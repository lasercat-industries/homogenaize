import { z } from 'zod';
export interface StreamingResult<T> {
    isComplete: boolean;
    data?: T;
    partialData?: Partial<T>;
    validationStatus: 'valid' | 'invalid' | 'partial';
    errors?: Array<{
        path: string;
        message: string;
    }>;
}
export interface StreamingOptions<T> {
    messages: Array<{
        role: string;
        content: string;
    }>;
    schema: z.ZodSchema<T>;
    onChunk?: (result: StreamingResult<T>) => void;
}
export declare class StreamingResponseHandler<T> {
    private schema;
    private buffer;
    constructor(schema: z.ZodSchema<T>);
    processChunk(chunk: string): Promise<StreamingResult<T>>;
    private parsePartialJSON;
    reset(): void;
}
export declare function createMockStream(chunks: string[]): ReadableStream<Uint8Array>;
//# sourceMappingURL=streaming.d.ts.map