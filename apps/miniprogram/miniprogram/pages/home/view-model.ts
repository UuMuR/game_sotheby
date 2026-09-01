export interface HomeViewModel {
  joinCode: string;
  canJoin: boolean;
}

export function normalizeRoomCode(value: string | undefined): string {
  return (value ?? '').trim();
}

export function createHomeViewModel(input: { sharedRoomCode?: string } = {}): HomeViewModel {
  const joinCode = normalizeRoomCode(input.sharedRoomCode);
  return { joinCode, canJoin: /^\d{6}$/.test(joinCode) };
}
