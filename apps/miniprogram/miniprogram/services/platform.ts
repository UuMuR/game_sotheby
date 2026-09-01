import type { MiniProgramPlatform } from './session.ts';
import type { RequestOptions } from './http.ts';


export function createWechatPlatform(): MiniProgramPlatform {
  return {
    login: () => new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject })),
    request: <T>(options: RequestOptions) => new Promise<T>((resolve, reject) => {
      wx.request<T>({
        url: options.url,
        ...(options.method === undefined ? {} : { method: options.method }),
        ...(options.data === undefined ? {} : { data: options.data }),
        ...(options.headers === undefined ? {} : { header: options.headers }),
        success(result) {
          if (result.statusCode >= 200 && result.statusCode < 300) resolve(result.data);
          else reject(result.data);
        },
        fail: reject,
      });
    }),
    getStorage: <T>(key: string) => wx.getStorageSync<T>(key),
    setStorage: (key, value) => wx.setStorageSync(key, value),
    removeStorage: (key) => wx.removeStorageSync(key),
    navigateTo: (url) => wx.navigateTo({ url }),
    redirectTo: (url) => wx.redirectTo({ url }),
  };
}
