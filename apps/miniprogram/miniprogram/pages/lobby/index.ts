import { createLobbyViewModel, type LobbyRoomView } from './view-model.ts';
import { platform, rooms, session } from '../../services/runtime.ts';

interface LobbyPageData {
  roomId: string;
  room: LobbyRoomView | null;
  canStart: boolean;
  canToggleReady: boolean;
  ready: boolean;
}

interface LobbyPageContext {
  data: LobbyPageData;
  setData(data: Partial<LobbyPageData>): void;
  setRoom(room: LobbyRoomView): void;
}

Page({
  data: {
    roomId: '',
    room: null as LobbyRoomView | null,
    canStart: false,
    canToggleReady: false,
    ready: false,
  },
  onLoad(this: LobbyPageContext, options: { roomId?: string }) {
    this.setData({ roomId: options.roomId ?? '' });
  },
  setRoom(this: LobbyPageContext, room: LobbyRoomView) {
    const playerId = session.current()?.playerId ?? '';
    const view = createLobbyViewModel(room, playerId);
    this.setData({
      room: view.room,
      canStart: view.canStart,
      canToggleReady: view.canToggleReady,
    });
  },
  async onToggleReady(this: LobbyPageContext) {
    if (!this.data.room || !this.data.canToggleReady) return;
    const ready = !this.data.ready;
    this.setRoom(await rooms.setReady(this.data.room.id, ready));
    this.setData({ ready });
  },
  async onStart(this: LobbyPageContext) {
    if (!this.data.room || !this.data.canStart) return;
    const room = await rooms.start(this.data.room.id);
    if (room.gameId) platform.redirectTo(`/pages/game/index?gameId=${room.gameId}`);
  },
  async onLeave(this: LobbyPageContext) {
    const playerId = session.current()?.playerId;
    if (!this.data.room || !playerId) return;
    await rooms.leave(this.data.room.id, playerId);
    platform.redirectTo('/pages/home/index');
  },
  onShareAppMessage(this: LobbyPageContext) {
    return {
      title: '加入我的《决战苏富比》房间',
      path: `/pages/home/index?room=${this.data.room?.code ?? ''}`,
    };
  },
});

export * from './view-model.ts';
