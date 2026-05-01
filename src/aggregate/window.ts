import { buildCombinedReceipt } from "./combine.js";
import type { Receipt, ReceiptScope } from "../data/receipt-schema.js";
import type { NormalizedSession } from "../data/types.js";

function startOfTodayLocal(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekRollingMs(): number {
  return Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function startOfYearLocal(year: number): number {
  return new Date(year, 0, 1, 0, 0, 0, 0).getTime();
}
function endOfYearLocal(year: number): number {
  return new Date(year + 1, 0, 1, 0, 0, 0, 0).getTime() - 1;
}

export function todayWindowSinceMs(): number {
  return startOfTodayLocal();
}
export function weekWindowSinceMs(): number {
  return startOfWeekRollingMs();
}

export function buildTodayReceipt(sessions: NormalizedSession[]): Receipt {
  const since = todayWindowSinceMs();
  const filtered = sessions.filter((s) => new Date(s.endUtc).getTime() >= since);
  if (filtered.length === 0) throw new Error("no sessions match window=today");
  const scope: ReceiptScope = { kind: "window-today" };
  return buildCombinedReceipt(filtered, scope);
}

export function buildWeekReceipt(sessions: NormalizedSession[]): Receipt {
  const since = weekWindowSinceMs();
  const filtered = sessions.filter((s) => new Date(s.endUtc).getTime() >= since);
  if (filtered.length === 0) throw new Error("no sessions match window=week");
  const scope: ReceiptScope = { kind: "combine-since", since: "P7D" };
  // Use combine-since semantically; we expose `week` to the user but model it as P7D for the scope.
  return buildCombinedReceipt(filtered, scope);
}

export function buildYearReceipt(sessions: NormalizedSession[], year?: number): Receipt {
  const y = year ?? new Date().getFullYear();
  const start = startOfYearLocal(y);
  const end = endOfYearLocal(y);
  const filtered = sessions.filter((s) => {
    const t = new Date(s.endUtc).getTime();
    return t >= start && t <= end;
  });
  if (filtered.length === 0) throw new Error(`no sessions match window=year ${y}`);
  const scope: ReceiptScope = { kind: "window-year", year: y };
  return buildCombinedReceipt(filtered, scope);
}
