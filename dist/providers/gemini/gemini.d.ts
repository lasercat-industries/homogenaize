import type { StreamingResponse, ProviderCapabilities } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import type { RetryConfig } from '../../retry/types';
export declare class GeminiProvider implements TypedProvider<'gemini'> {
    readonly name: "gemini";
    readonly capabilities: ProviderCapabilities;
    private apiKey;
    private baseURL;
    private retryConfig?;
    constructor(apiKey: string, baseURL?: string, retryConfig?: RetryConfig);
    chat<T = string>(request: ProviderChatRequest<'gemini'>): Promise<ProviderChatResponse<'gemini', T>>;
    stream<T = string>(request: ProviderChatRequest<'gemini'>): Promise<StreamingResponse<T>>;
    supportsFeature(feature: string): boolean;
    private transformRequest;
    private transformMessage;
    private transformResponse;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=gemini.d.ts.map