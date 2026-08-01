/**
 * NoxStream — shared Nox protocol constants.
 *
 * Every value here was verified live against the network on 2026-07-31, not
 * copied from prose docs (several of which are stale — see feedback.md):
 *
 *  - NoxCompute address comes from `Nox.sol::noxComputeContract()` in
 *    @iexec-nox/nox-protocol-contracts@0.2.4, and was confirmed to have
 *    runtime bytecode on Sepolia via `eth_getCode`.
 *  - Gateway + subgraph URLs come from
 *    @iexec-nox/handle@0.1.0-beta.13 `src/config/networks.ts`, and were
 *    confirmed reachable (gateway HTTP 200, subgraph answered `_meta`).
 */

export const SEPOLIA_CHAIN_ID = 11155111 as const;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614 as const;

export interface NoxNetwork {
  readonly chainId: number;
  readonly name: string;
  /** NoxCompute proxy — the on-chain entrypoint for handle ops + ACL. */
  readonly noxComputeAddress: `0x${string}`;
  /** Handle Gateway base URL (no path, no query — the SDK validates this). */
  readonly handleGatewayUrl: string;
  /** Subgraph used by `viewACL`. Required by the SDK even when unused. */
  readonly subgraphUrl: string;
  readonly explorer: string;
}

export const NOX_NETWORKS: Record<number, NoxNetwork> = {
  [SEPOLIA_CHAIN_ID]: {
    chainId: SEPOLIA_CHAIN_ID,
    name: "Ethereum Sepolia",
    noxComputeAddress: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
    handleGatewayUrl: "https://gateway-testnets.noxprotocol.dev",
    subgraphUrl:
      "https://thegraph.ethereum-sepolia-testnet.noxprotocol.io/api/subgraphs/id/9CsccKwvgYFo72zZeU4k4wj2NEBLdWhVE3EUandgmzgo",
    explorer: "https://sepolia.etherscan.io",
  },
  [ARBITRUM_SEPOLIA_CHAIN_ID]: {
    chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
    name: "Arbitrum Sepolia",
    noxComputeAddress: "0xd464B198f06756a1d00be223634b85E0a731c229",
    handleGatewayUrl: "https://gateway-testnets.noxprotocol.dev",
    subgraphUrl:
      "https://thegraph.arbitrum-sepolia-testnet.noxprotocol.io/api/subgraphs/id/BjQAX2HpmsSAzURJimKDhjZZnkSJtaczA8RPumggrStb",
    explorer: "https://sepolia.arbiscan.io",
  },
};

/** NoxStream targets Ethereum Sepolia — a hackathon hard requirement. */
export const TARGET_NETWORK = NOX_NETWORKS[SEPOLIA_CHAIN_ID];

/**
 * A 32-byte Nox handle: an on-chain pointer to a ciphertext held off-chain.
 * Reading one from the chain reveals nothing without an ACL grant.
 */
export type Handle = `0x${string}`;

/** The uninitialised handle. `euint256` does not default to an encrypted 0. */
export const ZERO_HANDLE: Handle =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function isZeroHandle(h: string | undefined | null): boolean {
  return !h || /^0x0{64}$/i.test(h);
}
