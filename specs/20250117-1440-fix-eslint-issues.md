# Fix ESLint Issues

## Task Definition

Fix all ESLint errors and warnings reported when running `bun run eslint` on the codebase.

## Implementation Plan

1. Fix high-priority issues:
   - Fix expression statement in scripts/build.ts line 16
   - Fix case declarations in provider files (anthropic, gemini, openai)
   - Fix duplicate case label in anthropic.ts

2. Replace 'any' types with proper types:
   - scripts/generate-model-types.ts (5 occurrences)
   - scripts/list-models.ts (2 occurrences)
   - src/client.ts (3 occurrences)
   - src/providers/anthropic/anthropic.ts (multiple occurrences)
   - src/providers/gemini/gemini.ts (multiple occurrences)
   - src/providers/openai/openai.ts (multiple occurrences)
   - src/retry/errors.ts (2 occurrences)
   - src/retry/retry.ts (2 occurrences)
   - src/streaming/streaming.ts (3 occurrences)

3. Fix unused variables:
   - src/integration/real-api.test.ts (3 warnings)
   - src/providers/anthropic/anthropic.ts (2 warnings)
   - src/providers/gemini/gemini.ts (2 warnings)
   - src/providers/openai/openai.ts (3 warnings)
   - src/streaming/streaming.ts (1 warning)

4. Run tests to ensure no regressions

## Update Log

- 2025-01-17 14:40 - Task created to fix 96 ESLint problems (85 errors, 11 warnings)
- 2025-01-17 14:55 - Fixed high-priority issues: expression statement in build.ts, case declarations and 'any' types in all provider files (anthropic, gemini, openai). Also fixed TypeScript compilation errors. Reduced to 43 problems (34 errors, 9 warnings)
