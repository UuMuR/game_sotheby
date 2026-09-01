import type { RandomSource } from './model.ts';

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;

  const next = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    integer(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('maxExclusive must be a positive integer');
      }
      return Math.floor(next() * maxExclusive);
    },
    shuffle<T>(values: readonly T[]): T[] {
      const shuffled = [...values];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(next() * (index + 1));
        const current = shuffled[index];
        const replacement = shuffled[swapIndex];
        if (current === undefined || replacement === undefined) {
          throw new Error('Random shuffle index was outside the array');
        }
        shuffled[index] = replacement;
        shuffled[swapIndex] = current;
      }
      return shuffled;
    },
  };
}
