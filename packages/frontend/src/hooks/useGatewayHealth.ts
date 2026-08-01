import { useQuery } from "@tanstack/react-query";
import { TARGET_NETWORK } from "@shared/nox";

/**
 * A real reachability check against the Nox handle gateway.
 *
 * Useful before anything is deployed: it proves the app is pointed at a live
 * Nox testnet, not at a mock. The endpoint answers
 * `{"service":"Handle Gateway","timestamp":…}` with `access-control-allow-origin: *`.
 */
export interface GatewayHealth {
  service: string;
  timestamp: string;
}

export function useGatewayHealth() {
  return useQuery<GatewayHealth>({
    queryKey: ["nox-gateway-health", TARGET_NETWORK.handleGatewayUrl],
    queryFn: async () => {
      const response = await fetch(TARGET_NETWORK.handleGatewayUrl, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Gateway responded ${response.status}`);
      }
      return (await response.json()) as GatewayHealth;
    },
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1_200,
  });
}
