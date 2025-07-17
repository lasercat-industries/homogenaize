// src/retry/types.ts
var DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 60000,
  backoffMultiplier: 2,
  jitter: true
};

// src/retry/errors.ts
class LLMError extends Error {
  statusCode;
  provider;
  model;
  originalError;
  isRetryable;
  retryAfter;
  constructor(message, statusCode, provider, model) {
    super(message);
    this.name = "LLMError";
    this.statusCode = statusCode;
    this.provider = provider;
    this.model = model;
    if (statusCode) {
      this.isRetryable = isRetryableStatusCode(statusCode);
    }
  }
}
function isRetryableStatusCode(statusCode) {
  if (statusCode === 429)
    return true;
  if (statusCode >= 500 && statusCode < 600)
    return true;
  if (statusCode === 529)
    return true;
  return false;
}
function isRetryableError(error, customClassifier) {
  if (customClassifier) {
    return customClassifier(error);
  }
  if ("isRetryable" in error && typeof error.isRetryable === "boolean") {
    return error.isRetryable;
  }
  if (error instanceof LLMError && error.statusCode) {
    return isRetryableStatusCode(error.statusCode);
  }
  const errorAny = error;
  if (errorAny.status && typeof errorAny.status === "number") {
    return isRetryableStatusCode(errorAny.status);
  }
  const message = error.message.toUpperCase();
  const networkErrors = [
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "SOCKET",
    "TIMEOUT",
    "NETWORK"
  ];
  if (networkErrors.some((err) => message.includes(err))) {
    return true;
  }
  if (message.includes("RESOURCE_EXHAUSTED") || message.includes("UNAVAILABLE")) {
    return true;
  }
  return false;
}

// src/retry/retry.ts
function calculateBackoff(attempt, initialDelay, multiplier, maxDelay) {
  const delay = initialDelay * Math.pow(multiplier, attempt);
  return maxDelay ? Math.min(delay, maxDelay) : delay;
}
function withJitter(delay) {
  return delay * (0.5 + Math.random() * 0.5);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function retry(fn, config) {
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    backoffMultiplier,
    jitter,
    retryableErrors: customRetryableErrors,
    onRetry
  } = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError;
  for (let attempt = 0;attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableError(lastError, customRetryableErrors)) {
        throw lastError;
      }
      let delay = calculateBackoff(attempt, initialDelay, backoffMultiplier, maxDelay);
      if (lastError instanceof LLMError && lastError.retryAfter) {
        delay = lastError.retryAfter * 1000;
      } else if ("retryAfter" in lastError && typeof lastError.retryAfter === "number") {
        delay = lastError.retryAfter * 1000;
      }
      if (jitter) {
        delay = withJitter(delay);
      }
      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      }
      await sleep(delay);
    }
  }
  throw lastError;
}
// src/providers/openai/openai.ts
function zodToOpenAISchema(schema) {
  const zodType = schema._def || schema.def;
  if (!zodType) {
    throw new Error("Invalid Zod schema: missing _def property");
  }
  function processZodType(def) {
    switch (def.type) {
      case "string":
        return { type: "string" };
      case "number":
        return { type: "number" };
      case "boolean":
        return { type: "boolean" };
      case "array": {
        const itemDef = def.valueType?._def || def.valueType?.def || def.valueType || def.element?._def || def.element?.def || def.element;
        return {
          type: "array",
          items: itemDef ? processZodType(itemDef) : { type: "string" }
        };
      }
      case "object": {
        const properties = {};
        const required = [];
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldDef = value._def || value.def || value;
          const fieldSchema = processZodType(fieldDef);
          delete fieldSchema.__isOptional;
          properties[key] = fieldSchema;
          required.push(key);
        }
        return {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
          additionalProperties: false
        };
      }
      case "optional": {
        const innerDef = def.innerType?._def || def.innerType?.def || def.innerType;
        const innerType = innerDef ? processZodType(innerDef) : { type: "string" };
        return { ...innerType, __isOptional: true };
      }
      case "enum":
        return {
          type: "string",
          enum: def.values
        };
      case "literal":
        return {
          type: typeof def.value,
          const: def.value
        };
      default:
        return { type: "string" };
    }
  }
  return processZodType(zodType);
}

