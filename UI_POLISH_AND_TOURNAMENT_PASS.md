# PokerClaw UI Polish and Tournament Pass

## Goal

After the LLM MoltFire upgrade is complete, run a polish pass to make PokerClaw feel much closer to a real poker client, inspired by ClubGG-style table UI.

Focus areas:

1. Cleaner poker-table visual design.
2. Faster betting UX with preselect buttons.
3. Blind levels that increase after a fixed number of hands.
4. Better live-agent status and pacing.
5. Preserve all existing privacy and fair-play boundaries.

---

## Reference Direction

Wes shared a ClubGG table screenshot as the visual reference.

Important elements to borrow, without cloning exactly:

- Dark client chrome.
- Large oval green felt table.
- Seats arranged around table edge.
- Clear player nameplates.
- Stack display in BB, not only raw chips.
- Dealer button chip.
- Blind/ante chip markers.
- Total pot pill in the center.
- Action buttons anchored bottom right.
- Quick bet preset buttons above the primary action buttons.
- Bet input box near quick buttons.
- Tournament header with level, blinds, timer, rank/chips if applicable.
- Subtle card shadows and table depth.

PokerClaw is heads-up only for now, so adapt the layout to two seats rather than six seats.

---

## Visual Design Direction

Make it feel like a compact modern poker client:

- Background: dark textured charcoal, not flat black.
- Table: deep green oval felt with subtle radial lighting and border rails.
- Rail: dark beveled ring with warm/gold edge accents.
- Cards: crisp cream cards with clear suits and ranks.
- Player panels: dark glass/black chips-style panels with stack in bright cyan/blue.
- Active player: glow ring or highlight.
- All-in: red badge.
- Button: gold `D` chip.
- Pot: small black/gold pill in center.
- Action area: bottom right, red/gold buttons inspired by poker client UX.

Avoid generic SaaS dashboard styling. This should feel like a poker table, not a web app form.

---

## Betting UX Requirements

Add fast betting controls for Wes.

### Preflop Presets

When Wes can raise preflop, show raise-to buttons:

- `2.2 BB`
- `2.5 BB`
- `3 BB`
- `Max`

These are raise-to total amounts, not additional chips.

Example at 50/100:

- `2.2 BB` -> raise to 220, rounded to nearest valid chip increment if needed.
- `2.5 BB` -> raise to 250.
- `3 BB` -> raise to 300.

If facing a raise, presets can still be useful but should clamp to legal min/max.

### Postflop Presets

When Wes can bet or raise postflop, show pot-percentage buttons:

- `33%`
- `50%`
- `75%`
- `Pot`
- `Max`

For bets:

- Amount should be total committed this street after the action.
- Since no previous commit when opening a street, bet amount equals desired chip amount.

For raises:

- Use sensible total-commit raise sizing.
- At minimum, produce legal total amount and clamp to min/max.
- Label should be clear if it is `Raise to` amount.

### Bet Input

Add a numeric input for manual amount.

- It should display the total commit-to amount expected by the API.
- It should auto-fill when a preset is clicked.
- It should clamp or warn against illegal values.
- Pressing Enter while input is focused should submit the bet/raise if legal.

### Primary Action Buttons

Always make legal actions obvious:

- Fold
- Check / Call
- Bet / Raise

Button labels should include amount where helpful:

- `Call 250`
- `Raise to 700`
- `Bet 400`

If check is legal, avoid showing disabled call clutter.

---

## Blind Schedule Requirements

Add blind levels that increase after a fixed number of hands.

### MVP Blind Schedule

Use hand-count-based levels, not wall-clock time, for easy local testing.

Default schedule:

| Level | Hands | Small Blind | Big Blind |
|-------|-------|-------------|-----------|
| 1 | 1-10 | 50 | 100 |
| 2 | 11-20 | 75 | 150 |
| 3 | 21-30 | 100 | 200 |
| 4 | 31-40 | 150 | 300 |
| 5 | 41-50 | 200 | 400 |
| 6 | 51-60 | 300 | 600 |
| 7 | 61-70 | 400 | 800 |
| 8 | 71+ | 500 | 1000 |

Make schedule configurable in code or env later, but hardcoded MVP is acceptable.

### Display

Header should show:

