import { useEffect, useMemo, useState } from 'react';
import type { LegalActions } from '../../shared/actions';
import type { PlayerAction, Street } from '../../shared/types';

type Props = {
  legal: LegalActions | null;
  onAction: (a: PlayerAction) => void;
  disabled: boolean;
  street: Street;
  pot: number;
  bigBlind: number;
  // Where my commitment on this street stands right now. Needed so postflop
  // pot-fraction presets can be translated into a total-commit "amount".
  myCommittedThisStreet: number;
};

type Preset = { label: string; amount: number };

function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// Build the appropriate preset list given current spot.
function buildPresets(
  street: Street,
  legal: LegalActions,
  pot: number,
  bigBlind: number,
  myCommitted: number,
): Preset[] {
  if (!legal.canBet && !legal.canRaise) return [];

  const min = legal.canBet ? legal.minBetTo : legal.minRaiseTo;
  const max = legal.canBet ? legal.maxBetTo : legal.maxRaiseTo;

  if (street === 'preflop' && legal.canRaise) {
    // Preflop facing the BB (or a raise): label as multiples of BB raise-to.
    return [
      { label: '2.2 BB', amount: clampInt(bigBlind * 2.2, min, max) },
      { label: '2.5 BB', amount: clampInt(bigBlind * 2.5, min, max) },
      { label: '3 BB',   amount: clampInt(bigBlind * 3, min, max) },
      { label: 'Max',    amount: max },
    ];
  }

  // Postflop bet/raise sizing in pot fractions.
  // For a bet (no current bet), amount-to = myCommitted + sizing-chips,
  // and myCommitted is 0 (fresh street) — so amount == sizing chips.
  // For a raise, current pot already reflects the call portion implicitly;
  // we still target sizing-chips ADDED on top of the call, then clamp legally.
  const targets = (frac: number) => {
    const callDelta = Math.max(0, legal.callTo - myCommitted);
    const sizing = Math.round((pot + 2 * callDelta) * frac);
    const totalCommit = myCommitted + callDelta + sizing;
    return clampInt(totalCommit, min, max);
  };
  if (legal.canBet) {
    return [
      { label: '33%', amount: clampInt(Math.round(pot * 0.33), min, max) },
      { label: '50%', amount: clampInt(Math.round(pot * 0.5), min, max) },
      { label: '75%', amount: clampInt(Math.round(pot * 0.75), min, max) },
      { label: 'Pot', amount: clampInt(pot, min, max) },
      { label: 'Max', amount: max },
    ];
  }
  return [
    { label: '33%', amount: targets(0.33) },
    { label: '50%', amount: targets(0.5) },
    { label: '75%', amount: targets(0.75) },
    { label: 'Pot', amount: targets(1) },
    { label: 'Max', amount: max },
  ];
}

export function ActionPanel({
  legal,
  onAction,
  disabled,
  street,
  pot,
  bigBlind,
  myCommittedThisStreet,
}: Props) {
  const presets = useMemo(
    () => (legal ? buildPresets(street, legal, pot, bigBlind, myCommittedThisStreet) : []),
    [legal, street, pot, bigBlind, myCommittedThisStreet],
  );

  const defaultAmount = legal?.canBet
    ? legal.minBetTo
    : legal?.canRaise
    ? legal.minRaiseTo
    : 0;
  const [amount, setAmount] = useState<number>(defaultAmount);

  useEffect(() => {
    setAmount(defaultAmount);
  }, [defaultAmount]);

  if (!legal) {
    return <div className="action-panel idle">Waiting for opponent…</div>;
  }

  const min = legal.canBet ? legal.minBetTo : legal.canRaise ? legal.minRaiseTo : 0;
  const max = legal.canBet ? legal.maxBetTo : legal.canRaise ? legal.maxRaiseTo : 0;
  const canSize = legal.canBet || legal.canRaise;

  function submit(): void {
    if (!canSize) return;
    onAction({
      type: legal!.canBet ? 'bet' : 'raise',
      amount: clampInt(amount || min, min, max),
    });
  }

  return (
    <div className="action-panel">
      {canSize && (
        <div className="sizing-block">
          <div className="preset-row">
            {presets.map((p) => (
              <button
                key={p.label}
                className="preset-btn"
                onClick={() => setAmount(p.amount)}
                disabled={disabled}
                title={`${p.label} → ${fmtChips(p.amount)}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="amount-row">
            <span className="amount-label">AMOUNT</span>
            <input
              type="number"
              min={min}
              max={max}
              step={1}
              value={Number.isFinite(amount) ? amount : ''}
              onChange={(e) => setAmount(parseInt(e.target.value, 10))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={disabled}
            />
            <span className="amount-hint">
              {fmtChips(min)} – {fmtChips(max)}
            </span>
          </div>
        </div>
      )}

      <div className="primary-row">
        {legal.fold && (
          <button
            className="action-btn action-fold"
            onClick={() => onAction({ type: 'fold' })}
            disabled={disabled}
          >
            <span className="action-btn-label">Fold</span>
          </button>
        )}
        {legal.check && (
          <button
            className="action-btn action-check"
            onClick={() => onAction({ type: 'check' })}
            disabled={disabled}
          >
            <span className="action-btn-label">Check</span>
          </button>
        )}
        {legal.call && (
          <button
            className="action-btn action-call"
            onClick={() => onAction({ type: 'call' })}
            disabled={disabled}
          >
            <span className="action-btn-label">Call</span>
            <span className="action-btn-amount">{fmtChips(legal.callTo)}</span>
          </button>
        )}
        {canSize && (
          <button
            className="action-btn action-aggressive"
            onClick={submit}
            disabled={disabled}
          >
            <span className="action-btn-label">{legal.canBet ? 'Bet' : 'Raise to'}</span>
            <span className="action-btn-amount">{fmtChips(amount || min)}</span>
          </button>
        )}
      </div>
    </div>
  );
}
