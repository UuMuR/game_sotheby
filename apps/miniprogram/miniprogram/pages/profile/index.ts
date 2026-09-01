import { validateProfile } from './view-model.ts';
import { http, platform, session } from '../../services/runtime.ts';

interface ProfilePageData {
  nickname: string;
  avatarUrl: string;
  error: string;
}

interface ProfilePageContext {
  data: ProfilePageData;
  setData(data: Partial<ProfilePageData>): void;
}

Page({
  data: { nickname: '', avatarUrl: '/assets/avatars/default.png', error: '' },
  onNicknameInput(this: ProfilePageContext, event: { detail: { value: string } }) {
    this.setData({ nickname: event.detail.value });
  },
  onChooseAvatar(this: ProfilePageContext, event: { detail: { avatarUrl: string } }) {
    this.setData({ avatarUrl: event.detail.avatarUrl });
  },
  onOpenHistory() { platform.navigateTo('/pages/history/index'); },
  async onSave(this: ProfilePageContext) {
    const validation = validateProfile({
      nickname: this.data.nickname,
      avatarUrl: this.data.avatarUrl,
    });
    if (!validation.ok) {
      this.setData({ error: '昵称长度需为 1～12 个字符' });
      return;
    }
    await http.request({ url: '/v1/profile', method: 'POST', data: validation.value });
    session.updateProfileComplete();
    platform.redirectTo('/pages/home/index');
  },
});

export * from './view-model.ts';
