# SIGMA4 UI-03–UI-07 — UX audit implementation, version 0.1.34

Baseline: `d348e1cf2b0347d870da5683c5255960e59f2087` (0.1.33) in `ux-audit-0.1.32`.
Isolated implementation branch: `ux-complete-0.1.34`.
Do not merge or alter `sigma4` without explicit acceptance.

## UI-03 — navigation, object inspector and trustworthy model status

- In 3D, selected opening / board properties are placed above the project tree so
  they are immediately visible without scrolling past unrelated sections.
- The project tree and technical project information use collapsible
  `InspectorGroup` sections. Their initial expanded state preserves existing
  workflows and the automated browser regression suite.
- Persistent status bar distinguishes the validated project model from
  **structural bearing-capacity calculations, which are NOT carried out**.
  Never describe this result as proof of IRC/CSA compliance.
- A standalone starter 3D frame is visibly marked as a demonstration distinct
  from an empty 2D floor plan.
- JSON export/download wording and local autosave remain explicit. No changes
  to canonical JSON schema or generator.

## UI-04 — contextual opening editing

- All selected 3D opening properties appear immediately above the navigation tree.
- For a frame linked to the plan, an explicit button opens the same selected
  opening in the 2D `PlanOpeningInspector` using the canonical existing
  `PLAN_FRAME_SAVE_OPENING` command. No redundant editing model is added.
- Selection of a wall in 2D reveals contextual creation buttons for allowed
  opening types in the sidebar as well as beside the wall on the drawing.
  Buttons have independent test IDs to avoid duplicate locators.
- The preview header and jack-stud parameters can be collapsed while retaining
  the explicit caveat that this does not verify bearing capacity.
- Exact legacy editing of openings by ID is preserved as an advanced, optional
  method for backwards compatibility.

## UI-05 — usable horizontal section

- Section filters: all, exterior, partition, backing; preserve geometrically
  computed cross-section from the canonical JSON.
- Accessible list of intersecting elements and keyboard-operable SVG polygons.
- Fit-to-screen and zoom-to-selected controls with responsive viewBox aspect.
- Selection remains synchronized with the project tree and 3D.
- Area of the selected cross-section is displayed in mm². Filtering does not
  change the underlying project or remove any timber elements.

## UI-06 — mobile, keyboard and contrast

- Mobile toolbar wraps instead of clipping controls at narrow viewport widths.
- Coarse-pointer actions grow to 44px targets; labelled icon and zoom controls
  retain keyboard-visible focus.
- Stronger neutral text and dimension-label colours.
- The section retains an accessible list as an alternative to pointer selection
  in the SVG geometry.
- Existing desktop and mobile sidebar-width constraints stay intact.

## UI-07 — reusable components and tokens

- New `UIPrimitives.tsx` contains `ActionButton`, `InspectorGroup`
  and `ModelStatus`, reused across both workspaces and section.
- UI tokens extended in `ui-theme.css` (spacing, warning, labels);
  standard section and mobile patterns centralized.
- Existing styling and semantic timber colours retained so structural diagrams
  are not inadvertently changed.

## Validation and limitations

The CI workflow runs: `npm ci`, TypeScript lint, unit tests, production build,
UX regression, comprehensive browser regression. New smoke assertions cover
status separation, opening of project-tree sections, filters, keyboard selection,
zoom-to-selected, and mobile toolbar fit.

This work changes only UI, selection routing and viewport representation.
**It does not** validate or certify bearing capacity, connections, engineering
calculations, or compliance with IRC/CSA. It does not replace assistive-technology
usability testing or user testing. The old source file `styles.css` continues
to contain some legacy styles; design tokens and shared components now govern
the newly unified components and should be the entry point for future changes.
