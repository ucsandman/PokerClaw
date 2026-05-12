import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerAction } from '../shared/types';
import type { PlayerView } from '../shared/view-models';
import {
  endTraining,
  fetchWesView,
  newHand,
  requestReview,
  resetSession,
  startTraining,
  submitWesAction,
} from './api';
import { Board } from './components/Board';
import { PlayerSeat } from './components/PlayerSeat';
import { ActionPanel } from './components/ActionPanel';
import { HandHistory } from './components/HandHistory';
import { ResultBanner } from './components/ResultBanner';
import { TournamentHeader } from './components/TournamentHeader';
import { AgentStatusBadge } from './components/AgentStatusBadge';
import { TrainingControl } from './components/TrainingControl';
import { ReviewModal } from './components/ReviewModal';

const POLL_MS = 800;

export default function App() {
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewMarkdown, setReviewMarkdown] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMeta, setReviewMeta] = useState<{ handCount: number; model: string; latencyMs: number } | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWesView();
      if (!aliveRef.current) return;
      setView(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch failed');
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  const onAction = useCallback(async (a: PlayerAction) => {
    setBusy(true);
    try {
      const next = await submitWesAction(a);
      setView(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'action failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const onNewHand = useCallback(async () => {
    setBusy(true);
    try {
      await newHand();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'new hand failed');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onPlayAgain = useCallback(async () => {
    setBusy(true);
    try {
      await resetSession();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reset failed');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onStartTraining = useCallback(async () => {
    setBusy(true);
    try {
      await startTraining();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'start training failed');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onEndTraining = useCallback(async () => {
    setBusy(true);
    try {
      await endTraining();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'end training failed');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onReview = useCallback(async () => {
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewMarkdown(null);
    setReviewError(null);
    setReviewMeta(null);
    try {
      const result = await requestReview();
      setReviewMarkdown(result.markdown);
      setReviewMeta({
        handCount: result.handCount,
        model: result.model,
        latencyMs: result.latencyMs,
      });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'review failed');
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const onCopyReview = useCallback(() => {
    if (!reviewMarkdown) return;
    navigator.clipboard.writeText(reviewMarkdown).catch(() => undefined);
  }, [reviewMarkdown]);

  if (!view) {
    return <div className="loading">Connecting to dealer…</div>;
  }

  const wesIsButton = view.button === 'wes';
  const wesIsActor = view.currentActor === 'wes';
  const moltIsActor = view.currentActor === 'moltfire';
  const wesWon = view.handComplete && view.result?.winner === 'wes';
  const moltWon = view.handComplete && view.result?.winner === 'moltfire';
  // Match over = the hand finished AND a player can no longer post chips for
  // the next hand. The dealer refuses to start the next hand in that state,
  // so the UI swaps "Deal next hand" for "Play again" (which resets to a
  // fresh starting-stack session).
  const matchOver =
    view.handComplete && (view.you.stack <= 0 || view.opponent.stack <= 0);
  const matchWinner = matchOver
    ? view.you.stack > 0
      ? 'wes'
      : 'moltfire'
    : null;

  return (
    <div className="table-root">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">♠</span>
          <span className="brand-text">PokerClaw</span>
        </div>
        <TournamentHeader handId={view.handId} tournament={view.tournament} />
        <TrainingControl
          status={view.training}
          busy={busy}
          reviewing={reviewLoading}
          onStart={onStartTraining}
          onEnd={onEndTraining}
          onReview={onReview}
        />
        <AgentStatusBadge status={view.agentStatus} moltfireToAct={moltIsActor} />
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="felt-wrap">
        <div className="felt">
          <PlayerSeat
            label="MoltFire"
            player="moltfire"
            seat={view.opponent}
            isCurrentActor={moltIsActor}
            isButton={!wesIsButton}
            isWinner={moltWon}
            bigBlind={view.bigBlind}
          />
          <Board board={view.board} pot={view.pot} street={view.street} />
          <PlayerSeat
            label="Wes"
            player="wes"
            seat={view.you}
            isCurrentActor={wesIsActor}
            isButton={wesIsButton}
            isWinner={wesWon}
            bigBlind={view.bigBlind}
          />
        </div>
      </div>

      <div className="footer">
        {view.handComplete && view.result ? (
          <div className="result-area">
            <ResultBanner result={view.result} />
            {matchOver ? (
              <>
                <div className="match-over">
                  {matchWinner === 'wes'
                    ? 'Match over — you win the match!'
                    : 'Match over — MoltFire wins the match.'}
                </div>
                <button
                  className="primary primary-deal"
                  onClick={onPlayAgain}
                  disabled={busy}
                  autoFocus
                >
                  Play again
                </button>
              </>
            ) : (
              <button className="primary primary-deal" onClick={onNewHand} disabled={busy}>
                Deal next hand
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="turn-indicator">
              {wesIsActor
                ? 'Your action'
                : moltIsActor
                ? 'MoltFire is thinking…'
                : 'Dealing…'}
            </div>
            <ActionPanel
              legal={view.legalActions}
              onAction={onAction}
              disabled={busy || !wesIsActor}
              street={view.street}
              pot={view.pot}
              bigBlind={view.bigBlind}
              myCommittedThisStreet={view.you.committedThisStreet}
            />
          </>
        )}
      </div>

      <details className="history-panel">
        <summary>
          <span className="history-summary-label">Hand history</span>
          <span className="history-summary-hint">{view.actionHistory.length} actions</span>
        </summary>
        <HandHistory history={view.actionHistory} />
      </details>

      <ReviewModal
        open={reviewOpen}
        loading={reviewLoading}
        markdown={reviewMarkdown}
        error={reviewError}
        meta={reviewMeta}
        onClose={() => setReviewOpen(false)}
        onCopy={onCopyReview}
      />
    </div>
  );
}
