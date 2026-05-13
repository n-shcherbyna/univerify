// packages/benchmarks/tests/chains/baseSepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/baseSepolia-issue-100.json";
import { createBaseSepoliaAdapter } from "../../src/chains/baseSepolia.js";

describe("baseSepolia adapter", () => {
  it("parses l1Fee and l1GasUsed from receipt", async () => {
    const adapter = createBaseSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
      l1Fee: BigInt(receipt.l1Fee),
      l1GasUsed: BigInt(receipt.l1GasUsed),
      l1GasPrice: BigInt(receipt.l1GasPrice),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 2000,
      },
      "issueBatch",
      { batchSize: 100, tag: "main" }
    );

    expect(metrics.chainId).toBe(84532);
    expect(metrics.l1DataFee).toBe(BigInt(receipt.l1Fee));
    expect(metrics.l1GasUsed).toBe(BigInt(receipt.l1GasUsed));
    expect(metrics.batchSize).toBe(100);
  });
});
