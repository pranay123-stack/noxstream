import { isAddress } from "viem";
import { newDraftRow, type DraftRow } from "./roster";

/**
 * Roster CSV parsing, deliberately forgiving about shape and strict about
 * content. Real payroll exports are messy; a hackathon demo should not fail on
 * a header row or a stray semicolon.
 *
 * Accepted per line, in any column order:
 *   0xabc…,5000
 *   0xabc…,Ada Lovelace,5000
 *   Ada Lovelace;0xabc…;5,000 USDC
 *
 * Rules: the field that parses as an address is the employee, the last field
 * that looks numeric is the monthly salary, anything left over is the label.
 * A label never leaves the browser — it is not sent on-chain.
 */

export interface CsvParseResult {
  rows: DraftRow[];
  /** Lines we could not make sense of, with their original text. */
  skipped: Array<{ line: number; text: string; reason: string }>;
}

const NUMERIC = /^[\d,_\s]*\.?\d+\s*[a-zA-Z$€£]*$/;

export function parseRosterCsv(text: string): CsvParseResult {
  const rows: DraftRow[] = [];
  const skipped: CsvParseResult["skipped"] = [];

  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const fields = line
      .split(/[,;\t|]/)
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter((f) => f.length > 0);

    if (fields.length === 0) continue;

    const address = fields.find((f) => isAddress(f));
    const numeric = [...fields].reverse().find((f) => f !== address && NUMERIC.test(f));

    if (!address && !numeric) {
      // Almost certainly a header row — skip it quietly.
      if (index === 0) continue;
      skipped.push({ line: index + 1, text: line, reason: "No address and no amount" });
      continue;
    }
    if (!address) {
      skipped.push({ line: index + 1, text: line, reason: "No valid address" });
      continue;
    }
    if (!numeric) {
      skipped.push({ line: index + 1, text: line, reason: "No monthly salary" });
      continue;
    }

    const label = fields.find((f) => f !== address && f !== numeric) ?? "";
    rows.push(
      newDraftRow({
        employee: address,
        label,
        monthly: numeric.replace(/[,_\s]/g, "").replace(/[a-zA-Z$€£]+$/, ""),
      }),
    );
  }

  return { rows, skipped };
}

export const CSV_PLACEHOLDER = `# address, name (optional), monthly salary
0x… , Ada Lovelace , 5000
0x… , Grace Hopper , 7250`;
