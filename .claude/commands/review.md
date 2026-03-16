Review the current staged and unstaged git changes for issues.

1. Run `git diff` and `git diff --cached` to see all changes.
2. Review for:
   - Bugs and logic errors
   - Security vulnerabilities (especially in Solidity and API routes)
   - Missing error handling at system boundaries
   - Breaking changes to public APIs or contract interfaces
   - Hardcoded secrets or sensitive data
   - Build order issues (verifier-core must be built before web/cli)
3. Provide a clear verdict: **Ship it** or **Needs changes**, with specific feedback.

$ARGUMENTS
