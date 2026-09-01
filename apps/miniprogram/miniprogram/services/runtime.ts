import { API_BASE_URL } from '../config.ts';
import { createHttpClient } from './http.ts';
import { createWechatPlatform } from './platform.ts';
import { createRoomClient } from './rooms.ts';
import { createSessionService } from './session.ts';

export const platform = createWechatPlatform();
export const session = createSessionService(platform, API_BASE_URL);
export const http = createHttpClient(platform.request.bind(platform), API_BASE_URL, () => session.current()?.token);
export const rooms = createRoomClient(http);
