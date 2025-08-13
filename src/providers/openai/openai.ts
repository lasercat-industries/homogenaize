import { z, ZodError } from 'zod';
import type { StreamingResponse, ProviderCapabilities, Message } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import type { RetryConfig } from '../../retry/types';
import { retry } from '../../retry';
import { LLMError } from '../../retry/errors';
import type { ZodDef, ZodArrayDef, ZodObjectDef } from '../zod-types';
import { getZodDef } from '../zod-types';
import type { JSONSchemaType } from 'ajv';
import type { GenericJSONSchema } from '../../types/schema';
import { isZodSchema, isJSONSchema } from '../../utils/schema-utils';
import { validateJSONSchema } from '../../utils/json-schema-validator';
import { getLogger } from '../../utils/logger';

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
    parameters: GenericJSONSchema;
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
    json_schema?: GenericJSONSchema;
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
function zodToOpenAISchema(schema: z.ZodSchema): GenericJSONSchema {
  const logger = getLogger('openai-schema');
  logger.debug('Converting Zod schema to OpenAI JSON Schema');

  const zodType = getZodDef(schema);

  if (!zodType) {
    logger.error('Invalid Zod schema: missing _def property');
    throw new Error('Invalid Zod schema: missing _def property');
  }

  function processZodType(def: ZodDef): GenericJSONSchema {
    logger.verbose('Processing Zod type', { type: def.type });
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
              case 'min':
                arrayResult.minItems = checkObj.value as number;
                break;
              case 'max':
                arrayResult.maxItems = checkObj.value as number;
                break;
              case 'length':
                arrayResult.minItems = checkObj.value as number;
                arrayResult.maxItems = checkObj.value as number;
                break;
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

            // OpenAI requires all fields to be in the required array, even optional ones
            // For optional fields, we'll handle it differently in the API
            required.push(key);
          }
        }

        return {
          type: 'object',
          properties,
          required: required.length > 0 ? required : undefined,
          additionalProperties: false,
        };
      }
      case 'optional': {
        // For OpenAI, we need to handle optional fields differently
        // Return the inner type directly - optional handling is done in the parent object
        const optionalDef = def as {
          type: 'optional';
          innerType?: { _def?: ZodDef; def?: ZodDef };
        };
        const innerDef = getZodDef(optionalDef.innerType);
        return innerDef ? processZodType(innerDef) : { type: 'string' as const };
      }
      case 'enum': {
        const enumDef = def as {
          type: 'enum';
          values?: unknown[];
          entries?: Record<string, string>;
          options?: unknown[];
        };
        let enumValues: unknown[] = [];

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
        const literalDef = def as { type: 'literal'; value?: unknown; values?: unknown[] };
        // Zod stores literal value in 'values' array
        const actualValue = literalDef.value ?? literalDef.values?.[0];
        const valueType = typeof actualValue;
        return {
          type: valueType === 'string' ? 'string' : valueType === 'number' ? 'number' : 'boolean',
          const: actualValue,
        };
      }
      case 'union': {
        const unionDef = def as { type: 'union'; options?: Array<{ _def?: ZodDef; def?: ZodDef }> };
        if (!unionDef.options || unionDef.options.length === 0) {
          return { type: 'string' };
        }

        const unionOptions = unionDef.options
          .map((opt) => {
            const optDef = getZodDef(opt);
            return optDef ? processZodType(optDef) : null;
          })
          .filter(Boolean) as GenericJSONSchema[];

        // Wrap oneOf in a property for OpenAI compatibility
        return {
          type: 'object',
          properties: {
            value: {
              oneOf: unionOptions,
            } as unknown as GenericJSONSchema,
          },
          required: ['value'],
          additionalProperties: false,
        } as GenericJSONSchema;
      }
      case 'discriminatedUnion': {
        const discUnionDef = def as {
          type: 'discriminatedUnion';
          discriminator?: string;
          options?: Array<{ _def?: ZodDef; def?: ZodDef }>;
          optionsMap?: Map<string, { _def?: ZodDef; def?: ZodDef }>;
        };

        // Try to get options from either options array or optionsMap
        let options: Array<{ _def?: ZodDef; def?: ZodDef }> = [];
        if (discUnionDef.options) {
          options = discUnionDef.options;
        } else if (discUnionDef.optionsMap) {
          options = Array.from(discUnionDef.optionsMap.values());
        }

        if (options.length === 0) {
          return { type: 'object', properties: {} };
        }

        // Convert each option to JSON schema
        const unionOptions = options
          .map((opt) => {
            const optDef = getZodDef(opt);
            return optDef ? processZodType(optDef) : null;
          })
          .filter(Boolean) as GenericJSONSchema[];

        // Wrap oneOf in a property for OpenAI compatibility
        return {
          type: 'object',
          properties: {
            value: {
              oneOf: unionOptions,
            } as unknown as GenericJSONSchema,
          },
          required: ['value'],
          additionalProperties: false,
        } as GenericJSONSchema;
      }
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
    request: ProviderChatRequest<'openai', T>,
  ): Promise<ProviderChatResponse<'openai', T>> {
    const logger = getLogger('openai');
    logger.info('OpenAI chat request initiated', { model: request.model });

    const makeRequest = async () => {
      const openAIRequest = this.transformRequest(request);
      const requestBody = JSON.stringify(openAIRequest);

      logger.debug('Transformed request for OpenAI API', {
        requestSize: requestBody.length,
      });

      // Log full request payload at verbose level
      logger.verbose('OpenAI request payload', {
        url: `${this.baseURL}/chat/completions`,
        model: openAIRequest.model,
        messages: openAIRequest.messages,
        tools: openAIRequest.tools,
        temperature: openAIRequest.temperature,
        max_tokens: openAIRequest.max_tokens,
        response_format: openAIRequest.response_format,
      });

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });

      if (!response) {
        logger.error('Network error: No response received from OpenAI');
        throw new LLMError(
          'Network error: No response received',
          undefined,
          'openai',
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

        // Extract retry-after header if present
        const retryAfter = response.headers.get('Retry-After');
        const errorMessage = `OpenAI API error (${response.status}): ${error.error?.message || 'Unknown error'}`;

        // Log full error details including request that caused it
        logger.error('OpenAI API error - Full Details', {
          status: response.status,
          error: error.error?.message,
          retryAfter,
          requestPayload: {
            model: openAIRequest.model,
            messages: openAIRequest.messages,
            tools: openAIRequest.tools,
          },
          rawErrorResponse: errorText,
        });

        const llmError = new LLMError(errorMessage, response.status, 'openai', request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }

      const data = (await response.json()) as OpenAIResponse;

      // Log raw response at verbose level
      logger.verbose('OpenAI raw response', {
        id: data.id,
        model: data.model,
        choices: data.choices,
        usage: data.usage,
      });

      logger.info('OpenAI chat response received', {
        usage: data.usage,
        model: data.model,
        finishReason: data.choices?.[0]?.finish_reason,
      });
      return this.transformResponse<T>(data, request.schema);
    };

    // Use retry wrapper if config is provided
    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }

    return makeRequest();
  }

  async stream<T = string>(
    request: ProviderChatRequest<'openai', T>,
  ): Promise<StreamingResponse<T>> {
    const logger = getLogger('openai');
    logger.info('OpenAI stream request initiated', { model: request.model });

    const makeRequest = async (): Promise<Response> => {
      const openAIRequest = this.transformRequest(request);
      logger.debug('Transformed streaming request for OpenAI API');
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
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};
    let model = '';
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | undefined;
    let toolCallArguments = '';
    let currentToolCall: {
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    } | null = null;

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
                      currentToolCall = {
                        id: toolCallDelta.id!,
                        type: 'function' as const,
                        function: {
                          name: toolCallDelta.function?.name || '',
                          arguments: '',
                        },
                      };
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
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }
      },

      async complete(): Promise<ProviderChatResponse<'openai', T>> {
        // Drain any remaining content
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of streamResponse) {
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
            let parsed = JSON.parse(toolCallArguments);

            // Handle Zod vs JSON Schema validation
            if (isZodSchema(request.schema)) {
              // Check if this is a wrapped discriminated union
              const schemaWithDef = request.schema as {
                _def?: { type?: string; typeName?: string };
              };
              const schemaDefType = schemaWithDef._def?.type;
              const schemaTypeName = schemaWithDef._def?.typeName;
              const isDiscriminatedUnion =
                schemaDefType === 'discriminatedUnion' ||
                schemaTypeName === 'ZodDiscriminatedUnion';
              const isUnion = schemaDefType === 'union' || schemaTypeName === 'ZodUnion';

              if ((isDiscriminatedUnion || isUnion) && parsed.value !== undefined) {
                // Unwrap the value for discriminated unions
                parsed = parsed.value;
              }

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

        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          },
          model,
          finishReason,
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

  private transformRequest<T = string>(request: ProviderChatRequest<'openai', T>): OpenAIRequest {
    const logger = getLogger('openai');
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
        openAIRequest.response_format = request.features.responseFormat as {
          type: 'text' | 'json_object' | 'json_schema';
          json_schema?: GenericJSONSchema;
        };
      }
    }

    // Handle structured output via schema using forced tool calling
    if (request.schema && !request.tools) {
      // Create a hidden tool for structured output
      let jsonSchema: GenericJSONSchema;

      if (isZodSchema(request.schema)) {
        jsonSchema = zodToOpenAISchema(request.schema);
      } else if (isJSONSchema(request.schema)) {
        // Use JSON Schema directly
        jsonSchema = request.schema as GenericJSONSchema;
      } else {
        throw new Error('Invalid schema type provided');
      }

      openAIRequest.tools = [
        {
          type: 'function' as const,
          function: {
            name: 'respond_with_structured_output',
            description: 'Respond with structured data matching the required schema',
            parameters: jsonSchema,
            // Don't use strict mode for schemas with oneOf (discriminated unions)
            strict: !JSON.stringify(jsonSchema).includes('"oneOf"'),
          },
        },
      ];
      // Force the model to use this tool
      openAIRequest.tool_choice = 'required';
    }

    // Handle tools
    if (request.tools) {
      logger.debug('Processing tools for request', { toolCount: request.tools.length });
      openAIRequest.tools = request.tools.map((tool) => {
        logger.verbose('Converting tool schema', { toolName: tool.name });
        const parameters = zodToOpenAISchema(tool.parameters);
        const strict = !JSON.stringify(parameters).includes('"oneOf"');
        logger.debug('Tool converted', {
          toolName: tool.name,
          strictMode: strict,
          hasOneOf: !strict,
        });
        return {
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters,
            // Don't use strict mode for schemas with oneOf (discriminated unions)
            strict,
          },
        };
      });
      logger.info('Tools configured', {
        toolNames: request.tools.map((t) => t.name),
      });
    }

    // Handle tool choice
    if (request.toolChoice) {
      logger.debug('Processing tool choice', { toolChoice: request.toolChoice });
      switch (request.toolChoice) {
        case 'required': {
          openAIRequest.tool_choice = 'required';
          logger.verbose('Tool choice set to required');
          break;
        }
        case 'none': {
          openAIRequest.tool_choice = 'none';
          logger.verbose('Tool choice set to none');
          break;
        }
        case 'auto': {
          openAIRequest.tool_choice = 'auto';
          logger.verbose('Tool choice set to auto');
          break;
        }
        default:
          if (typeof request.toolChoice === 'object' && 'name' in request.toolChoice) {
            openAIRequest.tool_choice = {
              type: 'function',
              function: { name: request.toolChoice.name },
            };
            logger.verbose('Tool choice set to specific function', {
              functionName: request.toolChoice.name,
            });
          }
      }
    }

    return openAIRequest;
  }

  private transformMessage(message: Message): OpenAIMessage {
    if (typeof message.content === 'string') {
      return {
        role: message.role as 'system' | 'user' | 'assistant',
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
      role: message.role as 'system' | 'user' | 'assistant',
      content: textContent,
    };
  }

  private transformResponse<T>(
    response: OpenAIResponse,
    schema?: z.ZodSchema<T> | JSONSchemaType<T> | GenericJSONSchema,
  ): ProviderChatResponse<'openai', T> {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No choice in response');
    }
    const message = choice.message;

    let content: T;

    const logger = getLogger('openai');
    logger.verbose('Full OpenAI response', { response });

    // If we used schema-based tool calling, extract the structured data from tool call
    if (schema && message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls.find(
        (tc) => tc.function.name === 'respond_with_structured_output',
      );
      if (toolCall) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let parsed: any;
        try {
          logger.debug('Processing tool call for structured output', { toolCall });
          parsed = JSON.parse(toolCall.function.arguments);
          logger.debug('Parsed tool call arguments', { parsed });

          // Handle Zod vs JSON Schema validation
          if (isZodSchema(schema)) {
            logger.debug('Using Zod schema for validation');
            // Check if this is a wrapped discriminated union (has single 'value' property)
            const schemaWithDef = schema as { _def?: { type?: string; typeName?: string } };
            const schemaDefType = schemaWithDef._def?.type;
            const schemaTypeName = schemaWithDef._def?.typeName;
            const isDiscriminatedUnion =
              schemaDefType === 'discriminatedUnion' || schemaTypeName === 'ZodDiscriminatedUnion';
            const isUnion = schemaDefType === 'union' || schemaTypeName === 'ZodUnion';

            if ((isDiscriminatedUnion || isUnion) && parsed.value !== undefined) {
              // Unwrap the value for discriminated unions
              parsed = parsed.value;
            } else {
              logger.debug('Schema is not a discriminated union');
            }

            content = schema.parse(parsed) as T;
            logger.info('Zod validation successful for structured output');
          } else if (isJSONSchema(schema)) {
            // Validate with AJV
            const validation = validateJSONSchema<T>(schema, parsed);
            if (validation.valid) {
              content = validation.data;
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
            content = parsed as T;
          }
        } catch (e) {
          if (e instanceof ZodError) {
            logger.error('Zod validation failed - Full Details', {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              zodErrors: (e as any).errors,
              issues: e.issues,
              failedData: parsed,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              schemaType: (schema as any)._def?.typeName || 'unknown',
              message: e.message,
              formattedError: e.format(),
            });
          } else {
            logger.error('Error parsing tool call - Full Details', {
              error: e instanceof Error ? e.message : String(e),
              errorType: e?.constructor?.name,
              failedData: toolCall?.function?.arguments,
              rawResponse: message,
            });
          }
          content = (message.content || '') as T;
        }
      } else {
        content = (message.content || '') as T;
      }
    } else if (schema && message.content) {
      logger.debug('Processing response without tool calls');
      try {
        const parsed = JSON.parse(message.content);
        logger.debug('Parsed message content for validation', { parsed });

        if (isZodSchema(schema)) {
          logger.debug('Validating with Zod schema');
          content = schema.parse(parsed) as T;
          logger.info('Zod validation successful for message content');
        } else if (isJSONSchema(schema)) {
          logger.debug('Validating with JSON Schema');
          const validation = validateJSONSchema<T>(schema, parsed);
          if (validation.valid) {
            content = validation.data;
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
          content = parsed as T;
        }
      } catch (e) {
        if (e instanceof ZodError) {
          logger.error('Zod validation failed for message content - Full Details', {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            zodErrors: (e as any).errors,
            issues: e.issues,
            failedData: message.content,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schemaType: (schema as any)._def?.typeName || 'unknown',
            message: e.message,
            formattedError: e.format(),
          });
        } else {
          logger.error('Error parsing message content - Full Details', {
            error: e instanceof Error ? e.message : String(e),
            errorType: e?.constructor?.name,
            rawContent: message.content,
            messageType: typeof message.content,
          });
        }
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
      logger.info('Processing tool calls from response', {
        toolCallCount: message.tool_calls.length,
      });
      result.toolCalls = message.tool_calls.map((tc) => {
        logger.debug('Processing tool call', {
          toolId: tc.id,
          toolName: tc.function.name,
          argumentsLength: tc.function.arguments.length,
        });
        try {
          const parsedArgs = JSON.parse(tc.function.arguments);
          logger.verbose('Tool call arguments parsed successfully', {
            toolName: tc.function.name,
          });
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          };
        } catch (error) {
          logger.error('Failed to parse tool call arguments', {
            toolName: tc.function.name,
            error: error instanceof Error ? error.message : 'Unknown error',
            rawArguments: tc.function.arguments,
          });
          throw error;
        }
      });
      logger.info('Tool calls processed', {
        toolNames: result.toolCalls.map((tc) => tc.name),
      });
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

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseURL}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }))) as {
        error?: { message?: string };
      };
      throw new LLMError(
        `OpenAI API error (${response.status}): ${error.error?.message || 'Unknown error'}`,
        response.status,
        'openai',
      );
    }

    const data = (await response.json()) as {
      data: Array<{ id: string; created: number; owned_by: string }>;
    };

    return data.data.map((model) => ({
      id: model.id,
      name: model.id,
      created: model.created,
    }));
  }
}
