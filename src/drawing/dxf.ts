import type { Project } from '../core/types';

export function generatePlanDxf(project: Project): string {
  const b = project.building;
  const lines: string[] = [];
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (const w of b.walls) {
    lines.push('0', 'LINE');
    lines.push('10', String(w.start.x), '20', String(w.start.z), '30', '0');
    lines.push('11', String(w.end.x), '21', String(w.end.z), '31', '0');
  }
  for (const o of b.openings) {
    const wall = b.walls.find((ww) => ww.id === o.wallId);
    if (!wall) continue;
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const x1 = wall.start.x + ux * o.x;
    const z1 = wall.start.z + uz * o.x;
    const x2 = x1 + ux * o.width;
    const z2 = z1 + uz * o.width;
    lines.push('0', 'LINE');
    lines.push('10', String(x1), '20', String(z1), '30', '0');
    lines.push('11', String(x2), '21', String(z2), '31', '0');
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}
