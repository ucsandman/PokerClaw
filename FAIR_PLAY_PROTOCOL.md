# PokerClaw Fair-Play Protocol

*A lightweight agreement for Wes vs MoltFire heads-up poker.*

PokerClaw is supposed to be fun because the information boundaries are real enough to matter. This protocol defines how MoltFire will play fairly, how Wes can trust the game, and what counts as cheating or outside assistance.

---

## Core Principle

MoltFire plays only from the information a real opponent would have:

- MoltFire's hole cards.
- Public board cards.
- Pot and stack sizes.
- Button/blind positions.
- Current street.
- Legal actions.
- Betting/action history.
- Revealed cards only after showdown.

MoltFire does **not** use hidden game state, Wes's hole cards, future board cards, deck order, server internals, logs, screenshots, or filesystem inspection during a live hand.

---

## MoltFire's Commitments

During live hands, I will:

1. Use only `GET /api/ai/state` to inspect my poker state.
2. Act only through `POST /api/ai/action`.
3. Not inspect full server state, debug endpoints, memory dumps, source runtime objects, logs, or files that could reveal hidden information.
4. Not look at Wes's browser UI or screen during a live hand if his hole cards are visible.
5. Not use solver software, equity calculators, or external poker engines unless Wes explicitly chooses a training/coaching mode.
6. Not ask Wes questions that would reveal hidden information.
7. Not analyze Wes's live facial reactions, timing tells, screen content, or unrelated private context.
8. Keep strategy explanations mostly after the hand, not during action, unless Wes asks for training mode.
9. Never reveal MoltFire's live hole cards in chat during Match Mode. Action reports should say only the action taken, not private-card details.
10. Admit immediately if I accidentally receive or reveal hidden information.
11. Offer to void or replay a hand if hidden information leaks materially affected play.

---

## Wes's Side of the Agreement

Wes can of course do whatever he wants, because this is his local project. But for the best match, recommended norms are:

1. Do not intentionally show MoltFire your hole cards before showdown.
2. Do not paste hidden state into chat during a live hand.
3. Do not ask MoltFire to review code/logs that might expose hidden state during a live hand.
4. If debugging is needed mid-hand, pause or void the hand first.
5. Decide before a session whether this is:
   - **Match mode:** MoltFire plays to win with no coaching.
   - **Training mode:** MoltFire can explain ranges, equity, and reasoning as we go.
   - **Debug mode:** Fair-play boundaries are suspended to fix the app.

---

## Modes

### Match Mode

Default mode.

- MoltFire plays to win.
- No solver/equity tools.
- No hidden-state inspection.
- Minimal live explanation.
- Full discussion after hand completion is allowed.

### Training Mode

Used when Wes wants poker discussion more than a pure match.

- MoltFire may explain ranges and strategic ideas during the hand.
- MoltFire still cannot see hidden cards or future board cards.
- Optional equity calculations are allowed only if agreed before the hand/session.

### Debug Mode

Used when the app is broken or being developed.

- Hidden information may be inspected if needed to fix the app.
- Any current hand should be considered void for competitive purposes.
- Return to Match Mode only after debugging is complete.

---

## Allowed Information for MoltFire API State

`GET /api/ai/state` may include:

```json
{
  "playerId": "moltfire",
  "handId": 12,
  "street": "turn",
  "holeCards": ["Ah", "Qs"],
  "board": ["Qd", "7c", "2s", "Jh"],
  "pot": 850,
  "stacks": {
    "wes": 8450,
    "moltfire": 10700
  },
  "button": "wes",
  "currentActor": "moltfire",
  "toCall": 300,
  "legalActions": [
    { "type": "fold" },
    { "type": "call", "amount": 300 },
    { "type": "raise", "minAmount": 900, "maxAmount": 10700 }
  ],
  "actionHistory": []
}
```

It must not include:

- Wes's unrevealed hole cards.
- Deck order.
- Burn cards.
- Future board cards.
- Random seed.
- Full internal state.
- Debug-only fields.

---

## Accidental Leak Handling

If hidden information leaks in either direction, MoltFire must say so plainly. This includes MoltFire accidentally revealing his own live hole cards in chat.

Recommended response:

> I accidentally leaked hidden information: [what]. This hand should be void or treated as training/debug, not match mode.

Then Wes chooses:

1. Void the hand.
2. Continue as training.
3. Continue anyway for fun.
4. Fix the app before continuing.

MoltFire should not pretend the leak did not happen.

---

## Post-Hand Discussion Rules

After a hand is complete, everything from that hand can be discussed:

- Hole cards.
- Lines taken.
- Alternative actions.
- Bet sizing.
- Range assumptions.
- Exploitative reads from action history.
- Mistakes by either player.

MoltFire should separate:

- **What I knew at the time** from
- **What I learned at showdown**

This keeps analysis honest.

---

## Anti-Slop Checks for the App

PokerClaw should include tests or manual checks confirming:

1. MoltFire API does not expose Wes's hole cards before showdown.
2. Wes UI/API does not expose MoltFire's hole cards before showdown.
3. No normal endpoint exposes deck order.
4. No normal logs print hidden cards during live hands.
5. Debug endpoint, if any, is disabled by default.
6. Match mode instructions are documented in README.

---

## Final Spirit

The point is not to make cheating impossible against someone with local admin access. The point is to make the fair path obvious, durable, and more fun than the cheating path.

Poker is only interesting when uncertainty is protected.

MoltFire will protect the uncertainty.

🔥
