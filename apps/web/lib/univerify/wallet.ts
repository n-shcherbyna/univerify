import { createWalletClient, custom, defineChain, type Address, type Chain } from "viem";
import { sepolia, mainnet } from "viem/chains";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const KNOWN_CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
};

function resolveChain(chainId: number): Chain {
  return KNOWN_CHAINS[chainId] ?? defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });
}

export function getEthereum(): any | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export async function ensureChain(params: { eth: any; targetChainId: number }) {
  const currentChainIdHex = (await params.eth.request({ method: "eth_chainId" })) as string;
  const currentChainId = Number.parseInt(currentChainIdHex, 16);
  if (currentChainId === params.targetChainId) return;
  await params.eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${params.targetChainId.toString(16)}` }],
  });
  const afterHex = (await params.eth.request({ method: "eth_chainId" })) as string;
  if (Number.parseInt(afterHex, 16) !== params.targetChainId) {
    throw new Error(`Failed to switch to chain ${params.targetChainId}.`);
  }
}

export function makeWalletClient(params: { eth: any; account: Address; chainId: number }) {
  return createWalletClient({
    chain: resolveChain(params.chainId),
    transport: custom(params.eth),
    account: params.account,
  });
}
