import type { AuctionView, PlayerGameView } from '@sotheby/contracts';

export interface GameAction {
  type: string;
  label: string;
  enabled: boolean;
  minimumAmount?: number;
}

export function remainingSeconds(expiresAt: string | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now.getTime()) / 1000));
}

function actionsForAuction(view: PlayerGameView, auction: AuctionView): readonly GameAction[] {
  const cash = view.self.cash;
  switch (auction.type) {
    case 'OPEN':
      return [{ type: 'PLACE_OPEN_BID', label: '出价', minimumAmount: (auction.currentPrice ?? 0) + 1, enabled: cash > (auction.currentPrice ?? 0) }];
    case 'SEQUENTIAL': {
      const acting = auction.actingPlayerId === view.self.id;
      return [
        { type: 'PLACE_SEQUENTIAL_BID', label: '出价', minimumAmount: (auction.currentPrice ?? 0) + 1, enabled: acting && cash > (auction.currentPrice ?? 0) },
        { type: 'PASS_SEQUENTIAL', label: '放弃', enabled: acting },
      ];
    }
    case 'FIXED_PRICE': {
      if (auction.phase === 'PRICING') return [{ type: 'SET_FIXED_PRICE', label: '设置一口价', minimumAmount: 0, enabled: view.self.isHost }];
      const acting = auction.actingPlayerId === view.self.id;
      return [
        { type: 'ACCEPT_FIXED_PRICE', label: '购买', enabled: acting && cash > 0 && cash >= (auction.fixedPrice ?? 0) },
        { type: 'DECLINE_FIXED_PRICE', label: '不要', enabled: acting },
      ];
    }
    case 'SEALED_BID': {
      const submitted = auction.submittedPlayerIds?.includes(view.self.id) ?? false;
      const minimumAmount = auction.stolen ? 0 : 1;
      return [{ type: 'SUBMIT_SEALED_BID', label: auction.stolen ? '秘密报价' : '提交暗标', minimumAmount, enabled: !submitted && (auction.stolen === true || cash > 0) }];
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
  };
}
