import type { PlayerView } from '../shared/view-models';
import type { PlayerAction } from '../shared/types';

const HEADERS = { 'Content-Type': 'application/json' };

export async function fetchWesView(): Promise<PlayerView> {
  const res = await fetch('/api/player/wes/state');
  if (!res.ok) throw new Error(`state ${res.status}`);
  return (await res.json()) as PlayerView;
}

export async function submitWesAction(action: PlayerAction): Promise<PlayerView> {
  const res = await fetch('/api/player/wes/action', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(action),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? 'action failed');
  return body as PlayerView;
}

export async function newHand(): Promise<void> {
  const res = await fetch('/api/new-hand', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'new hand failed');
  }
}

export async function resetSession(): Promise<void> {
  const res = await fetch('/api/reset', { method: 'POST' });
  if (!res.ok) throw new Error('reset failed');
}

export type TrainingStatus = {
  active: boolean;
  startedAt: number | null;
  handCount: number;
};

export async function startTraining(): Promise<TrainingStatus> {
  const res = await fetch('/api/training/start', { method: 'POST' });
  if (!res.ok) throw new Error('start training failed');
  return (await res.json()) as TrainingStatus;
}

export async function endTraining(): Promise<TrainingStatus> {
  const res = await fetch('/api/training/end', { method: 'POST' });
  if (!res.ok) throw new Error('end training failed');
  return (await res.json()) as TrainingStatus;
}

export type ReviewResponse = {
  ok: true;
  markdown: string;
  handCount: number;
  model: string;
  latencyMs: number;
};

export async function requestReview(): Promise<ReviewResponse> {
  const res = await fetch('/api/training/review', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error ?? `review failed (${res.status})`);
  }
  return body as ReviewResponse;
}
