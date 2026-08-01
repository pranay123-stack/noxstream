import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { wagmiConfig } from "./config/wagmi";
import { DecryptionProvider } from "./nox/DecryptionProvider";
import { HandleClientProvider } from "./nox/HandleClientProvider";

import "@rainbow-me/rainbowkit/styles.css";
import "./styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root");

createRoot(container).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {/* Matches the app's own palette: --accent on white, white foreground. */}
        <RainbowKitProvider
          theme={lightTheme({
            accentColor: "#4f46e5",
            accentColorForeground: "#ffffff",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          <HandleClientProvider>
            <DecryptionProvider>
              <App />
            </DecryptionProvider>
          </HandleClientProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