- Current level.
- Current blinds.
- Hands until next level.
- Next blinds.

Example:

```text
Level 3 · 100/200 · next in 4 hands
```

### Engine Behavior

- Blinds for each new hand should be determined from the hand number or completed-hand count.
- Existing in-progress hand should not change blinds mid-hand.
- New hand should use the current level's blinds.
- Hand history should show the blinds/level for that hand if practical.

### Tests

Add tests for:

- Hands 1-10 use 50/100.
- Hand 11 uses 75/150.
- Hand 21 uses 100/200.
- Level display data returns correct next level info.
- New hand posts correct blind amounts at each tested level.

---

## Stack Display

Show stacks in both chips and BB, or BB as primary with chips smaller.

Recommended:

```text
Wes
131.5 BB
13,150 chips
```

When blinds increase, BB display should update using current big blind.

---

## Live Agent UX

Add a subtle status display:

- `MoltFire thinking...`
- `MoltFire acted`
- `Waiting for Wes`
- `Agent offline` if relevant.

Avoid showing MoltFire hole cards or strategy rationale during Match Mode.

If LLM mode is enabled, optionally show:

```text
MoltFire: LLM mode
```

Do not expose model internals or private reasoning in the UI.

---

## Hand History Polish

Improve hand history readability:

- Group by street.
- Include pot sizes.
- Use concise poker phrasing.
- Highlight all-in and showdown results.
- Keep hidden cards hidden until hand completion.

Example:

```text
PREFLOP
Wes raises to 400
MoltFire calls 400

FLOP · Pot 800
MoltFire checks
Wes bets 300
MoltFire calls 300
```

---

## Responsive Layout

Primary target is desktop browser on Wes's machine.

- Minimum good size: 1200x800.
- Should still be usable at 1000px width.
- No need for phone layout in this pass.

---

## Accessibility and Usability

- Buttons must have clear labels.
- Color should not be the only indicator of action state.
- Disable illegal buttons rather than letting them submit errors.
- Maintain visible focus states.
- Keep keyboard Enter-to-submit for bet input.

---

## Privacy Boundaries

Do not break any existing privacy behavior.

- Wes UI must not see MoltFire hole cards before showdown.
- MoltFire agent/API must not see Wes hole cards before showdown.
- Debug full-state endpoint remains off by default.
- No live hole cards in logs.
- No full `GameState` returned to normal clients.

Run existing privacy tests after UI/engine changes.

---

## Suggested Implementation Steps

1. Add blind schedule module:
   - `shared/blinds.ts`
   - functions like `getBlindLevelForHand(handId)` and `getBlindDisplay(handId)`.
2. Wire new hand creation to blind schedule.
3. Add blind schedule tests.
4. Add UI header for level/blinds/next level.
5. Refactor action panel:
   - legal action buttons
   - preflop BB presets
   - postflop pot presets
   - manual amount input
6. Restyle table:
   - oval felt
   - player panels
   - pot pill
   - dealer button
   - action area
7. Improve stack display with BB conversion.
8. Polish hand history.
9. Run full gates.

---

## Acceptance Tests

Manual:

- Start app.
- Play at least 12 hands quickly.
- Confirm blinds move from 50/100 to 75/150 on hand 11.
- Confirm UI shows current level and next level countdown.
- Confirm preflop buttons set valid 2.2x / 2.5x / 3x raise amounts.
- Confirm postflop buttons set valid 33% / 50% / 75% / pot bet amounts.
- Confirm Max works and clamps legally.
- Confirm illegal buttons are disabled.
- Confirm agent still acts automatically.
- Confirm no private-card leakage.

Automated:

```bash
npm test
npm run build
```

If available:

```bash
npm run lint
```

---

## Claude Code Prompt

Implement `UI_POLISH_AND_TOURNAMENT_PASS.md` after the LLM MoltFire upgrade is complete.

Prioritize usability over decoration:

1. Blind schedule and tests.
2. Bet preset controls.
3. Stack display in BB.
4. ClubGG-inspired table polish.
5. Agent status polish.
6. Hand history cleanup.

Keep it heads-up only. Do not add multiplayer, accounts, real money, public hosting, or persistent databases. Preserve all privacy and fair-play boundaries.
