import { z } from 'zod';
import type { JSONSchemaType } from 'ajv';
import type { GenericJSONSchema } from '../types/schema';

/**
 * Type guard to check if a value is a Zod schema
 */
export function isZodSchema(value: unknown): value is z.ZodSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as Record<string, unknown>)._def === 'object'
  );
}

/**
 * Type guard to check if a value is a typed JSON Schema (AJV's JSONSchemaType)
 */
export function isTypedJSONSchema<T = unknown>(value: unknown): value is JSONSchemaType<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // If it has _def, it's a Zod schema
  if ('_def' in value) {
    return false;
  }

  // Check for JSON Schema properties with stricter typing
  const schema = value as Record<string, unknown>;
  return (
    ('type' in schema && typeof schema.type === 'string') ||
    ('type' in schema && Array.isArray(schema.type)) ||
    'properties' in schema ||
    'items' in schema ||
    'allOf' in schema ||
    'anyOf' in schema ||
    'oneOf' in schema ||
    '$ref' in schema
  );
}

/**
 * Type guard to check if a value is a generic JSON Schema
 */
export function isJSONSchema(value: unknown): value is GenericJSONSchema | JSONSchemaType<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // If it has _def, it's a Zod schema
  if ('_def' in value) {
    return false;
  }

  // Check for JSON Schema properties
  const schema = value as Record<string, unknown>;
  return (
    'type' in schema ||
    'properties' in schema ||
    'items' in schema ||
    'allOf' in schema ||
    'anyOf' in schema ||
    'oneOf' in schema ||
    '$ref' in schema
  );
}

/**
 * Get the type of a schema (Zod, typed JSON, or generic JSON)
 */
export function getSchemaType(schema: unknown): 'zod' | 'typed-json' | 'json' | 'unknown' {
  if (isZodSchema(schema)) {
    return 'zod';
  }
  if (isTypedJSONSchema(schema)) {
    return 'typed-json';
  }
  if (isJSONSchema(schema)) {
    return 'json';
  }
  return 'unknown';
}
