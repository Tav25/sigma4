import type { FrameElement } from '../core/types';

export interface LumberLine {
  mark: string;
  kind: string;
  section: string;
  length: number;
  count: number;
  totalLength: number; // mm
  volume: number; // m3 (assuming count*length*section area)
}

export function aggregateLumber(elements: FrameElement[]): LumberLine[] {
  const map = new Map<string, LumberLine>();
  for (const e of elements) {
    const key = `${e.kind}|${e.section.w}x${e.section.h}|${e.length}`;
    const existing = map.get(key);
    const vol = (e.section.w * e.section.h * e.length * e.count) / 1e9; // mm3 -> m3
    if (existing) {
      existing.count += e.count;
      existing.totalLength += e.length * e.count;
      existing.volume += vol;
    } else {
      map.set(key, {
        mark: key,
        kind: e.kind,
        section: `${e.section.w}x${e.section.h}`,
        length: e.length,
        count: e.count,
        totalLength: e.length * e.count,
        volume: vol,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.kind.localeCompare(b.kind));
}
