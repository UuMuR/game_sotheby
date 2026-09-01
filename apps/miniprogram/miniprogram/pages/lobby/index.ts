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
  refreshTimer?: number;
}

Page({
  data: {
    roomId: '',
    room: null as LobbyRoomView | null,
    canStart: false,
    canToggleReady: false,
    ready: false,
  },
  async onLoad(this: LobbyPageContext, options: { roomId?: string }) {
    const roomId = options.roomId ?? '';
    this.setData({ roomId });
    if (roomId) this.setRoom(await rooms.get(roomId));
  },
  async onShow(this: LobbyPageContext) {
    if (!this.data.roomId) return;
    this.setRoom(await rooms.get(this.data.roomId));
    this.refreshTimer = setInterval(async () => {
      try {
        const room = await rooms.get(this.data.roomId);
        this.setRoom(room);
        if (room.status === 'IN_GAME' && room.gameId) {
          clearInterval(this.refreshTimer);
          platform.redirectTo(`/pages/game/index?gameId=${room.gameId}`);
        }
      } catch {
        clearInterval(this.refreshTimer);
      }
    }, 1000) as unknown as number;
  },
  onHide(this: LobbyPageContext) {
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
  },
  onUnload(this: LobbyPageContext) {
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
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
