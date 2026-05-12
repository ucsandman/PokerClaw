import type { TrainingStatusPublic } from '../../shared/view-models';

type Props = {
  status?: TrainingStatusPublic;
  busy: boolean;
  reviewing: boolean;
  onStart: () => void;
  onEnd: () => void;
  onReview: () => void;
};

// Small header control for the training session feature. Three visual states:
//   1. Inactive, no buffered hands  → "Start training"
//   2. Active                       → "End training (N hands)"
//   3. Inactive, buffer has hands   → "Review session (N hands)" plus a
//                                     secondary "Discard & start over" affordance
export function TrainingControl({ status, busy, reviewing, onStart, onEnd, onReview }: Props) {
  const active = status?.active === true;
  const count = status?.handCount ?? 0;

  if (active) {
    return (
      <button
        className="training-btn training-btn-active"
        onClick={onEnd}
        disabled={busy}
        title="Stop capturing hands and prepare the review"
      >
        <span className="training-dot training-dot-active" />
        End training ({count})
      </button>
    );
  }
  if (count > 0) {
    return (
      <div className="training-controls-row">
        <button
          className="training-btn training-btn-review"
          onClick={onReview}
          disabled={busy || reviewing}
          title="Generate a coaching review of the captured session"
        >
          {reviewing ? 'Reviewing…' : `Review session (${count})`}
        </button>
        <button
          className="training-btn training-btn-restart"
          onClick={onStart}
          disabled={busy || reviewing}
          title="Discard the captured session and start a fresh training buffer"
        >
          Restart
        </button>
      </div>
    );
  }
  return (
    <button
      className="training-btn"
      onClick={onStart}
      disabled={busy}
      title="Start capturing hands for a coaching review"
    >
      Start training
    </button>
  );
}
