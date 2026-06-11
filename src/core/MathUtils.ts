export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Amortissement exponentiel indépendant du framerate. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Différence d'angle signée dans [-PI, PI]. */
export function angleDiff(target: number, current: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Interpolation angulaire par le chemin le plus court. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(b, a) * t;
}

/** Modulo positif. */
export function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
