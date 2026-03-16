Build all packages in the correct dependency order. Stop immediately if any step fails.

1. `npm -w @univerify/verifier-core run build`
2. `npm -w @univerify/sdk run build`
3. `npm -w @univerify/verifier-cli run build`
4. `npm -w web run build`

Report success or failure for each step.

$ARGUMENTS
