import { useCallback, useRef, useState } from "react";
import type { Address, Hash, TransactionReceipt } from "viem";
import { useSendTransaction, usePublicClient, useWriteContract } from "wagmi";
import { describeError, type FriendlyError } from "@/nox/errors";

/**
 * One transaction, with the states a user actually experiences:
 * signing → in the mempool → mined. Nothing is reported before it happens.
 */
export type TxStage =
  | "idle"
  | "awaiting-signature"
  | "pending"
  | "confirmed"
  | "error";

/**
 * The exact union wagmi's `writeContractAsync` accepts. Naming it keeps full
 * ABI/args type-checking at every call site.
 */
export type WriteRequest = Parameters<
  ReturnType<typeof useWriteContract>["writeContractAsync"]
>[0];

export interface TxFlow {
  stage: TxStage;
  hash?: Hash;
  receipt?: TransactionReceipt;
  error?: FriendlyError;
  isBusy: boolean;
  reset: () => void;
  send: (request: WriteRequest) => Promise<TransactionReceipt | undefined>;
  /** Plain value transfer — used to top up the adapter's fee tank. */
  sendEth: (to: Address, value: bigint) => Promise<TransactionReceipt | undefined>;
}

export function useTxFlow(): TxFlow {
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  const [stage, setStage] = useState<TxStage>("idle");
  const [hash, setHash] = useState<Hash | undefined>();
  const [receipt, setReceipt] = useState<TransactionReceipt | undefined>();
  const [error, setError] = useState<FriendlyError | undefined>();
  const busy = useRef(false);

  const reset = useCallback(() => {
    setStage("idle");
    setHash(undefined);
    setReceipt(undefined);
    setError(undefined);
  }, []);

  const send = useCallback<TxFlow["send"]>(
    async (request) => {
      if (busy.current) return undefined;
      busy.current = true;
      setStage("awaiting-signature");
      setError(undefined);
      setReceipt(undefined);
      setHash(undefined);
      try {
        // The union distributes badly through the callback boundary; the cast
        // is purely to re-narrow it, the shape is already checked at call sites.
        const txHash = await writeContractAsync(
          request as Parameters<typeof writeContractAsync>[0],
        );
        setHash(txHash);
        setStage("pending");
        const mined = await publicClient?.waitForTransactionReceipt({
          hash: txHash,
        });
        setReceipt(mined);
        setStage("confirmed");
        return mined;
      } catch (cause) {
        setError(describeError(cause));
        setStage("error");
        return undefined;
      } finally {
        busy.current = false;
      }
    },
    [writeContractAsync, publicClient],
  );

  const sendEth = useCallback<TxFlow["sendEth"]>(
    async (to, value) => {
      if (busy.current) return undefined;
      busy.current = true;
      setStage("awaiting-signature");
      setError(undefined);
      setReceipt(undefined);
      setHash(undefined);
      try {
        const txHash = await sendTransactionAsync({ to, value });
        setHash(txHash);
        setStage("pending");
        const mined = await publicClient?.waitForTransactionReceipt({
          hash: txHash,
        });
        setReceipt(mined);
        setStage("confirmed");
        return mined;
      } catch (cause) {
        setError(describeError(cause));
        setStage("error");
        return undefined;
      } finally {
        busy.current = false;
      }
    },
    [sendTransactionAsync, publicClient],
  );

  return {
    stage,
    hash,
    receipt,
    error,
    isBusy: stage === "awaiting-signature" || stage === "pending",
    reset,
    send,
    sendEth,
  };
}
