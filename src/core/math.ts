/** 2D vector operations (zero-allocation where possible) */
export const Vec2 = {
  create(x: number = 0, y: number = 0): { x: number; y: number } {
    return { x, y };
  },

  set(out: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
    out.x = x;
    out.y = y;
    return out;
  },

  copy(out: { x: number; y: number }, a: { x: number; y: number }): { x: number; y: number } {
    out.x = a.x;
    out.y = a.y;
    return out;
  },

  add(out: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    out.x = a.x + b.x;
    out.y = a.y + b.y;
    return out;
  },

  sub(out: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    out.x = a.x - b.x;
    out.y = a.y - b.y;
    return out;
  },

  scale(out: { x: number; y: number }, a: { x: number; y: number }, s: number): { x: number; y: number } {
    out.x = a.x * s;
    out.y = a.y * s;
    return out;
  },

  length(a: { x: number; y: number }): number {
    return Math.sqrt(a.x * a.x + a.y * a.y);
  },

  lengthSq(a: { x: number; y: number }): number {
    return a.x * a.x + a.y * a.y;
  },

  normalize(out: { x: number; y: number }, a: { x: number; y: number }): { x: number; y: number } {
    const len = Vec2.length(a);
    if (len > 0) {
      out.x = a.x / len;
      out.y = a.y / len;
    } else {
      out.x = 0;
      out.y = 0;
    }
    return out;
  },

  distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
  },

  dot(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return a.x * b.x + a.y * b.y;
  },

  cross2D(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return a.x * b.y - a.y * b.x;
  },

  angle(a: { x: number; y: number }): number {
    return Math.atan2(a.y, a.x);
  },

  lerp(out: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    return out;
  },
} as const;

/** Axis-aligned bounding box */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const AABBUtil = {
  create(minX: number = 0, minY: number = 0, maxX: number = 0, maxY: number = 0): AABB {
    return { minX, minY, maxX, maxY };
  },

  overlaps(a: AABB, b: AABB): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX &&
           a.minY <= b.maxY && a.maxY >= b.minY;
  },

  contains(a: AABB, x: number, y: number): boolean {
    return x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY;
  },

  width(a: AABB): number {
    return a.maxX - a.minX;
  },

  height(a: AABB): number {
    return a.maxY - a.minY;
  },
} as const;

/** Utility math functions */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function remap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const t = (value - fromMin) / (fromMax - fromMin);
  return toMin + t * (toMax - toMin);
}
