import type { StreamingResponse, ProviderCapabilities } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import type { RetryConfig } from '../../retry/types';
export declare class OpenAIProvider implements TypedProvider<'openai'> {
    readonly name: "openai";
    readonly capabilities: ProviderCapabilities;
    private apiKey;
    private baseURL;
    private retryConfig?;
    constructor(apiKey: string, baseURL?: string, retryConfig?: RetryConfig);
    chat<T = string>(request: ProviderChatRequest<'openai'>): Promise<ProviderChatResponse<'openai', T>>;
    stream<T = string>(request: ProviderChatRequest<'openai'>): Promise<StreamingResponse<T>>;
    supportsFeature(feature: string): boolean;
    private transformRequest;
    private transformMessage;
    private transformResponse;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=openai.d.ts.map