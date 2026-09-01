export interface SocketConnection {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectionRegistry {
  add(gameId: string, playerId: string, socket: SocketConnection): () => void;
  send(gameId: string, playerId: string, message: unknown): void;
  connectedPlayerIds(gameId: string): readonly string[];
}

export class InMemoryConnectionRegistry implements ConnectionRegistry {
  private readonly connections = new Map<string, Map<string, SocketConnection>>();

  add(gameId: string, playerId: string, socket: SocketConnection): () => void {
    const gameConnections = this.connections.get(gameId) ?? new Map<string, SocketConnection>();
    const previous = gameConnections.get(playerId);
    if (previous && previous !== socket) previous.close(4001, 'REPLACED_BY_RECONNECT');
    gameConnections.set(playerId, socket);
    this.connections.set(gameId, gameConnections);

    return () => {
      if (gameConnections.get(playerId) === socket) gameConnections.delete(playerId);
      if (gameConnections.size === 0) this.connections.delete(gameId);
    };
  }

  send(gameId: string, playerId: string, message: unknown): void {
    const socket = this.connections.get(gameId)?.get(playerId);
    if (socket?.readyState === 1) socket.send(JSON.stringify(message));
  }

  connectedPlayerIds(gameId: string): readonly string[] {
    return [...(this.connections.get(gameId)?.keys() ?? [])];
  }
}
