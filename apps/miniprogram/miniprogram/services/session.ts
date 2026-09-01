import type { RequestOptions } from './http.ts';

export interface PlayerSession {
  token: string;
  playerId: string;
  profileComplete: boolean;
}

interface LoginResponse {
  token: string;
  player: { id: string; profileComplete: boolean };
}

export interface MiniProgramPlatform {
  login(): Promise<{ code: string }>;
  request<T>(options: RequestOptions): Promise<T>;
  getStorage<T>(key: string): T | undefined;
  setStorage(key: string, value: unknown): void;
  removeStorage(key: string): void;
  navigateTo(url: string): void;
  redirectTo(url: string): void;
}

const SESSION_KEY = 'sotheby.session';

export function createSessionService(platform: MiniProgramPlatform, apiBaseUrl: string) {
  let currentSession = platform.getStorage<PlayerSession>(SESSION_KEY) ?? null;

  const save = (session: PlayerSession): void => {
    currentSession = session;
    platform.setStorage(SESSION_KEY, session);
  };

  const routeAfterLogin = async (session: PlayerSession): Promise<void> => {
    if (!session.profileComplete) {
      platform.redirectTo('/pages/profile/index?onboarding=1');
      return;
    }
    const active = await platform.request<{ gameId?: string }>({
      url: `${apiBaseUrl}/v1/me/active-game`,
      method: 'GET',
      headers: { authorization: `Bearer ${session.token}` },
    });
    platform.redirectTo(active.gameId ? `/pages/game/index?gameId=${active.gameId}` : '/pages/home/index');
  };

  return {
    current(): PlayerSession | null {
      return currentSession;
    },

    async loginAndRoute(): Promise<void> {
      const { code } = await platform.login();
      const response = await platform.request<LoginResponse>({
        url: `${apiBaseUrl}/v1/auth/wechat-login`,
        method: 'POST',
        data: { code },
      });
      const session = {
        token: response.token,
        playerId: response.player.id,
        profileComplete: response.player.profileComplete,
      };
      save(session);
      await routeAfterLogin(session);
    },

    async restoreAndRoute(): Promise<boolean> {
      if (!currentSession) return false;
      try {
        await routeAfterLogin(currentSession);
        return true;
      } catch {
        currentSession = null;
        platform.removeStorage(SESSION_KEY);
        return false;
      }
    },

    updateProfileComplete(): void {
      if (!currentSession) return;
      save({ ...currentSession, profileComplete: true });
    },

    clear(): void {
      currentSession = null;
      platform.removeStorage(SESSION_KEY);
    },
  };
}
