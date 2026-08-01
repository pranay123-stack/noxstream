import { formatUnits, parseUnits } from "viem";

export function formatAmount(
  value: bigint,
  decimals: number,
  maxFractionDigits = 2,
): string {
  const asString = formatUnits(value, decimals);
  const [whole, fraction = ""] = asString.split(".");
  const groupedWhole = Number(whole).toLocaleString("en-US");
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${groupedWhole}.${trimmed}` : groupedWhole;
}

/** Full precision, no grouping — for the "exact base units" disclosures. */
export function formatExact(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

export function parseAmount(input: string, decimals: number): bigint {
  const cleaned = input.trim().replace(/[,_\s]/g, "").replace(/[a-zA-Z$€£]+$/, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    throw new Error(`"${input.trim()}" is not a number`);
  }
  return parseUnits(cleaned, decimals);
}

const UNITS: Array<[number, string]> = [
  [86_400, "d"],
  [3_600, "h"],
  [60, "m"],
];

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  let remaining = Math.floor(seconds);
  const parts: string[] = [];
  for (const [size, suffix] of UNITS) {
    const count = Math.floor(remaining / size);
    if (count > 0) {
      parts.push(`${count}${suffix}`);
      remaining -= count * size;
    }
    if (parts.length === 2) break;
  }
  if (parts.length < 2 && remaining > 0) parts.push(`${remaining}s`);
  return parts.join(" ") || "0s";
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function formatTimestamp(unixSeconds: bigint | number): string {
  const asNumber = Number(unixSeconds);
  if (!asNumber) return "—";
  return new Date(asNumber * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function percent(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const scaled = (part * 10_000n) / whole;
  return Math.min(100, Number(scaled) / 100);
}
