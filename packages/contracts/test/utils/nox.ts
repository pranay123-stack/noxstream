/**
 * Nox test plumbing: per-account handle clients, decryption that survives the
 * real testnet, and local time travel.
 */
import assert from "node:assert/strict";
import { createViemHandleClient, type HandleClient } from "@iexec-nox/handle";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import type { ChainType, NetworkConnection } from "hardhat/types/network";
import { createWalletClient, custom, type Hex, type WalletClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { waitForHandleResolved } from "./handle-gateway.js";

export type NoxClient = Awaited<ReturnType<typeof nox.connect>>;

/**
 * The Hardhat plugin's `nox.connect()` binds encrypt/decrypt to the connection's
 * *first* account. Proving ACL enforcement needs a client bound to a different
 * account, so we build one directly on `@iexec-nox/handle`.
 *
 * The explicit config override matters twice over:
 *   - on chain 31337 the SDK has no built-in network entry, so without it
 *     `resolveNetworkConfig` throws;
 *   - `subgraphUrl` is required for config validation even though `decrypt`
 *     never queries the subgraph. The Hardhat plugin passes the same
 *     placeholder (see NOX_NOTES.md discrepancy #5).
 *
 * ## The wallet client MUST carry a LOCAL account
 *
 * `WalletClientAdapter` in `@iexec-nox/handle` signs with
 * `walletClient.account` but derives the *identity* it presents to the gateway
 * from `walletClient.getAddresses()[0]`. Those disagree for any client whose
 * provider exposes more than one account: a Hardhat viem wallet client for
 * account #1 signs as account #1 while `getAddresses()` returns the node's full
 * `eth_accounts` list, whose first entry is account #0. The gateway then either
 * rejects the request (`401 invalid signature`) or reports "user 0x… is not
 * authorized to decrypt it" naming an address you never asked about — which
 * looks exactly like a missing ACL grant and sends you debugging the contract.
 *
 * viem short-circuits `getAddresses()` for local (private-key / mnemonic)
 * accounts, returning only that account, so passing a local-account client
 * sidesteps it entirely. `localAccountWallet` below builds one. This is an SDK
 * bug, not a NoxStream one — see feedback.md.
 */
export async function handleClientFor(
  walletClient: WalletClient,
  noxClient: NoxClient,
): Promise<HandleClient> {
  const declared = (await walletClient.getAddresses())[0];
  const signing = walletClient.account?.address;
  if (
    signing !== undefined &&
    declared !== undefined &&
    signing.toLowerCase() !== declared.toLowerCase()
  ) {
    throw new Error(
      `This wallet client would sign as ${signing} but @iexec-nox/handle reads ` +
        `its identity from getAddresses()[0] = ${declared}. The gateway would ` +
        `reject the mismatch with a message that looks like a missing ACL grant. ` +
        `Use localAccountWallet() so the client carries a local account.`,
    );
  }
  return createViemHandleClient(walletClient, {
    gatewayUrl: noxClient.handleGatewayUrl as `http://${string}` | `https://${string}`,
    smartContractAddress: noxClient.noxComputeAddress,
    subgraphUrl: "https://example.com/subgraphs/id/none",
  });
}

/** Hardhat / Anvil's standard development mnemonic. */
const DEV_MNEMONIC =
  "test test test test test test test test test test test junk";

/**
 * A viem wallet client for local-chain account `index`, holding the private key
 * locally rather than delegating to the node. Only used to sign Nox's EIP-712
 * decryption requests; transactions still go through Hardhat's own clients.
 */
export function localAccountWallet<ChainTypeT extends ChainType | string>(
  connection: NetworkConnection<ChainTypeT>,
  index: number,
): WalletClient {
  return createWalletClient({
    account: mnemonicToAccount(DEV_MNEMONIC, { addressIndex: index }),
    transport: custom({
      request: (args) =>
        connection.provider.request(
          args as Parameters<typeof connection.provider.request>[0],
        ),
    }),
  });
}

/**
 * Waits for the gateway to resolve `handle`, then decrypts it.
 *
 * The wait is not optional on a shared testnet. `decrypt()` polls internally
 * for only 6 seconds (RESOLVE_MAX_RETRIES=60 x RESOLVE_DELAY_MS=100) and then
 * throws something that looks like a permissions failure rather than a timeout
 * — see NOX_NOTES.md discrepancy #4.
 */
export async function resolveAndDecrypt(
  client: { decrypt: (h: never) => Promise<{ value: unknown }> },
  gatewayUrl: string,
  handle: Hex,
  timeoutMs = 240_000,
): Promise<bigint> {
  // An all-zero handle is an *uninitialised* `euint256`, not a ciphertext. The
  // gateway will never resolve it, so polling would burn the whole timeout and
  // then report a timeout for what is really "this value was never written".
  if (/^0x0{64}$/i.test(handle)) {
    throw new Error(
      `Refusing to decrypt the zero handle: this euint256 was never ` +
        `initialised, so there is no ciphertext to resolve. Check that the ` +
        `write you expected actually happened.`,
    );
  }
  await waitForHandleResolved(gatewayUrl, handle, { timeoutMs });
  const { value } = await client.decrypt(handle as never);
  assert.equal(
    typeof value,
    "bigint",
    `decrypt(${handle}) returned ${typeof value}, expected bigint`,
  );
  return value as bigint;
}

/**
 * Asserts that `client` CANNOT decrypt `handle`.
 *
 * A rejected promise is the expected outcome (no ACL grant). We additionally
 * fail if the call *succeeds*, printing the value it exposed — a silent success
 * here is the single worst outcome for a confidentiality system, so it must be
 * reported loudly rather than swallowed by a bare `rejects` matcher.
 */
export async function assertCannotDecrypt(
  client: { decrypt: (h: never) => Promise<{ value: unknown }> },
  handle: Hex,
  who: string,
): Promise<string> {
  let value: unknown;
  try {
    ({ value } = await client.decrypt(handle as never));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail(
    `ACL FAILURE: ${who} decrypted a handle it holds no grant for.\n` +
      `  handle : ${handle}\n` +
      `  value  : ${String(value)}\n` +
      `Confidentiality is broken — any third party can read this salary.`,
  );
}

/**
 * Nox input proofs expire. `NoxCompute` initialises
 * `proofExpirationDuration = 1 hours` and `Compute.sol` enforces
 * `block.timestamp <= proofCreatedAt + proofExpirationDuration`, where
 * `proofCreatedAt` is stamped by the gateway from WALL-CLOCK time.
 *
 * Hardhat's `evm_increaseTime` moves the chain clock but not the gateway's, so
 * every second of simulated time travel eats into that hour — for every
 * encryption performed *afterwards*, forever, not just the next one. Overrun it
 * and `Nox.fromExternal` reverts `InvalidProof(..., "Proof expired")`, which
 * decodes as an unrecognised custom error and looks nothing like a clock
 * problem.
 *
 * We therefore budget the total advancement well under the hour and fail with
 * this explanation the moment a change would blow it.
 */
const PROOF_EXPIRATION_SECONDS = 3600;
/** Leaves ~40 minutes of headroom for the suite's own wall-clock runtime. */
const TIME_TRAVEL_BUDGET_SECONDS = 1_800;

const advancedBy = new WeakMap<object, number>();

/** Local-only: push the chain clock forward and mine, so accrual advances. */
export async function advanceTime<ChainTypeT extends ChainType | string>(
  connection: NetworkConnection<ChainTypeT>,
  seconds: number,
): Promise<void> {
  const total = (advancedBy.get(connection) ?? 0) + seconds;
  if (total > TIME_TRAVEL_BUDGET_SECONDS) {
    throw new Error(
      `Time-travel budget exceeded: this run has advanced the chain clock by ` +
        `${total}s, over the ${TIME_TRAVEL_BUDGET_SECONDS}s budget. Nox input ` +
        `proofs expire ${PROOF_EXPIRATION_SECONDS}s after the gateway mints them, ` +
        `measured against wall-clock time, so every further encryptInput in this ` +
        `process would revert with "Proof expired". Shorten the advances or split ` +
        `the scenario into its own run.`,
    );
  }
  advancedBy.set(connection, total);

  await connection.provider.request({
    method: "evm_increaseTime",
    params: [`0x${seconds.toString(16)}`],
  });
  await connection.provider.request({ method: "evm_mine", params: [] });
}

/** Block timestamp of the chain head. */
export async function blockTimestamp(publicClient: {
  getBlock: () => Promise<{ timestamp: bigint }>;
}): Promise<bigint> {
  return (await publicClient.getBlock()).timestamp;
}
