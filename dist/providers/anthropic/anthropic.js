import { z } from 'zod';
import { retry } from '../../retry';
import { LLMError } from '../../retry/errors';
// Helper to convert Zod schema to Anthropic-compatible JSON Schema
function zodToAnthropicSchema(schema) {
    // Handle both Zod v3 and v4 structure
    const zodType = schema._def || schema.def;
    if (!zodType) {
        throw new Error('Invalid Zod schema: missing _def property');
    }
    function processZodType(def) {
        switch (def.type) {
            case 'string':
                return { type: 'string' };
            case 'number':
                return { type: 'number' };
            case 'boolean':
                return { type: 'boolean' };
            case 'array': {
                const itemDef = def.valueType?._def ||
                    def.valueType?.def ||
                    def.valueType ||
                    def.element?._def ||
                    def.element?.def ||
                    def.element;
                return {
                    type: 'array',
                    items: itemDef ? processZodType(itemDef) : { type: 'any' },
                };
            }
            case 'object': {
                const properties = {};
                const required = [];
                // Access shape directly from def
                const shape = def.shape || {};
                for (const [key, value] of Object.entries(shape)) {
                    // Handle both Zod v3 and v4 - in v4, each field has its own _def
                    const fieldDef = value._def || value.def || value;
                    const fieldSchema = processZodType(fieldDef);
                    properties[key] = fieldSchema;
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
            }
            case 'optional': {
                const innerDef = def.innerType?._def || def.innerType?.def || def.innerType;
                return innerDef ? processZodType(innerDef) : { type: 'any' };
            }
            case 'enum':
                return {
                    type: 'string',
                    enum: def.values || [],
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
export class AnthropicProvider {
    constructor(apiKey, baseURL, retryConfig) {
        this.name = 'anthropic';
        this.capabilities = {
            streaming: true,
            tools: true,
            structuredOutput: true,
            vision: true,
            maxTokens: 200000, // Claude 3 supports up to 200k tokens
        };
        this.baseURL = 'https://api.anthropic.com/v1';
        this.apiVersion = '2023-06-01';
        this.apiKey = apiKey;
        if (baseURL) {
            this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
        }
        this.retryConfig = retryConfig;
    }
    async chat(request) {
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
                throw new LLMError('Network error: No response received', undefined, 'anthropic', request.model);
            }
            if (!response.ok) {
                const error = (await response
                    .json()
                    .catch(() => ({ error: { message: response.statusText } })));
                const retryAfter = response.headers.get('Retry-After');
                const errorMessage = `Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`;
                const llmError = new LLMError(errorMessage, response.status, 'anthropic', request.model);
                if (retryAfter) {
                    llmError.retryAfter = parseInt(retryAfter, 10);
                }
                throw llmError;
            }
            const data = (await response.json());
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
                .catch(() => ({ error: { message: response.statusText } })));
            throw new Error(`Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let usage = { input_tokens: 0, output_tokens: 0 };
        let model = '';
        let anthropicFinishReason;
        let currentToolUse = null;
        let toolUseInput = '';
        // let messageId = ''; // Not needed since id is not part of response type
        const streamResponse = {
            async *[Symbol.asyncIterator]() {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
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
                            if (!data || data === '[DONE]')
                                continue;
                            try {
                                const event = JSON.parse(data);
                                switch (event.type) {
                                    case 'message_start': {
                                        const msgStart = event;
                                        // messageId = msgStart.message.id;
                                        model = msgStart.message.model;
                                        usage.input_tokens = msgStart.message.usage.input_tokens;
                                        break;
                                    }
                                    case 'content_block_delta': {
                                        const delta = event;
                                        if (delta.delta.type === 'text_delta') {
                                            const text = delta.delta.text;
                                            content += text;
                                            // For structured output, we can't yield partial JSON
                                            if (!request.schema) {
                                                yield text;
                                            }
                                        }
                                        else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
                                            toolUseInput += event.delta.partial_json;
                                        }
                                        break;
                                    }
                                    case 'message_delta': {
                                        const msgDelta = event;
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
                            }
                            catch {
                                // Ignore parsing errors
                            }
                        }
                    }
                }
            },
            async complete() {
                // Drain any remaining content
                for await (const _chunk of streamResponse) {
                    // Just consume
                }
                let parsedContent;
                // If we used schema-based tool calling, extract from tool call
                if (request.schema &&
                    currentToolUse?.name === 'respond_with_structured_output' &&
                    toolUseInput) {
                    try {
                        const parsed = JSON.parse(toolUseInput);
                        parsedContent = request.schema.parse(parsed);
                    }
                    catch {
                        parsedContent = content;
                    }
                }
                else if (request.schema && content) {
                    try {
                        const parsed = JSON.parse(content);
                        parsedContent = request.schema.parse(parsed);
                    }
                    catch {
                        parsedContent = content;
                    }
                }
                else {
                    parsedContent = content;
                }
                // Map Anthropic finish reasons to standard ones
                let finishReason;
                if (anthropicFinishReason) {
                    if (anthropicFinishReason === 'end_turn' || anthropicFinishReason === 'stop_sequence') {
                        finishReason = 'stop';
                    }
                    else if (anthropicFinishReason === 'max_tokens') {
                        finishReason = 'length';
                    }
                    else if (anthropicFinishReason === 'tool_use') {
                        finishReason = 'tool_calls';
                    }
                }
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
    supportsFeature(feature) {
        return (feature in this.capabilities &&
            this.capabilities[feature] === true);
    }
    transformRequest(request) {
        // Extract system message if present
        let system;
        const messages = [];
        for (const msg of request.messages) {
            if (msg.role === 'system') {
                system = typeof msg.content === 'string' ? msg.content : '';
            }
            else {
                messages.push(this.transformMessage(msg));
            }
        }
        const anthropicRequest = {
            model: request.model || 'claude-3-opus-20240229', // Default fallback
            messages,
            system,
            max_tokens: request.maxTokens || 4096,
            temperature: request.temperature,
        };
        // Handle structured output via schema using forced tool calling
        if (request.schema && !request.tools) {
            // Create a hidden tool for structured output
            const jsonSchema = zodToAnthropicSchema(request.schema);
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
    transformMessage(message) {
        if (typeof message.content === 'string') {
            return {
                role: message.role,
                content: message.content,
            };
        }
        // Handle multi-modal content
        const anthropicContent = message.content.map((c) => {
            if (c.type === 'text') {
                return { type: 'text', text: c.text || '' };
            }
            // Handle image content if needed
            return { type: 'text', text: '[Image content]' };
        });
        return {
            role: message.role,
            content: anthropicContent,
        };
    }
    transformResponse(response, schema) {
        let content = '';
        let thinking = '';
        const toolCalls = [];
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
        let parsedContent;
        // If we used schema-based tool calling, extract the structured data from tool call
        const structuredOutputTool = toolCalls.find((tc) => tc.name === 'respond_with_structured_output');
        if (schema && structuredOutputTool) {
            try {
                parsedContent = schema.parse(structuredOutputTool.arguments);
            }
            catch {
                parsedContent = content;
            }
        }
        else if (schema && content) {
            try {
                const parsed = JSON.parse(content);
                parsedContent = schema.parse(parsed);
            }
            catch {
                parsedContent = content;
            }
        }
        else {
            parsedContent = content;
        }
        const totalTokens = response.usage.input_tokens +
            response.usage.output_tokens +
            (response.usage.thinking_tokens || 0);
        const result = {
            content: parsedContent,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                totalTokens: totalTokens,
            },
            model: response.model,
            finishReason: response.stop_reason,
            // id: response.id // Not part of the response type
        };
        // Only include tool calls if not using schema-based tool calling
        // or if there are other tool calls besides the structured output tool
        const nonStructuredToolCalls = toolCalls.filter((tc) => tc.name !== 'respond_with_structured_output');
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
            method: 'GET',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': this.apiVersion,
            },
        });
        if (!response.ok) {
            const error = (await response
                .json()
                .catch(() => ({ error: { message: response.statusText } })));
            throw new LLMError(`Anthropic API error (${response.status}): ${error.error?.message || 'Unknown error'}`, response.status, 'anthropic');
        }
        const data = (await response.json());
        return data.data.map((model) => ({
            id: model.id,
            name: model.display_name || model.id,
            created: new Date(model.created_at).getTime() / 1000,
        }));
    }
}
//# sourceMappingURL=anthropic.js.map