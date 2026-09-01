import type { AuctionView } from '@sotheby/contracts';

import type { ClientGameCommand } from '../../services/game-commands.ts';
import type { GameAction } from './view-model.ts';

export function actionToCommand(
  action: Pick<GameAction, 'type' | 'minimumAmount'>,
  input: { amount?: number; cardId?: string } = {},
): ClientGameCommand {
  switch (action.type) {
    case 'PLACE_OPEN_BID':
      return { type: 'PLACE_OPEN_BID', payload: { amount: input.amount ?? action.minimumAmount ?? 1 } };
    case 'PLACE_SEQUENTIAL_BID':
      return { type: 'PLACE_SEQUENTIAL_BID', payload: { amount: input.amount ?? action.minimumAmount ?? 1 } };
    case 'PASS_SEQUENTIAL':
      return { type: 'PASS_SEQUENTIAL', payload: {} };
    case 'SET_FIXED_PRICE':
      return { type: 'SET_FIXED_PRICE', payload: { amount: input.amount ?? 0 } };
    case 'ACCEPT_FIXED_PRICE':
      return { type: 'RESPOND_FIXED_PRICE', payload: { accept: true } };
    case 'DECLINE_FIXED_PRICE':
      return { type: 'RESPOND_FIXED_PRICE', payload: { accept: false } };
    case 'SUBMIT_SEALED_BID':
      return { type: 'SUBMIT_SEALED_BID', payload: { amount: input.amount ?? action.minimumAmount ?? 0 } };
    case 'CHOOSE_SELF_JOINT_CARD':
      if (!input.cardId) throw new Error('CARD_REQUIRED');
      return { type: 'CHOOSE_SELF_JOINT_CARD', payload: { cardId: input.cardId } };
    case 'INVITE_JOINT_PLAYER':
      return { type: 'INVITE_JOINT_PLAYER', payload: {} };
    case 'ACCEPT_JOINT_INVITE':
      if (!input.cardId) throw new Error('CARD_REQUIRED');
      return { type: 'RESPOND_JOINT_INVITE', payload: { accept: true, cardId: input.cardId } };
    case 'DECLINE_JOINT_INVITE':
      return { type: 'RESPOND_JOINT_INVITE', payload: { accept: false } };
    default:
      throw new Error(`UNSUPPORTED_ACTION:${action.type}`);
  }
}


export function commandForCardSelection(
  auction: AuctionView | null,
  cardId: string,
): ClientGameCommand {
  if (auction?.type === 'JOINT' && auction.phase === 'CHOOSING_MODE') {
    return { type: 'CHOOSE_SELF_JOINT_CARD', payload: { cardId } };
  }
  if (auction?.type === 'JOINT' && auction.phase === 'INVITING') {
    return { type: 'RESPOND_JOINT_INVITE', payload: { accept: true, cardId } };
  }
  return { type: 'PLAY_CARD', payload: { cardId } };
}
