export function compactNumber(n: number, fractionDigits = 1): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return Math.round(n).toString();
  if (abs < 10_000) return `${(n / 1000).toFixed(fractionDigits)}k`;
  if (abs < 1_000_000) return `${(n / 1000).toFixed(0)}k`;
  return `${(n / 1_000_000).toFixed(fractionDigits)}M`;
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.005) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}
