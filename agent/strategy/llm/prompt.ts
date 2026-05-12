import type { PublicActionRecord, StrategyInput } from '../../types';

// The system contract — short, public-safe, requires strict JSON output.
// Personality cues come from MOLTFIRE_POKER_AGENT_CONTRACT.md.
export const SYSTEM_PROMPT = `You are MoltFire, a competitive but fair heads-up no-limit Texas Hold'em opponent playing locally against Wes.

Hard rules:
- Use ONLY the authorized state provided. You do not know Wes's hole cards. Do not infer or claim to know them.
- Pick exactly one of the legal actions listed. Do not invent action types.
- "amount" for bet/raise is the TOTAL committed amount for the current street after the action — not the chip delta.
- Never reveal your own hole cards or describe their category in tableTalk during Match Mode.
- Never include chain-of-thought. A one-line public-safe rationale is fine.

Style:
- Play a reasonable HU range: open often on the button, defend BB selectively, c-bet some dry boards, fold trash to pressure, value-bet made hands, bluff occasionally.
- Avoid passive limp/call/fold lines as a default. Be willing to fold and willing to bet.
- Use sane sizes relative to pot and stacks. Avoid absurd overbets unless there is a clear all-in motive.

Output strict JSON, single object, this shape:
{
  "action": { "type": "fold" | "check" | "call" } |
            { "type": "bet", "amount": <integer total commit this street> } |
            { "type": "raise", "amount": <integer total commit this street> },
  "tableTalk": "<optional, short, no private-card content>",
  "rationale": "<optional, one short line, public-safe>"
}`;

// Builds the user message: a compact, fixed-shape description of the
// authorized state and a list of every legal action with its amount range.
// NEVER includes opponent hole cards.
export function buildUserPrompt(input: StrategyInput): string {
  const legal = input.legalActions;
  const legalLines: string[] = [];
  if (legal.fold) legalLines.push('- fold');
  if (legal.check) legalLines.push('- check');
  if (legal.call) legalLines.push(`- call (commits to ${legal.callTo} on this street)`);
  if (legal.canBet) {
    legalLines.push(`- bet: amount in [${legal.minBetTo}, ${legal.maxBetTo}] (total commit this street)`);
  }
  if (legal.canRaise) {
    legalLines.push(`- raise: amount in [${legal.minRaiseTo}, ${legal.maxRaiseTo}] (total commit this street)`);
  }

  const history = renderHistory(input.publicActionHistory);

  return [
    `Mode: ${input.mode}`,
    `Street: ${input.street}`,
    `Big blind: ${input.bigBlind}`,
    `Pot: ${input.pot}`,
    `Current bet to match: ${input.currentBet}`,
    `Effective stack: ${input.effectiveStack}`,
    `My stack: ${input.myStack} (committed this street: ${input.myCommittedThisStreet})`,
    `Opponent stack: ${input.opponentStack} (committed this street: ${input.opponentCommittedThisStreet})`,
    `Board: ${input.board.length ? input.board.join(' ') : '(none)'}`,
    `My hole cards: ${input.myHoleCards.join(' ') || '(none)'}`,
    '',
    'Public action history (no card data):',
    history,
    '',
    'Legal actions:',
    legalLines.join('\n'),
    '',
    'Respond with JSON only.',
  ].join('\n');
}

function renderHistory(history: PublicActionRecord[]): string {
  if (!history.length) return '(no actions yet)';
  const lines: string[] = [];
  let prevStreet: string | null = null;
  for (const rec of history) {
    if (rec.street !== prevStreet) {
      lines.push(`[${rec.street}]`);
      prevStreet = rec.street;
    }
    const who = rec.player === 'wes' ? 'Wes' : 'MoltFire';
    const a = rec.action;
    let line: string;
    switch (a.type) {
      case 'fold': line = `${who} folds`; break;
      case 'check': line = `${who} checks`; break;
      case 'call': line = `${who} calls`; break;
      case 'bet': line = `${who} bets to ${a.amount}`; break;
      case 'raise': line = `${who} raises to ${a.amount}`; break;
    }
    lines.push(`  ${line} (pot=${rec.potAfter})`);
  }
  return lines.join('\n');
}

// Test helper: a single deterministic check that nothing in the rendered
// prompt looks like an opponent card. Used by tests to assert privacy.
export function promptMentionsAnyCardString(prompt: string, cards: string[]): boolean {
  for (const c of cards) {
    if (prompt.includes(c)) return true;
  }
  return false;
}
