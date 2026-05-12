# PokerClaw Architecture

## Project Goal

Build a tiny local heads-up Texas Hold'em table where Wes can play against MoltFire.

This is a local-only, fake-chip poker sandbox. It is not for real money, public hosting, gambling operations, or multiplayer beyond one human player and one AI assistant player.

Core idea: a trusted local dealer server manages the full game state, but exposes separate restricted views so Wes cannot see MoltFire's hole cards and MoltFire cannot see Wes's hole cards until showdown.

---

## Core Product Shape

- Local web app running on Wes's machine.
- Browser UI for Wes.
- Restricted HTTP API for MoltFire.
- Server acts as trusted dealer and source of truth.
- Fake chips only.
- Heads-up no-limit Texas Hold'em.
- No accounts, no database, no external services in MVP.

Recommended project folder:

```text
C:\Projects\PokerClaw
```

---

## MVP Scope

### In Scope

- Heads-up NLHE cash-game style table.
- Two fixed seats:
  - `wes`
  - `moltfire`
- Fake stacks, default 100bb each.
- Configurable blinds, default 0.5bb / 1bb or 50 / 100 chips.
- Dealer button alternates each hand.
- Server shuffles and deals cards.
- Server validates legal actions.
- Wes acts through browser buttons.
- MoltFire acts through restricted API endpoint.
- Board and action history visible to both players.
- Hole cards visible only to each player before showdown.
- Showdown reveals both hands.
- Hand result, pot award, and stack updates.
- New hand button after hand completion.
- Basic hand history visible after each completed hand.

### Out of Scope for MVP

- Real money.
- Online hosting.
- User accounts.
- Authentication beyond localhost-only access.
- Multiple human players.
- Tournaments.
- Bounties.
- Rake.
- Side pots beyond simple all-in handling if not needed for MVP.
- Solver integration.
- Bot strategy engine inside the app.
- Persistent database.
- Mobile-first polish.
- Anti-cheat guarantees against someone with filesystem or debugger access.

---

## Trust and Privacy Model

The app is not cryptographic poker. It is a local trusted-dealer setup.

The server has full state. Clients receive only their authorized view.

### Wes View

Wes's browser should receive:

- Wes hole cards.
- Public board.
- Pot.
- Stacks.
- Button/blind positions.
- Current street.
- Action history.
- Whose turn it is.
- Legal actions for Wes when it is his turn.
- MoltFire hole cards only after showdown or hand end reveal.

Wes's browser should not receive:

- MoltFire hole cards before showdown.
- Deck order.
- Burn cards if implemented.
- Any hidden future board cards.

### MoltFire API View

`GET /api/ai/state` should return only:

- MoltFire hole cards.
- Public board.
- Pot.
- Stacks.
- Button/blind positions.
- Current street.
- Action history.
- Whose turn it is.
- Legal actions for MoltFire when it is his turn.
- Wes hole cards only after showdown or hand end reveal.

It must not return:

- Wes hole cards before showdown.
- Deck order.
- Future board cards.
- Full internal state.

### Full State Handling

For the MVP, keep full state in server memory. Do not write full live hand state to an easy-to-read JSON file.

Logging should avoid hidden information during live hands. If hand histories are saved later, only save full hole-card history after the hand is complete.

---

## Recommended Tech Stack

Use a simple TypeScript stack.

Recommended:

- Node.js
- TypeScript
- Express for local server/API
- Vite + React for browser UI
- WebSocket or Server-Sent Events for live UI updates
- Vitest for unit tests
- ESLint/Prettier if convenient

Alternative acceptable MVP:

- Single Express server serving static HTML/JS.
- TypeScript game engine.
- Polling UI instead of WebSocket.

Recommendation: Vite + React + Express + shared TypeScript game engine.

---

## Suggested Directory Structure

