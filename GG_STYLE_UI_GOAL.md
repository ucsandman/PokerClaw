# PokerClaw `/goal` Test: GG-Style Legit Poker Client UI

## Goal

Use Claude Code `/goal` to upgrade PokerClaw’s UI from “working prototype” to a much more legitimate heads-up poker client inspired by GG/ClubGG-style tables.

This pass is primarily visual and UX polish. Preserve all existing game logic, LLM agent behavior, privacy boundaries, tests, and fake-chip/local-only scope.

---

## Reference Direction

Wes wants the UI to look closer to GG/ClubGG:

- Dark premium poker-client shell.
- Large oval green felt table with depth.
- Gold/bronze rail trim.
- Player avatars and nameplates.
- Visible chip stacks and chip icons.
- Pot chips in the center.
- Cleaner card presentation.
- More polished action buttons and bet presets.
- Tournament/blind info header.
- More convincing showdown/result panel.
- Less “web app demo”, more “actual poker client”.

Do not copy GG assets or branding. Use the reference only as visual inspiration.

---

## Hard Constraints

Do not break these:

1. Local-only fake-chip app.
2. No real money, accounts, payments, public hosting, telemetry, or external services beyond configured LLM agent.
3. Wes UI must not see MoltFire hole cards before showdown.
4. MoltFire agent/API must not see Wes hole cards before showdown.
5. Debug full-state endpoint remains off by default.
6. No live hole cards in logs.
7. Existing agent flow keeps working.
8. Existing tests keep passing.

---

## Visual Direction

Create a premium dark poker-client aesthetic.

### App Shell

- Full-screen dark background, not flat black.
- Add subtle noise/texture or radial gradients.
- Header should look like poker software chrome, not a SaaS navbar.
- Use compact uppercase labels and high-contrast numbers.
- Keep `POKERCLAW` branding, but make it feel like a real client logo.

### Table

- Large oval table centered on screen.
- Deep green felt with subtle texture/radial lighting.
- Dark rail around table.
- Bronze/gold outer rim.
- Soft shadow below table.
- Seats should visually attach to table edges.

### Cards

- Larger, cleaner cards.
- Cream/off-white card face.
- Clear rank/suit typography.
- Red suits clearly red, black suits clearly dark.
- Card backs for hidden MoltFire cards before reveal.
- Subtle shadow and slight rounded corners.

### Chips

Add chip visuals.

Required:

- Pot area should include a small stack/pile of chips or chip icon next to pot amount.
- Player stack panels should include chip icon(s) or small stack visual.
- Bet/committed amount should appear near the player as chips when they have committed this street.

This can be CSS-only: circles/ellipses with colored bands are fine. Do not import external image assets unless already local and appropriate.

### Avatars

Add avatars for both players.

Required:

- Wes avatar placeholder, human/player style.
- MoltFire avatar placeholder, fiery/AI style.
- Avatars should sit in or beside each nameplate.
- If no image assets are available, use polished CSS avatar circles:
  - Wes: dark/blue/gold human initials/avatar, e.g. `W`.
  - MoltFire: ember/orange/red glow, e.g. `🔥` or `MF`.

Optional if easy:

- Support local image paths later, but do not require it for this pass.

### Player Panels

Each player panel should show:

- Avatar.
- Name.
- Stack in BB.
- Stack in chips.
- Current committed amount if any.
- Dealer button if applicable.
- All-in badge if applicable.
- Active-turn glow/highlight.
- Winner highlight after hand complete.

### Header

Header should show:

- PokerClaw logo/name.
- Current level.
- Current blinds.
- Next level/blinds and hands remaining.
- Current hand number.
- Agent status: LLM/rules/offline, provider/model if available.

Make this compact and premium.

### Center Table Area

Should show:

- Pot chip/pill centered above board.
- Board cards centered.
- Optional street label.
- Subtle animation or highlight when pot/action changes, if simple.

