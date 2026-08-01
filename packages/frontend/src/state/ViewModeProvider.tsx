import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * PUBLIC vs PRIVATE — the whole product in one switch.
 *
 * PUBLIC renders exactly what an observer of Ethereum Sepolia gets: addresses,
 * the aggregate stream, and a 32-byte handle where each salary should be.
 * PRIVATE renders the same rows after an ACL-authorised `decrypt()`, and only
 * for handles the connected account actually holds a grant on.
 *
 * The mode is written to `<html data-mode>` so the page's accent colour comes
 * with it — you feel the switch before you read it.
 */

export type ViewMode = "public" | "private";

interface ViewModeContextValue {
  mode: ViewMode;
  isPrivate: boolean;
  setMode: (mode: ViewMode) => void;
  toggle: () => void;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>("public");

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const value = useMemo<ViewModeContextValue>(
    () => ({
      mode,
      isPrivate: mode === "private",
      setMode,
      toggle: () => setMode((m) => (m === "public" ? "private" : "public")),
    }),
    [mode],
  );

  return (
    <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
  );
}

export function useViewMode(): ViewModeContextValue {
  const context = useContext(ViewModeContext);
  if (!context) {
    throw new Error("useViewMode must be used inside <ViewModeProvider>");
  }
  return context;
}