```text
C:\Projects\PokerClaw
├── README.md
├── ARCHITECTURE.md
├── CLAUDE_CODE_PROMPT.md
├── package.json
├── tsconfig.json
├── server
│   ├── index.ts
│   ├── routes.ts
│   └── state.ts
├── src
│   ├── App.tsx
│   ├── main.tsx
│   ├── components
│   │   ├── Table.tsx
│   │   ├── PlayerSeat.tsx
│   │   ├── Board.tsx
│   │   ├── ActionPanel.tsx
│   │   └── HandHistory.tsx
│   └── api.ts
├── shared
│   ├── cards.ts
│   ├── deck.ts
│   ├── game.ts
│   ├── actions.ts
│   ├── evaluator.ts
│   ├── types.ts
│   └── view-models.ts
└── tests
    ├── deck.test.ts
    ├── legal-actions.test.ts
    ├── privacy.test.ts
    ├── betting-round.test.ts
    └── showdown.test.ts
```

---

## Core Domain Model

### Card

```ts
type Suit = 'c' | 'd' | 'h' | 's';
type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

type Card = {
  rank: Rank;
  suit: Suit;
};
```

### Player

```ts
type PlayerId = 'wes' | 'moltfire';

type PlayerState = {
  id: PlayerId;
  stack: number;
  committedThisStreet: number;
  committedThisHand: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
};
```

### Game State

```ts
type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

type GameState = {
  handId: number;
  deck: Card[];
  board: Card[];
  players: Record<PlayerId, PlayerState>;
  button: PlayerId;
  smallBlind: number;
  bigBlind: number;
  pot: number;
  street: Street;
  currentActor: PlayerId | null;
  minRaiseTo: number;
  lastAggressor: PlayerId | null;
  actionHistory: ActionRecord[];
  handComplete: boolean;
  result?: HandResult;
};
```

### Actions

```ts
type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; amount: number };
```

Important convention: for `bet` and `raise`, `amount` should mean total amount committed for this street after the action, not additional chips, unless clearly documented otherwise.

---

## API Design

### Browser/UI Endpoints

#### `GET /api/player/wes/state`

Returns Wes-authorized view.

#### `POST /api/player/wes/action`

Body:

```json
{
  "type": "call"
}
```

or

```json
{
  "type": "raise",
  "amount": 300
}
```

Server validates:

- It is Wes's turn.
- Action is legal.
- Amount is legal.
- Player has enough chips or action is all-in.

#### `POST /api/new-hand`

Starts next hand only if current hand is complete or no hand exists.

### MoltFire API Endpoints

#### `GET /api/ai/state`

Returns MoltFire-authorized view only.

#### `POST /api/ai/action`

Same action shape as Wes endpoint, but validates it is MoltFire's turn.

### Optional Debug Endpoint

Avoid full-state debug endpoints in normal use.

If a debug endpoint is added for development, protect it behind an explicit environment variable like:

```text
POKERCLAW_DEBUG_FULL_STATE=1
```

It should be off by default.

---

## View Model Privacy Tests

Privacy tests are mandatory.

At minimum:

1. Before showdown, Wes view includes Wes hole cards but not MoltFire hole cards.
2. Before showdown, MoltFire view includes MoltFire hole cards but not Wes hole cards.
3. Neither view includes deck order.
4. Neither view includes future board cards.
5. After showdown, both views may include revealed hole cards.

These tests should fail if someone accidentally returns `GameState` directly from an API.

---

## Game Flow

### New Hand

1. Alternate button.
2. Create shuffled 52-card deck.
3. Deal two hole cards to each player.
4. Post blinds.
5. Set current actor.
   - Heads-up preflop: small blind/button acts first.
   - Postflop: big blind/non-button acts first.
6. Set street to `preflop`.
7. Expose authorized state views.

### Betting Round

A betting round ends when:

- All non-folded, non-all-in players have matched the current bet, and
- Action has returned appropriately after the last aggressive action, or
- Everyone checked when no bet exists, or
- Only one player remains not folded.

For MVP heads-up, keep this logic explicit and well-tested.

### Street Advancement

- Preflop complete -> deal flop, three board cards.
- Flop complete -> deal turn, one card.
- Turn complete -> deal river, one card.
- River complete -> showdown.
- Fold at any time -> award pot to remaining player and complete hand.

