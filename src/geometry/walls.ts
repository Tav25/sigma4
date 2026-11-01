import type { Wall, Vec2, Opening } from '../core/types';

export function wallLength(w: Wall): number {
  const dx = w.end.x - w.start.x;
  const dz = w.end.z - w.start.z;
  return Math.hypot(dx, dz);
}

export function wallDir(w: Wall): { x: number; z: number } {
  const L = wallLength(w);
  return { x: (w.end.x - w.start.x) / L, z: (w.end.z - w.start.z) / L };
}

export function wallNormal(w: Wall): { x: number; z: number } {
  const d = wallDir(w);
  return { x: -d.z, z: d.x };
}

export function pointAlongWall(w: Wall, t: number): Vec2 {
  return { x: w.start.x + (w.end.x - w.start.x) * t, z: w.start.z + (w.end.z - w.start.z) * t };
}

export function openingsOnWall(openings: Opening[], wallId: string): Opening[] {
  return openings.filter((o) => o.wallId === wallId);
}
