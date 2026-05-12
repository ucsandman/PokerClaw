import type { Card, Street } from '../../shared/types';
import { CardView } from './CardView';
import { ChipStack } from './ChipStack';
import { fmtBB } from '../fmt';

const STREET_LABEL: Record<Street, string> = {
  preflop: 'PREFLOP',
  flop: 'FLOP',
  turn: 'TURN',
  river: 'RIVER',
  showdown: 'SHOWDOWN',
  complete: 'HAND COMPLETE',
};

type Props = {
  board: Card[];
  pot: number;
  street: Street;
  bigBlind: number;
};

export function Board({ board, pot, street, bigBlind }: Props) {
  const slots: Array<Card | null> = [...board];
  while (slots.length < 5) slots.push(null);
  return (
    <div className="board">
      <div className="board-pot">
        <ChipStack amount={pot} variant="pot" />
        <div className="pot-pill">
          <span className="pot-label">POT</span>
          <span className="pot-value">{fmtBB(pot, bigBlind)}</span>
        </div>
      </div>
      <div className="board-cards">
        {slots.map((c, i) =>
          c ? <CardView key={i} card={c} /> : <div key={i} className="card card-empty" />,
        )}
      </div>
      <div className="board-street">{STREET_LABEL[street]}</div>
    </div>
  );
}
