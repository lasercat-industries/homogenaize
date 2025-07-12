import { z } from 'zod';
import type { 
  Provider, 
  ChatRequest, 
  ChatResponse, 
  StreamingResponse,
  ProviderCapabilities,
  Tool,
  ToolCall,
  Message
} from '../provider';
import type { 
  TypedProvider, 
  ProviderChatRequest, 
  ProviderChatResponse 
} from '../types';

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
  const zodType = schema._def;
  
  function processZodType(def: any): any {
    switch (def.type) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'array':
        return {
          type: 'array',
          items: processZodType(def.valueType._def)
        };
      case 'object':
        const properties: any = {};
        const required: string[] = [];
        
        // Access shape directly from def
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldSchema = processZodType((value as any)._def);
          // Remove the __isOptional marker and use it to determine required fields
          const isOptional = fieldSchema.__isOptional;
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
          additionalProperties: false
        };
      case 'optional':
        // For OpenAI, we need to handle optional fields differently
        // Return the inner type but mark that it's optional
        const innerType = processZodType(def.innerType._def);
        return { ...innerType, __isOptional: true };
      case 'enum':
        return {
          type: 'string',
          enum: def.values
        };
      case 'literal':
        return {
          type: typeof def.value,
          const: def.value
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
    maxTokens: 128000
  };

  private apiKey: string;
  private baseURL = 'https://api.openai.com/v1';

  constructor(apiKey: string, baseURL?: string) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    }
  }

  async chat(request: ProviderChatRequest<'openai'>): Promise<ProviderChatResponse<'openai'>> {
    const openAIRequest = this.transformRequest(request);
    
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openAIRequest)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`OpenAI API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
    }

    const data: OpenAIResponse = await response.json();
    return this.transformResponse(data);
  }

  async stream(request: ProviderChatRequest<'openai'>): Promise<StreamingResponse> {
    const openAIRequest = this.transformRequest(request);
    openAIRequest.stream = true;
    openAIRequest.stream_options = { include_usage: true };

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openAIRequest)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`OpenAI API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage: any;
    let model = '';
    let finishReason: any;

    return {
      async *[Symbol.asyncIterator]() {
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
                  yield chunkContent;
                }
                
                if (chunk.usage) {
                  usage = {
                    prompt_tokens: chunk.usage.prompt_tokens,
                    completion_tokens: chunk.usage.completion_tokens,
                    total_tokens: chunk.usage.total_tokens
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

      async complete(): Promise<ProviderChatResponse<'openai'>> {
        // Drain any remaining content
        for await (const _ of this) {
          // Just consume
        }

        return {
          content,
          usage: usage ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens
          } : {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0
          },
          model,
          finishReason
        };
      }
    };
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

    // Handle structured output via schema
    if (request.schema) {
      const jsonSchema = zodToOpenAISchema(request.schema);
      console.log('Converted schema:', JSON.stringify(jsonSchema, null, 2));
      openAIRequest.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: jsonSchema
        }
      };
    }

    // Handle tools
    if (request.tools) {
      openAIRequest.tools = request.tools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToOpenAISchema(tool.parameters),
          strict: true
        }
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
          function: { name: request.toolChoice.name }
        };
      }
    }

    return openAIRequest;
  }

  private transformMessage(message: Message): OpenAIMessage {
    if (typeof message.content === 'string') {
      return {
        role: message.role as any,
        content: message.content
      };
    }

    // Handle multi-modal content
    // For now, we'll just concatenate text content
    // Full image support would require base64 encoding
    const textContent = message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return {
      role: message.role as any,
      content: textContent
    };
  }

  private transformResponse(response: OpenAIResponse): ProviderChatResponse<'openai'> {
    const choice = response.choices[0];
    const message = choice.message;
    
    const result: ProviderChatResponse<'openai'> = {
      content: message.content || '',
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      },
      model: response.model,
      finishReason: choice.finish_reason,
      systemFingerprint: response.system_fingerprint
    };

    // Handle tool calls
    if (message.tool_calls) {
      result.toolCalls = message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }));
    }

    // Handle logprobs
    if (choice.logprobs) {
      result.logprobs = choice.logprobs.content.map(lp => ({
        token: lp.token,
        logprob: lp.logprob,
        topLogprobs: lp.top_logprobs
      }));
    }

    return result;
  }
}