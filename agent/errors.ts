// Helpers for classifying errors returned by the dealer's action endpoint.

// Server messages that mean "the decision spot you posted to no longer exists".
// These come from shared/actions.ts (validateAction) and shared/game.ts. When
// we see one of these we MUST stop retrying for the current decision key —
// otherwise we spam the dealer with stale posts every poll cycle.
const STALE_MESSAGES = [
  'Not your turn',
  'Hand is complete',
  'Cannot check',
  'Cannot fold',
  'Cannot call',
  'Cannot bet',
  'Cannot raise',
  'No legal action',
];

export function isStaleActionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return STALE_MESSAGES.some((needle) => msg.includes(needle));
}
