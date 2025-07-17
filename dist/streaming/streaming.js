import { z } from 'zod';
export class StreamingResponseHandler {
    constructor(schema) {
        this.schema = schema;
        this.buffer = '';
    }
    async processChunk(chunk) {
        this.buffer += chunk;
        // Try to parse as complete JSON first
        try {
            const parsed = JSON.parse(this.buffer);
            // We have complete JSON, now validate it
            const validationResult = this.schema.safeParse(parsed);
            if (validationResult.success) {
                return {
                    isComplete: true,
                    data: validationResult.data,
                    validationStatus: 'valid',
                };
            }
            else {
                return {
                    isComplete: true,
                    data: parsed,
                    validationStatus: 'invalid',
                    errors: validationResult.error.issues.map((err) => ({
                        path: err.path.join('.'),
                        message: err.message,
                    })),
                };
            }
        }
        catch {
            // JSON is incomplete, try partial parsing
            const partialData = this.parsePartialJSON(this.buffer);
            if (Object.keys(partialData).length > 0) {
                return {
                    isComplete: false,
                    partialData: partialData,
                    validationStatus: 'partial',
                };
            }
            return {
                isComplete: false,
                validationStatus: 'partial',
            };
        }
    }
    parsePartialJSON(str) {
        const result = {};
        // Extract key-value pairs, including incomplete ones
        // Match pattern: "key": "value" OR "key": "incomplete
        const keyValueRegex = /"([^"]+)":\s*(?:"([^"]*)"?|(\d+))/g;
        let match;
        while ((match = keyValueRegex.exec(str)) !== null) {
            const [, key, stringValue, numberValue] = match;
            if (key && stringValue !== undefined) {
                result[key] = stringValue;
            }
            else if (key && numberValue !== undefined) {
                result[key] = parseInt(numberValue, 10);
            }
        }
        return result;
    }
    reset() {
        this.buffer = '';
    }
}
// Helper function to create mock streams for testing
export function createMockStream(chunks) {
    let index = 0;
    return new ReadableStream({
        async pull(controller) {
            if (index < chunks.length) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode(chunks[index]));
                index++;
            }
            else {
                controller.close();
            }
        },
    });
}
//# sourceMappingURL=streaming.js.map