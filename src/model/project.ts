import { newId } from '../core/ids';
import type { Project, Building, Wall, Roof, LumberMaterial, SheetMaterial } from '../core/types';

export const defaultLumber: LumberMaterial[] = [
  { id: 'lm-45x145', name: '45x145', width: 45, height: 145, lengths: [3000, 4000, 5000, 6000], density: 500, available: true },
  { id: 'lm-45x195', name: '45x195', width: 45, height: 195, lengths: [4000, 5000, 6000], density: 500, available: true },
  { id: 'lm-50x100', name: '50x100', width: 50, height: 100, lengths: [3000,4000,5000,6000], density: 500, available: true },
  { id: 'lm-50x150', name: '50x150', width: 50, height: 150, lengths: [4000,5000,6000], density: 500, available: true },
  { id: 'lm-50x200', name: '50x200', width: 50, height: 200, lengths: [4000,5000,6000], density: 500, available: true },
];

export const defaultSheets: SheetMaterial[] = [
  { id: 'sh-osb-1200x2400', name: 'OSB 1200x2400', width: 1200, length: 2400, thickness: 9, available: true },
  { id: 'sh-ply-1220x2440', name: 'Фанера 1220x2440', width: 1220, length: 2440, thickness: 9, available: true },
];

export function makeRectangularWalls(length: number, width: number, height: number, thickness: number): Wall[] {
  const t2 = thickness / 2;
  return [
    { id: newId(), start: { x: 0, z: t2 }, end: { x: length, z: t2 }, height, thickness },
    { id: newId(), start: { x: length, z: width - t2 }, end: { x: 0, z: width - t2 }, height, thickness },
    { id: newId(), start: { x: t2, z: thickness }, end: { x: t2, z: width - thickness }, height, thickness },
    { id: newId(), start: { x: length - t2, z: width - thickness }, end: { x: length - t2, z: thickness }, height, thickness },
  ];
}

export function defaultRoof(): Roof {
  return {
    type: 'gable',
    pitchDeg: 30,
    overhang: { front: 300, back: 300, left: 300, right: 300 },
    rafterSpacing: 600,
    rafterSection: { w: 50, h: 150 },
  };
}

export function defaultBuilding(length = 6000, width = 4000, wallHeight = 2700): Building {
  const structuralThickness = 145;
  const walls = makeRectangularWalls(length, width, wallHeight, structuralThickness);
  return {
    id: newId(),
    length,
    width,
    wallHeight,
    walls,
    openings: [
      { id: newId(), type: 'door', wallId: walls[0].id, x: 1000, width: 900, height: 2100, sillHeight: 0 },
      { id: newId(), type: 'window', wallId: walls[0].id, x: 2500, width: 1200, height: 1200, sillHeight: 900 },
    ],
    roof: defaultRoof(),
    floorLevel: 0,
    studSpacing: 600,
    plateCountTop: 2,
    cornerType: '3-stud',
    lumberMaterialId: 'lm-45x145',
    sheetMaterialId: 'sh-osb-1200x2400',
    wallThickness: structuralThickness,
    structuralThickness,
  };
}

export function defaultProject(): Project {
  return {
    schemaVersion: 1,
    id: newId(),
    name: 'Новый проект',
    units: 'mm',
    building: defaultBuilding(),
    materials: { lumber: defaultLumber, sheets: defaultSheets },
  };
}
