import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { App } from "./App";
import { wagmiConfig } from "./config/wagmi";
import { DecryptionProvider } from "./nox/DecryptionProvider";
import { HandleClientProvider } from "./nox/HandleClientProvider";
import { ViewModeProvider } from "./state/ViewModeProvider";

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
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7f8cff",
            accentColorForeground: "#06070d",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          <ViewModeProvider>
            <HandleClientProvider>
              <DecryptionProvider>
                <App />
              </DecryptionProvider>
            </HandleClientProvider>
          </ViewModeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
