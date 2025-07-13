# Fix Remaining TypeScript Errors

## Task Definition
Fix all remaining TypeScript errors shown by `bun run typecheck`. Currently there are 56 errors across 10 files.

## Error Categories
1. **TS18048 (13 errors)** - Value is possibly 'undefined'
2. **TS2322 (10 errors)** - Type 'X' is not assignable to type 'Y'
3. **TS2532 (8 errors)** - Object is possibly 'undefined'
4. **TS2304 (6 errors)** - Cannot find name
5. **TS18046 (6 errors)** - 'X' is of type 'unknown'
6. **TS6133 (5 errors)** - Variable is declared but never used
7. **TS2741 (3 errors)** - Property missing in type
8. **TS2416 (3 errors)** - Property not assignable to same property in base type

## Implementation Plan
1. Fix JSON parsing type assertions (TS18046, TS2322)
   - Add proper type assertions for response.json() calls
   - Fix error handling type assertions

2. Fix test file issues (TS2532, TS2741)
   - Add proper null checks instead of ! assertions
   - Fix mock fetch typing

3. Fix provider interface implementation (TS2416)
   - Ensure stream methods return correct generic types
   - Fix type mismatches between interface and implementation

4. Remove unused variables (TS6133)

5. Fix remaining type issues

## Update Log
### 2025-01-13 12:54
- Task created to fix remaining 56 TypeScript errors
- Analyzed error categories and created implementation plan

### 2025-01-13 13:15
- Successfully fixed all 56 TypeScript errors
- Fixed JSON parsing type assertions in all providers (Anthropic, OpenAI, Gemini)
- Added 'as any' type assertions for mock fetch in test files  
- Fixed generic type parameters on stream methods in all providers
- Added null safety checks for potentially undefined objects
- Removed unused variables and imports
- All TypeScript errors resolved - `bun run typecheck` now passes successfully