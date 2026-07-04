import { encodeFunctionData, type Address, type Hex } from "viem";
import { RegistryMultisigAbi, TimelockControllerAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { buildScheduleCall, ZERO32 } from "./governance";

type Bundle = {
  multisig: Address;
  timelock: Address;
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem WalletClient.writeContract generics
  walletClient: { writeContract: (args: any) => Promise<Hex> };
  setTxState: (s: TxState) => void;
};

async function run(b: Bundle, write: () => Promise<Hex>): Promise<Hex> {
  b.setTxState("submitting");
  try {
    const hash = await write();
    b.setTxState("confirming");
    await b.publicClient.waitForTransactionReceipt({ hash });
    b.setTxState("idle");
    return hash;
  } catch (e) {
    b.setTxState("idle");
    throw e;
  }
}

/** Propose a registry change: wrap in timelock.schedule, submit to multisig. */
export async function proposeChange(b: Bundle, registryData: Hex, salt: Hex, delay: bigint) {
  return run(b, () => {
    const scheduleData = buildScheduleCall(b.registry, registryData, salt, delay);
    return b.walletClient.writeContract({
      address: b.multisig, abi: RegistryMultisigAbi, functionName: "submit",
      args: [b.timelock, 0n, scheduleData], account: b.account,
    });
  });
}

export async function confirmTx(b: Bundle, txId: bigint) {
  return run(b, () =>
    b.walletClient.writeContract({
      address: b.multisig, abi: RegistryMultisigAbi, functionName: "confirm", args: [txId], account: b.account,
    }),
  );
}

export async function revokeTx(b: Bundle, txId: bigint) {
  return run(b, () =>
    b.walletClient.writeContract({
      address: b.multisig, abi: RegistryMultisigAbi, functionName: "revoke", args: [txId], account: b.account,
    }),
  );
}

export async function execMultisig(b: Bundle, txId: bigint) {
  return run(b, () =>
    b.walletClient.writeContract({
      address: b.multisig, abi: RegistryMultisigAbi, functionName: "execute", args: [txId], account: b.account,
    }),
  );
}

export async function execTimelock(b: Bundle, registryData: Hex, salt: Hex) {
  return run(b, () =>
    b.walletClient.writeContract({
      address: b.timelock, abi: TimelockControllerAbi, functionName: "execute",
      args: [b.registry, 0n, registryData, ZERO32, salt], account: b.account,
    }),
  );
}

export async function cancelOp(b: Bundle, opId: Hex) {
  return run(b, () => {
    const cancelData = encodeFunctionData({
      abi: TimelockControllerAbi, functionName: "cancel", args: [opId],
    });
    return b.walletClient.writeContract({
      address: b.multisig, abi: RegistryMultisigAbi, functionName: "submit",
      args: [b.timelock, 0n, cancelData], account: b.account,
    });
  });
}
