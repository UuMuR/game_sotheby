import { createHomeViewModel, type HomeViewModel } from './view-model.ts';
import { platform, rooms } from '../../services/runtime.ts';

interface HomePageContext {
  data: HomeViewModel;
  setData(data: Partial<HomeViewModel>): void;
}

Page({
  data: createHomeViewModel(),

  onLoad(this: HomePageContext, options: { room?: string }) {
    this.setData(createHomeViewModel(options.room === undefined ? {} : { sharedRoomCode: options.room }));
  },

  onRoomCodeInput(this: HomePageContext, event: { detail: { value: string } }) {
    this.setData(createHomeViewModel({ sharedRoomCode: event.detail.value }));
  },

  async onCreateRoom(this: HomePageContext) {
    try {
      const room = await rooms.create();
      platform.navigateTo(`/pages/lobby/index?roomId=${room.id}`);
    } catch {
      wx.showToast({ title: '创建房间失败', icon: 'none' });
    }
  },

  async onJoinRoom(this: HomePageContext) {
    if (!this.data.canJoin) return;
    try {
      const room = await rooms.join(this.data.joinCode);
      platform.navigateTo(`/pages/lobby/index?roomId=${room.id}`);
    } catch {
      wx.showToast({ title: '无法加入房间', icon: 'none' });
    }
  },

  onOpenRules() { platform.navigateTo('/pages/rules/index'); },
  onOpenProfile() { platform.navigateTo('/pages/profile/index'); },
});

export * from './view-model.ts';
