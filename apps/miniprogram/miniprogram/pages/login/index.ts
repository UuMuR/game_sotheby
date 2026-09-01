import { session } from '../../services/runtime.ts';

Page({
  async onLoad() {
    const restored = await session.restoreAndRoute();
    if (!restored) await session.loginAndRoute();
  },
});
