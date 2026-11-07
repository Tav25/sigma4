# SIGMA4 0.1.32 — room topology and net floor areas
Base SHA: `205dbf7405db6d9d9f1d1370d92d509323fe287b`. Branch: `sigma4`. Only geometry and unit tests at this stage.

A deterministic, pure derivation from FloorPlan: orthogonal polygon +
exterior wall strips + internal wall footprints (half-thickness each side)
→ exact coordinate grid → 4-neighbour flood-fill of usable floor cells →
room rectangles, area in mm²/m² and interior label points.
- A doorway is still a boundary between two rooms, not a geometry gap.
- A partial wall that does not close remains within the same room.
- T / X intersections are unioned with no double-counting.
- Deterministic local IDs and no mutation of source JSON or dependency on
  scene mesh / old test documents.
- New unit tests: 9×6 cases, T, X, incomplete wall, doors, moves, thickness,
  concave perimeter. The 2D and 3D display follows in v0.1.33.

**Rule**: work on sigma4 at pinned SHA; JSON sole source of truth;
test, lint, build and browser regression; no force/reset; stop for acceptance.
