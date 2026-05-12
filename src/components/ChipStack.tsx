type Props = {
  // Reference chip count. Visual stack height steps up at fixed thresholds
  // so a 100-chip pot doesn't look identical to a 10,000-chip pot.
  amount: number;
  variant?: 'pot' | 'bet' | 'stack';
};

// Pick a chip "denomination color" by amount band. Mirrors typical casino
// chip color conventions loosely so larger amounts read as more valuable.
function denomFor(amount: number): 'white' | 'red' | 'green' | 'black' | 'purple' | 'gold' {
  if (amount >= 25000) return 'gold';
  if (amount >= 5000) return 'purple';
  if (amount >= 1000) return 'black';
  if (amount >= 250) return 'green';
  if (amount >= 50) return 'red';
  return 'white';
}

// Map amount to a small visual stack height (1..4 chips). Keeps the stack
// compact even when chip counts get big.
function stackHeight(amount: number): number {
  if (amount <= 0) return 0;
  if (amount < 100) return 1;
  if (amount < 1000) return 2;
  if (amount < 10000) return 3;
  return 4;
}

// CSS-only chip stack. Renders a small pile of disc-shaped chips. The actual
// chip count drives the stack height but we cap it so the visual stays small
// next to text counters.
export function ChipStack({ amount, variant = 'pot' }: Props) {
  const height = stackHeight(amount);
  if (height === 0) return null;
  const denom = denomFor(amount);
  return (
    <div className={`chip-stack chip-variant-${variant}`} aria-hidden="true">
      {Array.from({ length: height }).map((_, i) => (
        <div
          key={i}
          className={`chip chip-${denom}`}
          style={{ bottom: `${i * 3}px` }}
        />
      ))}
    </div>
  );
}
