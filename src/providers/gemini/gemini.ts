import { z } from 'zod';
import type { StreamingResponse, ProviderCapabilities, ToolCall, Message } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse } from '../types';
import { LLMError } from '../../retry/errors';
import { retry } from '../../retry';
import type { RetryConfig } from '../../retry/types';

// Gemini-specific types
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: any } }
  | { functionResponse: { name: string; response: any } };

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: any;
  }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    candidateCount?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: string;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE';
    };
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: GeminiContent;
    finishReason: string;
    index: number;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// Helper to convert Zod schema to Gemini-compatible JSON Schema
function zodToGeminiSchema(schema: z.ZodSchema): any {
  // Handle both Zod v3 and v4 structure
  const zodType = schema._def || (schema as any).def;

  if (!zodType) {
    throw new Error('Invalid Zod schema: missing _def property');
  }

  function processZodType(def: any): any {
    switch (def.type) {
      case 'string':
        const result: any = { type: 'string' };

        // Check for format constraints
        if (def.checks) {
          for (const check of def.checks) {
            // Handle both Zod v3 and v4 check structures
            const checkDef = check.def || check._def || check;

            if (checkDef.kind === 'uuid' || checkDef.format === 'uuid') {
              // Gemini doesn't support 'uuid' format, use pattern instead
              result.pattern =
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[4][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
            } else if (checkDef.kind === 'email' || checkDef.format === 'email') {
              // Gemini doesn't support 'email' format, use pattern instead
              result.pattern = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
            } else if (checkDef.kind === 'datetime' || checkDef.format === 'date-time') {
              // Gemini supports date-time format
              result.format = 'date-time';
            } else if (checkDef.kind === 'min') {
              result.minLength = checkDef.value;
            } else if (checkDef.kind === 'max') {
              result.maxLength = checkDef.value;
            }
          }
        }

        return result;
      case 'number':
        const numResult: any = { type: 'number' };

        // Check for number constraints
        if (def.checks) {
          for (const check of def.checks) {
            const checkDef = check.def || check._def || check;

            if (checkDef.kind === 'int') {
              numResult.type = 'integer';
            } else if (checkDef.kind === 'min') {
              numResult.minimum = checkDef.value;
            } else if (checkDef.kind === 'max') {
              numResult.maximum = checkDef.value;
            } else if (checkDef.kind === 'multipleOf') {
              numResult.multipleOf = checkDef.value;
            }
          }
        }

        return numResult;
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
        const arrayResult: any = {
          type: 'array',
          items: itemDef ? processZodType(itemDef) : { type: 'any' },
        };

        // Check for array constraints
        if (def.checks) {
          for (const check of def.checks) {
            const checkDef = check.def || check._def || check;

            if (checkDef.kind === 'min') {
              arrayResult.minItems = checkDef.value;
            } else if (checkDef.kind === 'max') {
              arrayResult.maxItems = checkDef.value;
            } else if (checkDef.kind === 'length') {
              arrayResult.minItems = checkDef.value;
              arrayResult.maxItems = checkDef.value;
            }
          }
        }

        return arrayResult;
      case 'object':
        const properties: any = {};
        const required: string[] = [];

        // Access shape directly from def
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          // Handle both Zod v3 and v4 - in v4, each field has its own _def
          const fieldDef = (value as any)._def || (value as any).def || value;
          properties[key] = processZodType(fieldDef);
          // Check if field is optional
          if (fieldDef.type !== 'optional') {
            required.push(key);
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
        };
      case 'optional':
        const innerDef = def.innerType?._def || def.innerType?.def || def.innerType;
        return innerDef ? processZodType(innerDef) : { type: 'any' };
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

export class GeminiProvider implements TypedProvider<'gemini'> {
  readonly name = 'gemini' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 1048576, // Gemini 1.5 Pro supports up to 1M tokens
  };

  private apiKey: string;
  private baseURL = 'https://generativelanguage.googleapis.com/v1beta';
  private retryConfig?: RetryConfig;

  constructor(apiKey: string, baseURL?: string, retryConfig?: RetryConfig) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    }
    this.retryConfig = retryConfig;
  }

  async chat<T = string>(
    request: ProviderChatRequest<'gemini'>,
  ): Promise<ProviderChatResponse<'gemini', T>> {
    const makeRequest = async () => {
      const geminiRequest = this.transformRequest(request);
      const model = request.model || 'gemini-1.5-pro-latest';

      const response = await fetch(`${this.baseURL}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(geminiRequest),
      });

      if (!response) {
        throw new LLMError(
          'Network error: No response received',
          undefined,
          'gemini',
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
        const errorMessage = `Gemini API error (${response.status}): ${error.error?.message || 'Unknown error'}`;
        const llmError = new LLMError(errorMessage, response.status, 'gemini', request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      const data = (await response.json()) as GeminiResponse;
      return this.transformResponse<T>(data, model, request.schema);
    };

    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }

    return makeRequest();
  }

  async stream<T = string>(request: ProviderChatRequest<'gemini'>): Promise<StreamingResponse<T>> {
    const geminiRequest = this.transformRequest(request);
    const model = request.model || 'gemini-1.5-pro-latest';

    const response = await fetch(`${this.baseURL}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(geminiRequest),
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))) as {
        error?: { message?: string };
      };
      throw new Error(
        `Gemini API error (${response.status}): ${error.error?.message || 'Unknown error'}`,
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = { promptTokenCount: 0, candidatesTokenCount: 0 };
    let finishReason: string | undefined;

    const streamResponse = {
      async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              // Gemini might prefix lines with "data: " in SSE format
              const jsonStr = line.startsWith('data: ') ? line.slice(6) : line;
              const data: GeminiResponse = JSON.parse(jsonStr);

              if (data.candidates && data.candidates[0]) {
                const candidate = data.candidates[0];

                // Extract text from parts
                if (candidate.content && candidate.content.parts) {
                  for (const part of candidate.content.parts) {
                    if ('text' in part && part.text) {
                      content += part.text;
                      // For structured output, we can't yield partial JSON
                      if (!request.schema) {
                        yield part.text as T;
                      }
                    }
                  }
                }

                // Update finish reason
                if (candidate.finishReason) {
                  finishReason = candidate.finishReason;
                }
              }

              // Update usage metadata
              if (data.usageMetadata) {
                usage = data.usageMetadata;
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'gemini', T>> {
        // Drain any remaining content
        for await (const _ of streamResponse) {
          // Just consume
        }

        let parsedContent: T;
        if (request.schema && content) {
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
          usage: {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.promptTokenCount + usage.candidatesTokenCount,
          },
          model,
          finishReason: finishReason as any,
        };
      },
    };

    return streamResponse;
  }

  supportsFeature(feature: string): boolean {
    return feature in this.capabilities && (this.capabilities as any)[feature] === true;
  }

  private transformRequest(request: ProviderChatRequest<'gemini'>): GeminiRequest {
    // Extract system message if present
    let systemInstruction: GeminiRequest['systemInstruction'];
    const contents: GeminiContent[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        systemInstruction = {
          parts: [{ text: typeof msg.content === 'string' ? msg.content : '' }],
        };
      } else {
        contents.push(this.transformMessage(msg));
      }
    }

    const geminiRequest: GeminiRequest = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    };

    // Handle structured output via schema using forced tool calling
    if (request.schema && !request.tools) {
      // Create a hidden tool for structured output
      const jsonSchema = zodToGeminiSchema(request.schema);
      geminiRequest.tools = [
        {
          functionDeclarations: [
            {
              name: 'respond_with_structured_output',
              description: 'Respond with structured data matching the required schema',
              parameters: jsonSchema,
            },
          ],
        },
      ];
      // Force the model to use this tool
      geminiRequest.toolConfig = {
        functionCallingConfig: { mode: 'ANY' },
      };
    }

    // Handle Gemini-specific features
    if (request.features) {
      if (request.features.safetySettings) {
        geminiRequest.safetySettings = request.features.safetySettings;
      }
    }

    // Handle tools
    if (request.tools) {
      geminiRequest.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
              ? zodToGeminiSchema(tool.parameters)
              : { type: 'object', properties: {} },
          })),
        },
      ];
    }

    // Handle tool choice
    if (request.toolChoice) {
      if (request.toolChoice === 'required') {
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'ANY' },
        };
      } else if (request.toolChoice === 'none') {
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'NONE' },
        };
      } else if (request.toolChoice === 'auto') {
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'AUTO' },
        };
      }
    }

    return geminiRequest;
  }

  private transformMessage(message: Message): GeminiContent {
    const role = message.role === 'assistant' ? 'model' : 'user';

    if (typeof message.content === 'string') {
      return {
        role,
        parts: [{ text: message.content }],
      };
    }

    // Handle multi-modal content
    const parts: GeminiPart[] = message.content.map((c) => {
      if (c.type === 'text') {
        return { text: c.text || '' };
      }
      // Handle image content if needed
      return { text: '[Image content]' };
    });

    return { role, parts };
  }

  private transformResponse<T>(
    response: GeminiResponse,
    model: string,
    schema?: z.ZodSchema,
  ): ProviderChatResponse<'gemini', T> {
    const candidate = response.candidates[0];
    if (!candidate) {
      throw new Error('No candidate in response');
    }
    let content = '';
    const toolCalls: ToolCall[] = [];

    // Process content parts
    if (candidate.content && candidate.content.parts) {
      for (let i = 0; i < candidate.content.parts.length; i++) {
        const part = candidate.content.parts[i];
        if (part && 'text' in part && part.text) {
          content += part.text;
        } else if (part && 'functionCall' in part) {
          toolCalls.push({
            id: `${part.functionCall.name}_${i}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          });
        }
      }
    }

    let parsedContent: T;

    // If we used schema-based tool calling, extract the structured data from tool call
    const structuredOutputTool = toolCalls.find(
      (tc) => tc.name === 'respond_with_structured_output',
    );
    if (schema && structuredOutputTool) {
      try {
        parsedContent = schema.parse(structuredOutputTool.arguments) as T;
      } catch {
        parsedContent = content as T;
      }
    } else if (schema && content) {
      try {
        const parsed = JSON.parse(content);
        parsedContent = schema.parse(parsed) as T;
      } catch {
        parsedContent = content as T;
      }
    } else {
      parsedContent = content as T;
    }

    const result: ProviderChatResponse<'gemini', T> = {
      content: parsedContent,
      usage: response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount,
            outputTokens: response.usageMetadata.candidatesTokenCount,
            totalTokens: response.usageMetadata.totalTokenCount,
          }
        : {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
      model,
      finishReason: candidate.finishReason as any,
    };

    // Only include tool calls if not using schema-based tool calling
    // or if there are other tool calls besides the structured output tool
    const nonStructuredToolCalls = toolCalls.filter(
      (tc) => tc.name !== 'respond_with_structured_output',
    );
    if (nonStructuredToolCalls.length > 0 && !schema) {
      result.toolCalls = nonStructuredToolCalls;
    }

    if (candidate.safetyRatings) {
      result.safetyRatings = candidate.safetyRatings;
    }

    return result;
  }
}
