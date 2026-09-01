import type { HttpClient } from './http.ts';
import type { LobbyRoomView } from '../pages/lobby/view-model.ts';

export interface RoomClient {
  get(roomId: string): Promise<LobbyRoomView>;
  create(): Promise<LobbyRoomView>;
  join(code: string): Promise<LobbyRoomView>;
  setReady(roomId: string, ready: boolean): Promise<LobbyRoomView>;
  start(roomId: string): Promise<LobbyRoomView>;
  leave(roomId: string, playerId: string): Promise<LobbyRoomView | null>;
}

export function createRoomClient(http: HttpClient): RoomClient {
  return {
    get: (roomId) => http.request<LobbyRoomView>({ url: `/v1/rooms/${roomId}`, method: 'GET' }),
    create: () => http.request<LobbyRoomView>({ url: '/v1/rooms', method: 'POST' }),
    join: (code) => http.request<LobbyRoomView>({ url: `/v1/rooms/${code}/join`, method: 'POST' }),
    setReady: (roomId, ready) => http.request<LobbyRoomView>({ url: `/v1/rooms/${roomId}/ready`, method: 'POST', data: { ready } }),
    start: (roomId) => http.request<LobbyRoomView>({ url: `/v1/rooms/${roomId}/start`, method: 'POST' }),
    leave: (roomId, playerId) => http.request<LobbyRoomView | null>({ url: `/v1/rooms/${roomId}/players/${playerId}`, method: 'DELETE' }),
  };
}
