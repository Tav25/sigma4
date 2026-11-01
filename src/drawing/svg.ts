import type { Project } from '../core/types';

export function generatePlanSvg(project: Project): string {
  const b = project.building;
  const pad = 200;
  const w = b.length + pad * 2;
  const h = b.width + pad * 2;
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  lines.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#f5f5f5"/>`);
  // outer walls
  for (const wall of b.walls) {
    lines.push(`<line x1="${wall.start.x + pad}" y1="${wall.start.z + pad}" x2="${wall.end.x + pad}" y2="${wall.end.z + pad}" stroke="#333" stroke-width="8"/>`);
  }
  // openings
  for (const o of b.openings) {
    const wall = b.walls.find((ww) => ww.id === o.wallId);
    if (!wall) continue;
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const sx = wall.start.x + ux * o.x + pad;
    const sz = wall.start.z + uz * o.x + pad;
    const ex = sx + ux * o.width;
    const ez = sz + uz * o.width;
    lines.push(`<line x1="${sx}" y1="${sz}" x2="${ex}" y2="${ez}" stroke="#fff" stroke-width="10"/>`);
    lines.push(`<line x1="${sx}" y1="${sz}" x2="${ex}" y2="${ez}" stroke="#c00" stroke-width="2" stroke-dasharray="4,2"/>`);
  }
  // dimensions
  lines.push(`<text x="${pad}" y="${pad - 20}" font-size="14" fill="#000">Длина: ${b.length} мм</text>`);
  lines.push(`<text x="${pad}" y="${pad + b.width + 30}" font-size="14" fill="#000">Ширина: ${b.width} мм</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

export function generateFacadeSvg(project: Project, wallIndex = 0): string {
  const b = project.building;
  const wall = b.walls[wallIndex];
  if (!wall) return '';
  const L = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
  const H = wall.height;
  const pad = 100;
  const w = L + pad * 2;
  const h = H + pad * 2;
  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  lines.push(`<rect x="${pad}" y="${pad}" width="${L}" height="${H}" fill="#eee" stroke="#333" stroke-width="2"/>`);
  for (const o of b.openings.filter((oo) => oo.wallId === wall.id)) {
    lines.push(`<rect x="${pad + o.x}" y="${pad + (H - o.sillHeight - o.height)}" width="${o.width}" height="${o.height}" fill="#87CEEB" stroke="#333"/>`);
  }
  lines.push(`</svg>`);
  return lines.join('\n');
}
export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
