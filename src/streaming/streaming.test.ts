import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { StreamingResponseHandler } from './streaming';

// Test schema
const TestSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email().optional(),
});

describe('Streaming with Partial Validation', () => {
  describe('StreamingResponseHandler', () => {
    it('should handle complete JSON chunks', async () => {
      const handler = new StreamingResponseHandler(TestSchema);
      const chunk = '{"name": "John", "age": 30}';
      
      const result = await handler.processChunk(chunk);
      
      expect(result.isComplete).toBe(true);
      expect(result.data).toEqual({ name: "John", age: 30 });
      expect(result.errors).toBeUndefined();
    });

    it('should handle partial JSON chunks', async () => {
      const handler = new StreamingResponseHandler(TestSchema);
      
      // Test incomplete string value
      const result1 = await handler.processChunk('{"name": "Jo');
      expect(result1.isComplete).toBe(false);
      expect(result1.partialData).toBeDefined();
      
      // Reset and test complete chunk
      handler.reset();
      const result2 = await handler.processChunk('{"name": "John", "age": 30}');
      expect(result2.isComplete).toBe(true);
      expect(result2.data).toEqual({ name: "John", age: 30 });
    });

    it('should validate against schema incrementally', async () => {
      const handler = new StreamingResponseHandler(TestSchema);
      
      const result1 = await handler.processChunk('{"name": "John"');
      expect(result1.validationStatus).toBe('partial');
      
      const result2 = await handler.processChunk(', "age": 30}');
      expect(result2.validationStatus).toBe('valid');
      expect(result2.data).toEqual({ name: "John", age: 30 });
    });

    it('should handle validation errors', async () => {
      const handler = new StreamingResponseHandler(TestSchema);
      
      // Pass valid JSON with wrong types for schema
      const jsonString = JSON.stringify({ name: "John", age: "not a number" });
      const result = await handler.processChunk(jsonString);
      expect(result.isComplete).toBe(true);
      expect(result.validationStatus).toBe('invalid');
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });
});