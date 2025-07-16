import type { StreamingResponse, ProviderCapabilities } from '../provider';
import type { TypedProvider, ProviderChatRequest, ProviderChatResponse, ModelInfo } from '../types';
import type { RetryConfig } from '../../retry/types';
export declare class AnthropicProvider implements TypedProvider<'anthropic'> {
    readonly name: "anthropic";
    readonly capabilities: ProviderCapabilities;
    private apiKey;
    private baseURL;
    private apiVersion;
    private retryConfig?;
    constructor(apiKey: string, baseURL?: string, retryConfig?: RetryConfig);
    chat<T = string>(request: ProviderChatRequest<'anthropic'>): Promise<ProviderChatResponse<'anthropic', T>>;
    stream<T = string>(request: ProviderChatRequest<'anthropic'>): Promise<StreamingResponse<T>>;
    supportsFeature(feature: string): boolean;
    private transformRequest;
    private transformMessage;
    private transformResponse;
    listModels(): Promise<ModelInfo[]>;
}
//# sourceMappingURL=anthropic.d.ts.map