// packages/benchmarks/src/util/wallet.ts
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export function loadBenchAccount(): PrivateKeyAccount {
  const pk = process.env.BENCH_PK;
  if (!pk) {
    throw new Error(
      "BENCH_PK is not set. Export a funded testnet private key with a 0x prefix."
    );
  }
  if (!pk.startsWith("0x") || pk.length !== 66) {
    throw new Error("BENCH_PK must be a 0x-prefixed 32-byte hex private key.");
  }
  return privateKeyToAccount(pk as `0x${string}`);
}