### Action Area

Make controls feel like poker-client controls.

Must include:

- Fold button.
- Check/Call button with amount when applicable.
- Bet/Raise button with amount when applicable.
- Manual amount input.
- Quick buttons:
  - Preflop: `2.2 BB`, `2.5 BB`, `3 BB`, `Max`.
  - Postflop: `33%`, `50%`, `75%`, `Pot`, `Max`.

Make legal actions obvious and disabled actions visually distinct.

### Result Panel

When hand completes:

- Show winner and pot amount in a premium banner.
- Show reason: fold/showdown.
- Show hand categories when available.
- Add a strong gold “Deal next hand” button.

### Hand History

Make hand history more readable and less raw.

- Use a dark panel with border.
- Group or label streets if practical.
- Use bullet/action rows.
- Keep it compact.
- No hidden card leaks.

---

## Interaction/UX Requirements

- UI should feel usable at 1200x800 and above.
- No phone/mobile perfection needed.
- Preserve keyboard Enter on bet input if already present.
- Preset buttons should populate the amount field and/or submit only when explicit existing behavior says so. Prefer populate first unless current UX already submits directly.
- Bet/raise amount must follow existing API convention: amount is total committed this street after action.
- Clamp presets to legal min/max.
- Avoid confusing disabled buttons.

---

## Suggested Implementation Areas

Likely files:

- `src/App.tsx`
- `src/components/*`
- `src/styles.css` or equivalent CSS files
- any existing action panel/table/card components

Prefer improving existing components over rewriting the whole app.

Recommended additions:

- `Avatar` component.
- `ChipStack` or `ChipIcon` component.
- `PlayerPanel` polish.
- `PotDisplay` polish.
- `ActionControls` polish.

---

## Acceptance Criteria

Claude Code should stop only when all of these are true:

1. PokerClaw UI has a visibly more premium GG/ClubGG-inspired poker-client look.
2. Both players have avatars.
3. Chips are visually represented in pot and player/bet areas.
4. Table has oval felt, dark rail, and gold/bronze trim/depth.
5. Header shows level, blinds, next level, hand number, and agent status.
6. Action panel has polished buttons and quick bet presets.
7. Result panel and Deal Next Hand button look intentional/premium.
8. Hand history remains readable and does not leak hidden cards.
9. Game still works with the live MoltFire agent.
10. No privacy boundaries regress.
11. `npm test` passes.
12. `npm run build` passes.

If blocked by missing design assets, use CSS-only avatars/chips and continue. Do not stop just because no images exist.

---

## Validation Commands

Run:

```bash
npm test
npm run build
```

If available:

```bash
npm run lint
```

Also manually inspect the UI by running:

```bash
npm run dev
```

If browser/screenshot tooling is available, take or inspect a screenshot and compare against this brief.

---

## `/goal` Prompt to Paste into Claude Code

```text
/goal Implement GG_STYLE_UI_GOAL.md as a UI polish pass for PokerClaw. Preserve all privacy boundaries, live-agent behavior, fake-chip/local-only scope, and existing game logic. Stop only when the UI has a visibly more premium GG/ClubGG-inspired poker-client look with avatars for both players, chip visuals for pot/stacks/bets, a polished oval felt table with dark rail and gold/bronze trim, a compact tournament header, polished action controls with preflop and postflop bet presets, a better result panel, readable hand history, and npm test plus npm run build both pass. If blocked by missing image assets, use CSS-only avatars/chips and continue. If blocked by a real technical issue, report the exact blocker instead of weakening the goal.
```

---

## Optional Stretch Goals

Only do these if core acceptance criteria are complete and tests/build pass:

- Subtle card entrance animations.
- Pot update pulse animation.
- Active player timer ring.
- Sound toggle placeholder, no actual sounds required.
- Local avatar image support through simple constants.
- Theme variables for future skinning.

Do not let stretch goals break the completion condition.
