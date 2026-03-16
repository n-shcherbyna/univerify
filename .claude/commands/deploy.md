Deploy the DiplomaRegistry contract. Follow these steps strictly:

1. Run `forge test` in the `contracts/` directory. If any test fails, STOP and report the failure — do NOT proceed.
2. Build all packages in order: `npm -w @univerify/verifier-core run build`, then `npm -w @univerify/verifier-cli run build`, then `npm -w web run build`.
3. Show the user the current deployment target by reading `CHAIN_ID` and `RPC_URL` from `.env`. Clearly state whether this is **mainnet** or a **testnet**.
4. Ask the user for explicit confirmation before broadcasting. Display: the network name, chain ID, and the deployer address (from `OWNER_PK`). NEVER proceed without a "yes".
5. Only after confirmation, run: `forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --private-key $OWNER_PK --broadcast` from the `contracts/` directory.
6. After deployment, extract the new contract address from the output and offer to update `REGISTRY_ADDRESS` in `.env`.
7. Offer to run `npm run sync:env:sepolia` or `npm run sync:env:mainnet` depending on the target chain.

$ARGUMENTS
