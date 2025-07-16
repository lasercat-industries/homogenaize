import { z } from 'zod';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
// Implementation class
export class LLMClientImpl {
    constructor(provider, apiKey, model, defaultOptions, retry, providerImpl) {
        this.provider = provider;
        this.apiKey = apiKey;
        this.model = model;
        this.defaultOptions = defaultOptions;
        this.retry = retry;
        this.providerImpl = providerImpl;
        this.tools = new Map();
    }
    async chat(options) {
        if (!this.providerImpl) {
            throw new Error(`Provider ${this.provider} not implemented yet`);
        }
        const request = {
            ...options,
            temperature: options.temperature ?? this.defaultOptions?.temperature,
            maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
            model: this.model,
        };
        const response = await this.providerImpl.chat(request);
        return response;
    }
    async stream(options) {
        if (!this.providerImpl) {
            throw new Error(`Provider ${this.provider} not implemented yet`);
        }
        const request = {
            ...options,
            temperature: options.temperature ?? this.defaultOptions?.temperature,
            maxTokens: options.maxTokens ?? this.defaultOptions?.maxTokens,
            model: this.model,
        };
        return this.providerImpl.stream(request);
    }
    defineTool(config) {
        const tool = {
            name: config.name,
            description: config.description,
            parameters: config.schema,
            execute: config.execute,
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
                    error: `Tool ${call.name} not found`,
                });
                continue;
            }
            try {
                const params = tool.parameters.parse(call.arguments);
                const result = await tool.execute(params);
                results.push({
                    toolCallId: call.id,
                    result,
                });
            }
            catch (error) {
                results.push({
                    toolCallId: call.id,
                    result: null,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return results;
    }
    async listModels() {
        if (!this.providerImpl) {
            throw new Error('Provider not initialized');
        }
        return this.providerImpl.listModels();
    }
}
// Factory functions
export function createLLM(config) {
    let providerImpl;
    // Create provider implementation based on provider name
    switch (config.provider) {
        case 'openai':
            providerImpl = new OpenAIProvider(config.apiKey, undefined, config.retry);
            break;
        case 'anthropic':
            providerImpl = new AnthropicProvider(config.apiKey, undefined, config.retry);
            break;
        case 'gemini':
            providerImpl = new GeminiProvider(config.apiKey, undefined, config.retry);
            break;
    }
    return new LLMClientImpl(config.provider, config.apiKey, config.model, config.defaultOptions, config.retry, providerImpl);
}
export function createOpenAILLM(config) {
    return createLLM({ ...config, provider: 'openai' });
}
export function createAnthropicLLM(config) {
    return createLLM({ ...config, provider: 'anthropic' });
}
export function createGeminiLLM(config) {
    return createLLM({ ...config, provider: 'gemini' });
}
//# sourceMappingURL=client.js.map