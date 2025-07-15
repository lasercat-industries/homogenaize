import { z } from 'zod';
import type { StreamingResponse, ProviderCapabilities, Message } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse } from '../types';
import type { RetryConfig } from '../../retry/types';
import { retry } from '../../retry';
import { LLMError } from '../../retry/errors';

// OpenAI-specific types
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
    strict?: boolean;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  logprobs?: boolean;
  top_logprobs?: number;
  seed?: number;
  response_format?: {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: any;
  };
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint?: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    logprobs?: {
      content: Array<{
        token: string;
        logprob: number;
        top_logprobs?: Array<{
          token: string;
          logprob: number;
        }>;
      }>;
    };
  }>;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Helper to convert Zod schema to OpenAI-compatible JSON Schema
function zodToOpenAISchema(schema: z.ZodSchema): any {
  // Handle both Zod v3 and v4 structure
  const zodType = schema._def || (schema as any).def;

  if (!zodType) {
    throw new Error('Invalid Zod schema: missing _def property');
  }

  function processZodType(def: any): any {
    switch (def.type) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'array':
        const itemDef =
          def.valueType?._def ||
          def.valueType?.def ||
          def.valueType ||
          def.element?._def ||
          def.element?.def ||
          def.element;
        return {
          type: 'array',
          items: itemDef ? processZodType(itemDef) : { type: 'any' },
        };
      case 'object':
        const properties: any = {};
        const required: string[] = [];

        // Access shape directly from def
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          // Handle both Zod v3 and v4 - in v4, each field has its own _def
          const fieldDef = (value as any)._def || (value as any).def || value;
          const fieldSchema = processZodType(fieldDef);
          // Remove the __isOptional marker and use it to determine required fields
          // const isOptional = fieldSchema.__isOptional;
          delete fieldSchema.__isOptional;
          properties[key] = fieldSchema;

          // OpenAI requires all fields to be in the required array, even optional ones
          // For optional fields, we'll handle it differently in the API
          required.push(key);
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
          additionalProperties: false,
        };
      case 'optional':
        // For OpenAI, we need to handle optional fields differently
        // Return the inner type but mark that it's optional
        const innerDef = def.innerType?._def || def.innerType?.def || def.innerType;
        const innerType = innerDef ? processZodType(innerDef) : { type: 'any' };
        return { ...innerType, __isOptional: true };
      case 'enum':
        return {
          type: 'string',
          enum: def.values,
        };
      case 'literal':
        return {
          type: typeof def.value,
          const: def.value,
        };
      default:
        // Fallback for unsupported types
        return { type: 'string' };
    }
  }

  return processZodType(zodType);
}

