export interface LobbyPlayerView {
  id: string;
  nickname: string;
  avatarUrl: string;
  seat: number;
  ready: boolean;
}

export interface LobbyRoomView {
  id: string;
  code: string;
  ownerPlayerId: string;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED' | 'DISBANDED';
  players: readonly LobbyPlayerView[];
  gameId?: string;
}

export function createLobbyViewModel(room: LobbyRoomView, currentPlayerId: string) {
  const isOwner = room.ownerPlayerId === currentPlayerId;
  const allGuestsReady = room.players.every((player) => player.id === room.ownerPlayerId || player.ready);
  return {
    room,
    isOwner,
    canStart: isOwner && room.status === 'WAITING' && room.players.length >= 3 && room.players.length <= 8 && allGuestsReady,
    canToggleReady: !isOwner && room.status === 'WAITING',
    canKickPlayer(playerId: string): boolean {
      return isOwner && room.status === 'WAITING' && playerId !== currentPlayerId;
    },
  };
}
