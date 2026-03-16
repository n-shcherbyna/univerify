Run all tests for the project.

1. Run Solidity tests: `cd /home/nazar/projects/univerify/contracts && forge test -vv`
2. If there are any TypeScript/JS test files in `packages/` or `apps/`, run those too (look for `*.test.*` or `*.spec.*` files and use the appropriate test runner).
3. Summarize results: total passed, failed, and skipped for each test suite.

If $ARGUMENTS is provided, use it as a filter (e.g., a test name pattern for `--match-test` in forge, or a file pattern for TS tests).

$ARGUMENTS
