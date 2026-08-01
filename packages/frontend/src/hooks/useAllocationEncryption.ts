import { useCallback, useRef, useState } from "react";
import type { Handle } from "@shared/nox";
import { useHandleClient } from "@/nox/HandleClientProvider";
import { describeError, type FriendlyError } from "@/nox/errors";
import type { ValidatedRow } from "@/lib/roster";

/**
 * Turning salaries into handles — the moment the product is about.
 *
 * `encryptInput` posts the value to the Nox handle gateway, which returns a
 * 32-byte handle plus an EIP-712 proof that the handle is legitimate. The
 * plaintext never touches the chain and never touches our code again. The
 * handle is bound to the registry address at mint time, so it cannot be
 * replayed against a different contract.
 *
 * Rows are encrypted one at a time so the roster visibly turns into
 * ciphertext, and so a gateway hiccup fails one row instead of ten.
 */

export type RowStatus = "idle" | "encrypting" | "done" | "error";

export interface EncryptedRow extends ValidatedRow {
  status: RowStatus;
  handle?: Handle;
  proof?: `0x${string}`;
  error?: FriendlyError;
  elapsedMs?: number;
}

export interface AllocationEncryption {
  rows: EncryptedRow[];
  isRunning: boolean;
  /** True once every row has a handle. */
  isComplete: boolean;
  failedCount: number;
  encrypt: (rows: readonly ValidatedRow[], contract: `0x${string}`) => Promise<void>;
  clear: () => void;
}

export function useAllocationEncryption(): AllocationEncryption {
  const { client } = useHandleClient();
  const [rows, setRows] = useState<EncryptedRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const clientRef = useRef(client);
  clientRef.current = client;

  const encrypt = useCallback(
    async (input: readonly ValidatedRow[], contract: `0x${string}`) => {
      const handleClient = clientRef.current;
      if (!handleClient) {
        setRows(
          input.map((row) => ({
            ...row,
            status: "error" as const,
            error: describeError(
              new Error("Connect a wallet before encrypting the roster."),
            ),
          })),
        );
        return;
      }

      setIsRunning(true);
      setRows(input.map((row) => ({ ...row, status: "idle" as const })));

      for (const [index, row] of input.entries()) {
        setRows((previous) =>
          previous.map((r, i) => (i === index ? { ...r, status: "encrypting" } : r)),
        );
        const startedAt = performance.now();
        try {
          const { handle, handleProof } = await handleClient.encryptInput(
            row.ratePerSecond,
            "uint256",
            contract,
          );
          const elapsedMs = performance.now() - startedAt;
          setRows((previous) =>
            previous.map((r, i) =>
              i === index
                ? {
                    ...r,
                    status: "done",
                    handle: handle as Handle,
                    proof: handleProof,
                    elapsedMs,
                  }
                : r,
            ),
          );
        } catch (cause) {
          setRows((previous) =>
            previous.map((r, i) =>
              i === index
                ? { ...r, status: "error", error: describeError(cause) }
                : r,
            ),
          );
        }
      }

      setIsRunning(false);
    },
    [],
  );

  const clear = useCallback(() => setRows([]), []);

  return {
    rows,
    isRunning,
    isComplete: rows.length > 0 && rows.every((r) => r.status === "done"),
    failedCount: rows.filter((r) => r.status === "error").length,
    encrypt,
    clear,
  };
}
