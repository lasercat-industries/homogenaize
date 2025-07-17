# Fix TypeScript Recursion Issues with Mapped Types

## Task Definition

Fix TypeScript language server recursion issues that cause "recursion too deep or possibly infinite" errors by replacing deep conditional types with mapped types.

## Background

Users are experiencing TypeScript language server slowdowns and recursion errors when using the library. The issue stems from complex conditional type chains in the provider type system that create deep type resolution cycles.

## Implementation Plan

1. **Replace Deep Conditional Types in providers/types.ts**
   - Replace `ProviderChatRequest` conditional type with mapped type
   - Replace `ProviderChatResponse` conditional type with mapped type
   - Create interface maps for better type resolution

2. **Update client.ts Feature Types**
   - Replace complex feature conditional in `ChatOptions` with mapped type
   - Simplify `TypedProvider` interface to use mapped types

3. **Verify Type Performance**
   - Run TypeScript compilation to ensure no errors
   - Test that types resolve correctly
   - Run tests to ensure functionality is preserved

## Files to Modify

- `src/providers/types.ts` - Replace conditional types with mapped types
- `src/client.ts` - Update to use new mapped type system

## Success Criteria

- TypeScript compilation succeeds without recursion errors
- All existing tests pass
- Type resolution is faster and more stable
- API remains backward compatible

## Update Log

- 2025-07-17 18:00: Task created, starting implementation
