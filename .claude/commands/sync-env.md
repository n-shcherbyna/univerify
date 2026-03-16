Sync environment variables to a target network.

1. If $ARGUMENTS specifies a network (sepolia, mainnet), use it. Otherwise, show the current `CHAIN_ID` from `.env` and ask which network to sync to.
2. Run the appropriate command:
   - Sepolia: `npm run sync:env:sepolia`
   - Mainnet: `npm run sync:env:mainnet`
3. Report what changed.

$ARGUMENTS
