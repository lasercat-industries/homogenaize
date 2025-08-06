// Generic JSON Schema type that can represent any valid JSON Schema
// We use this instead of AJV's JSONSchemaType which is too strict for generic schemas
export interface GenericJSONSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  properties?: Record<string, GenericJSONSchema>;
  items?: GenericJSONSchema | GenericJSONSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  additionalProperties?: boolean | GenericJSONSchema;
  allOf?: GenericJSONSchema[];
  anyOf?: GenericJSONSchema[];
  oneOf?: GenericJSONSchema[];
  not?: GenericJSONSchema;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  nullable?: boolean;
  [key: string]: unknown;
}
