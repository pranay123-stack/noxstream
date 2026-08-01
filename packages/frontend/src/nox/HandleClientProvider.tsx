import { createViemHandleClient } from "@iexec-nox/handle";
import type { HandleClient } from "@iexec-nox/handle";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useWalletClient } from "wagmi";
import { describeError, type FriendlyError } from "./errors";

/**
 * One `HandleClient` per connected account, kept alive for the whole session.
 *
 * This is not an optimisation, it is a UX requirement. The SDK caches the
 * EIP-712 data-access authorisation in a storage service that defaults to an
 * in-memory one, and `createViemHandleClient` gives no way to swap it for
 * localStorage. So the cache lives and dies with the client instance: keep one
 * instance and the user signs once per hour; rebuild it per component and they
 * sign for every single value they look at.
 */

export type HandleClientStatus = "no-wallet" | "creating" | "ready" | "error";

interface HandleClientContextValue {
  client: HandleClient | null;
  status: HandleClientStatus;
  error: FriendlyError | null;
  /** True once this session has produced a data-access signature. */
  hasAuthorised: boolean;
  markAuthorised: () => void;
}

const HandleClientContext = createContext<HandleClientContextValue | null>(null);

export function HandleClientProvider({ children }: { children: ReactNode }) {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [client, setClient] = useState<HandleClient | null>(null);
  const [status, setStatus] = useState<HandleClientStatus>("no-wallet");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [hasAuthorised, setHasAuthorised] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const id = ++generation.current;
    setHasAuthorised(false);
    setClient(null);
    setError(null);

    if (!walletClient || !address) {
      setStatus("no-wallet");
      return;
    }

    setStatus("creating");
    // The SDK auto-resolves the Sepolia (11155111) config from the connected
    // chain — verified against @iexec-nox/handle's networks.ts, which ships a
    // complete entry despite the docs claiming otherwise. No override needed.
    createViemHandleClient(walletClient)
      .then((created) => {
        if (generation.current !== id) return;
        setClient(created);
        setStatus("ready");
      })
      .catch((cause) => {
        if (generation.current !== id) return;
        setError(describeError(cause));
        setStatus("error");
      });
  }, [walletClient, address, chainId]);

  const value = useMemo<HandleClientContextValue>(
    () => ({
      client,
      status,
      error,
      hasAuthorised,
      markAuthorised: () => setHasAuthorised(true),
    }),
    [client, status, error, hasAuthorised],
  );

  return (
    <HandleClientContext.Provider value={value}>
      {children}
    </HandleClientContext.Provider>
  );
}

export function useHandleClient(): HandleClientContextValue {
  const context = useContext(HandleClientContext);
  if (!context) {
    throw new Error("useHandleClient must be used inside <HandleClientProvider>");
  }
  return context;
}
