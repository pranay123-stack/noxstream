import { setTimeout as sleep } from "node:timers/promises";
import { type Hex } from "viem";

/**
 * Polls the Nox handle gateway until `handle` is resolved (its ciphertext has
 * been produced by the runner and stored), or throws once `timeoutMs` elapses.
 *
 * Adapted from the official nox-hardhat-starter helper, with two changes that
 * are required to work against real Sepolia:
 *
 *  1. `handleGatewayUrl` is a parameter. The starter imports a
 *     `HANDLE_GATEWAY_URL` constant from `@iexec-nox/nox-hardhat-plugin`, but
 *     that export was REMOVED in plugin v0.2.0 — the published starter no
 *     longer compiles against the current plugin. Take the URL from
 *     `nox.connect(connection)` instead, which returns the one actually in use.
 *
 *  2. A longer default timeout. The plugin's own internal poller gives up after
 *     6s (60 x 100ms), which is fine for a local Docker stack but too short for
 *     the shared testnet gateway, where resolution routinely takes longer.
 */
export async function waitForHandleResolved(
  handleGatewayUrl: string,
  handle: Hex,
  {
    timeoutMs = 180_000,
    initialPollMs = 500,
    maxPollMs = 5_000,
    backoffFactor = 1.5,
  }: {
    timeoutMs?: number;
    initialPollMs?: number;
    maxPollMs?: number;
    backoffFactor?: number;
  } = {},
): Promise<void> {
  const url = `${handleGatewayUrl}/v0/public/handles/status`;
  const deadline = Date.now() + timeoutMs;
  let pollMs = initialPollMs;

  while (Date.now() < deadline) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handles: [handle] }),
    });
    if (res.ok) {
      const body = (await res.json()) as {
        payload: { statuses: Array<{ handle: string; resolved: boolean }> };
      };
      const resolved = body.payload.statuses.some(
        (s) =>
          s.handle.toLowerCase() === handle.toLowerCase() && s.resolved === true,
      );
      if (resolved) return;
    }
    await sleep(pollMs);
    pollMs = Math.min(pollMs * backoffFactor, maxPollMs);
  }

  throw new Error(
    `Handle ${handle} was not resolved by the Nox gateway within ${timeoutMs}ms`,
  );
}
