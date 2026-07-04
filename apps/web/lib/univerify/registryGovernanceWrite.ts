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

async function send(b: Bundle, hash: Hex): Promise<Hex> {
  b.setTxState("confirming");
  await b.publicClient.waitForTransactionReceipt({ hash });
  b.setTxState("idle");
  return hash;
}

/** Propose a registry change: wrap in timelock.schedule, submit to multisig. */
export async function proposeChange(b: Bundle, registryData: Hex, salt: Hex, delay: bigint) {
  b.setTxState("submitting");
  const scheduleData = buildScheduleCall(b.registry, registryData, salt, delay);
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "submit",
    args: [b.timelock, 0n, scheduleData], account: b.account,
  });
  return send(b, hash);
}

export async function confirmTx(b: Bundle, txId: bigint) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "confirm", args: [txId], account: b.account,
  });
  return send(b, hash);
}

export async function revokeTx(b: Bundle, txId: bigint) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "revoke", args: [txId], account: b.account,
  });
  return send(b, hash);
}

export async function execMultisig(b: Bundle, txId: bigint) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "execute", args: [txId], account: b.account,
  });
  return send(b, hash);
}

export async function execTimelock(b: Bundle, registryData: Hex, salt: Hex) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.timelock, abi: TimelockControllerAbi, functionName: "execute",
    args: [b.registry, 0n, registryData, ZERO32, salt], account: b.account,
  });
  return send(b, hash);
}

export async function cancelOp(b: Bundle, opId: Hex) {
  b.setTxState("submitting");
  const cancelData = encodeFunctionData({
    abi: TimelockControllerAbi, functionName: "cancel", args: [opId],
  });
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "submit",
    args: [b.timelock, 0n, cancelData], account: b.account,
  });
  return send(b, hash);
}
