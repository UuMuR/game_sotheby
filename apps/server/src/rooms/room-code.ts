export function randomSixDigitRoomCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, '0');
}
