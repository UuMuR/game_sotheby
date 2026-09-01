export type ClientGameCommand =
  | { type: 'PLAY_CARD'; payload: { cardId: string } }
  | { type: 'PLACE_OPEN_BID'; payload: { amount: number } }
  | { type: 'SET_FIXED_PRICE'; payload: { amount: number } }
  | { type: 'RESPOND_FIXED_PRICE'; payload: { accept: boolean } }
  | { type: 'PLACE_SEQUENTIAL_BID'; payload: { amount: number } }
  | { type: 'PASS_SEQUENTIAL'; payload: Record<string, never> }
  | { type: 'SUBMIT_SEALED_BID'; payload: { amount: number } }
  | { type: 'CHOOSE_SELF_JOINT_CARD'; payload: { cardId: string } }
  | { type: 'INVITE_JOINT_PLAYER'; payload: Record<string, never> }
  | { type: 'RESPOND_JOINT_INVITE'; payload: { accept: boolean; cardId?: string } }
  | { type: 'ADVANCE_AFTER_SETTLEMENT'; payload: Record<string, never> };

let commandSequence = 0;

export function createCommandEnvelope(
  roomId: string,
  gameId: string,
  playerId: string,
  stateVersion: number,
  command: ClientGameCommand,
) {
  commandSequence += 1;
  return {
    type: 'COMMAND' as const,
    requestId: `${playerId}-${Date.now()}-${commandSequence}`,
    roomId,
    gameId,
    playerId,
    stateVersion,
    command,
  };
}
