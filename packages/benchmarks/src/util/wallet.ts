// packages/benchmarks/src/util/wallet.ts
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const PK_PATTERN = /^0x[0-9a-fA-F]{64}$/;

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
  if (!PK_PATTERN.test(pk)) {
    throw new Error("BENCH_PK contains non-hex characters.");
  }
  return privateKeyToAccount(pk as `0x${string}`);
}
