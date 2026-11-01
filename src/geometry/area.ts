import type { Project } from '../core/types';
import { wallLength } from './walls';

export function grossWallArea(project: Project): number {
  return project.building.walls.reduce((s, w) => s + wallLength(w) * w.height, 0);
}

export function openingsArea(project: Project): number {
  return project.building.openings.reduce((s, o) => s + o.width * o.height, 0);
}

export function netWallArea(project: Project): number {
  return (grossWallArea(project) - openingsArea(project)) / 1e6; // m2
}
