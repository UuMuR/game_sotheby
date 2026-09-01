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
  private readonly connections = new Map<string, Map<string, Set<SocketConnection>>>();

  add(gameId: string, playerId: string, socket: SocketConnection): () => void {
    const gameConnections = this.connections.get(gameId) ?? new Map<string, Set<SocketConnection>>();
    const playerConnections = gameConnections.get(playerId) ?? new Set<SocketConnection>();
    playerConnections.add(socket);
    gameConnections.set(playerId, playerConnections);
    this.connections.set(gameId, gameConnections);

    return () => {
      playerConnections.delete(socket);
      if (playerConnections.size === 0) gameConnections.delete(playerId);
      if (gameConnections.size === 0) this.connections.delete(gameId);
    };
  }

  send(gameId: string, playerId: string, message: unknown): void {
    const encoded = JSON.stringify(message);
    for (const socket of this.connections.get(gameId)?.get(playerId) ?? []) {
      if (socket.readyState === 1) socket.send(encoded);
    }
  }

  connectedPlayerIds(gameId: string): readonly string[] {
    return [...(this.connections.get(gameId)?.keys() ?? [])];
  }
}
