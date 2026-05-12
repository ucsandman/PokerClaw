# Claude Code Prompt for PokerClaw

Use this prompt with Claude Code from the folder:

```text
C:\Projects\PokerClaw
```

---

## Prompt

You are building PokerClaw, a tiny local heads-up Texas Hold'em app where Wes plays against MoltFire.

Read `ARCHITECTURE.md` first and follow it closely.

Build a local-only fake-chip heads-up NLHE poker table with:

- TypeScript.
- Node.js local server.
- Browser UI for Wes.
- Restricted API for MoltFire.
- Trusted dealer server that keeps full game state in memory.
- Authorized view models that prevent hole-card leakage before showdown.

This is not a real-money app and should not include public hosting, payments, accounts, telemetry, or external integrations.

## Strong Requirements

1. Keep full live hand state server-side only.
2. Do not expose full internal `GameState` through normal endpoints.
3. Do not write live hidden hole cards or deck order to logs/files.
4. Add privacy tests proving that:
   - Wes view does not include MoltFire hole cards before showdown.
   - MoltFire view does not include Wes hole cards before showdown.
   - Neither view includes deck order or future board cards.
   - Hole cards can be revealed after showdown.
5. Implement enough legal-action validation that the app cannot accept obvious illegal poker actions.
6. Keep the MVP simple and playable before polishing.

## Recommended Stack

Prefer:

- Vite + React for UI.
- Express for API/server.
- TypeScript shared game engine.
- Vitest for tests.

If you choose a different minimal stack, explain why in `README.md` and keep it simple.

## MVP Features

Build these first:

- New hand creation.
- Heads-up button/blind logic.
- Deck shuffle and deal.
- Wes browser state endpoint.
- MoltFire private state endpoint.
- Wes action endpoint.
- MoltFire action endpoint.
- Legal actions for fold/check/call/bet/raise.
- Street progression: preflop, flop, turn, river, showdown.
- Fold pot award.
- Showdown hand evaluation.
- Stack and pot updates.
- Browser UI with:
  - Wes visible hole cards.
  - MoltFire hidden cards until showdown.
  - board cards.
  - pot.
  - stacks.
  - action history.
  - current actor.
  - legal action buttons.
  - bet/raise amount input.
  - new hand button after completion.

## Implementation Notes

Use explicit domain functions rather than burying poker logic in React components.

Recommended modules:

- `shared/cards.ts`
- `shared/deck.ts`
- `shared/types.ts`
- `shared/game.ts`
- `shared/actions.ts`
- `shared/evaluator.ts`
- `shared/view-models.ts`
- `server/index.ts`
- `server/routes.ts`
- `server/state.ts`
- `src/App.tsx`
- `src/components/*`

For bet and raise amount semantics, use this convention:

- `amount` means the player's total committed amount for the current street after the action.

Document this in code comments and README.

## Tests to Add

At minimum add tests for:

- 52 unique cards in deck.
- New hand deals two cards to each player and no duplicate cards.
- Blinds post correctly.
- Heads-up preflop action starts with button/small blind.
- Heads-up postflop action starts with non-button/big blind.
- Privacy view models do not leak opponent hole cards or deck.
- Out-of-turn action is rejected.
- Illegal check facing a bet is rejected.
- Illegal under-raise is rejected.
- Fold awards pot to remaining player.
- Hand evaluator handles:
  - high card
  - pair
  - two pair
  - trips
  - straight, including wheel
  - flush
  - full house
  - quads
  - straight flush
  - kicker comparison

## UX Direction

Make it simple but fun:

- Dark poker-table feel.
- Clean cards.
- Obvious current-turn indicator.
- Clear result banner.
- No visual clutter.

Do not overbuild.

## Definition of Done

Before you stop, verify:

```bash
npm test
npm run build
```

If lint exists:

```bash
npm run lint
```

Then update `README.md` with:

- How to install.
- How to run.
- Browser URL for Wes.
- API endpoints for MoltFire.
- Example `curl` calls for MoltFire state/action.
- What is intentionally out of scope.

## Important Tone/Project Context

This is a fun local sparring project for Wes and MoltFire. Treat it like a small polished toy, not an enterprise platform.

Prioritize correctness and privacy boundaries over fancy UI. Once the hand loop works cleanly, then make it feel good.