class OpenAIProvider {
  name = "openai";
  capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 128000
  };
  apiKey;
  baseURL = "https://api.openai.com/v1";
  retryConfig;
  constructor(apiKey, baseURL, retryConfig) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, "");
    }
    this.retryConfig = retryConfig;
  }
  async chat(request) {
    const makeRequest = async () => {
      const openAIRequest = this.transformRequest(request);
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(openAIRequest)
      });
      if (!response) {
        throw new LLMError("Network error: No response received", undefined, "openai", request.model);
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        const retryAfter = response.headers.get("Retry-After");
        const errorMessage = `OpenAI API error (${response.status}): ${error.error?.message || "Unknown error"}`;
        const llmError = new LLMError(errorMessage, response.status, "openai", request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }
      const data = await response.json();
      return this.transformResponse(data, request.schema);
    };
    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }
    return makeRequest();
  }
  async stream(request) {
    const makeRequest = async () => {
      const openAIRequest = this.transformRequest(request);
      openAIRequest.stream = true;
      openAIRequest.stream_options = { include_usage: true };
      const response2 = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(openAIRequest)
      });
      if (!response2.ok) {
        const error = await response2.json().catch(() => ({ error: { message: response2.statusText } }));
        const retryAfter = response2.headers.get("Retry-After");
        const llmError = new LLMError(error.error?.message || "Unknown error", response2.status, "openai", request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }
      return response2;
    };
    const response = this.retryConfig ? await retry(makeRequest, this.retryConfig) : await makeRequest();
    const reader = response.body.getReader();
    const decoder = new TextDecoder;
    let buffer = "";
    let content = "";
    let usage = {};
    let model = "";
    let finishReason;
    let toolCallArguments = "";
    let currentToolCall = null;
    const streamResponse = {
      async* [Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(`
`);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]")
                continue;
              try {
                const chunk = JSON.parse(data);
                model = chunk.model;
                if (chunk.choices[0]?.delta?.content) {
                  const chunkContent = chunk.choices[0].delta.content;
                  content += chunkContent;
                  if (!request.schema) {
                    yield chunkContent;
                  }
                }
                if (chunk.choices[0]?.delta?.tool_calls) {
                  for (const toolCallDelta of chunk.choices[0].delta.tool_calls) {
                    if (toolCallDelta.id) {
                      currentToolCall = {
                        id: toolCallDelta.id,
                        type: "function",
                        function: {
                          name: toolCallDelta.function?.name || "",
                          arguments: ""
                        }
                      };
                      toolCallArguments = "";
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
                    total_tokens: chunk.usage.total_tokens
                  };
                }
                if (chunk.choices[0]?.finish_reason) {
                  finishReason = chunk.choices[0].finish_reason;
                }
              } catch {}
            }
          }
        }
      },
      async complete() {
        for await (const _chunk of streamResponse) {}
        let parsedContent;
        if (request.schema && toolCallArguments && currentToolCall?.function?.name === "respond_with_structured_output") {
          try {
            const parsed = JSON.parse(toolCallArguments);
            parsedContent = request.schema.parse(parsed);
          } catch {
            parsedContent = content;
          }
        } else if (request.schema && content) {
          try {
            const parsed = JSON.parse(content);
            parsedContent = request.schema.parse(parsed);
          } catch {
            parsedContent = content;
          }
        } else {
          parsedContent = content;
        }
        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0
          },
          model,
          finishReason
        };
      }
    };
    return streamResponse;
  }
  supportsFeature(feature) {
    return feature in this.capabilities && this.capabilities[feature] === true;
  }
  transformRequest(request) {
    const openAIRequest = {
      model: request.model || "gpt-4o-mini",
      messages: request.messages.map(this.transformMessage),
      temperature: request.temperature,
      max_tokens: request.maxTokens
    };
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
    if (request.schema && !request.tools) {
      const jsonSchema = zodToOpenAISchema(request.schema);
      openAIRequest.tools = [
        {
          type: "function",
          function: {
            name: "respond_with_structured_output",
            description: "Respond with structured data matching the required schema",
            parameters: jsonSchema,
            strict: true
          }
        }
      ];
      openAIRequest.tool_choice = "required";
    }
    if (request.tools) {
      openAIRequest.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: zodToOpenAISchema(tool.parameters),
          strict: true
        }
      }));
    }
    if (request.toolChoice) {
      switch (request.toolChoice) {
        case "required": {
          openAIRequest.tool_choice = "required";
          break;
        }
        case "none": {
          openAIRequest.tool_choice = "none";
          break;
        }
        case "auto": {
          openAIRequest.tool_choice = "auto";
          break;
        }
        default:
          if (typeof request.toolChoice === "object" && "name" in request.toolChoice) {
            openAIRequest.tool_choice = {
              type: "function",
              function: { name: request.toolChoice.name }
            };
          }
      }
    }
    return openAIRequest;
  }
  transformMessage(message) {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content
      };
    }
    const textContent = message.content.filter((c) => c.type === "text").map((c) => c.text).join(`
`);
    return {
      role: message.role,
      content: textContent
    };
  }
  transformResponse(response, schema) {
    const choice = response.choices[0];
    if (!choice) {
      throw new Error("No choice in response");
    }
    const message = choice.message;
    let content;
    if (schema && message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls.find((tc) => tc.function.name === "respond_with_structured_output");
      if (toolCall) {
        try {
          const parsed = JSON.parse(toolCall.function.arguments);
          content = schema.parse(parsed);
        } catch {
          content = message.content || "";
        }
      } else {
        content = message.content || "";
      }
    } else if (schema && message.content) {
      try {
        const parsed = JSON.parse(message.content);
        content = schema.parse(parsed);
      } catch {
        content = message.content;
      }
    } else {
      content = message.content || "";
    }
    const result = {
      content,
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      },
      model: response.model,
      finishReason: choice.finish_reason,
      systemFingerprint: response.system_fingerprint
    };
    if (message.tool_calls && !schema) {
      result.toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments)
      }));
    }
    if (choice.logprobs) {
      result.logprobs = choice.logprobs.content.map((lp) => ({
        token: lp.token,
        logprob: lp.logprob,
        topLogprobs: lp.top_logprobs
      }));
    }
    return result;
  }
  async listModels() {
    const response = await fetch(`${this.baseURL}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new LLMError(`OpenAI API error (${response.status}): ${error.error?.message || "Unknown error"}`, response.status, "openai");
    }
    const data = await response.json();
    return data.data.map((model) => ({
      id: model.id,
      name: model.id,
      created: model.created
    }));
  }
}
// src/providers/anthropic/anthropic.ts
function zodToAnthropicSchema(schema) {
  const zodType = schema._def || schema.def;
  if (!zodType) {
    throw new Error("Invalid Zod schema: missing _def property");
  }
  function processZodType(def) {
    switch (def.type) {
      case "string":
        return { type: "string" };
      case "number":
        return { type: "number" };
      case "boolean":
        return { type: "boolean" };
      case "array": {
        const itemDef = def.valueType?._def || def.valueType?.def || def.valueType || def.element?._def || def.element?.def || def.element;
        return {
          type: "array",
          items: itemDef ? processZodType(itemDef) : { type: "any" }
        };
      }
      case "object": {
        const properties = {};
        const required = [];
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldDef = value._def || value.def || value;
          const fieldSchema = processZodType(fieldDef);
          properties[key] = fieldSchema;
          if (fieldDef.type !== "optional") {
            required.push(key);
          }
        }
        return {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined
        };
      }
      case "optional": {
        const innerDef = def.innerType?._def || def.innerType?.def || def.innerType;
        return innerDef ? processZodType(innerDef) : { type: "any" };
      }
      case "enum":
        return {
          type: "string",
          enum: def.values || []
        };
      case "literal":
        return {
          type: typeof def.value,
          const: def.value
        };
      default:
        return { type: "string" };
    }
  }
  return processZodType(zodType);
}

class AnthropicProvider {
  name = "anthropic";
  capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 200000
  };
  apiKey;
  baseURL = "https://api.anthropic.com/v1";
  apiVersion = "2023-06-01";
  retryConfig;
  constructor(apiKey, baseURL, retryConfig) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, "");
    }
    this.retryConfig = retryConfig;
  }
  async chat(request) {
    const makeRequest = async () => {
      const anthropicRequest = this.transformRequest(request);
      const response = await fetch(`${this.baseURL}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": this.apiVersion,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(anthropicRequest)
      });
      if (!response) {
        throw new LLMError("Network error: No response received", undefined, "anthropic", request.model);
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        const retryAfter = response.headers.get("Retry-After");
        const errorMessage = `Anthropic API error (${response.status}): ${error.error?.message || "Unknown error"}`;
        const llmError = new LLMError(errorMessage, response.status, "anthropic", request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }
      const data = await response.json();
      return this.transformResponse(data, request.schema);
    };
    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }
    return makeRequest();
  }
  async stream(request) {
    const anthropicRequest = this.transformRequest(request);
    anthropicRequest.stream = true;
    const response = await fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(anthropicRequest)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Anthropic API error (${response.status}): ${error.error?.message || "Unknown error"}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder;
    let buffer = "";
    let content = "";
    let usage = { input_tokens: 0, output_tokens: 0 };
    let model = "";
    let anthropicFinishReason;
    let currentToolUse = null;
    let toolUseInput = "";
    const streamResponse = {
      async* [Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(`
`);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              continue;
            }
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (!data || data === "[DONE]")
                continue;
              try {
                const event = JSON.parse(data);
                switch (event.type) {
                  case "message_start": {
                    const msgStart = event;
                    model = msgStart.message.model;
                    usage.input_tokens = msgStart.message.usage.input_tokens;
                    break;
                  }
                  case "content_block_delta": {
                    const delta = event;
                    if (delta.delta.type === "text_delta") {
                      const text = delta.delta.text;
                      content += text;
                      if (!request.schema) {
                        yield text;
                      }
                    } else if (event.delta?.type === "input_json_delta" && currentToolUse) {
                      toolUseInput += event.delta.partial_json;
                    }
                    break;
                  }
                  case "message_delta": {
                    const msgDelta = event;
                    usage.output_tokens = msgDelta.usage.output_tokens;
                    anthropicFinishReason = msgDelta.delta.stop_reason;
                    break;
                  }
                  case "content_block_start": {
                    if (event.content_block?.type === "tool_use") {
                      currentToolUse = event.content_block;
                      toolUseInput = "";
                    }
                    break;
                  }
                }
              } catch {}
            }
          }
        }
      },
      async complete() {
        for await (const _chunk of streamResponse) {}
        let parsedContent;
        if (request.schema && currentToolUse?.name === "respond_with_structured_output" && toolUseInput) {
          try {
            const parsed = JSON.parse(toolUseInput);
            parsedContent = request.schema.parse(parsed);
          } catch {
            parsedContent = content;
          }
        } else if (request.schema && content) {
          try {
            const parsed = JSON.parse(content);
            parsedContent = request.schema.parse(parsed);
          } catch {
            parsedContent = content;
          }
        } else {
          parsedContent = content;
        }
        let finishReason;
        if (anthropicFinishReason) {
          if (anthropicFinishReason === "end_turn" || anthropicFinishReason === "stop_sequence") {
            finishReason = "stop";
          } else if (anthropicFinishReason === "max_tokens") {
            finishReason = "length";
          } else if (anthropicFinishReason === "tool_use") {
            finishReason = "tool_calls";
          }
        }
        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens
          },
          model,
          finishReason
        };
      }
    };
    return streamResponse;
  }
  supportsFeature(feature) {
    return feature in this.capabilities && this.capabilities[feature] === true;
  }
  transformRequest(request) {
    let system;
    const messages = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        system = typeof msg.content === "string" ? msg.content : "";
      } else {
        messages.push(this.transformMessage(msg));
      }
    }
    const anthropicRequest = {
      model: request.model || "claude-3-opus-20240229",
      messages,
      system,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature
    };
    if (request.schema && !request.tools) {
      const jsonSchema = zodToAnthropicSchema(request.schema);
      anthropicRequest.tools = [
        {
          name: "respond_with_structured_output",
          description: "Respond with structured data matching the required schema",
          input_schema: jsonSchema
        }
      ];
      anthropicRequest.tool_choice = { type: "tool", name: "respond_with_structured_output" };
    }
    if (request.features) {
      if (request.features.thinking && request.features.maxThinkingTokens) {
        anthropicRequest.max_thinking_tokens = request.features.maxThinkingTokens;
      }
    }
    if (request.tools) {
      anthropicRequest.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters ? zodToAnthropicSchema(tool.parameters) : { type: "object", properties: {} }
      }));
    }
    if (request.toolChoice === "required" && request.tools?.length !== 1) {
      throw new Error("Only 1 tool can be provided when using toolChoice: required");
    }
    if (request.toolChoice) {
      switch (request.toolChoice) {
        case "required": {
          anthropicRequest.tool_choice = { type: "tool", name: request.tools?.[0]?.name };
          break;
        }
        case "none": {
          delete anthropicRequest.tools;
          break;
        }
        case "auto": {
          anthropicRequest.tool_choice = { type: "auto" };
          break;
        }
        default:
          if (typeof request.toolChoice === "object" && "name" in request.toolChoice) {
            anthropicRequest.tool_choice = {
              type: "tool",
              name: request.toolChoice.name
            };
          }
      }
    }
    return anthropicRequest;
  }
  transformMessage(message) {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content
      };
    }
    const anthropicContent = message.content.map((c) => {
      if (c.type === "text") {
        return { type: "text", text: c.text || "" };
      }
      return { type: "text", text: "[Image content]" };
    });
    return {
      role: message.role,
      content: anthropicContent
    };
  }
  transformResponse(response, schema) {
    let content = "";
    let thinking = "";
    const toolCalls = [];
    for (const block of response.content) {
      switch (block.type) {
        case "text": {
          content += block.text;
          break;
        }
        case "thinking": {
          thinking += block.text;
          break;
        }
        case "tool_use": {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input
          });
          break;
        }
      }
    }
    let parsedContent;
    const structuredOutputTool = toolCalls.find((tc) => tc.name === "respond_with_structured_output");
    if (schema && structuredOutputTool) {
      try {
        parsedContent = schema.parse(structuredOutputTool.arguments);
      } catch {
        parsedContent = content;
      }
    } else if (schema && content) {
      try {
        const parsed = JSON.parse(content);
        parsedContent = schema.parse(parsed);
      } catch {
        parsedContent = content;
      }
    } else {
      parsedContent = content;
    }
    const totalTokens = response.usage.input_tokens + response.usage.output_tokens + (response.usage.thinking_tokens || 0);
    const result = {
      content: parsedContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens
      },
      model: response.model,
      finishReason: response.stop_reason
    };
    const nonStructuredToolCalls = toolCalls.filter((tc) => tc.name !== "respond_with_structured_output");
    if (nonStructuredToolCalls.length > 0 && !schema) {
      result.toolCalls = nonStructuredToolCalls;
    }
    if (thinking) {
      result.thinking = thinking;
    }
    return result;
  }
  async listModels() {
    const response = await fetch(`${this.baseURL}/models`, {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion
      }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new LLMError(`Anthropic API error (${response.status}): ${error.error?.message || "Unknown error"}`, response.status, "anthropic");
    }
    const data = await response.json();
    return data.data.map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      created: new Date(model.created_at).getTime() / 1000
    }));
  }
}
// src/providers/gemini/gemini.ts
function zodToGeminiSchema(schema) {
  const zodType = schema._def || schema.def;
  if (!zodType) {
    throw new Error("Invalid Zod schema: missing _def property");
  }
  function processZodType(def) {
    switch (def.type) {
      case "string": {
        const result = { type: "string" };
        if (def.checks) {
          for (const check of def.checks) {
            const checkDef = check.def || check._def || check;
            if (checkDef.kind === "uuid" || checkDef.format === "uuid") {
              result.pattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[4][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
            } else if (checkDef.kind === "email" || checkDef.format === "email") {
              result.pattern = "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$";
            } else if (checkDef.kind === "datetime" || checkDef.format === "date-time") {
              result.format = "date-time";
            } else if (checkDef.kind === "min") {
              result.minLength = checkDef.value;
            } else if (checkDef.kind === "max") {
              result.maxLength = checkDef.value;
            }
          }
        }
        return result;
      }
      case "number": {
        const numResult = { type: "number" };
        if (def.checks) {
          for (const check of def.checks) {
            const checkDef = check.def || check._def || check;
            switch (checkDef.kind) {
              case "int": {
                numResult.type = "integer";
                break;
              }
              case "min": {
                numResult.minimum = checkDef.value;
                break;
              }
              case "max": {
                numResult.maximum = checkDef.value;
                break;
              }
              case "multipleOf": {
                numResult.multipleOf = checkDef.value;
                break;
              }
            }
          }
        }
        return numResult;
      }
      case "boolean":
        return { type: "boolean" };
      case "array": {
        const itemDef = def.valueType?._def || def.valueType?.def || def.valueType || def.element?._def || def.element?.def || def.element;
        const arrayResult = {
          type: "array",
          items: itemDef ? processZodType(itemDef) : { type: "string" }
        };
        if (def.checks) {
          for (const check of def.checks) {
            const checkDef = check.def || check._def || check;
            switch (checkDef.kind) {
              case "min": {
                arrayResult.minItems = checkDef.value;
                break;
              }
              case "max": {
                arrayResult.maxItems = checkDef.value;
                break;
              }
              case "length": {
                arrayResult.minItems = checkDef.value;
                arrayResult.maxItems = checkDef.value;
                break;
              }
            }
          }
        }
        return arrayResult;
      }
      case "object": {
        const properties = {};
        const required = [];
        const shape = def.shape || {};
        for (const [key, value] of Object.entries(shape)) {
          const fieldDef = value._def || value.def || value;
          properties[key] = processZodType(fieldDef);
          if (fieldDef.type !== "optional") {
            required.push(key);
          }
        }
        return {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined
        };
      }
      case "optional": {
        const innerDef = def.innerType?._def || def.innerType?.def || def.innerType;
        return innerDef ? processZodType(innerDef) : { type: "string" };
      }
      case "enum":
        return {
          type: "string",
          enum: def.values
        };
      case "literal":
        return {
          type: typeof def.value,
          const: def.value
        };
      default:
        return { type: "string" };
    }
  }
  return processZodType(zodType);
}

class GeminiProvider {
  name = "gemini";
  capabilities = {
    streaming: true,
    tools: true,
    structuredOutput: true,
    vision: true,
    maxTokens: 1048576
  };
  apiKey;
  baseURL = "https://generativelanguage.googleapis.com/v1beta";
  retryConfig;
  constructor(apiKey, baseURL, retryConfig) {
    this.apiKey = apiKey;
    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, "");
    }
    this.retryConfig = retryConfig;
  }
  async chat(request) {
    const makeRequest = async () => {
      const geminiRequest = this.transformRequest(request);
      const model = request.model || "gemini-1.5-pro-latest";
      const response = await fetch(`${this.baseURL}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body: JSON.stringify(geminiRequest)
      });
      if (!response) {
        throw new LLMError("Network error: No response received", undefined, "gemini", request.model);
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
        const retryAfter = response.headers.get("Retry-After");
        const errorMessage = `Gemini API error (${response.status}): ${error.error?.message || "Unknown error"}`;
        const llmError = new LLMError(errorMessage, response.status, "gemini", request.model);
        if (retryAfter) {
          llmError.retryAfter = parseInt(retryAfter, 10);
        }
        throw llmError;
      }
      const data = await response.json();
      return this.transformResponse(data, model, request.schema);
    };
    if (this.retryConfig) {
      return retry(makeRequest, this.retryConfig);
    }
    return makeRequest();
  }
  async stream(request) {
    const geminiRequest = this.transformRequest(request);
    const model = request.model || "gemini-1.5-pro-latest";
    const response = await fetch(`${this.baseURL}/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify(geminiRequest)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(`Gemini API error (${response.status}): ${error.error?.message || "Unknown error"}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder;
    let buffer = "";
    let content = "";
    let usage = { promptTokenCount: 0, candidatesTokenCount: 0 };
    let finishReason;
    const streamResponse = {
      async* [Symbol.asyncIterator]() {
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split(`
`);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim())
              continue;
            try {
              const jsonStr = line.startsWith("data: ") ? line.slice(6) : line;
              const data = JSON.parse(jsonStr);
              if (data.candidates && data.candidates[0]) {
                const candidate = data.candidates[0];
                if (candidate.content && candidate.content.parts) {
                  for (const part of candidate.content.parts) {
                    if ("text" in part && part.text) {
                      content += part.text;
                      if (!request.schema) {
                        yield part.text;
                      }
                    }
                  }
                }
                if (candidate.finishReason) {
                  finishReason = candidate.finishReason;
                }
              }
              if (data.usageMetadata) {
                usage = data.usageMetadata;
              }
            } catch (e) {}
          }
        }
      },
      async complete() {
        for await (const _chunk of streamResponse) {}
        let parsedContent;
        if (request.schema && content) {
          try {
            const parsed = JSON.parse(content);
            parsedContent = request.schema.parse(parsed);
          } catch {
            parsedContent = content;
          }
        } else {
          parsedContent = content;
        }
        return {
          content: parsedContent,
          usage: {
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.promptTokenCount + usage.candidatesTokenCount
          },
          model,
          finishReason
        };
      }
    };
    return streamResponse;
  }
  supportsFeature(feature) {
    return feature in this.capabilities && this.capabilities[feature] === true;
  }
  transformRequest(request) {
    let systemInstruction;
    const contents = [];
    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemInstruction = {
          parts: [{ text: typeof msg.content === "string" ? msg.content : "" }]
        };
      } else {
        contents.push(this.transformMessage(msg));
      }
    }
    const geminiRequest = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens
      }
    };
    if (request.schema && !request.tools) {
      const jsonSchema = zodToGeminiSchema(request.schema);
      geminiRequest.tools = [
        {
          functionDeclarations: [
            {
              name: "respond_with_structured_output",
              description: "Respond with structured data matching the required schema",
              parameters: jsonSchema
            }
          ]
        }
      ];
      geminiRequest.toolConfig = {
        functionCallingConfig: { mode: "ANY" }
      };
    }
    if (request.features) {
      if (request.features.safetySettings) {
        geminiRequest.safetySettings = request.features.safetySettings;
      }
    }
    if (request.tools) {
      geminiRequest.tools = [
        {
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters ? zodToGeminiSchema(tool.parameters) : { type: "object", properties: {} }
          }))
        }
      ];
    }
    if (request.toolChoice) {
      switch (request.toolChoice) {
        case "required": {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: "ANY" }
          };
          break;
        }
        case "none": {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: "NONE" }
          };
          break;
        }
        case "auto": {
          geminiRequest.toolConfig = {
            functionCallingConfig: { mode: "AUTO" }
          };
          break;
        }
      }
    }
    return geminiRequest;
  }
  transformMessage(message) {
    const role = message.role === "assistant" ? "model" : "user";
    if (typeof message.content === "string") {
      return {
        role,
        parts: [{ text: message.content }]
      };
    }
    const parts = message.content.map((c) => {
      if (c.type === "text") {
        return { text: c.text || "" };
      }
      return { text: "[Image content]" };
    });
    return { role, parts };
  }
  transformResponse(response, model, schema) {
    const candidate = response.candidates[0];
    if (!candidate) {
      throw new Error("No candidate in response");
    }
    let content = "";
    const toolCalls = [];
    if (candidate.content && candidate.content.parts) {
      for (let i = 0;i < candidate.content.parts.length; i++) {
        const part = candidate.content.parts[i];
        if (part && "text" in part && part.text) {
          content += part.text;
        } else if (part && "functionCall" in part) {
          toolCalls.push({
            id: `${part.functionCall.name}_${i}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args
          });
        }
      }
    }
    let parsedContent;
    const structuredOutputTool = toolCalls.find((tc) => tc.name === "respond_with_structured_output");
    if (schema && structuredOutputTool) {
      try {
        parsedContent = schema.parse(structuredOutputTool.arguments);
      } catch {
        parsedContent = content;
      }
    } else if (schema && content) {
      try {
        const parsed = JSON.parse(content);
        parsedContent = schema.parse(parsed);
      } catch {
        parsedContent = content;
      }
    } else {
      parsedContent = content;
    }
    const result = {
      content: parsedContent,
      usage: response.usageMetadata ? {
        inputTokens: response.usageMetadata.promptTokenCount,
        outputTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount
      } : {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      model,
      finishReason: candidate.finishReason
    };
    const nonStructuredToolCalls = toolCalls.filter((tc) => tc.name !== "respond_with_structured_output");
    if (nonStructuredToolCalls.length > 0 && !schema) {
      result.toolCalls = nonStructuredToolCalls;
    }
    if (candidate.safetyRatings) {
      result.safetyRatings = candidate.safetyRatings;
    }
    return result;
  }
  async listModels() {
    const response = await fetch(`${this.baseURL}/models`, {
      method: "GET",
      headers: {
        "x-goog-api-key": this.apiKey
      }
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new LLMError(`Gemini API error (${response.status}): ${error.error?.message || "Unknown error"}`, response.status, "gemini");
    }
    const data = await response.json();
    return data.models.map((model) => ({
      id: model.name.replace("models/", ""),
      name: model.displayName,
      description: model.description
    }));
  }
}
// src/client.ts
class LLMClientImpl {
  provider;
  apiKey;
  model;
  defaultOptions;
  retry;
  providerImpl;
  tools = new Map;
  constructor(provider, apiKey, model, defaultOptions, retry2, providerImpl) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model;
    this.defaultOptions = defaultOptions;
    this.retry = retry2;
    this.providerImpl = providerImpl;
  }
  async chat(options) {
    if (!this.providerImpl) {
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }
    const request = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: options.stream,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model
    };
    const response = await this.providerImpl.chat(request);
    return response;
  }
  async stream(options) {
    if (!this.providerImpl) {
      throw new Error(`Provider ${this.provider} not implemented yet`);
    }
    const request = {
      messages: options.messages,
      temperature: options.temperature ?? this.defaultOptions?.temperature,
      maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
      stream: true,
      schema: options.schema,
      tools: options.tools,
      toolChoice: options.toolChoice,
      features: options.features,
      model: this.model
    };
    return this.providerImpl.stream(request);
  }
  defineTool(config) {
    const tool = {
      name: config.name,
      description: config.description,
      parameters: config.schema,
      execute: config.execute
    };
    this.tools.set(config.name, tool);
    return tool;
  }
  async executeTools(toolCalls) {
    const results = [];
    for (const call of toolCalls) {
      const tool = this.tools.get(call.name);
      if (!tool) {
        results.push({
          toolCallId: call.id,
          result: null,
          error: `Tool ${call.name} not found`
        });
        continue;
      }
      try {
        const params = tool.parameters.parse(call.arguments);
        const result = await tool.execute(params);
        results.push({
          toolCallId: call.id,
          result
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          result: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }
  async listModels() {
    if (!this.providerImpl) {
      throw new Error("Provider not initialized");
    }
    return this.providerImpl.listModels();
  }
}
function createLLM(config) {
  let providerImpl;
  switch (config.provider) {
    case "openai":
      providerImpl = new OpenAIProvider(config.apiKey, undefined, config.retry);
      break;
    case "anthropic":
      providerImpl = new AnthropicProvider(config.apiKey, undefined, config.retry);
      break;
    case "gemini":
      providerImpl = new GeminiProvider(config.apiKey, undefined, config.retry);
      break;
  }
  return new LLMClientImpl(config.provider, config.apiKey, config.model, config.defaultOptions, config.retry, providerImpl);
}
function createOpenAILLM(config) {
  return createLLM({ ...config, provider: "openai" });
}
function createAnthropicLLM(config) {
  return createLLM({ ...config, provider: "anthropic" });
}
function createGeminiLLM(config) {
  return createLLM({ ...config, provider: "gemini" });
}
// src/providers/types.ts
function isOpenAIResponse(_response, provider) {
  return provider === "openai";
}
function isAnthropicResponse(_response, provider) {
  return provider === "anthropic";
}
function isGeminiResponse(_response, provider) {
  return provider === "gemini";
}
// src/generated/model-types.ts
var OPENAI_MODELS = [
  "gpt-4-0613",
  "gpt-4",
  "gpt-3.5-turbo",
  "o4-mini-deep-research-2025-06-26",
  "o3-pro-2025-06-10",
  "o4-mini-deep-research",
  "o3-deep-research",
  "o3-deep-research-2025-06-26",
  "davinci-002",
  "babbage-002",
  "gpt-3.5-turbo-instruct",
  "gpt-3.5-turbo-instruct-0914",
  "dall-e-3",
  "dall-e-2",
  "gpt-4-1106-preview",
  "gpt-3.5-turbo-1106",
  "tts-1-hd",
  "tts-1-1106",
  "tts-1-hd-1106",
  "text-embedding-3-small",
  "text-embedding-3-large",
  "gpt-4-0125-preview",
  "gpt-4-turbo-preview",
  "gpt-3.5-turbo-0125",
  "gpt-4-turbo",
  "gpt-4-turbo-2024-04-09",
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-mini-2024-07-18",
  "gpt-4o-mini",
  "gpt-4o-2024-08-06",
  "chatgpt-4o-latest",
  "o1-preview-2024-09-12",
  "o1-preview",
  "o1-mini-2024-09-12",
  "o1-mini",
  "gpt-4o-realtime-preview-2024-10-01",
  "gpt-4o-audio-preview-2024-10-01",
  "gpt-4o-audio-preview",
  "gpt-4o-realtime-preview",
  "omni-moderation-latest",
  "omni-moderation-2024-09-26",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-4o-audio-preview-2024-12-17",
  "gpt-4o-mini-realtime-preview-2024-12-17",
  "gpt-4o-mini-audio-preview-2024-12-17",
  "o1-2024-12-17",
  "o1",
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-mini-audio-preview",
  "computer-use-preview",
  "o3-mini",
  "o3-mini-2025-01-31",
  "gpt-4o-2024-11-20",
  "computer-use-preview-2025-03-11",
  "gpt-4o-search-preview-2025-03-11",
  "gpt-4o-search-preview",
  "gpt-4o-mini-search-preview-2025-03-11",
  "gpt-4o-mini-search-preview",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "o1-pro-2025-03-19",
  "o1-pro",
  "gpt-4o-mini-tts",
  "o3-2025-04-16",
  "o4-mini-2025-04-16",
  "o3",
  "o4-mini",
  "gpt-4.1-2025-04-14",
  "gpt-4.1",
  "gpt-4.1-mini-2025-04-14",
  "gpt-4.1-mini",
  "gpt-4.1-nano-2025-04-14",
  "gpt-4.1-nano",
  "gpt-image-1",
  "codex-mini-latest",
  "o3-pro",
  "gpt-4o-realtime-preview-2025-06-03",
  "gpt-4o-audio-preview-2025-06-03",
  "gpt-3.5-turbo-16k",
  "tts-1",
  "whisper-1",
  "text-embedding-ada-002"
];
var ANTHROPIC_MODELS = [
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20240620",
  "claude-3-haiku-20240307",
  "claude-3-opus-20240229"
];
var GEMINI_MODELS = [
  "embedding-gecko-001",
  "gemini-1.0-pro-vision-latest",
  "gemini-pro-vision",
  "gemini-1.5-pro-latest",
  "gemini-1.5-pro-002",
  "gemini-1.5-pro",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash",
  "gemini-1.5-flash-002",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash-8b-001",
  "gemini-1.5-flash-8b-latest",
  "gemini-2.5-pro-preview-03-25",
  "gemini-2.5-flash-preview-05-20",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite-preview-06-17",
  "gemini-2.5-pro-preview-05-06",
  "gemini-2.5-pro-preview-06-05",
  "gemini-2.5-pro",
  "gemini-2.0-flash-exp",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-exp-image-generation",
  "gemini-2.0-flash-lite-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-lite-preview-02-05",
  "gemini-2.0-flash-lite-preview",
  "gemini-2.0-pro-exp",
  "gemini-2.0-pro-exp-02-05",
  "gemini-exp-1206",
  "gemini-2.0-flash-thinking-exp-01-21",
  "gemini-2.0-flash-thinking-exp",
  "gemini-2.0-flash-thinking-exp-1219",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
  "learnlm-2.0-flash-experimental",
  "gemma-3-1b-it",
  "gemma-3-4b-it",
  "gemma-3-12b-it",
  "gemma-3-27b-it",
  "gemma-3n-e4b-it",
  "gemma-3n-e2b-it",
  "embedding-001",
  "text-embedding-004",
  "gemini-embedding-exp-03-07",
  "gemini-embedding-exp",
  "gemini-embedding-001",
  "aqa",
  "imagen-3.0-generate-002"
];
export {
  isOpenAIResponse,
  isGeminiResponse,
  isAnthropicResponse,
  createOpenAILLM,
  createLLM,
  createGeminiLLM,
  createAnthropicLLM,
  OPENAI_MODELS,
  GEMINI_MODELS,
  ANTHROPIC_MODELS
};