Burn cards are optional in MVP. If implemented, keep them hidden.

### Showdown

- Evaluate best five-card hand from seven cards for each player.
- Compare hands.
- Award pot.
- Reveal cards.
- Mark hand complete.

For MVP, a straightforward evaluator is fine. It must correctly handle:

- high card
- pair
- two pair
- trips
- straight, including wheel A-2-3-4-5
- flush
- full house
- quads
- straight flush
- ties/kickers

If implementing evaluator from scratch is too slow, use a small trusted npm package, but prefer avoiding heavy dependencies.

---

## UI Requirements

The UI can be simple but should be pleasant enough to play.

Required UI sections:

- Table area.
- Wes seat with visible hole cards.
- MoltFire seat with hidden cards until showdown.
- Board cards.
- Pot size.
- Stack sizes.
- Dealer button indicator.
- Current actor indicator.
- Action history.
- Action buttons:
  - Fold
  - Check
  - Call
  - Bet/Raise amount input
- New hand button after completion.
- Result banner after hand completion.

Nice style direction:

- Dark felt table.
- Clear card visuals.
- Minimal clutter.
- Fast local interaction.

---

## MoltFire Play Loop

MoltFire will use API calls rather than browser access.

Expected flow:

1. Wes starts app locally.
2. Wes opens browser UI.
3. When it is MoltFire's turn, Wes tells MoltFire or the UI indicates it.
4. MoltFire calls `GET /api/ai/state`.
5. MoltFire decides action using only returned authorized info.
6. MoltFire calls `POST /api/ai/action`.
7. UI updates.

Future option: add a button in UI that says “Ask MoltFire to act” if OpenClaw integration is ever added. Do not build that in MVP.

---

## Security and Safety Boundaries

- Localhost only.
- Fake chips only.
- No real-money functionality.
- No public deployment assumptions.
- No external account integrations.
- No personal data.
- No hidden telemetry.
- No writing live hidden hand state to logs.

This is a friendly local sparring table, not a gambling product.

---

## Testing Plan

Minimum tests:

- Deck has 52 unique cards.
- Shuffle/deal produces valid private hands and board.
- Blinds post correctly.
- Heads-up preflop actor is correct.
- Postflop actor is correct.
- Legal actions are correct for check/call/bet/raise/fold spots.
- Illegal out-of-turn action is rejected.
- Illegal bet sizing is rejected.
- Fold awards pot correctly.
- Showdown hand evaluator ranks hands correctly.
- Privacy view functions do not leak opponent hole cards or deck.

Run before declaring MVP complete:

```bash
npm test
npm run build
```

If lint is configured:

```bash
npm run lint
```

---

## Build Milestones

### Milestone 1: Engine Skeleton

- Types.
- Deck/shuffle/deal.
- New hand.
- Blind posting.
- Authorized view model functions.
- Privacy tests.

### Milestone 2: Betting Logic

- Legal actions.
- Apply actions.
- Street transitions.
- Fold completion.
- Tests for common heads-up lines.

### Milestone 3: Showdown

- Hand evaluator.
- Pot award.
- Reveal logic.
- Tests.

### Milestone 4: API

- Express server.
- Wes state/action endpoints.
- MoltFire state/action endpoints.
- New hand endpoint.
- Error handling.

### Milestone 5: UI

- Basic table.
- Cards, board, pot, stacks.
- Action controls.
- Result display.
- Live refresh via polling, SSE, or WebSocket.

### Milestone 6: Polish

- README instructions.
- Nice styling.
- Hand history.
- Final verification.

---

## Definition of Done for MVP

MVP is done when:

- Wes can run one command to start the app.
- Wes can open local browser UI.
- A new HU hand can be played from start to finish.
- MoltFire can query private state and act through API.
- Hole cards are not leaked before showdown.
- Pot and stacks update correctly.
- Showdown determines winner correctly.
- Tests cover privacy, legal actions, and showdown basics.
- `npm test` passes.
- `npm run build` passes.