export class OpenAIProvider implements TypedProvider<'openai'> {
  readonly name = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 128000,
  };

  private apiKey: string;
  private baseURL = 'https://api.openai.com/v1';
  private retryConfig?: RetryConfig;

  constructor(apiKey: string, baseURL?: string, retryConfig?: RetryConfig) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    }
    this.retryConfig = retryConfig;
  }

  async chat<T = string>(
    request: ProviderChatRequest<'openai'>,
  ): Promise<ProviderChatResponse<'openai', T>> {
    const makeRequest = async () => {
      const openAIRequest = this.transformRequest(request);

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(openAIRequest),
      });

      if (!response) {
        throw new LLMError(
          'Network error: No response received',
          undefined,
          'openai',
          request.model,
        );
      }

      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ error: { message: response.statusText } }))) as {
          error?: { message?: string };
        };

        // Extract retry-after header if present
        const retryAfter = response.headers.get('Retry-After');
        const errorMessage = `OpenAI API error (${response.status}): ${error.error?.message || 'Unknown error'}`;
        const llmError = new LLMError(errorMessage, response.status, 'openai', request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      const data = (await response.json()) as OpenAIResponse;
      return this.transformResponse<T>(data, request.schema);
    };

    // Use retry wrapper if config is provided
    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }

    return makeRequest();
  }

  async stream<T = string>(request: ProviderChatRequest<'openai'>): Promise<StreamingResponse<T>> {
    const makeRequest = async (): Promise<Response> => {
      const openAIRequest = this.transformRequest(request);
      openAIRequest.stream = true;
      openAIRequest.stream_options = { include_usage: true };

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(openAIRequest),
      });

      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ error: { message: response.statusText } }))) as {
          error?: { message?: string };
        };

        const retryAfter = response.headers.get('Retry-After');
        const llmError = new LLMError(
          error.error?.message || 'Unknown error',
          response.status,
          'openai',
          request.model,
        );
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      return response;
    };

    // Get response with retry support
    const response = this.retryConfig
      ? await retry(makeRequest, this.retryConfig)
      : await makeRequest();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage: any;
    let model = '';
    let finishReason: any;
    let toolCallArguments = '';
    let currentToolCall: any = null;

    const streamResponse = {
      async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const chunk: OpenAIStreamChunk = JSON.parse(data);
                model = chunk.model;

                if (chunk.choices[0]?.delta?.content) {
                  const chunkContent = chunk.choices[0].delta.content;
                  content += chunkContent;
                  // For structured output, we can't yield partial JSON
                  // So we only yield for string content
                  if (!request.schema) {
                    yield chunkContent as T;
                  }
                }

                // Handle tool call streaming
                if (chunk.choices[0]?.delta?.tool_calls) {
                  for (const toolCallDelta of chunk.choices[0].delta.tool_calls) {
                    if (toolCallDelta.id) {
                      currentToolCall = toolCallDelta;
                      toolCallArguments = '';
                    }
                    if (toolCallDelta.function?.arguments) {
                      toolCallArguments += toolCallDelta.function.arguments;
                    }
                  }
                }

                if (chunk.usage) {
                  usage = {
                    prompt_tokens: chunk.usage.prompt_tokens,
                    completion_tokens: chunk.usage.completion_tokens,
                    total_tokens: chunk.usage.total_tokens,
                  };
                }

                if (chunk.choices[0]?.finish_reason) {
                  finishReason = chunk.choices[0].finish_reason;
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'openai', T>> {
        // Drain any remaining content
        for await (const _ of streamResponse) {
          // Just consume
        }

        let parsedContent: T;

        // If we used schema-based tool calling, extract from tool call
        if (
          request.schema &&
          toolCallArguments &&
          currentToolCall?.function?.name === 'respond_with_structured_output'
        ) {
          try {
            const parsed = JSON.parse(toolCallArguments);
            parsedContent = request.schema.parse(parsed) as T;
          } catch {
            parsedContent = content as T;
          }
        } else if (request.schema && content) {
          try {
            const parsed = JSON.parse(content);
            parsedContent = request.schema.parse(parsed) as T;
          } catch {
            parsedContent = content as T;
          }
        } else {
          parsedContent = content as T;
        }

        return {
          content: parsedContent,
          usage: usage
            ? {
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              }
            : {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
          model,
          finishReason,
        };
      },
    };

    return streamResponse;
  }

  supportsFeature(feature: string): boolean {
    return feature in this.capabilities && (this.capabilities as any)[feature] === true;
  }

  private transformRequest(request: ProviderChatRequest<'openai'>): OpenAIRequest {
    const openAIRequest: OpenAIRequest = {
      model: request.model || 'gpt-4o-mini', // Default fallback
      messages: request.messages.map(this.transformMessage),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };

    // Handle OpenAI-specific features
    if (request.features) {
      if (request.features.logprobs !== undefined) {
        openAIRequest.logprobs = request.features.logprobs;
      }
      if (request.features.topLogprobs !== undefined) {
        openAIRequest.top_logprobs = request.features.topLogprobs;
      }
      if (request.features.seed !== undefined) {
        openAIRequest.seed = request.features.seed;
      }
      if (request.features.responseFormat !== undefined) {
        openAIRequest.response_format = request.features.responseFormat;
      }
    }

    // Handle structured output via schema using forced tool calling
    if (request.schema && !request.tools) {
      // Create a hidden tool for structured output
      const jsonSchema = zodToOpenAISchema(request.schema);
      openAIRequest.tools = [
        {
          type: 'function' as const,
          function: {
            name: 'respond_with_structured_output',
            description: 'Respond with structured data matching the required schema',
            parameters: jsonSchema,
            strict: true,
          },
        },
      ];
      // Force the model to use this tool
      openAIRequest.tool_choice = 'required';
    }

    // Handle tools
    if (request.tools) {
      openAIRequest.tools = request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToOpenAISchema(tool.parameters),
          strict: true,
        },
      }));
    }

    // Handle tool choice
    if (request.toolChoice) {
      if (request.toolChoice === 'required') {
        openAIRequest.tool_choice = 'required';
      } else if (request.toolChoice === 'none') {
        openAIRequest.tool_choice = 'none';
      } else if (request.toolChoice === 'auto') {
        openAIRequest.tool_choice = 'auto';
      } else if (typeof request.toolChoice === 'object' && 'name' in request.toolChoice) {
        openAIRequest.tool_choice = {
          type: 'function',
          function: { name: request.toolChoice.name },
        };
      }
    }

    return openAIRequest;
  }

  private transformMessage(message: Message): OpenAIMessage {
    if (typeof message.content === 'string') {
      return {
        role: message.role as any,
        content: message.content,
      };
    }

    // Handle multi-modal content
    // For now, we'll just concatenate text content
    // Full image support would require base64 encoding
    const textContent = message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    return {
      role: message.role as any,
      content: textContent,
    };
  }

  private transformResponse<T>(
    response: OpenAIResponse,
    schema?: z.ZodSchema,
  ): ProviderChatResponse<'openai', T> {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choice in response');
    }
    const message = choice.message;

    let content: T;

    // If we used schema-based tool calling, extract the structured data from tool call
    if (schema && message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls.find(
        (tc) => tc.function.name === 'respond_with_structured_output',
      );
      if (toolCall) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          content = schema.parse(parsed) as T;
        } catch (error) {
          content = (message.content || '') as T;
        }
      } else {
        content = (message.content || '') as T;
      }
    } else if (schema && message.content) {
      try {
        const parsed = JSON.parse(message.content);
        content = schema.parse(parsed) as T;
      } catch {
        content = message.content as T;
      }
    } else {
      content = (message.content || '') as T;
    }

    const result: ProviderChatResponse<'openai', T> = {
      content,
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      model: response.model,
      finishReason: choice.finish_reason,
      systemFingerprint: response.system_fingerprint,
    };

    // Handle tool calls - but not if we used schema-based tool calling
    if (message.tool_calls && !schema) {
      result.toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    // Handle logprobs
    if (choice.logprobs) {
      result.logprobs = choice.logprobs.content.map((lp) => ({
        token: lp.token,
        logprob: lp.logprob,
        topLogprobs: lp.top_logprobs,
      }));
    }

    return result;
  }
}
