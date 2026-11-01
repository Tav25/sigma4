import type { Project } from '../core/types';
import { wallLength } from '../geometry/walls';

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  objectId?: string;
  kind?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  elements: number;
  badGeometry: number;
  overlaps: number;
  unanchored: number;
  badConnections: number;
  missingSpec: number;
  unchecked: number;
  ok: boolean;
}

export function validateProject(project: Project): ValidationReport {
  const issues: ValidationIssue[] = [];
  const b = project.building;
  for (const w of b.walls) {
    if (w.height <= 0) issues.push({ id: `wall-height-${w.id}`, severity: 'error', message: 'Высота стены должна быть > 0', objectId: w.id, kind: 'wall' });
    if (wallLength(w) <= 0) issues.push({ id: `wall-length-${w.id}`, severity: 'error', message: 'Длина стены должна быть > 0', objectId: w.id, kind: 'wall' });
  }
  for (const o of b.openings) {
    const wall = b.walls.find((w) => w.id === o.wallId);
    if (!wall) {
      issues.push({ id: `opening-wall-${o.id}`, severity: 'error', message: 'Проём ссылается на несуществующую стену', objectId: o.id, kind: 'opening' });
      continue;
    }
    const L = wallLength(wall);
    if (o.x < 0 || o.x + o.width > L + 1e-6) {
      issues.push({ id: `opening-bounds-${o.id}`, severity: 'error', message: 'Проём выходит за пределы стены', objectId: o.id, kind: 'opening' });
    }
    if (o.sillHeight + o.height > wall.height + 1e-6) {
      issues.push({ id: `opening-height-${o.id}`, severity: 'error', message: 'Проём превышает высоту стены', objectId: o.id, kind: 'opening' });
    }
    if (o.width <= 0 || o.height <= 0) issues.push({ id: `opening-size-${o.id}`, severity: 'error', message: 'Размеры проёма должны быть > 0', objectId: o.id, kind: 'opening' });
    for (const o2 of b.openings) {
      if (o2.id === o.id || o2.wallId !== o.wallId) continue;
      if (o.x < o2.x + o2.width && o2.x < o.x + o.width) {
        issues.push({ id: `opening-overlap-${o.id}-${o2.id}`, severity: 'error', message: 'Проёмы пересекаются', objectId: o.id, kind: 'opening' });
      }
    }
  }
  if (b.studSpacing <= 0) issues.push({ id: 'stud-spacing', severity: 'error', message: 'Шаг стоек должен быть > 0', kind: 'wall' });
  if (b.roof.pitchDeg <= 0 || b.roof.pitchDeg >= 90) issues.push({ id: 'roof-pitch', severity: 'error', message: 'Угол крыши должен быть от 0 до 90', kind: 'roof' });

  return {
    issues,
    elements: 0,
    badGeometry: issues.filter((i) => i.kind === 'wall' || i.kind === 'opening' || i.kind === 'roof').length,
    overlaps: issues.filter((i) => i.message.includes('пересекаются')).length,
    unanchored: 0,
    badConnections: 0,
    missingSpec: 0,
    unchecked: issues.length,
    ok: issues.length === 0,
  };
}

export function validateFrame(elements: any[]): { bad: number; report: string[] } {
  const bad: string[] = [];
  for (const e of elements) {
    const start = e.startMm ?? { x: e.position?.x ?? 0, y: e.position?.y ?? 0, z: e.position?.z ?? 0 };
    const end = e.endMm ?? { x: start.x, y: start.y + (e.lengthMm ?? e.length ?? 0), z: start.z };
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (Math.abs(len - (e.lengthMm ?? e.length ?? 0)) > 5) {
      bad.push(`${e.kind} ${e.id}: длина ${len.toFixed(1)} мм, заявлено ${e.lengthMm ?? e.length}`);
    }
    if (e.position) {
      const cx = (start.x + end.x) / 2, cy = (start.y + end.y) / 2, cz = (start.z + end.z) / 2;
      if (Math.abs(cx - e.position.x) > 1 || Math.abs(cy - e.position.y) > 1 || Math.abs(cz - e.position.z) > 1) {
        bad.push(`${e.kind} ${e.id}: центр не совпадает с серединой оси`);
      }
    }
    if (start.y < -1 || end.y < -1) bad.push(`${e.kind} ${e.id}: элемент уходит ниже Y=0`);
  }
  return { bad: bad.length, report: bad };
}
