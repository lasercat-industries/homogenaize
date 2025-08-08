import { z } from 'zod';
import type { StreamingResponse, ProviderCapabilities, ToolCall, Message } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import { LLMError } from '../../retry/errors';
import { retry } from '../../retry';
import type { RetryConfig } from '../../retry/types';
import type { JSONSchemaType } from 'ajv';
import type { GenericJSONSchema } from '../../types/schema';
import { isZodSchema, isJSONSchema } from '../../utils/schema-utils';
import { validateJSONSchema } from '../../utils/json-schema-validator';
import { getLogger } from '../../utils/logger';
import type {
  ZodDef,
  ZodArrayDef,
  ZodObjectDef,
  ZodOptionalDef,
  ZodEnumDef,
  ZodLiteralDef,
  ZodStringDef,
  ZodNumberDef,
} from '../zod-types';
import { getZodDef } from '../zod-types';

// Gemini-specific types
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: GenericJSONSchema;
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

// Helper to normalize Gemini finish reasons to standard format
function normalizeGeminiFinishReason(
  reason: string,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | undefined {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    default:
      return undefined;
  }
}

// Helper to convert Zod schema to Gemini-compatible JSON Schema
function zodToGeminiSchema(schema: z.ZodSchema): GenericJSONSchema {
  const zodType = getZodDef(schema);

  if (!zodType) {
    throw new Error('Invalid Zod schema: missing _def property');
  }

  function processZodType(def: ZodDef): GenericJSONSchema {
    switch (def.type) {
      case 'string': {
        const stringDef = def as ZodStringDef;
        const result: GenericJSONSchema = { type: 'string' };

        // Check for format constraints
        if (stringDef.checks) {
          for (const check of stringDef.checks) {
            // Handle both Zod v3 and v4 check structures
            const checkDef = check.def || check._def || check;
            if (!checkDef || typeof checkDef !== 'object') continue;

            const checkObj = checkDef as { kind?: string; format?: string; value?: unknown };

            if (checkObj.kind === 'uuid' || checkObj.format === 'uuid') {
              // Gemini doesn't support 'uuid' format, use pattern instead
              result.pattern =
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[4][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
            } else if (checkObj.kind === 'email' || checkObj.format === 'email') {
              // Gemini doesn't support 'email' format, use pattern instead
              result.pattern = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
            } else if (checkObj.kind === 'datetime' || checkObj.format === 'date-time') {
              // Gemini supports date-time format
              result.format = 'date-time';
            } else if (checkObj.kind === 'min') {
              result.minLength = checkObj.value as number;
            } else if (checkObj.kind === 'max') {
              result.maxLength = checkObj.value as number;
            }
          }
        }

        return result;
      }
      case 'number': {
        const numberDef = def as ZodNumberDef;
        const numResult: GenericJSONSchema = { type: 'number' };

        // Check for number constraints
        if (numberDef.checks) {
          for (const check of numberDef.checks) {
            const checkDef = check.def || check._def || check;
            if (!checkDef || typeof checkDef !== 'object') continue;

            const checkObj = checkDef as { kind?: string; value?: unknown };

            switch (checkObj.kind) {
              case 'int': {
                numResult.type = 'integer';
                break;
              }
              case 'min': {
                numResult.minimum = checkObj.value as number;
                break;
              }
              case 'max': {
                numResult.maximum = checkObj.value as number;
                break;
              }
              case 'multipleOf': {
                numResult.multipleOf = checkObj.value as number;
                break;
              }
              // No default
            }
          }
        }

        return numResult;
      }
      case 'boolean':
        return { type: 'boolean' };
      case 'array': {
        const arrayDef = def as ZodArrayDef;
        const itemDef = getZodDef(arrayDef.valueType) || getZodDef(arrayDef.element);
        const arrayResult: GenericJSONSchema = {
          type: 'array',
          items: itemDef ? processZodType(itemDef) : { type: 'string' },
        };

        // Check for array constraints
        if (arrayDef.checks) {
          for (const check of arrayDef.checks) {
            const checkDef = check.def || check._def || check;
            if (!checkDef || typeof checkDef !== 'object') continue;

            const checkObj = checkDef as { kind?: string; value?: unknown };

            switch (checkObj.kind) {
              case 'min': {
                arrayResult.minItems = checkObj.value as number;
                break;
              }
              case 'max': {
                arrayResult.maxItems = checkObj.value as number;
                break;
              }
              case 'length': {
                arrayResult.minItems = checkObj.value as number;
                arrayResult.maxItems = checkObj.value as number;
                break;
              }
              // No default
            }
          }
        }

        return arrayResult;
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
            properties[key] = processZodType(fieldDef);
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
        return innerDef ? processZodType(innerDef) : { type: 'string' };
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
    request: ProviderChatRequest<'gemini', T>,
  ): Promise<ProviderChatResponse<'gemini', T>> {
    const logger = getLogger('gemini');
    const model = request.model || 'gemini-1.5-pro-latest';
    logger.info('Gemini chat request initiated', { model });

    const makeRequest = async () => {
      const geminiRequest = this.transformRequest(request);
      logger.debug('Transformed request for Gemini API', {
        hasSystemInstruction: !!geminiRequest.systemInstruction,
        contentCount: geminiRequest.contents.length,
        hasTools: !!geminiRequest.tools,
      });

      const response = await fetch(`${this.baseURL}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(geminiRequest),
      });

      if (!response) {
        logger.error('Network error: No response received from Gemini');
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
        logger.error('Gemini API error', {
          status: response.status,
          error: error.error?.message,
          retryAfter,
        });
        const llmError = new LLMError(errorMessage, response.status, 'gemini', request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      const data = (await response.json()) as GeminiResponse;
      logger.info('Gemini chat response received', {
        usage: data.usageMetadata,
        candidateCount: data.candidates?.length,
        finishReason: data.candidates?.[0]?.finishReason,
      });
      return this.transformResponse<T>(data, model, request.schema);
    };

    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }

    return makeRequest();
  }

  async stream<T = string>(
    request: ProviderChatRequest<'gemini', T>,
  ): Promise<StreamingResponse<T>> {
    const logger = getLogger('gemini');
    const model = request.model || 'gemini-1.5-pro-latest';
    logger.info('Gemini stream request initiated', { model });

    const geminiRequest = this.transformRequest(request);
    logger.debug('Transformed streaming request for Gemini API');

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
      logger.error('Gemini streaming API error', {
        status: response.status,
        error: error.error?.message,
      });
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
            } catch {
              // Ignore parsing errors
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'gemini', T>> {
        // Drain any remaining content
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of streamResponse) {
          // Just consume
        }

        let parsedContent: T;
        if (request.schema && content) {
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

        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.promptTokenCount + usage.candidatesTokenCount,
          },
          model,
          finishReason: normalizeGeminiFinishReason(finishReason || ''),
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

  private transformRequest<T = string>(request: ProviderChatRequest<'gemini', T>): GeminiRequest {
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
      let jsonSchema: GenericJSONSchema;

      if (isZodSchema(request.schema)) {
        jsonSchema = zodToGeminiSchema(request.schema);
      } else if (isJSONSchema(request.schema)) {
        // Use JSON Schema directly
        jsonSchema = request.schema as GenericJSONSchema;
      } else {
        throw new Error('Invalid schema type provided');
      }

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
      switch (request.toolChoice) {
        case 'required': {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: 'ANY' },
          };
          break;
        }
        case 'none': {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: 'NONE' },
          };
          break;
        }
        case 'auto': {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: 'AUTO' },
          };
          break;
        }
        // No default
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
    schema?: z.ZodSchema<T> | JSONSchemaType<T> | GenericJSONSchema,
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
      finishReason: normalizeGeminiFinishReason(candidate.finishReason),
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

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseURL}/models`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))) as {
        error?: { message?: string };
      };
      throw new LLMError(
        `Gemini API error (${response.status}): ${error.error?.message || 'Unknown error'}`,
        response.status,
        'gemini',
      );
    }

    const data = (await response.json()) as {
      models: Array<{
        name: string;
        displayName: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
    };

    return data.models.map((model) => ({
      id: model.name.replace('models/', ''),
      name: model.displayName,
      description: model.description,
    }));
  }
}
