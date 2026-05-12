// Shared display formatters. The engine speaks in chips (atomic units the
// dealer validates), but the UI prefers big-blind units because it's how
// poker is actually thought about — "I'm calling 3 BB" reads faster than
// "I'm calling 300". These helpers convert at the display boundary.

export function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

// Render an amount in big blinds. Whole numbers drop the decimal; otherwise
// one decimal place. Falls back to chip display when bigBlind is 0 (defensive
// — bigBlind should never be 0 in a real session).
export function fmtBB(amount: number, bigBlind: number): string {
  if (!bigBlind || bigBlind <= 0) return `${fmtChips(amount)}`;
  const bb = amount / bigBlind;
  if (Math.abs(bb - Math.round(bb)) < 0.05) {
    return `${Math.round(bb)} BB`;
  }
  return `${(Math.round(bb * 10) / 10).toFixed(1)} BB`;
}
