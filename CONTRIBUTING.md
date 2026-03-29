# Contributing to UniVerify

Thank you for your interest in contributing to UniVerify! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/univerify.git`
3. Install dependencies: `npm install`
4. Build all packages: `npm run build`
5. Run tests to confirm everything works: `npm test && cd contracts && forge test`

## Development Workflow

1. Create a feature branch from `main`: `git checkout -b feature/your-feature`
2. Make your changes
3. Ensure tests pass: `npm test && cd contracts && forge test`
4. Commit your changes with a clear message
5. Push to your fork and open a pull request

## Build Order

Packages must be built in dependency order:

```bash
npm -w @univerify/verifier-core run build   # 1. Core (no deps)
npm -w @univerify/sdk run build              # 2. SDK (depends on core)
npm -w @univerify/verifier-cli run build     # 3. CLI (depends on core)
npm -w web run build                         # 4. Web (depends on core + sdk)
```

Or simply: `npm run build`

## Project Structure

| Directory | Description |
|-----------|-------------|
| `contracts/` | Solidity smart contracts (Foundry) |
| `apps/web/` | Next.js frontend application |
| `packages/verifier-core/` | Shared TypeScript library |
| `packages/sdk/` | Client SDK |
| `packages/verifier-cli/` | CLI tools |

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Follow existing code style (ESLint is configured for the web app)
- Prefer `viem` for Ethereum interactions

### Solidity

- Target Solidity `^0.8.28`
- Follow the existing contract patterns (access control, error handling)
- Add gas benchmarks for any new contract variants
- All contracts must pass `forge test`

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if you change public APIs
- Reference related issues in the PR description
- Ensure CI passes before requesting review

## Reporting Bugs

Open an [issue](https://github.com/n-shcherbyna/univerify/issues) with:

- A clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (Node.js version, network, etc.)

## Security Vulnerabilities

Please **do not** open public issues for security vulnerabilities. Instead, follow the [Security Policy](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
