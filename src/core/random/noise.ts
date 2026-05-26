import { hash2d, lerp, smoothstep } from "./rng";

export function valueNoise2d(x: number, y: number, seed: number, scale: number): number {
  const nx = x / scale;
  const ny = y / scale;
  const x0 = Math.floor(nx);
  const y0 = Math.floor(ny);
  const tx = smoothstep(nx - x0);
  const ty = smoothstep(ny - y0);

  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function fbmNoise2d(x: number, y: number, seed: number, baseScale: number, octaves = 4): number {
  let total = 0;
  let amplitude = 0.5;
  let amplitudeTotal = 0;
  let scale = baseScale;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2d(x, y, seed ^ Math.imul(octave + 1, 0x9e3779b9), scale) * amplitude;
    amplitudeTotal += amplitude;
    amplitude *= 0.5;
    scale = Math.max(2, scale * 0.5);
  }

  return amplitudeTotal > 0 ? total / amplitudeTotal : 0;
}
