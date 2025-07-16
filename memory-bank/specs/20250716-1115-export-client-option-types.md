# Export Client Option Types for Better DX

## Task Definition

Export dedicated types for client method options (ChatOptions, StreamOptions, etc.) to improve developer experience when building abstractions on top of the library.

## Implementation Plan

1. **Create option type definitions**
   - ChatOptions<P, T> for chat method
   - StreamOptions<P, T> for stream method
   - DefineToolOptions for defineTool method
   - ExecuteToolsOptions for executeTools method

2. **Update LLMClient interface**
   - Use the new option types in method signatures
   - Maintain backward compatibility

3. **Export types from index.ts**
   - Add to main exports for easy discovery
   - Include both generic and provider-specific variants

4. **Update documentation**
   - Add examples showing how to use these types
   - Show use cases for building abstractions

## Technical Details

The new types will allow users to:

- Import ChatOptions directly without complex type extraction
- Build wrapper functions with proper typing
- Create abstractions without importing unnecessary types

Example usage:

```typescript
import { ChatOptions } from 'homogenaize';

function myWrapper<T>(options: ChatOptions<'openai', T>) {
  // Custom logic
}
```

## Update Log

- 2025-07-16 11:15 - Task created, beginning implementation
- 2025-07-16 11:20 - Implemented option types:
  - Added ChatOptions, StreamOptions, DefineToolOptions, ExecuteToolsOptions types
  - Updated LLMClient interface to use the new types
  - Exported types from index.ts
- 2025-07-16 11:22 - Created tests to verify type usage and imports
- 2025-07-16 11:24 - Added documentation section "Building Abstractions" with examples
- 2025-07-16 11:25 - All tests passing, TypeScript compilation successful
