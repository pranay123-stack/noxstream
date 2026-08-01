import type { RosterEntry } from "@shared/types";
import { SECONDS_PER_MONTH, toRatePerSecond } from "@shared/types";
import { isAddress } from "viem";
import { parseAmount } from "./format";

export type { RosterEntry };
export { SECONDS_PER_MONTH, toRatePerSecond };

/** A roster row while it is still being edited — strings, possibly invalid. */
export interface DraftRow {
  id: string;
  employee: string;
  label: string;
  /** Monthly gross, as typed by the employer (human units, e.g. "5000"). */
  monthly: string;
}

export interface ValidatedRow {
  id: string;
  employee: `0x${string}`;
  label: string;
  monthlyAmount: bigint;
  ratePerSecond: bigint;
}

export interface RowIssue {
  id: string;
  field: "employee" | "monthly";
  message: string;
}

export function newDraftRow(partial: Partial<DraftRow> = {}): DraftRow {
  return {
    id: crypto.randomUUID(),
    employee: "",
    label: "",
    monthly: "",
    ...partial,
  };
}

export interface ValidationResult {
  rows: ValidatedRow[];
  issues: RowIssue[];
}

export function validateRoster(
  draft: readonly DraftRow[],
  decimals: number,
): ValidationResult {
  const rows: ValidatedRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Map<string, string>();

  for (const row of draft) {
    const employee = row.employee.trim();
    const monthly = row.monthly.trim();
    if (!employee && !monthly) continue; // an untouched blank row is not an error

    let valid = true;

    if (!isAddress(employee)) {
      issues.push({
        id: row.id,
        field: "employee",
        message: employee
          ? "Not a valid Ethereum address"
          : "Address is required",
      });
      valid = false;
    } else {
      const key = employee.toLowerCase();
      if (seen.has(key)) {
        issues.push({
          id: row.id,
          field: "employee",
          message: "This address is already on the roster",
        });
        valid = false;
      }
      seen.set(key, row.id);
    }

    let monthlyAmount = 0n;
    try {
      monthlyAmount = parseAmount(monthly, decimals);
      if (monthlyAmount <= 0n) {
        issues.push({
          id: row.id,
          field: "monthly",
          message: "Salary must be greater than zero",
        });
        valid = false;
      } else if (toRatePerSecond(monthlyAmount) === 0n) {
        issues.push({
          id: row.id,
          field: "monthly",
          message: `Too small to stream — a month is ${SECONDS_PER_MONTH} seconds, so this rounds to 0 per second`,
        });
        valid = false;
      }
    } catch (error) {
      issues.push({
        id: row.id,
        field: "monthly",
        message: error instanceof Error ? error.message : "Invalid amount",
      });
      valid = false;
    }

    if (valid) {
      rows.push({
        id: row.id,
        employee: employee as `0x${string}`,
        label: row.label.trim(),
        monthlyAmount,
        ratePerSecond: toRatePerSecond(monthlyAmount),
      });
    }
  }

  return { rows, issues };
}

/**
 * Integer division truncates, so the stored per-second rate is up to one base
 * unit short. Over 30 days that is a real, bounded shortfall — we show it
 * rather than rounding it out of sight.
 */
export function roundingShortfall(monthlyAmount: bigint): bigint {
  return monthlyAmount - toRatePerSecond(monthlyAmount) * SECONDS_PER_MONTH;
}

export function totalMonthly(rows: readonly ValidatedRow[]): bigint {
  return rows.reduce((sum, row) => sum + row.monthlyAmount, 0n);
}

export function totalRatePerSecond(rows: readonly ValidatedRow[]): bigint {
  return rows.reduce((sum, row) => sum + row.ratePerSecond, 0n);
}
