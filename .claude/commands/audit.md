Perform a security audit of the Solidity contracts in `contracts/src/`.

Review for:
- Reentrancy vulnerabilities
- Access control issues (missing modifiers, privilege escalation)
- Integer overflow/underflow
- Unchecked external calls
- Storage layout issues
- Gas griefing vectors
- Front-running risks
- Event emission correctness
- Merkle proof verification correctness

For each finding, report:
- **Severity**: Critical / High / Medium / Low / Informational
- **Location**: file and line number
- **Description**: what the issue is
- **Recommendation**: how to fix it

End with a summary table of all findings.

$ARGUMENTS
