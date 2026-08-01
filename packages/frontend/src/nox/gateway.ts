import { TARGET_NETWORK, type Handle } from "@shared/nox";

/**
 * Handle-resolution polling, done ourselves rather than through the SDK.
 *
 * Why: `HandleClient.decrypt()` signs an EIP-712 authorisation FIRST and only
 * then discovers the handle is not computed yet. Its internal retry budget is
 * ~7s (1s, 2s, 4s), and on failure the freshly-signed material is never cached
 * — so every outer retry pops another wallet prompt. On a shared testnet where
 * resolution takes tens of seconds, that turns one decrypt into a stream of
 * signature requests.
 *
 * `POST /v0/public/handles/status` is public and unsigned (verified live: it
 * returns `{payload:{statuses:[{handle,resolved}]},signature}`, and answers
 * `resolved:false` rather than erroring for an unknown handle). So we wait here
 * — free, silent, cancellable — and ask for the signature exactly once, at the
 * moment the ciphertext is actually retrievable.
 */

export interface HandleStatus {
  handle: string;
  resolved: boolean;
}

interface StatusResponse {
  payload?: { statuses?: HandleStatus[] };
}

export async function fetchHandleStatuses(
  handles: readonly Handle[],
  signal?: AbortSignal,
): Promise<Map<string, boolean>> {
  const response = await fetch(
    `${TARGET_NETWORK.handleGatewayUrl}/v0/public/handles/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handles }),
      signal: signal ?? null,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Handle gateway returned ${response.status} while checking handle status`,
    );
  }
  const data = (await response.json()) as StatusResponse;
  const statuses = data.payload?.statuses ?? [];
  return new Map(statuses.map((s) => [s.handle.toLowerCase(), s.resolved]));
}

export interface WaitOptions {
  /** Total time to wait before giving up. */
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  /** Called on every poll so the UI can show elapsed time honestly. */
  onTick?: (info: { attempt: number; elapsedMs: number }) => void;
}

export class HandleNotResolvedError extends Error {
  constructor(
    readonly handle: Handle,
    readonly waitedMs: number,
  ) {
    super(
      `Nox has not finished computing this handle after ${Math.round(waitedMs / 1000)}s.`,
    );
    this.name = "HandleNotResolvedError";
  }
}

/** Resolves as soon as the gateway reports the handle as computed. */
export async function waitForHandle(
  handle: Handle,
  { timeoutMs = 150_000, intervalMs = 2_500, signal, onTick }: WaitOptions = {},
): Promise<void> {
  const startedAt = Date.now();
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const statuses = await fetchHandleStatuses([handle], signal);
    if (statuses.get(handle.toLowerCase()) === true) return;

    const elapsedMs = Date.now() - startedAt;
    onTick?.({ attempt, elapsedMs });
    if (elapsedMs + intervalMs > timeoutMs) {
      throw new HandleNotResolvedError(handle, elapsedMs);
    }
    await sleep(intervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
