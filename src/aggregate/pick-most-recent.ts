import type { NormalizedSession, Source } from "../data/types.js";

export function pickMostRecent(
  sessions: NormalizedSession[],
  source?: Source,
): NormalizedSession | null {
  const filtered = source ? sessions.filter((s) => s.source === source) : sessions;
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => new Date(b.endUtc).getTime() - new Date(a.endUtc).getTime());
  return filtered[0]!;
}
