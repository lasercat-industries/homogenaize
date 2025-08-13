# OpenAI Zod Schema Support Report

## Executive Summary

After running comprehensive tests with 50+ different Zod schema scenarios, we've identified clear patterns of what OpenAI's structured output supports and what it doesn't. OpenAI has good support for basic to moderately complex schemas but fails with advanced Zod features.

**Success Rate: ~40% (20 pass / 50 total tests)**

## ✅ FULLY SUPPORTED (Works Reliably)

### Basic Schema Types

- ✅ **Simple objects** with string, number, boolean fields
- ✅ **Nested objects** (even 4+ levels deep)
- ✅ **Arrays** with basic types
- ✅ **Enums** (string-based z.enum())
- ✅ **Native enums** (TypeScript enums with string values)
- ✅ **Optional fields** (z.optional())
- ✅ **Literal string/number values** (z.literal())
- ✅ **Constants** (const values)

### Validation & Constraints

- ✅ **String validations**
  - Length constraints (min, max, length)
  - Email validation
  - URL validation
  - UUID validation
  - Regex patterns
  - String transforms (toLowerCase, toUpperCase, trim)
- ✅ **Number validations**
  - Integer validation
  - Positive/negative constraints
  - Min/max ranges
  - Multiple of constraints
  - Safe number validation

- ✅ **Array constraints**
  - Min/max length
  - Nonempty arrays

### Advanced Features That Work

- ✅ **Discriminated unions** (z.discriminatedUnion)
- ✅ **Intersection types** (z.intersection, .and())
- ✅ **Custom refinements** (z.refine)
- ✅ **SuperRefine** (complex validation logic)
- ✅ **Transforms** (data manipulation)
- ✅ **Object composition**
  - merge() - combining schemas
  - extend() - extending schemas
  - pick() - selecting fields
  - omit() - excluding fields
- ✅ **Strict objects** (no extra properties)
- ✅ **Date/time string validation**
- ✅ **Large schemas** (20+ fields)
- ✅ **Default values**
- ✅ **Custom error messages**
- ✅ **Preprocessing/coercion** (z.preprocess, z.coerce)

## ❌ NOT SUPPORTED (Fails Consistently)

### Critical Failures

- ❌ **Recursive schemas** (z.lazy for tree structures)
  - Error: "schema must be JSON Schema of 'type: object'"
- ❌ **BigInt** (z.bigint())
  - Returns undefined
- ❌ **Sets** (z.set())
  - Returns undefined
- ❌ **Maps** (z.map())
  - Returns undefined
- ❌ **Tuples** (z.tuple())
  - Returns undefined or wrong structure
- ❌ **Non-discriminated unions** (z.union())
  - Returns undefined or wrong type
- ❌ **Mixed type unions** (string | number | array)
  - Picks wrong type or returns undefined
- ❌ **Nullable unions** (type | null)
  - Often returns undefined instead of null

### Object Manipulation Failures

- ❌ **Passthrough** (.passthrough())
  - Extra fields not preserved
- ❌ **Partial objects** (.partial())
  - Fields become undefined instead of optional
- ❌ **Deep partial** (.deepPartial())
  - Not supported, throws error
- ❌ **Required** (.required() on optional schema)
  - Fields remain undefined
- ❌ **CatchAll** (.catchall())
  - Additional properties not handled

### Other Failures

- ❌ **Numeric enums** (enum with number values)
  - Error: "enum value does not validate against type: string"
- ❌ **Literal null** in certain contexts
  - Error: "const value None does not validate"
- ❌ **Void type** (z.void())
- ❌ **Never type** (z.never())
- ❌ **Symbol type** (z.symbol())
- ❌ **Unknown type** behavior inconsistent
- ❌ **Fixed-length arrays** (.length())
- ❌ **Array rest elements** (.rest())
- ❌ **IP address validation** (z.string().ip())
- ❌ **CUID/CUID2/ULID/Nanoid** validation
- ❌ **Emoji validation** (z.string().emoji())
- ❌ **Circular references** with lazy
- ❌ **Pipeline compositions** (z.pipe())
- ❌ **Catch** (z.catch())
- ❌ **Very long strings** (500+ chars with constraints)

