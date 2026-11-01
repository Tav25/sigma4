import { create } from 'zustand';
import { defaultProject, makeRectangularWalls } from '../model/project';
import { generateFrame } from '../frame/generator';
import type { Project, Opening } from '../core/types';
import { newId } from '../core/ids';

interface State {
  project: Project;
  frame: ReturnType<typeof generateFrame>;
  selectedId: string | null;
  history: Project[];
  future: Project[];
  setProject: (p: Project) => void;
  updateBuilding: (patch: Partial<Project['building']>) => void;
  setWallHeight: (h: number) => void;
  setLength: (l: number) => void;
  setWidth: (w: number) => void;
  addOpening: (type: Opening['type'], wallId: string, x: number, width: number, height: number, sillHeight: number) => void;
  editOpening: (id: string, patch: Partial<Opening>) => void;
  removeOpening: (id: string) => void;
  select: (id: string | null) => void;
  save: () => string;
  load: (json: string) => void;
  undo: () => void;
  redo: () => void;
  debug: { visibleGroups: string[]; viewMode: 'iso' | 'front' | 'side' | 'top' };
  setDebug: (patch: Partial<State['debug']>) => void;
}

function commit(set: any, get: any, newProject: Project) {
  const cur = get().project;
  set({
    project: newProject,
    frame: generateFrame(newProject),
    history: [...get().history, cur].slice(-50),
    future: [],
  });
}

export const useProject = create<State>((set, get) => ({
  project: defaultProject(),
  frame: generateFrame(defaultProject()),
  selectedId: null,
  history: [],
  future: [],
  debug: { visibleGroups: ['plate-bottom','plate-top','stud','header','sill','rafter','ridge','tie'], viewMode: 'iso' },
  setProject: (p) => set({ project: p, frame: generateFrame(p), history: [], future: [] }),
  updateBuilding: (patch) => {
    const p = get().project;
    const nb = { ...p.building, ...patch };
    if (patch.wallHeight !== undefined) {
      nb.walls = nb.walls.map((w) => ({ ...w, height: patch.wallHeight! }));
    }
    const np = { ...p, building: nb };
    commit(set, get, np);
  },
  setWallHeight: (h) => get().updateBuilding({ wallHeight: h }),
  setLength: (l) => {
    const p = get().project;
    const b = p.building;
    const oldWalls = b.walls;
    const newWalls = makeRectangularWalls(l, b.width, b.wallHeight, b.wallThickness);
    const idMap = new Map(oldWalls.map((w, i) => [w.id, newWalls[i].id]));
    const openings = b.openings.map((o) => ({ ...o, wallId: idMap.get(o.wallId) ?? o.wallId }));
    const nb = { ...b, length: l, walls: newWalls, openings };
    const np = { ...p, building: nb };
    commit(set, get, np);
  },
  setWidth: (w) => {
    const p = get().project;
    const b = p.building;
    const oldWalls = b.walls;
    const newWalls = makeRectangularWalls(b.length, w, b.wallHeight, b.wallThickness);
    const idMap = new Map(oldWalls.map((wall, i) => [wall.id, newWalls[i].id]));
    const openings = b.openings.map((o) => ({ ...o, wallId: idMap.get(o.wallId) ?? o.wallId }));
    const nb = { ...b, width: w, walls: newWalls, openings };
    const np = { ...p, building: nb };
    commit(set, get, np);
  },
  addOpening: (type, wallId, x, width, height, sillHeight) => {
    const p = get().project;
    const o: Opening = { id: newId(), type, wallId, x, width, height, sillHeight };
    const nb = { ...p.building, openings: [...p.building.openings, o] };
    const np = { ...p, building: nb };
    commit(set, get, np);
  },
  removeOpening: (id) => {
    const p = get().project;
    const nb = { ...p.building, openings: p.building.openings.filter((o) => o.id !== id) };
    const np = { ...p, building: nb };
    commit(set, get, np);
  },
  editOpening: (id, patch) => {
    const p = get().project;
    const openings = p.building.openings.map((o) => (o.id === id ? { ...o, ...patch } : o));
    const nb = { ...p.building, openings };
    const np = { ...p, building: nb };
    commit(set, get, np);
  },
  select: (id) => set({ selectedId: id }),
  save: () => JSON.stringify(get().project, null, 2),
  load: (json) => {
    const p = JSON.parse(json) as Project;
    set({ project: p, frame: generateFrame(p), history: [], future: [] });
  },
  undo: () => {
    const hist = get().history;
    if (hist.length === 0) return;
    const prev = hist[hist.length - 1];
    const cur = get().project;
    set({
      project: prev,
      frame: generateFrame(prev),
      history: hist.slice(0, -1),
      future: [cur, ...get().future],
    });
  },
  redo: () => {
    const fut = get().future;
    if (fut.length === 0) return;
    const next = fut[0];
    const cur = get().project;
    set({
      project: next,
      frame: generateFrame(next),
      history: [...get().history, cur],
      future: fut.slice(1),
    });
  },
  setDebug: (patch) => set((s) => ({ debug: { ...s.debug, ...patch } })),
}));
