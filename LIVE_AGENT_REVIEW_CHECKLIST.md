# PokerClaw Live Agent Review Checklist

Use this after Claude Code implements the live MoltFire agent.

Goal: make sure the agent feels live without breaking fair play, leaking hidden info, or double-acting.

---

## 1. Process Boundary

- [ ] Agent is a separate runtime/process or module that talks through HTTP client functions.
- [ ] Agent does not import server `GameState` directly.
- [ ] Agent does not access server internals, files, logs, or debug endpoints.
- [ ] Agent only reads `GET /api/ai/state`.
- [ ] Agent only writes `POST /api/ai/action`.

Pass condition: deleting access to server internals would not break agent decision-making.

---

## 2. Privacy

- [ ] Agent state type does not include opponent hole cards before showdown.
- [ ] Agent state type does not include deck order.
- [ ] Agent state type does not include future board cards.
- [ ] Agent logs do not print MoltFire live hole cards in Match Mode.
- [ ] Agent logs do not print Wes hole cards before showdown.
- [ ] Agent LLM prompt, if used, contains only authorized state.
- [ ] Agent LLM response is not logged with hidden card details.

Manual test:

1. Start a hand.
2. Confirm it is MoltFire's turn.
3. Watch terminal logs.
4. No private cards should appear.

---

## 3. Duplicate Action Protection

- [ ] Agent builds a decision key from hand/street/action count/current actor/current bet/pot.
- [ ] Agent stores the last acted decision key.
- [ ] Agent does not act again if the same decision key repeats.
- [ ] Agent handles repeated poll responses safely.
- [ ] Agent does not act after `handComplete === true`.
- [ ] Agent does not act when `currentActor !== "moltfire"`.

Stress test:

- Lower poll interval to 100ms briefly.
- Confirm agent still posts only one action per decision point.

---

## 4. Legal Action Validation

- [ ] Agent only chooses from legal actions.
- [ ] Before posting, selected action is validated locally against `legalActions`.
- [ ] Invalid LLM output is rejected, not posted blindly.
- [ ] Fallback action is safe and legal.
- [ ] Agent handles all common legal states:
  - [ ] check available
  - [ ] facing bet, can call/fold/raise
  - [ ] can open bet
  - [ ] all-in max raise/call spots

Pass condition: server should reject illegal actions too, but agent should not regularly send them.

---

## 5. Runtime UX

- [ ] One command starts the agent.
- [ ] README documents exact command.
- [ ] `.env.example` exists if env vars are needed.
- [ ] Missing API key produces a clear error or falls back to rule-based mode.
- [ ] Agent logs are concise and safe.
- [ ] Agent indicates when it is waiting, thinking, acting, or paused.
- [ ] Agent can be stopped cleanly with Ctrl+C.

Good log example:

```text
[agent] waiting: actor=wes hand=4 street=flop
[agent] thinking: hand=4 street=turn decision=9
[agent] acted: hand=4 street=turn action=call
```

Bad log example:

```text
[agent] I have AhQs and should c-bet...
```

---

## 6. Strategy Behavior

For rule-based MVP:

- [ ] Does not always fold.
- [ ] Does not always call.
- [ ] Uses position/opening logic preflop.
- [ ] Can check back sometimes.
- [ ] Can bet sometimes.
- [ ] Folds obvious trash to pressure sometimes.
- [ ] Avoids absurd oversized bets unless all-in logic is intentional.

For LLM mode:

- [ ] Prompt includes fair-play protocol.
- [ ] Prompt includes action schema.
- [ ] Prompt tells model not to reveal hole cards in table talk.
- [ ] Prompt tells model to output strict JSON.
- [ ] JSON parsing is robust.
- [ ] Bad JSON does not crash the process.
- [ ] Model cannot choose an illegal action just because it says so.

---

## 7. Match / Training / Debug Modes

- [ ] Match Mode is default.
- [ ] Match Mode avoids live strategic explanations.
- [ ] Match Mode does not reveal MoltFire hole cards in logs/table talk.
- [ ] Training Mode can include more explanation if enabled.
- [ ] Debug Mode clearly marks hands as non-competitive.
- [ ] Mode is visible in logs or config.

---

## 8. Tests

Expected tests or equivalent verification:

- [ ] Agent does not act when it is Wes's turn.
- [ ] Agent acts once when it is MoltFire's turn.
- [ ] Duplicate decision key prevents double action.
- [ ] Invalid action from strategy adapter is rejected.
- [ ] Fallback action is legal.
- [ ] Prompt builder excludes opponent hidden cards.
- [ ] Safe logger redacts live hole cards.
- [ ] Existing 48+ game/privacy tests still pass.

Run:

```bash
npm test
npm run build
```

If available:

```bash
npm run lint
```

---

## 9. Live Table Acceptance Test

1. Start server/UI.
2. Start agent.
3. Open browser.
4. Start new hand.
5. Wes acts.
6. Agent should respond automatically within a few seconds when it is MoltFire's turn.
7. Play at least five hands.
8. Confirm:
   - no manual Telegram prompts needed
   - no duplicate actions
   - no private-card leakage in terminal
   - no illegal action errors
   - no crashes

---

## 10. Final Acceptance

Live-agent upgrade is acceptable when:

- It feels like playing a live opponent rather than a chat relay.
- It preserves the no-cheat API boundary.
- It is easy to start and stop.
- It fails safely.
- Wes can still use this chat for review and post-hand analysis without slowing down play.
