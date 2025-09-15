import { describe, expect, it, beforeEach } from 'bun:test';
import { z } from 'zod';
import { OpenAIProvider } from './openai';

describe('OpenAI Complex Schema Tests', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-api-key');
  });

  describe('Nested Object Strict Mode Requirements', () => {
    it('should add additionalProperties: false to ALL nested objects', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            settings: z.object({
              theme: z.string(),
            }),
          }),
        }),
      });

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // Root level
      expect(result.additionalProperties).toBe(false);

      // First level nested
      expect(result.properties.user.additionalProperties).toBe(false);

      // Second level nested
      expect(result.properties.user.properties.profile.additionalProperties).toBe(false);

      // Third level nested
      expect(
        result.properties.user.properties.profile.properties.settings.additionalProperties,
      ).toBe(false);
    });

    it('should handle required arrays correctly for nested objects with mixed fields', () => {
      const schema = z.object({
        elementBreakdown: z.object({
          totalElements: z.number(),
          elementSummaries: z.array(z.string()).optional(),
        }),
      });

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // The nested object should have required array with ALL properties
      expect(result.properties.elementBreakdown.required).toEqual([
        'totalElements',
        'elementSummaries',
      ]);

      // Root should also have its required array
      expect(result.required).toEqual(['elementBreakdown']);
    });

    it('should handle deeply nested structures with optional fields at multiple levels', () => {
      const schema = z.object({
        analysis: z.object({
          componentTree: z.object({
            root: z.object({
              name: z.string(),
              children: z
                .array(
                  z.object({
                    id: z.string(),
                    type: z.string().optional(),
                    metadata: z
                      .object({
                        score: z.number(),
                        tags: z.array(z.string()).optional(),
                      })
                      .optional(),
                  }),
                )
                .optional(),
            }),
            stats: z
              .object({
                totalNodes: z.number(),
                maxDepth: z.number().optional(),
              })
              .optional(),
          }),
        }),
      });

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // Check that all objects have additionalProperties: false
      const checkAdditionalProperties = (obj: any, path = ''): void => {
        if (obj && typeof obj === 'object') {
          if (obj.type === 'object') {
            expect(obj.additionalProperties).toBe(false);
          }

          // Check nested properties
          if (obj.properties) {
            Object.keys(obj.properties).forEach((key) => {
              checkAdditionalProperties(obj.properties[key], `${path}.properties.${key}`);
            });
          }

          // Check anyOf branches (for optional fields)
          if (obj.anyOf) {
            obj.anyOf.forEach((branch: any, i: number) => {
              checkAdditionalProperties(branch, `${path}.anyOf[${i}]`);
            });
          }

          // Check array items
          if (obj.items) {
            checkAdditionalProperties(obj.items, `${path}.items`);
          }
        }
      };

      checkAdditionalProperties(result, 'root');
    });

    it('should handle Record types with proper strict mode', () => {
      const schema = z.object({
        config: z.record(
          z.string(),
          z.object({
            value: z.string(),
            metadata: z
              .object({
                lastModified: z.number(),
              })
              .optional(),
          }),
        ),
      });

      // Record types might need special handling or should throw an error
      expect(() => {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          schema,
          model: 'gpt-4',
        });
      }).toThrow(); // Record types are typically not supported in strict mode
    });
  });

  describe('Array of Objects with Complex Schemas', () => {
    it('should handle arrays of nested objects correctly', () => {
      const schema = z.object({
        items: z.array(
          z.object({
            id: z.string(),
            details: z.object({
              name: z.string(),
              attributes: z.object({
                color: z.string().optional(),
                size: z.number().optional(),
              }),
            }),
          }),
        ),
      });

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;
      const itemSchema = result.properties.items.items;

      // Check the array item object has additionalProperties: false
      expect(itemSchema.additionalProperties).toBe(false);

      // Check nested objects in array items
      expect(itemSchema.properties.details.additionalProperties).toBe(false);
      expect(itemSchema.properties.details.properties.attributes.additionalProperties).toBe(false);

      // Check required arrays
      expect(itemSchema.required).toEqual(['id', 'details']);
      expect(itemSchema.properties.details.required).toEqual(['name', 'attributes']);
      expect(itemSchema.properties.details.properties.attributes.required).toEqual([
        'color',
        'size',
      ]);
    });
  });

  describe('Real-world Complex Schema from Error Context', () => {
    it('should handle file analyzer schema with proper strict mode', () => {
      // Reconstructing the likely schema from the error message
      const schema = z.object({
        elementBreakdown: z.object({
          totalElements: z.number(),
          elementSummaries: z.array(
            z.object({
              element: z.string(),
              count: z.number(),
              complexity: z.number().optional(),
            }),
          ),
          details: z
            .object({
              components: z.array(z.string()).optional(),
              imports: z.array(z.string()).optional(),
            })
            .optional(),
        }),
        analysis: z.object({
          score: z.number(),
          recommendations: z.array(z.string()).optional(),
        }),
      });

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // Verify root level
      expect(result.additionalProperties).toBe(false);
      expect(result.required).toContain('elementBreakdown');
      expect(result.required).toContain('analysis');

      // Verify elementBreakdown
      const elementBreakdown = result.properties.elementBreakdown;
      expect(elementBreakdown.additionalProperties).toBe(false);
      expect(elementBreakdown.required).toEqual(['totalElements', 'elementSummaries', 'details']);

      // Verify nested array items
      const elementSummarySchema = elementBreakdown.properties.elementSummaries.items;
      expect(elementSummarySchema.additionalProperties).toBe(false);
      expect(elementSummarySchema.required).toEqual(['element', 'count', 'complexity']);
    });
  });

  describe('JSON Schema Input', () => {
    it('should handle JSON Schema input with nested objects correctly', () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          elementBreakdown: {
            type: 'object',
            properties: {
              totalElements: { type: 'number' },
              elementSummaries: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['totalElements'],
          },
        },
        required: ['elementBreakdown'],
      };

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema: jsonSchema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // Should add additionalProperties: false even for JSON Schema input
      expect(result.additionalProperties).toBe(false);
      expect(result.properties.elementBreakdown.additionalProperties).toBe(false);

      // Should fix required arrays to include all properties
      expect(result.properties.elementBreakdown.required).toContain('totalElements');
      expect(result.properties.elementBreakdown.required).toContain('elementSummaries');
    });
  });

  describe('Edge Cases and Known Issues', () => {
    it('should handle nullable vs optional correctly', () => {
      const schema = z.object({
        nullableField: z.string().nullable(),
        optionalField: z.string().optional(),
        nullableOptionalField: z.string().nullable().optional(),
      });

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;

      // All fields should be in required array for strict mode
      expect(result.required).toEqual(['nullableField', 'optionalField', 'nullableOptionalField']);

      // Check how nullable is handled
      expect(result.properties.nullableField).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      });

      // Check how optional is handled
      expect(result.properties.optionalField).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      });

      // Check how nullable + optional is handled (should be double-wrapped)
      expect(result.properties.nullableOptionalField).toEqual({
        anyOf: [
          {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          { type: 'null' },
        ],
      });
    });

    it('should handle passthrough correctly or throw error', () => {
      const schema = z
        .object({
          knownField: z.string(),
        })
        .passthrough();

      // Passthrough is incompatible with additionalProperties: false
      expect(() => {
        (provider as any).transformRequest({
          messages: [{ role: 'user', content: 'test' }],
          schema,
          model: 'gpt-4',
        });
      }).toThrow();
    });

    it('should handle strict objects correctly', () => {
      const schema = z
        .object({
          field: z.string(),
        })
        .strict();

      const request = (provider as any).transformRequest({
        messages: [{ role: 'user', content: 'test' }],
        schema,
        model: 'gpt-4',
      });

      const result = request.response_format.json_schema.schema;
      expect(result.additionalProperties).toBe(false);
    });
  });
});
