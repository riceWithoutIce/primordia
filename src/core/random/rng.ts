import type { RandomSource } from "../types";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mulberry32(seed: number): RandomSource {
  let t = seed >>> 0;
  return function random(): number {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2d(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ Math.imul(y, 0x27d4eb2d) ^ seed, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
