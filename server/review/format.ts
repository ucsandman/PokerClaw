import type { ActionRecord, Card, PlayerId } from '../../shared/types';
import type { HandSnapshot } from '../training';

// Renders a HandSnapshot[] into the compact, structured text block we feed
// the reviewer. Designed for token efficiency and readability — every hand is
// labelled by handId so the model can cite spots precisely.

function cardStr(c: Card): string {
  return `${c.rank}${c.suit}`;
}

function cardsStr(cards: Card[]): string {
  return cards.length === 0 ? '(none)' : cards.map(cardStr).join(' ');
}

function positionFor(button: PlayerId, player: PlayerId): 'BTN/SB' | 'BB' {
  return player === button ? 'BTN/SB' : 'BB';
}

function actionStr(rec: ActionRecord): string {
  const a = rec.action;
  switch (a.type) {
    case 'fold': return 'fold';
    case 'check': return 'check';
    case 'call': return 'call';
    case 'bet': return `bet to ${a.amount}`;
    case 'raise': return `raise to ${a.amount}`;
  }
}

function whoStr(button: PlayerId, player: PlayerId): string {
  const pos = positionFor(button, player);
  const name = player === 'wes' ? 'Wes' : 'MoltFire';
  return `${name} (${pos})`;
}

export function formatHand(snap: HandSnapshot): string {
  const lines: string[] = [];
  lines.push(`Hand ${snap.handId}  blinds ${snap.smallBlind}/${snap.bigBlind}  button=${snap.button}`);
  lines.push(
    `  Stacks at start: Wes ${snap.startingStacks.wes}, MoltFire ${snap.startingStacks.moltfire}`,
  );
  lines.push(`  Wes hole cards: ${cardsStr(snap.wesHoleCards)}`);
  lines.push(
    `  MoltFire hole cards: ${snap.moltfireHoleCards ? cardsStr(snap.moltfireHoleCards) : '(hidden — not shown at showdown)'}`,
  );

  // Group action history by street so the reviewer can read each street as a
  // unit. Board cards are dealt between streets — the engine adds them to
  // state.board at the street transition, but we approximate by interleaving
  // a "Flop"/"Turn"/"River" header before the first record on each street.
  let prevStreet: string | null = null;
  for (const rec of snap.actionHistory) {
    if (rec.street !== prevStreet) {
      lines.push(`  [${rec.street}]`);
      prevStreet = rec.street;
    }
    lines.push(
      `    ${whoStr(snap.button, rec.player)}: ${actionStr(rec)}  (pot ${rec.potAfter})`,
    );
  }

  // Final board (may be partial if hand ended on a fold).
  lines.push(`  Final board: ${cardsStr(snap.board)}`);

  // Result.
  const r = snap.result;
  if (r.winner === 'tie') {
    lines.push(`  Result: tie via ${r.reason}, pot ${r.potAwarded}`);
  } else {
    const name = r.winner === 'wes' ? 'Wes' : 'MoltFire';
    lines.push(`  Result: ${name} wins ${r.potAwarded} via ${r.reason}`);
  }
  if (r.showdown) {
    lines.push(
      `  Showdown: Wes ${r.showdown.wes.category}, MoltFire ${r.showdown.moltfire.category}`,
    );
  }
  // Net chip swing for Wes — the most useful single delta for a study session.
  const delta = snap.endingStacks.wes - snap.startingStacks.wes;
  const sign = delta >= 0 ? '+' : '';
  lines.push(`  Wes Δstack: ${sign}${delta}`);
  return lines.join('\n');
}

export function formatSession(hands: HandSnapshot[]): string {
  if (hands.length === 0) {
    return '(no hands captured)';
  }
  const sb = hands[0].smallBlind;
  const bb = hands[0].bigBlind;
  const startWes = hands[0].startingStacks.wes;
  const endWes = hands[hands.length - 1].endingStacks.wes;
  const netWes = endWes - startWes;
  const sign = netWes >= 0 ? '+' : '';

  const header = [
    `Training session: ${hands.length} hand(s)`,
    `Blinds: ${sb}/${bb}`,
    `Wes net result over session: ${sign}${netWes} chips (${startWes} → ${endWes})`,
  ];

  const body = hands.map(formatHand).join('\n\n');
  return `${header.join('\n')}\n\n${body}`;
}
