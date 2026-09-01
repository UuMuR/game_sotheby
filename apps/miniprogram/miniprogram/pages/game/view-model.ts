import type { AuctionView, CardDefinition, CollectionSeries, PlayerGameView } from '@sotheby/contracts';

import { CARD_BY_ID } from '../../data/cards.ts';
import { resolveCardImage } from '../../services/asset-resolver.ts';

const SERIES_LABELS: Readonly<Record<CollectionSeries, string>> = {
  BLACK: '黑色',
  BLUE: '蓝色',
  GREEN: '绿色',
  YELLOW: '黄色',
  RED: '红色',
};

export interface VisibleCard extends CardDefinition {
  imageUrl: string;
  seriesLabel: string;
  rarityLabel: string;
  selectable?: boolean;
}

export function createVisibleCards(cardIds: readonly string[]): readonly VisibleCard[] {
  return cardIds.map((cardId) => {
    const card = CARD_BY_ID.get(cardId);
    if (!card) throw new Error(`UNKNOWN_CARD:${cardId}`);
    return {
      ...card,
      imageUrl: resolveCardImage(card.id, card.series),
      seriesLabel: SERIES_LABELS[card.series],
      rarityLabel: '★'.repeat(card.rarity),
    };
  });
}

export interface GameAction {
  type: string;
  label: string;
  enabled: boolean;
  minimumAmount?: number;
  requiresAmount?: boolean;
}

export function remainingSeconds(expiresAt: string | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now.getTime()) / 1000));
}

function actionsForAuction(view: PlayerGameView, auction: AuctionView): readonly GameAction[] {
  const cash = view.self.cash;
  switch (auction.type) {
    case 'OPEN':
      return [{ type: 'PLACE_OPEN_BID', label: '出价', minimumAmount: (auction.currentPrice ?? 0) + 1, requiresAmount: true, enabled: cash > (auction.currentPrice ?? 0) }];
    case 'SEQUENTIAL': {
      const acting = auction.actingPlayerId === view.self.id;
      return [
        { type: 'PLACE_SEQUENTIAL_BID', label: '出价', minimumAmount: (auction.currentPrice ?? 0) + 1, requiresAmount: true, enabled: acting && cash > (auction.currentPrice ?? 0) },
        { type: 'PASS_SEQUENTIAL', label: '放弃', enabled: acting },
      ];
    }
    case 'FIXED_PRICE': {
      if (auction.phase === 'PRICING') return [{ type: 'SET_FIXED_PRICE', label: '设置一口价', minimumAmount: 0, requiresAmount: true, enabled: view.self.isHost }];
      const acting = auction.actingPlayerId === view.self.id;
      return [
        { type: 'ACCEPT_FIXED_PRICE', label: '购买', enabled: acting && cash > 0 && cash >= (auction.fixedPrice ?? 0) },
        { type: 'DECLINE_FIXED_PRICE', label: '不要', enabled: acting },
      ];
    }
    case 'SEALED_BID': {
      const submitted = auction.submittedPlayerIds?.includes(view.self.id) ?? false;
      const minimumAmount = auction.stolen ? 0 : 1;
      return [{ type: 'SUBMIT_SEALED_BID', label: auction.stolen ? '秘密报价' : '提交暗标', minimumAmount, requiresAmount: true, enabled: !submitted && (auction.stolen === true || cash > 0) }];
    }
    case 'JOINT': {
      const acting = auction.actingPlayerId === view.self.id;
      if (auction.phase === 'CHOOSING_MODE') {
        return [
          { type: 'CHOOSE_SELF_JOINT_CARD', label: '使用自己的藏品', enabled: acting },
          { type: 'INVITE_JOINT_PLAYER', label: '邀请联合', enabled: acting },
        ];
      }
      return [
        { type: 'ACCEPT_JOINT_INVITE', label: '参与联合', enabled: acting },
        { type: 'DECLINE_JOINT_INVITE', label: '拒绝', enabled: acting },
      ];
    }
  }
}

export function createGamePageModel(view: PlayerGameView, now: Date) {
  return {
    roomId: view.roomId,
    roundLabel: `第 ${view.round} / 4 阶段`,
    hostPlayerId: view.hostPlayerId,
    players: view.players,
    self: view.self,
    auction: view.auction,
    remainingSeconds: remainingSeconds(view.auction?.expiresAt, now),
    actions: view.auction ? actionsForAuction(view, view.auction) : [],
    seriesCounts: view.seriesCounts,
    cumulativeSeriesPrices: view.cumulativeSeriesPrices,
    marketRows: (Object.keys(view.seriesCounts) as CollectionSeries[]).map((series) => ({
      name: series,
      label: SERIES_LABELS[series],
      count: view.seriesCounts[series],
      price: view.cumulativeSeriesPrices[series],
    })),
    handCards: view.self.hand.map((card) => {
      const initial = CARD_BY_ID.get(view.auction?.cardIds[0] ?? '');
      const selectable = view.auction?.type === 'JOINT'
        ? view.auction.actingPlayerId === view.self.id && initial !== undefined && card.series === initial.series && !card.stolen && card.auctionType !== 'JOINT'
        : view.self.isHost && view.auction === null;
      return { ...card, imageUrl: resolveCardImage(card.id, card.series), seriesLabel: SERIES_LABELS[card.series], rarityLabel: '★'.repeat(card.rarity), selectable };
    }),
  };
}
