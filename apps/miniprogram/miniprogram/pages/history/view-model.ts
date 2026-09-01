import { moneyLabel } from '../round-result/view-model.ts';

export interface HistoryInput {
  gameId: string;
  roomCode: string;
  finishedAt: string;
  playerCount: number;
  cash: number;
  place: number;
}

export function createHistoryModel(history: readonly HistoryInput[]) {
  return history.map((item) => ({
    ...item,
    cashLabel: moneyLabel(item.cash),
    resultLabel: `第 ${item.place} 名`,
    dateLabel: item.finishedAt.slice(0, 10),
  }));
}
