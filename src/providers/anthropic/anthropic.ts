import { z } from 'zod';
import type { StreamingResponse, ProviderCapabilities, ToolCall, Message } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import type { RetryConfig } from '../../retry/types';
import { retry } from '../../retry';
import { LLMError } from '../../retry/errors';
import type {
  ZodDef,
  ZodArrayDef,
  ZodObjectDef,
  ZodOptionalDef,
  ZodEnumDef,
  ZodLiteralDef,
} from '../zod-types';
import { getZodDef } from '../zod-types';
import type { JSONSchemaType } from 'ajv';
import type { GenericJSONSchema } from '../../types/schema';
import { isZodSchema, isJSONSchema } from '../../utils/schema-utils';
import { validateJSONSchema } from '../../utils/json-schema-validator';
import { normalizeAnthropicFinishReason } from './anthropic-types';
import type { AnthropicStopReason } from './anthropic-types';

// Anthropic-specific types
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'thinking'; text: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: GenericJSONSchema;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  max_thinking_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContent[];
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    thinking_tokens?: number;
  };
}

// Streaming event types
interface MessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: [];
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

// Helper to convert Zod schema to Anthropic-compatible JSON Schema
function zodToAnthropicSchema(schema: z.ZodSchema): GenericJSONSchema {
  const zodType = getZodDef(schema);

  if (!zodType) {
    throw new Error('Invalid Zod schema: missing _def property');
  }

  function processZodType(def: ZodDef): GenericJSONSchema {
    switch (def.type) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'array': {
        const arrayDef = def as ZodArrayDef;
        const itemDef = getZodDef(arrayDef.valueType) || getZodDef(arrayDef.element);
        return {
          type: 'array',
          items: itemDef ? processZodType(itemDef) : { type: 'object', properties: {} },
        };
      }
      case 'object': {
        const objectDef = def as ZodObjectDef;
        const properties: Record<string, GenericJSONSchema> = {};
        const required: string[] = [];

        // Access shape directly from def
        const shape = objectDef.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldDef = getZodDef(value);
          if (fieldDef) {
            const fieldSchema = processZodType(fieldDef);
            properties[key] = fieldSchema;

            // Check if field is optional
            if (fieldDef.type !== 'optional') {
              required.push(key);
            }
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        };
      }
      case 'optional': {
        const optionalDef = def as ZodOptionalDef;
        const innerDef = getZodDef(optionalDef.innerType);
        return innerDef ? processZodType(innerDef) : { type: 'object', properties: {} };
      }
      case 'enum': {
        const enumDef = def as ZodEnumDef;
        return {
          type: 'string',
          enum: enumDef.values || [],
        };
      }
      case 'literal': {
        const literalDef = def as ZodLiteralDef;
        const valueType = typeof literalDef.value;
        return {
          type: valueType === 'string' ? 'string' : valueType === 'number' ? 'number' : 'boolean',
          const: literalDef.value,
        };
      }
      default:
        // Fallback for unsupported types
        return { type: 'object', properties: {} };
    }
  }

  return processZodType(zodType);
}