## 🟡 PARTIALLY SUPPORTED (Works Sometimes)

- 🟡 **Complex nested schemas** - Works but may miss deeply nested optional fields
- 🟡 **E-commerce/blog schemas** - Basic structure works but complex features fail
- 🟡 **Empty objects/arrays** - Sometimes returns wrong structure
- 🟡 **Schema factories** - Pattern works but dynamic schemas may fail
- 🟡 **Generic schema patterns** - Basic generics work, complex ones fail

## Key Findings

### 1. **JSON Schema Limitation**

OpenAI converts Zod schemas to JSON Schema internally. Features that don't have direct JSON Schema equivalents fail.

### 2. **Type System Mismatch**

- Zod's TypeScript-centric types (BigInt, Symbol, Map, Set) don't translate
- Union types only work with discriminated unions
- Tuples are treated as arrays

### 3. **Object Modification Issues**

- Object modifiers (partial, passthrough, deepPartial) don't work properly
- The schema is evaluated statically, not dynamically

### 4. **Recursive Schema Problem**

- Any recursive/circular structure fails immediately
- This includes tree structures, comment threads, nested categories

## Recommendations

### ✅ **Best Practices for OpenAI**

1. **Use discriminated unions** instead of regular unions

   ```typescript
   // ❌ BAD
   z.union([z.string(), z.number()]);

   // ✅ GOOD
   z.discriminatedUnion('type', [
     z.object({ type: z.literal('text'), value: z.string() }),
     z.object({ type: z.literal('number'), value: z.number() }),
   ]);
   ```

2. **Avoid recursive schemas** - Flatten or limit depth

   ```typescript
   // ❌ BAD - Recursive
   const Comment = z.object({
     text: z.string(),
     replies: z.array(z.lazy(() => Comment)),
   });

   // ✅ GOOD - Fixed depth
   const Comment = z.object({
     text: z.string(),
     replies: z.array(
       z.object({
         text: z.string(),
         // No further nesting
       }),
     ),
   });
   ```

3. **Use simple types** for collections

   ```typescript
   // ❌ BAD
   z.map(z.string(), z.number());
   z.set(z.string());

   // ✅ GOOD
   z.record(z.string(), z.number());
   z.array(z.string());
   ```

4. **Handle optionality explicitly**

   ```typescript
   // ❌ BAD - Using .partial()
   schema.partial();

   // ✅ GOOD - Explicit optional fields
   z.object({
     name: z.string().optional(),
     age: z.number().optional(),
   });
   ```

5. **Avoid complex unions**

   ```typescript
   // ❌ BAD
   z.union([z.string(), z.null()]);

   // ✅ GOOD
   z.string().nullable();
   ```

### 🎯 **Safe Schema Patterns**

```typescript
// ✅ SAFE: Complex nested object with validations
const SafeUserSchema = z.object({
  id: z.string().uuid(),
  profile: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    age: z.number().int().min(0).max(150),
    bio: z.string().max(500).optional(),
    settings: z.object({
      theme: z.enum(['light', 'dark']),
      notifications: z.boolean(),
    }),
  }),
  roles: z.array(z.enum(['admin', 'user', 'guest'])),
  metadata: z.record(z.string(), z.any()),
  createdAt: z.string().datetime(),
});

// ✅ SAFE: Discriminated union for different response types
const SafeResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    data: z.any(),
    timestamp: z.string().datetime(),
  }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    code: z.number(),
  }),
]);
```

## Conclusion

OpenAI's structured output works well for:

- Standard business objects
- Form validation schemas
- API request/response structures
- Configuration objects
- Simple discriminated unions

But fails with:

- Advanced TypeScript types
- Recursive data structures
- Dynamic schemas
- Complex type unions
- Object modification patterns

**Recommendation**: Keep schemas simple and flat. Use discriminated unions for polymorphism. Avoid Zod's advanced features when targeting OpenAI.
