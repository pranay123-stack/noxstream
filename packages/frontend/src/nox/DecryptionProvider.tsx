import { TARGET_NETWORK, isZeroHandle, type Handle } from "@shared/nox";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, usePublicClient } from "wagmi";
import { noxComputeAclAbi } from "@/contracts/abis";
import { describeError, type FriendlyError } from "./errors";
import { waitForHandle } from "./gateway";
import { useHandleClient } from "./HandleClientProvider";

/**
 * Every decrypted number in this app passes through here.
 *
 * The stages are real steps, not a progress-bar animation:
 *
 *   checking-acl        an `isViewer(handle, you)` read against NoxCompute
 *   unauthorised        that read returned false — you hold no grant
 *   resolving           the gateway says the ciphertext is not computed yet
 *   awaiting-signature  your wallet is being asked for the EIP-712 grant proof
 *   decrypting          gateway round-trip + local RSA/ECIES unwrap
 *
 * Nothing here is simulated and no stage is entered before the work it names
 * has actually started.
 */

export type DecryptStage =
  | "idle"
  | "uninitialised"
  | "checking-acl"
  | "unauthorised"
  | "resolving"
  | "awaiting-signature"
  | "decrypting"
  | "done"
  | "error";

export interface DecryptEntry {
  handle: Handle;
  stage: DecryptStage;
  value?: bigint;
  error?: FriendlyError;
  /** How long we have been waiting for Nox to compute the handle. */
  waitedMs?: number;
}

const IDLE: DecryptEntry = { handle: "0x", stage: "idle" };

interface DecryptionContextValue {
  entryFor: (handle: Handle | undefined) => DecryptEntry;
  request: (handle: Handle) => Promise<void>;
  requestMany: (handles: readonly Handle[]) => Promise<void>;
  forget: (handle: Handle) => void;
  reset: () => void;
  /** Handles currently mid-flight. Drives the "N of M" batch indicator. */
  busyCount: number;
}

const DecryptionContext = createContext<DecryptionContextValue | null>(null);

export function DecryptionProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { client, hasAuthorised, markAuthorised } = useHandleClient();
  const [entries, setEntries] = useState<ReadonlyMap<string, DecryptEntry>>(
    new Map(),
  );
  const inFlight = useRef(new Map<string, Promise<void>>());

  // ACL grants are per-address: everything learned as account A is void for B.
  useEffect(() => {
    inFlight.current.clear();
    setEntries(new Map());
  }, [address]);

  const patch = useCallback((handle: Handle, next: Partial<DecryptEntry>) => {
    setEntries((previous) => {
      const map = new Map(previous);
      const key = handle.toLowerCase();
      map.set(key, {
        ...(map.get(key) ?? { handle, stage: "idle" }),
        handle,
        ...next,
      });
      return map;
    });
  }, []);

  const clientRef = useRef(client);
  clientRef.current = client;
  const addressRef = useRef(address);
  addressRef.current = address;
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;
  const hasAuthorisedRef = useRef(hasAuthorised);
  hasAuthorisedRef.current = hasAuthorised;

  const run = useCallback(
    async (handle: Handle): Promise<void> => {
      const account = addressRef.current;
      const handleClient = clientRef.current;
      const reader = publicClientRef.current;

      if (isZeroHandle(handle)) {
        patch(handle, { stage: "uninitialised" });
        return;
      }
      if (!handleClient || !account || !reader) {
        // Not an error — the per-session handle client is probably still being
        // created. Leaving the row idle means it retries by itself the moment
        // the client is ready, instead of stranding the user on a stale
        // "connect a wallet" message they have already acted on.
        patch(handle, { stage: "idle" });
        return;
      }

      try {
        // 1. Ask the chain whether this account may read this ciphertext. Doing
        //    it up-front means we never make the user sign for a value they are
        //    not allowed to see.
        patch(handle, { stage: "checking-acl", error: undefined });
        const allowed = await reader.readContract({
          address: TARGET_NETWORK.noxComputeAddress,
          abi: noxComputeAclAbi,
          functionName: "isViewer",
          args: [handle, account],
        });
        if (!allowed) {
          patch(handle, {
            stage: "unauthorised",
            error: describeError(
              new Error(
                `Handle (${handle}) does not exist or user (${account}) is not authorized to decrypt it`,
              ),
            ),
          });
          return;
        }

        // 2. Wait — signature-free — until the ciphertext actually exists.
        patch(handle, { stage: "resolving", waitedMs: 0 });
        await waitForHandle(handle, {
          onTick: ({ elapsedMs }) => patch(handle, { waitedMs: elapsedMs }),
        });

        // 3. One signature, at the point it can succeed.
        patch(handle, {
          stage: hasAuthorisedRef.current ? "decrypting" : "awaiting-signature",
        });
        const { value } = await handleClient.decrypt<"uint256">(handle);
        markAuthorised();

        patch(handle, { stage: "done", value, error: undefined });
      } catch (cause) {
        patch(handle, { stage: "error", error: describeError(cause) });
      }
    },
    // `client` and `address` are read through refs, but they belong in the
    // dependency list on purpose: changing them changes this callback's
    // identity, which is what makes idle rows retry once the client exists.
    [patch, markAuthorised, client, address],
  );

  const request = useCallback(
    (handle: Handle): Promise<void> => {
      const key = handle.toLowerCase();
      const existing = inFlight.current.get(key);
      if (existing) return existing;
      const promise = run(handle).finally(() => {
        inFlight.current.delete(key);
        setEntries((previous) => new Map(previous));
      });
      inFlight.current.set(key, promise);
      // Re-render so busyCount updates immediately.
      setEntries((previous) => new Map(previous));
      return promise;
    },
    [run],
  );

  const requestMany = useCallback(
    async (handles: readonly Handle[]) => {
      // Sequential on purpose: the first decrypt of a session pops a wallet
      // signature, and firing ten of those at once is how you get a wallet to
      // silently drop nine of them.
      for (const handle of handles) {
        await request(handle);
      }
    },
    [request],
  );

  const entryFor = useCallback(
    (handle: Handle | undefined): DecryptEntry => {
      if (!handle) return IDLE;
      return entries.get(handle.toLowerCase()) ?? { handle, stage: "idle" };
    },
    [entries],
  );

  const forget = useCallback((handle: Handle) => {
    setEntries((previous) => {
      const map = new Map(previous);
      map.delete(handle.toLowerCase());
      return map;
    });
  }, []);

  const reset = useCallback(() => {
    inFlight.current.clear();
    setEntries(new Map());
  }, []);

  const value = useMemo<DecryptionContextValue>(
    () => ({
      entryFor,
      request,
      requestMany,
      forget,
      reset,
      busyCount: inFlight.current.size,
    }),
    [entryFor, request, requestMany, forget, reset, entries],
  );

  return (
    <DecryptionContext.Provider value={value}>
      {children}
    </DecryptionContext.Provider>
  );
}

export function useDecryption(): DecryptionContextValue {
  const context = useContext(DecryptionContext);
  if (!context) {
    throw new Error("useDecryption must be used inside <DecryptionProvider>");
  }
  return context;
}

export const DECRYPT_STAGE_LABEL: Record<DecryptStage, string> = {
  idle: "Encrypted",
  uninitialised: "No value written yet",
  "checking-acl": "Checking on-chain access list…",
  unauthorised: "Not authorised",
  resolving: "Nox is computing this value…",
  "awaiting-signature": "Waiting for your signature…",
  decrypting: "Decrypting locally…",
  done: "Decrypted",
  error: "Failed",
};
