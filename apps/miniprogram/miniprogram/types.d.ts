declare function App(definition: Record<string, unknown>): void;
declare function Page(definition: Record<string, unknown>): void;
declare function Component(definition: Record<string, unknown>): void;

declare const wx: {
  login(options: { success(result: { code: string }): void; fail(error: unknown): void }): void;
  request<T>(options: {
    url: string;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    data?: unknown;
    header?: Record<string, string>;
    success(result: { data: T; statusCode: number }): void;
    fail(error: unknown): void;
  }): void;
  getStorageSync<T>(key: string): T | undefined;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  navigateTo(options: { url: string }): void;
  redirectTo(options: { url: string }): void;
  showToast(options: { title: string; icon?: 'success' | 'error' | 'none' }): void;
  connectSocket(options: { url: string }): {
    send(options: { data: string }): void;
    close(options?: { code?: number; reason?: string }): void;
    onOpen(handler: () => void): void;
    onMessage(handler: (message: { data: string | ArrayBuffer }) => void): void;
    onClose(handler: () => void): void;
    onError(handler: (error: unknown) => void): void;
  };
};
