// Types for Zod internal structures that we need to access
// These are based on Zod's internal implementation but provide type safety

export interface ZodDefBase {
  type: string;
}

export interface ZodStringDef extends ZodDefBase {
  type: 'string';
  checks?: Array<{
    kind?: string;
    format?: string;
    value?: unknown;
    def?: unknown;
    _def?: unknown;
  }>;
}

export interface ZodNumberDef extends ZodDefBase {
  type: 'number';
  checks?: Array<{
    kind?: string;
    value?: unknown;
    def?: unknown;
    _def?: unknown;
  }>;
}

export interface ZodBooleanDef extends ZodDefBase {
  type: 'boolean';
}

export interface ZodArrayDef extends ZodDefBase {
  type: 'array';
  valueType?: { _def?: ZodDef; def?: ZodDef };
  element?: { _def?: ZodDef; def?: ZodDef };
  checks?: Array<{
    kind?: string;
    value?: unknown;
    def?: unknown;
    _def?: unknown;
  }>;
}

export interface ZodObjectDef extends ZodDefBase {
  type: 'object';
  shape: Record<string, { _def?: ZodDef; def?: ZodDef }>;
}

export interface ZodOptionalDef extends ZodDefBase {
  type: 'optional';
  innerType?: { _def?: ZodDef; def?: ZodDef };
}

export interface ZodEnumDef extends ZodDefBase {
  type: 'enum';
  values?: string[];
  entries?: Record<string, string>;
  options?: string[];
}

export interface ZodLiteralDef extends ZodDefBase {
  type: 'literal';
  value: string | number | boolean;
}

export interface ZodUnionDef extends ZodDefBase {
  type: 'union';
  options?: Array<{ _def?: ZodDef; def?: ZodDef }>;
}

export interface ZodDiscriminatedUnionDef extends ZodDefBase {
  type: 'discriminatedUnion';
  discriminator?: string;
  options?: Array<{ _def?: ZodDef; def?: ZodDef }>;
  optionsMap?: Map<string, { _def?: ZodDef; def?: ZodDef }>;
}

export type ZodDef =
  | ZodStringDef
  | ZodNumberDef
  | ZodBooleanDef
  | ZodArrayDef
  | ZodObjectDef
  | ZodOptionalDef
  | ZodEnumDef
  | ZodLiteralDef
  | ZodUnionDef
  | ZodDiscriminatedUnionDef
  | ZodDefBase; // fallback for unknown types

// Helper to safely get Zod def from a schema
export function getZodDef(schema: unknown): ZodDef | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }

  const s = schema as { _def?: ZodDef; def?: ZodDef };
  return s._def || s.def;
}
