import Ajv from 'ajv';
import type { ErrorObject, ValidateFunction, JSONSchemaType } from 'ajv';
import type { GenericJSONSchema } from '../types/schema';

// Create a singleton AJV instance with common settings
const ajv = new Ajv({
  strict: false, // Allow additional properties by default
  allErrors: true, // Collect all errors, not just first
  verbose: true, // Include schema and data in errors
});

// Cache for compiled validators
// Using unknown type for the key to avoid complex type issues
const validatorCache = new Map<unknown, ValidateFunction>();

/**
 * Validate data against a JSON Schema (typed or untyped)
 * @param schema The JSON Schema to validate against (can be typed or generic)
 * @param data The data to validate
 * @returns Validation result with parsed data or errors
 */
export function validateJSONSchema<T = unknown>(
  schema: JSONSchemaType<T> | GenericJSONSchema,
  data: unknown,
): { valid: true; data: T } | { valid: false; errors: string[] } {
  // Get or compile validator
  let validate = validatorCache.get(schema);
  if (!validate) {
    try {
      // Cast to unknown first to avoid complex type issues with JSONSchemaType
      validate = ajv.compile(schema as unknown as Parameters<typeof ajv.compile>[0]);
      validatorCache.set(schema, validate);
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to compile JSON Schema: ${error}`],
      };
    }
  }

  // Validate the data
  const valid = validate(data);

  if (valid) {
    return { valid: true, data: data as T };
  } else {
    // Format errors
    const errors = (validate.errors || []).map((err: ErrorObject) => {
      const path = err.instancePath || '/';
      const message = err.message || 'validation error';
      return `${path}: ${message}`;
    });

    return { valid: false, errors };
  }
}

/**
 * Clear the validator cache
 */
export function clearValidatorCache(): void {
  validatorCache.clear();
}