export class AnthropicProvider implements TypedProvider<'anthropic'> {
  readonly name = 'anthropic' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 200000, // Claude 3 supports up to 200k tokens
  };

  private apiKey: string;
  private baseURL = 'https://api.anthropic.com/v1';
  private apiVersion = '2023-06-01';
  private retryConfig?: RetryConfig;

  constructor(apiKey: string, baseURL?: string, retryConfig?: RetryConfig) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    }
    this.retryConfig = retryConfig;
  }

  async chat<T = string>(
    request: ProviderChatRequest<'anthropic', T>,
  ): Promise<ProviderChatResponse<'anthropic', T>> {
    const makeRequest = async () => {
      const anthropicRequest = this.transformRequest(request);
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(anthropicRequest),
      });

      if (!response) {
        throw new LLMError(
          'Network error: No response received',
          undefined,
          'anthropic',
          request.model,
        );
      }

      if (!response.ok) {
        const error = (await response
          .json()
          .catch(() => ({ error: { message: response.statusText } }))) as {
          error?: { message?: string };
        };

        const retryAfter = response.headers.get('Retry-After');
        const errorMessage = `Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`;
        const llmError = new LLMError(errorMessage, response.status, 'anthropic', request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      const data = (await response.json()) as AnthropicResponse;
      return this.transformResponse<T>(data, request.schema);
    };

    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }

    return makeRequest();
  }

  async stream<T = string>(
    request: ProviderChatRequest<'anthropic', T>,
  ): Promise<StreamingResponse<T>> {
    const anthropicRequest = this.transformRequest(request);
    anthropicRequest.stream = true;

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(anthropicRequest),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))) as {
        error?: { message?: string };
      };
      throw new Error(
        `Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`,
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = { input_tokens: 0, output_tokens: 0 };
    let model = '';
    let anthropicFinishReason: string | undefined;
    let currentToolUse: { id: string; name: string; input?: unknown } | null = null;
    let toolUseInput = '';
    // let messageId = ''; // Not needed since id is not part of response type

    const streamResponse = {
      async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              // We don't need the event type for now
              continue;
            }

            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (!data || data === '[DONE]') continue;

              try {
                const event = JSON.parse(data);

                switch (event.type) {
                  case 'message_start': {
                    const msgStart = event as MessageStartEvent;
                    // messageId = msgStart.message.id;
                    model = msgStart.message.model;
                    usage.input_tokens = msgStart.message.usage.input_tokens;
                    break;
                  }

                  case 'content_block_delta': {
                    const delta = event as ContentBlockDeltaEvent;
                    if (delta.delta.type === 'text_delta') {
                      const text = delta.delta.text;
                      content += text;
                      // For structured output, we can't yield partial JSON
                      if (!request.schema) {
                        yield text as T;
                      }
                    } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
                      toolUseInput += event.delta.partial_json;
                    }
                    break;
                  }

                  case 'message_delta': {
                    const msgDelta = event as MessageDeltaEvent;
                    usage.output_tokens = msgDelta.usage.output_tokens;
                    anthropicFinishReason = msgDelta.delta.stop_reason;
                    break;
                  }

                  case 'content_block_start': {
                    if (event.content_block?.type === 'tool_use') {
                      currentToolUse = event.content_block;
                      toolUseInput = '';
                    }
                    break;
                  }

                  // Duplicate case removed - handled in first content_block_delta case
                }
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'anthropic', T>> {
        // Drain any remaining content
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of streamResponse) {
          // Just consume
        }

        let parsedContent: T;

        // If we used schema-based tool calling, extract from tool call
        if (
          request.schema &&
          currentToolUse?.name === 'respond_with_structured_output' &&
          toolUseInput
        ) {
          try {
            const parsed = JSON.parse(toolUseInput);
            if (isZodSchema(request.schema)) {
              parsedContent = request.schema.parse(parsed) as T;
            } else if (isJSONSchema(request.schema)) {
              const validation = validateJSONSchema<T>(request.schema, parsed);
              if (validation.valid) {
                parsedContent = validation.data;
              } else {
                throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
              }
            } else {
              parsedContent = parsed as T;
            }
          } catch {
            parsedContent = content as T;
          }
        } else if (request.schema && content) {
          try {
            const parsed = JSON.parse(content);
            if (isZodSchema(request.schema)) {
              parsedContent = request.schema.parse(parsed) as T;
            } else if (isJSONSchema(request.schema)) {
              const validation = validateJSONSchema<T>(request.schema, parsed);
              if (validation.valid) {
                parsedContent = validation.data;
              } else {
                throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
              }
            } else {
              parsedContent = parsed as T;
            }
          } catch {
            parsedContent = content as T;
          }
        } else {
          parsedContent = content as T;
        }

        // Map Anthropic finish reasons to standard ones
        const finishReason = anthropicFinishReason
          ? normalizeAnthropicFinishReason(anthropicFinishReason)
          : undefined;

        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens,
          },
          model,
          finishReason,
          // id: messageId // Not part of the response type
        };
      },
    };

    return streamResponse;
  }

  supportsFeature(feature: string): boolean {
    return (
      feature in this.capabilities &&
      (this.capabilities as unknown as Record<string, boolean>)[feature] === true
    );
  }

  private transformRequest<T = string>(
    request: ProviderChatRequest<'anthropic', T>,
  ): AnthropicRequest {
    // Extract system message if present
    let system: string | undefined;
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system = typeof msg.content === 'string' ? msg.content : '';
      } else {
        messages.push(this.transformMessage(msg));
      }
    }

    const anthropicRequest: AnthropicRequest = {
      model: request.model || 'claude-3-opus-20240229', // Default fallback
      messages,
      system,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature,
    };

    // Handle structured output via schema using forced tool calling
    if (request.schema && !request.tools) {
      // Create a hidden tool for structured output
      let jsonSchema: GenericJSONSchema;

      if (isZodSchema(request.schema)) {
        jsonSchema = zodToAnthropicSchema(request.schema);
      } else if (isJSONSchema(request.schema)) {
        // Use JSON Schema directly
        jsonSchema = request.schema as GenericJSONSchema;
      } else {
        throw new Error('Invalid schema type provided');
      }

      anthropicRequest.tools = [
        {
          name: 'respond_with_structured_output',
          description: 'Respond with structured data matching the required schema',
          input_schema: jsonSchema,
        },
      ];
      // Force the model to use this specific tool
      anthropicRequest.tool_choice = { type: 'tool', name: 'respond_with_structured_output' };
    }

    // Handle Anthropic-specific features
    if (request.features) {
      if (request.features.thinking && request.features.maxThinkingTokens) {
        anthropicRequest.max_thinking_tokens = request.features.maxThinkingTokens;
      }
      // cacheControl would be handled here when implemented
    }

    // Handle tools
    if (request.tools) {
      anthropicRequest.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
          ? zodToAnthropicSchema(tool.parameters)
          : { type: 'object', properties: {} },
      }));
    }

    if (request.toolChoice === 'required' && request.tools?.length !== 1) {
      throw new Error('Only 1 tool can be provided when using toolChoice: required');
    }

    // Handle tool choice
    if (request.toolChoice) {
      switch (request.toolChoice) {
        case 'required': {
          anthropicRequest.tool_choice = { type: 'tool', name: request.tools?.[0]?.name };

          break;
        }
        case 'none': {
          // Don't include tools if none
          delete anthropicRequest.tools;

          break;
        }
        case 'auto': {
          anthropicRequest.tool_choice = { type: 'auto' };

          break;
        }
        default:
          if (typeof request.toolChoice === 'object' && 'name' in request.toolChoice) {
            anthropicRequest.tool_choice = {
              type: 'tool',
              name: request.toolChoice.name,
            };
          }
      }
    }

    return anthropicRequest;
  }

  private transformMessage(message: Message): AnthropicMessage {
    if (typeof message.content === 'string') {
      return {
        role: message.role as 'user' | 'assistant',
        content: message.content,
      };
    }

    // Handle multi-modal content
    const anthropicContent: AnthropicContent[] = message.content.map((c) => {
      if (c.type === 'text') {
        return { type: 'text' as const, text: c.text || '' };
      }
      // Handle image content if needed
      return { type: 'text' as const, text: '[Image content]' };
    });

    return {
      role: message.role as 'user' | 'assistant',
      content: anthropicContent,
    };
  }

  private transformResponse<T>(
    response: AnthropicResponse,
    schema?: z.ZodSchema<T> | JSONSchemaType<T> | GenericJSONSchema,
  ): ProviderChatResponse<'anthropic', T> {
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];

    // Process content blocks
    for (const block of response.content) {
      switch (block.type) {
        case 'text': {
          content += block.text;

          break;
        }
        case 'thinking': {
          thinking += block.text;

          break;
        }
        case 'tool_use': {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
          });

          break;
        }
        // No default
      }
    }

    let parsedContent: T;

    // If we used schema-based tool calling, extract the structured data from tool call
    const structuredOutputTool = toolCalls.find(
      (tc) => tc.name === 'respond_with_structured_output',
    );
    if (schema && structuredOutputTool) {
      try {
        if (isZodSchema(schema)) {
          parsedContent = schema.parse(structuredOutputTool.arguments) as T;
        } else if (isJSONSchema(schema)) {
          const validation = validateJSONSchema<T>(schema, structuredOutputTool.arguments);
          if (validation.valid) {
            parsedContent = validation.data;
          } else {
            throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
          }
        } else {
          parsedContent = structuredOutputTool.arguments as T;
        }
      } catch {
        parsedContent = content as T;
      }
    } else if (schema && content) {
      try {
        const parsed = JSON.parse(content);
        if (isZodSchema(schema)) {
          parsedContent = schema.parse(parsed) as T;
        } else if (isJSONSchema(schema)) {
          const validation = validateJSONSchema<T>(schema, parsed);
          if (validation.valid) {
            parsedContent = validation.data;
          } else {
            throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
          }
        } else {
          parsedContent = parsed as T;
        }
      } catch {
        parsedContent = content as T;
      }
    } else {
      parsedContent = content as T;
    }

    const totalTokens =
      response.usage.input_tokens +
      response.usage.output_tokens +
      (response.usage.thinking_tokens || 0);

    // Normalize finish reason
    const finishReason = normalizeAnthropicFinishReason(response.stop_reason);

    const result: ProviderChatResponse<'anthropic', T> = {
      content: parsedContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: totalTokens,
      },
      model: response.model,
      finishReason,
      // id: response.id // Not part of the response type
    };

    // Only include tool calls if not using schema-based tool calling
    // or if there are other tool calls besides the structured output tool
    const nonStructuredToolCalls = toolCalls.filter(
      (tc) => tc.name !== 'respond_with_structured_output',
    );
    if (nonStructuredToolCalls.length > 0 && !schema) {
      result.toolCalls = nonStructuredToolCalls;
    }

    if (thinking) {
      result.thinking = thinking;
    }

    return result;
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseURL}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))) as {
        error?: { message?: string };
      };
      throw new LLMError(
        `Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`,
        response.status,
        'anthropic',
      );
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        display_name: string;
        created_at: string;
      }>;
    };

    return data.data.map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      created: new Date(model.created_at).getTime() / 1000,
    }));
  }
}
