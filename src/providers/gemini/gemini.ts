import { z, ZodError } from 'zod';
import type { StreamingResponse, ProviderCapabilities, ToolCall, Message } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import { LLMError, ValidationError } from '../../retry/errors';
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

// Gemini native structured output schema format
// Uses uppercase type names and includes propertyOrdering
interface GeminiNativeSchema {
  type: 'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  format?: string;
  enum?: string[];
  properties?: Record<string, GeminiNativeSchema>;
  required?: string[];
  propertyOrdering?: string[];
  items?: GeminiNativeSchema;
  minItems?: number;
  maxItems?: number;
  nullable?: boolean;
  description?: string;
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
    responseSchema?: GeminiNativeSchema;
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

            const checkObj = checkDef as {
              kind?: string;
              format?: string;
              value?: unknown;
            };

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
        let enumValues: string[] = [];

        // Zod can store enum values in different fields
        if (enumDef.values) {
          enumValues = enumDef.values;
        } else if (enumDef.options) {
          enumValues = enumDef.options;
        } else if (enumDef.entries) {
          enumValues = Object.values(enumDef.entries);
        }

        return {
          type: 'string',
          enum: enumValues,
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

// Convert JSON Schema to Gemini's native structured output format
function jsonSchemaToGeminiNativeSchema(schema: GenericJSONSchema): GeminiNativeSchema {
  const logger = getLogger('gemini-json-schema');
  logger.debug('Converting JSON Schema to Gemini native format');

  function convertType(jsonType: string | undefined): GeminiNativeSchema['type'] {
    switch (jsonType) {
      case 'string':
        return 'STRING';
      case 'number':
        return 'NUMBER';
      case 'integer':
        return 'INTEGER';
      case 'boolean':
        return 'BOOLEAN';
      case 'array':
        return 'ARRAY';
      case 'object':
        return 'OBJECT';
      default:
        return 'STRING';
    }
  }

  function processSchema(jsonSchema: GenericJSONSchema): GeminiNativeSchema {
    // Handle basic types
    const result: GeminiNativeSchema = {
      type: convertType(jsonSchema.type as string),
    };

    // Handle anyOf (for nullable patterns)
    if (jsonSchema.anyOf && Array.isArray(jsonSchema.anyOf)) {
      // Check if it's a nullable pattern [type, null]
      if (jsonSchema.anyOf.length === 2 && jsonSchema.anyOf.some((s) => s.type === 'null')) {
        const nonNullSchema = jsonSchema.anyOf.find((s) => s.type !== 'null');
        if (nonNullSchema) {
          const converted = processSchema(nonNullSchema);
          converted.nullable = true;
          return converted;
        }
      }
      // For other anyOf patterns, take the first non-null option
      const firstNonNull = jsonSchema.anyOf.find((s) => s.type !== 'null') || jsonSchema.anyOf[0];
      if (firstNonNull) {
        return processSchema(firstNonNull);
      }
    }

    // Handle object properties recursively
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const convertedProperties: Record<string, GeminiNativeSchema> = {};

      for (const [key, prop] of Object.entries(jsonSchema.properties)) {
        if (prop) {
          // Recursively process each property
          convertedProperties[key] = processSchema(prop);
        }
      }

      result.properties = convertedProperties;
      if (jsonSchema.required) {
        result.required = jsonSchema.required;
      }
    }

    // Handle array items recursively
    if (jsonSchema.type === 'array' && jsonSchema.items) {
      if (Array.isArray(jsonSchema.items)) {
        // Tuple-style array - take first item as the type for all
        if (jsonSchema.items[0]) {
          result.items = processSchema(jsonSchema.items[0]);
        }
      } else {
        result.items = processSchema(jsonSchema.items);
      }
    }

    // Handle enums
    if (jsonSchema.enum && Array.isArray(jsonSchema.enum)) {
      result.enum = jsonSchema.enum as string[];
    }

    // Handle format
    if (jsonSchema.format) {
      result.format = jsonSchema.format;
    }

    // Handle description
    if (jsonSchema.description && typeof jsonSchema.description === 'string') {
      result.description = jsonSchema.description;
    }

    return result;
  }

  return processSchema(schema);
}

// Convert Zod schema to Gemini's native structured output format
function zodToGeminiNativeSchema(schema: z.ZodSchema): GeminiNativeSchema {
  const logger = getLogger('gemini-schema');
  logger.debug('Converting Zod schema to Gemini native format');

  const zodType = getZodDef(schema);

  if (!zodType) {
    logger.error('Invalid Zod schema: missing _def property');
    throw new Error('Invalid Zod schema: missing _def property');
  }

  function processZodType(def: ZodDef): GeminiNativeSchema {
    logger.verbose('Processing Zod type for Gemini native', { type: def.type });

    switch (def.type) {
      case 'string': {
        const stringDef = def as ZodStringDef;
        const result: GeminiNativeSchema = { type: 'STRING' };

        // Check for string format constraints
        if (stringDef.checks) {
          for (const check of stringDef.checks) {
            const checkDef = check.def || check._def || check;
            if (!checkDef || typeof checkDef !== 'object') continue;

            const checkObj = checkDef as { kind?: string; format?: string };
            if (checkObj.kind === 'datetime' || checkObj.format === 'date-time') {
              result.format = 'date-time';
            }
          }
        }

        return result;
      }

      case 'number': {
        const numberDef = def as ZodNumberDef;
        let isInteger = false;

        // Check if it's an integer
        if (numberDef.checks) {
          for (const check of numberDef.checks) {
            const checkDef = check.def || check._def || check;
            if (!checkDef || typeof checkDef !== 'object') continue;

            const checkObj = checkDef as { kind?: string };
            if (checkObj.kind === 'int') {
              isInteger = true;
              break;
            }
          }
        }

        return { type: isInteger ? 'INTEGER' : 'NUMBER' };
      }

      case 'boolean':
        return { type: 'BOOLEAN' };

      case 'array': {
        const arrayDef = def as ZodArrayDef;
        const itemDef = getZodDef(arrayDef.valueType) || getZodDef(arrayDef.element);
        const result: GeminiNativeSchema = {
          type: 'ARRAY',
          items: itemDef ? processZodType(itemDef) : { type: 'STRING' },
        };

        // Check for array constraints
        if (arrayDef.checks) {
          for (const check of arrayDef.checks) {
            const checkDef = check.def || check._def || check;
            if (!checkDef || typeof checkDef !== 'object') continue;

            const checkObj = checkDef as { kind?: string; value?: unknown };

            switch (checkObj.kind) {
              case 'min':
                result.minItems = checkObj.value as number;
                break;
              case 'max':
                result.maxItems = checkObj.value as number;
                break;
              case 'length':
                result.minItems = checkObj.value as number;
                result.maxItems = checkObj.value as number;
                break;
            }
          }
        }

        return result;
      }

      case 'object': {
        const objectDef = def as ZodObjectDef;
        const properties: Record<string, GeminiNativeSchema> = {};
        const required: string[] = [];
        const propertyOrdering: string[] = [];

        // Access shape directly from def
        const shape = objectDef.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldDef = getZodDef(value);
          if (fieldDef) {
            properties[key] = processZodType(fieldDef);
            propertyOrdering.push(key);

            // Check if field is optional
            if (fieldDef.type !== 'optional') {
              required.push(key);
            }
          }
        }

        const result: GeminiNativeSchema = {
          type: 'OBJECT',
          properties,
        };

        if (required.length > 0) {
          result.required = required;
        }

        // Always include propertyOrdering for consistent output
        result.propertyOrdering = propertyOrdering;

        return result;
      }

      case 'optional': {
        const optionalDef = def as ZodOptionalDef;
        const innerDef = getZodDef(optionalDef.innerType);
        return innerDef ? processZodType(innerDef) : { type: 'STRING' };
      }

      case 'enum': {
        const enumDef = def as ZodEnumDef;
        let enumValues: string[] = [];

        // Zod can store enum values in different fields
        if (enumDef.values) {
          enumValues = enumDef.values;
        } else if (enumDef.options) {
          enumValues = enumDef.options;
        } else if (enumDef.entries) {
          enumValues = Object.values(enumDef.entries);
        }

        return {
          type: 'STRING',
          enum: enumValues,
        };
      }

      case 'literal': {
        const literalDef = def as ZodLiteralDef;
        const value = literalDef.value;
        const valueType = typeof value;

        // For literals, we can use enum with single value
        if (valueType === 'string') {
          return {
            type: 'STRING',
            enum: [value as string],
          };
        } else if (valueType === 'number') {
          // Gemini doesn't support enum for numbers, just return the type
          return {
            type: Number.isInteger(value as number) ? 'INTEGER' : 'NUMBER',
          };
        } else {
          return { type: 'BOOLEAN' };
        }
      }

      case 'record': {
        // Record types allow arbitrary keys, which is incompatible with structured output
        // that requires predefined schemas
        throw new Error(
          'Record types are not supported with Gemini structured output.\n' +
            'Record types allow arbitrary keys which cannot be represented in a fixed schema.\n' +
            'Please refactor to use a fixed object schema with known properties.\n' +
            'Example: Instead of z.record(z.string()), use z.object({ key1: z.string(), key2: z.string(), ... })',
        );
      }

      default:
        logger.warn('Unsupported Zod type for Gemini native schema', {
          type: def.type,
        });
        return { type: 'STRING' };
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
    retryConfig?: RetryConfig,
  ): Promise<ProviderChatResponse<'gemini', T>> {
    const logger = getLogger('gemini');
    const model = request.model || 'gemini-1.5-pro-latest';
    logger.info('Gemini chat request initiated', { model });

    const makeRequest = async () => {
      const geminiRequest = this.transformRequest(request);
      const requestBody = JSON.stringify(geminiRequest);

      logger.debug('Transformed request for Gemini API', {
        hasSystemInstruction: !!geminiRequest.systemInstruction,
        contentCount: geminiRequest.contents.length,
        hasTools: !!geminiRequest.tools,
      });

      // Log full request payload at verbose level
      logger.verbose('Gemini request payload', {
        url: `${this.baseURL}/models/${model}:generateContent`,
        systemInstruction: geminiRequest.systemInstruction,
        contents: geminiRequest.contents,
        tools: geminiRequest.tools,
        generationConfig: geminiRequest.generationConfig,
        safetySettings: geminiRequest.safetySettings,
      });

      const response = await fetch(`${this.baseURL}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: requestBody,
        signal: request.signal,
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
        let error: { error?: { message?: string } };
        let errorText: string;

        // Handle both real responses and test mocks
        if (typeof response.text === 'function') {
          errorText = await response.text();
          try {
            error = JSON.parse(errorText);
          } catch {
            error = { error: { message: errorText || response.statusText } };
          }
        } else {
          // Fallback for test mocks that only have .json()
          error = (await response
            .json()
            .catch(() => ({ error: { message: response.statusText } }))) as {
            error?: { message?: string };
          };
          errorText = JSON.stringify(error);
        }
        const retryAfter = response.headers.get('Retry-After');
        const errorMessage = `Gemini API error (${response.status}): ${error.error?.message || 'Unknown error'}`;

        // Log full error details including request that caused it
        logger.error('Gemini API error - Full Details', {
          status: response.status,
          error: error.error?.message,
          retryAfter,
          requestPayload: {
            systemInstruction: geminiRequest.systemInstruction,
            contents: geminiRequest.contents,
            tools: geminiRequest.tools,
          },
          rawErrorResponse: errorText,
        });

        const llmError = new LLMError(errorMessage, response.status, 'gemini', request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      const data = (await response.json()) as GeminiResponse;

      // Log raw response at verbose level
      logger.verbose('Gemini raw response', {
        candidates: data.candidates,
        usageMetadata: data.usageMetadata,
      });

      logger.info('Gemini chat response received', {
        usage: data.usageMetadata,
        candidateCount: data.candidates?.length,
        finishReason: data.candidates?.[0]?.finishReason,
      });
      return this.transformResponse<T>(data, model, request.schema);
    };

    // Use override retry config if provided, otherwise use instance config
    const activeRetryConfig = retryConfig ?? this.retryConfig;

    if (activeRetryConfig) {
      return retry(makeRequest, activeRetryConfig, request.signal);
    }

    return makeRequest();
  }

  async stream<T = string>(
    request: ProviderChatRequest<'gemini', T>,
    _retryConfig?: RetryConfig, // Streaming doesn't use retry (single long-lived connection)
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
      signal: request.signal,
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
    const logger = getLogger('gemini');
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

    // Handle structured output via native Gemini responseSchema when only schema is provided
    if (request.schema && !request.tools) {
      logger.debug('Using native structured output for schema-only request');

      // Use native Gemini structured output
      if (!geminiRequest.generationConfig) {
        geminiRequest.generationConfig = {};
      }

      geminiRequest.generationConfig.responseMimeType = 'application/json';

      if (isZodSchema(request.schema)) {
        // Convert to Gemini native schema format
        geminiRequest.generationConfig.responseSchema = zodToGeminiNativeSchema(request.schema);
        logger.verbose('Converted Zod schema to Gemini native format');
      } else if (isJSONSchema(request.schema)) {
        // Convert JSON Schema to Gemini format using recursive converter
        const jsonSchema = request.schema as GenericJSONSchema;
        geminiRequest.generationConfig.responseSchema = jsonSchemaToGeminiNativeSchema(jsonSchema);
        logger.verbose('Converted JSON Schema to Gemini native format');
      } else {
        throw new Error('Invalid schema type provided');
      }
    }

    // Handle Gemini-specific features
    if (request.features) {
      if (request.features.safetySettings) {
        geminiRequest.safetySettings = request.features.safetySettings;
      }
    }

    // Handle tools (and schema via tools if both are provided)
    if (request.tools) {
      logger.debug('Processing tools for request', {
        toolCount: request.tools.length,
      });

      // If we have both schema and tools, we need to use the tool-based approach for schema
      // because Gemini doesn't support both responseSchema and tools simultaneously
      const toolDeclarations = request.tools.map((tool) => {
        logger.verbose('Converting tool schema', { toolName: tool.name });
        const parameters = tool.parameters
          ? zodToGeminiSchema(tool.parameters)
          : { type: 'object' as const, properties: {} };
        logger.debug('Tool converted', {
          toolName: tool.name,
          hasParameters: !!tool.parameters,
        });
        return {
          name: tool.name,
          description: tool.description,
          parameters,
        };
      });

      // If we have a schema AND tools, add the schema as a tool
      if (request.schema) {
        logger.info('Both schema and tools provided, using tool-based approach for schema');

        let schemaAsToolParams: GenericJSONSchema;
        if (isZodSchema(request.schema)) {
          schemaAsToolParams = zodToGeminiSchema(request.schema);
        } else if (isJSONSchema(request.schema)) {
          schemaAsToolParams = request.schema as GenericJSONSchema;
        } else {
          throw new Error('Invalid schema type provided');
        }

        toolDeclarations.push({
          name: 'respond_with_structured_output',
          description: 'Respond with structured data matching the required schema',
          parameters: schemaAsToolParams,
        });

        // Force the model to use the schema tool
        geminiRequest.toolConfig = {
          functionCallingConfig: { mode: 'ANY' },
        };
      }

      geminiRequest.tools = [{ functionDeclarations: toolDeclarations }];
      logger.info('Tools configured', {
        toolNames: toolDeclarations.map((t) => t.name),
      });
    }

    // Handle tool choice
    if (request.toolChoice) {
      logger.debug('Processing tool choice', {
        toolChoice: request.toolChoice,
      });
      switch (request.toolChoice) {
        case 'required': {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: 'ANY' },
          };
          logger.verbose('Tool choice set to required (ANY)');
          break;
        }
        case 'none': {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: 'NONE' },
          };
          logger.verbose('Tool choice set to none');
          break;
        }
        case 'auto': {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: 'AUTO' },
          };
          logger.verbose('Tool choice set to auto');
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
    const logger = getLogger('gemini');
    const candidate = response.candidates[0];
    if (!candidate) {
      logger.error('No candidate in Gemini response');
      throw new Error('No candidate in response');
    }
    let content = '';
    const toolCalls: ToolCall[] = [];

    logger.debug('Processing response content parts', {
      partCount: candidate.content?.parts?.length || 0,
    });

    // Process content parts
    if (candidate.content && candidate.content.parts) {
      for (let i = 0; i < candidate.content.parts.length; i++) {
        const part = candidate.content.parts[i];
        if (part && 'text' in part && part.text) {
          content += part.text;
          logger.verbose('Processed text part', {
            textLength: part.text.length,
          });
        } else if (part && 'functionCall' in part) {
          logger.debug('Processing function call', {
            functionName: part.functionCall.name,
            index: i,
          });
          toolCalls.push({
            id: `${part.functionCall.name}_${i}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          });
          logger.info('Function call processed', {
            functionName: part.functionCall.name,
          });
        }
      }
    }

    let parsedContent: T;

    // Check if we have native structured output (no tools, just schema)
    // In this case, the content should already be valid JSON
    const hasNativeStructuredOutput = schema && !toolCalls.length && content;

    // If we used schema-based tool calling, extract the structured data from tool call
    const structuredOutputTool = toolCalls.find(
      (tc) => tc.name === 'respond_with_structured_output',
    );

    if (hasNativeStructuredOutput) {
      // Handle native structured output - content should be JSON
      logger.debug('Processing native structured output response');
      try {
        const parsed = JSON.parse(content);
        logger.debug('Parsed native structured output', { parsed });

        if (isZodSchema(schema)) {
          logger.verbose('Validating native output with Zod schema');
          parsedContent = schema.parse(parsed) as T;
          logger.info('Native structured output validated successfully');
        } else if (isJSONSchema(schema)) {
          logger.verbose('Validating native output with JSON schema');
          const validation = validateJSONSchema<T>(schema, parsed);
          if (validation.valid) {
            parsedContent = validation.data;
            logger.info('Native structured output validated successfully');
          } else {
            logger.error('JSON Schema validation failed for native output - Full Details', {
              errors: validation.errors,
              failedData: parsed,
              schema: schema,
            });
            throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
          }
        } else {
          parsedContent = parsed as T;
        }
      } catch (e) {
        if (e instanceof ZodError) {
          logger.error('Zod validation failed for native output - Full Details', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            zodErrors: (e as any).errors,
            issues: e.issues,
            failedData: content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schemaType: (schema as any)._def?.typeName || 'unknown',
            message: e.message,
            formattedError: e.format(),
          });
          // Wrap in ValidationError to make it retriable
          throw new ValidationError(`Schema validation failed: ${e.message}`, e);
        } else if (e instanceof Error && e.message.includes('JSON Schema validation failed')) {
          logger.error('JSON Schema validation failed - retryable', {
            error: e.message,
          });
          // Wrap JSON Schema validation errors as retriable
          throw new ValidationError(e.message, e);
        } else {
          logger.error('Error parsing native structured output - Full Details', {
            error: e instanceof Error ? e.message : String(e),
            errorType: e?.constructor?.name,
            rawContent: content,
          });
          throw e;
        }
      }
    } else if (schema && structuredOutputTool) {
      logger.debug('Extracting structured output from tool call');
      try {
        if (isZodSchema(schema)) {
          logger.verbose('Validating with Zod schema');
          parsedContent = schema.parse(structuredOutputTool.arguments) as T;
          logger.info('Structured output validated successfully');
        } else if (isJSONSchema(schema)) {
          logger.verbose('Validating with JSON schema');
          const validation = validateJSONSchema<T>(schema, structuredOutputTool.arguments);
          if (validation.valid) {
            parsedContent = validation.data;
            logger.info('Structured output validated successfully');
          } else {
            logger.error('JSON Schema validation failed - Full Details', {
              errors: validation.errors,
              failedData: structuredOutputTool.arguments,
              schema: schema,
            });
            throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
          }
        } else {
          parsedContent = structuredOutputTool.arguments as T;
        }
      } catch (e) {
        if (e instanceof ZodError) {
          logger.error('Zod validation failed for tool call - Full Details', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            zodErrors: (e as any).errors,
            issues: e.issues,
            failedData: structuredOutputTool.arguments,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schemaType: (schema as any)._def?.typeName || 'unknown',
            message: e.message,
            formattedError: e.format(),
          });
          // Wrap in ValidationError to make it retriable
          throw new ValidationError(`Schema validation failed: ${e.message}`, e);
        } else if (e instanceof Error && e.message.includes('JSON Schema validation failed')) {
          logger.error('JSON Schema validation failed - retryable', {
            error: e.message,
          });
          // Wrap JSON Schema validation errors as retriable
          throw new ValidationError(e.message, e);
        } else {
          logger.error('Error parsing tool call - Full Details', {
            error: e instanceof Error ? e.message : String(e),
            errorType: e?.constructor?.name,
            failedData: structuredOutputTool.arguments,
            toolName: structuredOutputTool.name,
          });
          throw e;
        }
      }
    } else if (schema && content) {
      logger.debug('Processing content for schema validation');
      try {
        const parsed = JSON.parse(content);
        logger.debug('Parsed content for validation', { parsed });

        if (isZodSchema(schema)) {
          logger.verbose('Validating with Zod schema');
          parsedContent = schema.parse(parsed) as T;
          logger.info('Zod validation successful for content');
        } else if (isJSONSchema(schema)) {
          logger.verbose('Validating with JSON schema');
          const validation = validateJSONSchema<T>(schema, parsed);
          if (validation.valid) {
            parsedContent = validation.data;
            logger.info('JSON Schema validation successful');
          } else {
            logger.error('JSON Schema validation failed - Full Details', {
              errors: validation.errors,
              failedData: parsed,
              schema: schema,
            });
            throw new Error(`JSON Schema validation failed: ${validation.errors.join('; ')}`);
          }
        } else {
          parsedContent = parsed as T;
        }
      } catch (e) {
        if (e instanceof ZodError) {
          logger.error('Zod validation failed for content - Full Details', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            zodErrors: (e as any).errors,
            issues: e.issues,
            failedData: content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schemaType: (schema as any)._def?.typeName || 'unknown',
            message: e.message,
            formattedError: e.format(),
          });
          // Wrap in ValidationError to make it retriable
          throw new ValidationError(`Schema validation failed: ${e.message}`, e);
        } else if (e instanceof Error && e.message.includes('JSON Schema validation failed')) {
          logger.error('JSON Schema validation failed - retryable', {
            error: e.message,
          });
          // Wrap JSON Schema validation errors as retriable
          throw new ValidationError(e.message, e);
        } else {
          logger.error('Error parsing content - Full Details', {
            error: e instanceof Error ? e.message : String(e),
            errorType: e?.constructor?.name,
            rawContent: content,
          });
          throw e;
        }
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
