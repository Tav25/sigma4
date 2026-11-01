import { newId } from '../core/ids';
import type { Project, FrameElement, Section, Vec3 } from '../core/types';
import { wallLength, wallDir, openingsOnWall } from '../geometry/walls';

export interface FrameModel { elements: FrameElement[]; }

export function generateFrame(project: Project): FrameModel {
  const b = project.building;
  const mat = project.materials.lumber.find((m) => m.id === b.lumberMaterialId) ?? project.materials.lumber[0];
  const section: Section = { w: mat.width, h: mat.height };
  const plateThickness = mat.width; // 45
  const elements: FrameElement[] = [];
  const studPositions = new Map<string, FrameElement>();

  const addStud = (wallId: string, posAlong: number, wall: any, isCorner: boolean, studLen: number) => {
    const d = wallDir(wall);
    const start: Vec3 = { x: wall.start.x + d.x * posAlong, y: plateThickness, z: wall.start.z + d.z * posAlong };
    const end: Vec3 = { x: start.x, y: start.y + studLen, z: start.z };
    const key = `${Math.round(start.x)}_${Math.round(start.z)}`;
    if (studPositions.has(key)) return;
    const el: FrameElement = {
      id: newId(), kind: 'stud', role: isCorner ? 'corner-stud' : 'regular-stud',
      assemblyId: wallId, wallId, materialId: mat.id, section,
      length: studLen, lengthMm: studLen,
      count: isCorner ? (b.cornerType === '3-stud' ? 3 : 2) : 1,
      position: { x: start.x, y: start.y + studLen / 2, z: start.z },
      startMm: start, endMm: end,
      localAxes: { x: { x: d.x, y: 0, z: d.z }, y: { x: 0, y: 1, z: 0 }, z: { x: -d.z, y: 0, z: d.x } },
      jointStart: 'bottom-plate', jointEnd: 'top-plate',
      verificationStatus: 'insufficient',
    };
    studPositions.set(key, el);
    elements.push(el);
  };

  for (const wall of b.walls) {
    const L = wallLength(wall);
    const spacing = b.studSpacing;
    const wallOpenings = openingsOnWall(b.openings, wall.id);
    const wallStudLength = (wall.height || b.wallHeight) - (b.plateCountTop + 1) * plateThickness;
    const d = wallDir(wall);

    // bottom plate — split at openings (finished state: door opening breaks plate)
    const sortedOpenings = [...wallOpenings].sort((a, b2) => a.x - b2.x);
    let cursor = 0;
    const addPlateSeg = (a: number, c: number) => {
      if (c - a < 1) return;
      const start = { x: wall.start.x + d.x * a, y: plateThickness / 2, z: wall.start.z + d.z * a };
      const end = { x: wall.start.x + d.x * c, y: plateThickness / 2, z: wall.start.z + d.z * c };
      elements.push({
        id: newId(), kind: 'plate-bottom', role: 'bottom-plate',
        assemblyId: wall.id, wallId: wall.id, materialId: mat.id, section,
        length: c - a, lengthMm: c - a, count: 1,
        position: { x: (start.x + end.x) / 2, y: plateThickness / 2, z: (start.z + end.z) / 2 },
        startMm: start, endMm: end,
        localAxes: { x: { x: d.x, y: 0, z: d.z }, y: { x: 0, y: 1, z: 0 }, z: { x: -d.z, y: 0, z: d.x } },
        jointStart: 'foundation', jointEnd: 'stud',
        verificationStatus: 'insufficient',
      });
    };
    for (const o of sortedOpenings) {
      addPlateSeg(cursor, o.x);
      cursor = o.x + o.width;
    }
    addPlateSeg(cursor, L);

    // top plates
    for (let i = 0; i < b.plateCountTop; i++) {
      const start = { x: wall.start.x + d.x * 0, y: b.wallHeight - plateThickness * (i + 1) + plateThickness / 2, z: wall.start.z + d.z * 0 };
      const end = { x: wall.start.x + d.x * L, y: start.y, z: wall.start.z + d.z * L };
      elements.push({
        id: newId(), kind: 'plate-top', role: i === 0 ? 'top-plate-1' : 'top-plate-2',
        assemblyId: wall.id, wallId: wall.id, materialId: mat.id, section,
        length: L, lengthMm: L, count: 1,
        position: { x: (start.x + end.x) / 2, y: start.y, z: (start.z + end.z) / 2 },
        startMm: start, endMm: end,
        localAxes: { x: { x: d.x, y: 0, z: d.z }, y: { x: 0, y: 1, z: 0 }, z: { x: -d.z, y: 0, z: d.x } },
        jointStart: 'stud', jointEnd: 'ridge/rafter',
        verificationStatus: 'insufficient',
      });
    }

    // regular studs
    const positions: number[] = [];
    for (let p = 0; p <= L + 1e-6; p += spacing) positions.push(Math.min(p, L));
    if (positions[positions.length - 1] !== L) positions.push(L);
    const uniqPos = Array.from(new Set(positions.map((p) => Math.round(p)))).map((p) => p);
    for (const pos of uniqPos) {
      let insideOpening = false;
      for (const o of wallOpenings) {
        if (pos > o.x + 1 && pos < o.x + o.width - 1) { insideOpening = true; break; }
      }
      if (insideOpening) continue;
      const corner = pos < 1 || Math.abs(pos - L) < 1;
      addStud(wall.id, pos, wall, corner, wallStudLength);
    }

    // opening framing
    for (const o of wallOpenings) {
      addStud(wall.id, o.x, wall, false, wallStudLength);
      addStud(wall.id, o.x + o.width, wall, false, wallStudLength);
      // header
      const headerLen = o.width + 2 * section.w;
      const hStart = { x: wall.start.x + d.x * (o.x - section.w), y: o.sillHeight + o.height + section.h / 2, z: wall.start.z + d.z * (o.x - section.w) };
      const hEnd = { x: hStart.x + d.x * headerLen, y: hStart.y, z: hStart.z + d.z * headerLen };
      elements.push({
        id: newId(), kind: 'header', role: 'header',
        assemblyId: wall.id, wallId: wall.id, materialId: mat.id, section,
        length: headerLen, lengthMm: headerLen, count: 1,
        position: { x: (hStart.x + hEnd.x) / 2, y: hStart.y, z: (hStart.z + hEnd.z) / 2 },
        startMm: hStart, endMm: hEnd,
        localAxes: { x: { x: d.x, y: 0, z: d.z }, y: { x: 0, y: 1, z: 0 }, z: { x: -d.z, y: 0, z: d.x } },
        jointStart: 'king-stud', jointEnd: 'king-stud',
        verificationStatus: 'insufficient',
      });
      if (o.type === 'window') {
        // sill
        const sStart = { x: wall.start.x + d.x * o.x, y: o.sillHeight + section.h / 2, z: wall.start.z + d.z * o.x };
        const sEnd = { x: sStart.x + d.x * o.width, y: sStart.y, z: sStart.z + d.z * o.width };
        elements.push({
          id: newId(), kind: 'sill', role: 'sill',
          assemblyId: wall.id, wallId: wall.id, materialId: mat.id, section,
          length: o.width, lengthMm: o.width, count: 1,
          position: { x: (sStart.x + sEnd.x) / 2, y: sStart.y, z: (sStart.z + sEnd.z) / 2 },
          startMm: sStart, endMm: sEnd,
          localAxes: { x: { x: d.x, y: 0, z: d.z }, y: { x: 0, y: 1, z: 0 }, z: { x: -d.z, y: 0, z: d.x } },
          jointStart: 'jack-stud', jointEnd: 'jack-stud',
          verificationStatus: 'insufficient',
        });
      }
    }
  }

  // Gable studs on end walls (walls running along Z at x = const)
  const gableTan = Math.tan((b.roof.pitchDeg * Math.PI) / 180);
  const gHalfW = b.width / 2;
  for (const wall of b.walls) {
    if (Math.abs(wall.start.x - wall.end.x) > 1) continue;
    const gx = wall.start.x;
    const gzMin = Math.min(wall.start.z, wall.end.z);
    const gzMax = Math.max(wall.start.z, wall.end.z);
    for (let z = gzMin; z <= gzMax + 1e-6; z += b.studSpacing) {
      const zz = Math.min(z, gzMax);
      const distToRidge = Math.abs(zz - gHalfW);
      const rise = Math.max(0, (gHalfW - distToRidge) * gableTan);
      if (rise < 50) continue;
      const start = { x: gx, y: b.wallHeight, z: zz };
      const end = { x: gx, y: start.y + rise, z: zz };
      elements.push({
        id: newId(), kind: 'stud', role: 'gable-stud',
        assemblyId: wall.id, wallId: wall.id, materialId: mat.id, section,
        length: rise, lengthMm: rise, count: 1,
        position: { x: gx, y: start.y + rise / 2, z: zz },
        startMm: start, endMm: end,
        localAxes: { x: { x: 0, y: 0, z: 1 }, y: { x: 0, y: 1, z: 0 }, z: { x: 1, y: 0, z: 0 } },
        jointStart: 'top-plate', jointEnd: 'rafter',
        verificationStatus: 'insufficient',
      });
    }
  }

  // Roof
  const roof = b.roof;
  const pitch = (roof.pitchDeg * Math.PI) / 180;
  const cosP = Math.cos(pitch);
  const L = b.length;
  const W = b.width;
  const halfW = W / 2;
  const peakY = b.wallHeight + halfW * Math.tan(pitch);
  const rafterRun = halfW;
  const rafterLen = rafterRun / cosP;

  const n = Math.floor(L / roof.rafterSpacing) + 1;
  for (let i = 0; i < n; i++) {
    let x = i * roof.rafterSpacing;
    if (x > L) x = L;
    // bottom (wall outer face) and top (ridge)
    const zEave = 0;
    const zRidge = halfW;
    const start = { x, y: b.wallHeight, z: zEave };
    const end = { x, y: peakY, z: zRidge };
    elements.push({
      id: newId(), kind: 'rafter', role: 'common-rafter',
      materialId: mat.id, section: roof.rafterSection,
      length: rafterLen, lengthMm: rafterLen, count: 1,
      position: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 },
      startMm: start, endMm: end,
      localAxes: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: (end.y - start.y) / rafterLen, z: (end.z - start.z) / rafterLen }, z: { x: 0, y: -(end.z - start.z) / rafterLen, z: (end.y - start.y) / rafterLen } },
      jointStart: 'top-plate', jointEnd: 'ridge-board',
      verificationStatus: 'insufficient',
    });
    // tie (zatyazhka) at wall top between rafter pair
    const tStart = { x, y: b.wallHeight, z: 0 };
    const tEnd = { x, y: b.wallHeight, z: W };
    elements.push({
      id: newId(), kind: 'tie', role: 'ceiling-tie',
      assemblyId: undefined, materialId: mat.id, section,
      length: W, lengthMm: W, count: 1,
      position: { x: (tStart.x + tEnd.x) / 2, y: b.wallHeight, z: (tStart.z + tEnd.z) / 2 },
      startMm: tStart, endMm: tEnd,
      localAxes: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } },
      jointStart: 'rafter', jointEnd: 'rafter',
      verificationStatus: 'insufficient',
    });
  }
  // ridge board
  const rStart = { x: 0, y: peakY, z: halfW };
  const rEnd = { x: L, y: peakY, z: halfW };
  elements.push({
    id: newId(), kind: 'ridge', role: 'ridge-board',
    materialId: mat.id, section: roof.rafterSection,
    length: L, lengthMm: L, count: 1,
    position: { x: (rStart.x + rEnd.x) / 2, y: rStart.y, z: rStart.z },
    startMm: rStart, endMm: rEnd,
    localAxes: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } },
    jointStart: 'rafter', jointEnd: 'rafter',
    verificationStatus: 'insufficient',
  });

  return { elements };
}
