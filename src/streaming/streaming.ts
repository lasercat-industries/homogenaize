import { z } from 'zod';
import { getLogger } from '../utils/logger';

export interface StreamingResult<T> {
  isComplete: boolean;
  data?: T;
  partialData?: Partial<T>;
  validationStatus: 'valid' | 'invalid' | 'partial';
  errors?: Array<{ path: string; message: string }>;
}

export interface StreamingOptions<T> {
  messages: Array<{ role: string; content: string }>;
  schema: z.ZodSchema<T>;
  onChunk?: (result: StreamingResult<T>) => void;
}

export class StreamingResponseHandler<T> {
  private buffer: string = '';
  private logger = getLogger('streaming');

  constructor(private schema: z.ZodSchema<T>) {
    this.logger.debug('StreamingResponseHandler initialized');
  }

  async processChunk(chunk: string): Promise<StreamingResult<T>> {
    this.buffer += chunk;
    this.logger.verbose('Processing chunk', {
      chunkLength: chunk.length,
      bufferLength: this.buffer.length,
    });

    // Try to parse as complete JSON first
    try {
      const parsed = JSON.parse(this.buffer);
      this.logger.debug('Successfully parsed complete JSON from buffer');

      // We have complete JSON, now validate it
      const validationResult = this.schema.safeParse(parsed);

      if (validationResult.success) {
        this.logger.info('Stream complete with valid data');
        return {
          isComplete: true,
          data: validationResult.data,
          validationStatus: 'valid',
        };
      } else {
        this.logger.warn('Stream complete but validation failed', {
          errors: validationResult.error.issues.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        });
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
    } catch {
      // JSON is incomplete, try partial parsing
      this.logger.verbose('JSON incomplete, attempting partial parsing');
      const partialData = this.parsePartialJSON(this.buffer);

      if (Object.keys(partialData).length > 0) {
        return {
          isComplete: false,
          partialData: partialData as Partial<T>,
          validationStatus: 'partial',
        };
      }

      return {
        isComplete: false,
        validationStatus: 'partial',
      };
    }
  }

  private parsePartialJSON(str: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Extract key-value pairs, including incomplete ones
    // Match pattern: "key": "value" OR "key": "incomplete
    const keyValueRegex = /"([^"]+)":\s*(?:"([^"]*)"?|(\d+))/g;
    let match;

    while ((match = keyValueRegex.exec(str)) !== null) {
      const [, key, stringValue, numberValue] = match;

      if (key && stringValue !== undefined) {
        result[key] = stringValue;
      } else if (key && numberValue !== undefined) {
        result[key] = parseInt(numberValue, 10);
      }
    }

    return result;
  }

  reset(): void {
    this.buffer = '';
  }
}

// Helper function to create mock streams for testing
export function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  let index = 0;

  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}
