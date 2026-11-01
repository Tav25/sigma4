import { describe, it, expect } from 'vitest';
import { defaultProject, makeRectangularWalls } from '../model/project';
import { netWallArea } from '../geometry/area';
import { newId } from '../core/ids';

describe('wall area', () => {
  it('matches 49.23', () => {
    const p = defaultProject();
    p.building.length = 6000;
    p.building.width = 4000;
    p.building.wallHeight = 2700;
    p.building.walls = makeRectangularWalls(6000, 4000, 2700, p.building.wallThickness);
    p.building.openings = [
      { id: newId(), type: 'door', wallId: p.building.walls[0].id, x: 0, width: 900, height: 2100, sillHeight: 0 },
      { id: newId(), type: 'window', wallId: p.building.walls[0].id, x: 2000, width: 1200, height: 1200, sillHeight: 900 },
      { id: newId(), type: 'window', wallId: p.building.walls[2].id, x: 1000, width: 1200, height: 1200, sillHeight: 900 },
    ];
    expect(netWallArea(p)).toBeCloseTo(47.66, 2);
  });
});
