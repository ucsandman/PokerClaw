import type { ActionRecord, PlayerId } from '../../shared/types';

function fmtChips(n: number): string {
  return n.toLocaleString('en-US');
}

function actorLabel(player: PlayerId, opponentName: string): string {
  return player === 'wes' ? 'Wes' : opponentName;
}

function describe(r: ActionRecord): { verb: string; amount: string | null } {
  const a = r.action;
  switch (a.type) {
    case 'fold':  return { verb: 'folds', amount: null };
    case 'check': return { verb: 'checks', amount: null };
    case 'call':  return { verb: 'calls', amount: fmtChips(r.committedAfter) };
    case 'bet':   return { verb: 'bets', amount: fmtChips(a.amount) };
    case 'raise': return { verb: 'raises to', amount: fmtChips(a.amount) };
  }
}

const STREET_LABELS: Record<string, string> = {
  preflop: 'PREFLOP',
  flop: 'FLOP',
  turn: 'TURN',
  river: 'RIVER',
  showdown: 'SHOWDOWN',
  complete: 'RESULT',
};

export function HandHistory({
  history,
  opponentName = 'Opponent',
}: {
  history: ActionRecord[];
  opponentName?: string;
}) {
  if (history.length === 0) {
    return <div className="hand-history empty">No actions yet.</div>;
  }
  // Preserve insertion order so streets render preflop → river.
  const byStreet = new Map<string, ActionRecord[]>();
  for (const rec of history) {
    const list = byStreet.get(rec.street) ?? [];
    list.push(rec);
    byStreet.set(rec.street, list);
  }
  return (
    <div className="hand-history">
      {Array.from(byStreet.entries()).map(([street, recs]) => {
        const firstPot = recs[0]?.potAfter ?? 0;
        return (
          <div className="hand-history-street" key={street}>
            <div className="hand-history-label">
              <span className="hand-history-street-name">
                {STREET_LABELS[street] ?? street.toUpperCase()}
              </span>
              <span className="hand-history-pot">pot {fmtChips(firstPot)}</span>
            </div>
            <ul className="hand-history-actions">
              {recs.map((r, i) => {
                const { verb, amount } = describe(r);
                return (
                  <li key={i} className={`hh-row hh-row-${r.player}`}>
                    <span className={`hh-actor hh-actor-${r.player}`}>
                      {actorLabel(r.player, opponentName)}
                    </span>
                    <span className="hh-verb">{verb}</span>
                    {amount && <span className="hh-amount">{amount}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
