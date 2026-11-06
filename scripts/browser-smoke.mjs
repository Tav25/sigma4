import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:4173'
const dir = 'artifacts/sigma4-browser'
await mkdir(dir, { recursive: true })
const processVite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', '4173', '--strictPort',
], { stdio: 'ignore' })
let browser
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.ok(ready, 'Vite preview failed')
  browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader',
  ] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base, { waitUntil: 'networkidle' })
  assert.equal((await page.locator('.app-version').textContent())?.trim(), '0.1.28')
  // New SIGMA4 0.1.0 starts on the separate 2D Plan workspace.
  await page.getByTestId('plan-workspace').waitFor()
  await page.screenshot({ path: dir + '/18-plan-editor-blank.png' })
  await page.getByTestId('tab-frame').click()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
  // 0.1.18: the exact horizontal cut is also available for unlinked 3D
  // projects; verify actual boards at multiple heights and the SVG polygon.
  await page.getByTestId('frame-section-toggle').click()
  const universalCut = page.getByTestId('frame-section')
  await universalCut.getByTestId('frame-section-svg').waitFor()
  await universalCut.getByTestId('frame-section-height').fill('10')
  await universalCut.locator('[data-element-id="plate-bottom-1"]').waitFor()
  assert.equal(await universalCut.locator('[data-element-id="stud-01"]').count(),0)
  const bottomPolygon = await universalCut.locator('[data-element-id="plate-bottom-1"]').getAttribute('points')
  assert.ok(bottomPolygon?.split(' ').length >= 4)
  await universalCut.getByTestId('frame-section-height').fill('1200')
  await universalCut.locator('[data-element-id="stud-01"]').waitFor()
  assert.equal(await universalCut.locator('[data-element-id="plate-bottom-1"]').count(),0)
  const selectedPiece=universalCut.locator('[data-element-id="stud-01"]')
  await selectedPiece.click()
  assert.match(await universalCut.getByTestId('frame-section-selected').textContent(),/stud-01/)
  assert.ok(Number(await selectedPiece.getAttribute('data-area-mm2'))>0)
  await page.screenshot({path:dir+'/32-true-horizontal-cut-mid-height.png'})
  await universalCut.getByTestId('frame-section-height').fill('2620')
  await universalCut.locator('[data-role="top-plate"]').first().waitFor()
  assert.equal(await universalCut.locator('[data-element-id="stud-01"]').count(),0)
  await page.screenshot({path:dir+'/33-true-horizontal-cut-top-plate.png'})
  await page.getByTestId('frame-section-toggle').click()
  await page.locator('.viewport canvas').waitFor({state:'visible'})
  // New canonical project: its source origin and physical timber corner are zero.
  const startDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const initial = JSON.parse(await readFile(await (await startDownload).path(), 'utf8'))
  assert.equal(initial.project.schemaVersion, '1.1.0')
  assert.deepEqual(initial.building.walls[0].origin, { x: 0, y: 0, z: 0 })
  assert.match(await page.getByTestId('first-wall-exterior-corner').textContent(), /X=0, Y=0, Z=0/)
  assert.equal(await page.getByTestId('anchor-first-wall-to-zero').count(), 0)
  const tree = page.getByRole('navigation', { name: 'Дерево проекта' })
  await tree.getByTestId('wall-node-wall-001').waitFor()
  await tree.getByTestId('tree-opening-W01').click()
  await page.getByText('Свойства оконного проёма (W01)').waitFor()
  await page.getByRole('button', { name: '+ Добавить вторую стену' }).click()
  await tree.getByTestId('wall-node-wall-002').waitFor()
  // The selected wall is the only expanded branch in S06.2.
  await tree.locator('[data-testid="wall-node-wall-001"] > summary').click()
  await tree.locator('[data-testid="tree-frame-wall-001"] > summary').click()
  await tree.getByTestId('tree-board-warm-corner-stud').click()
  await page.getByText('Свойства детали').waitFor()
  await page.getByText('Количество элементов: 46').waitFor()
  await page.getByText('Валидация: OK').waitFor()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
  // S06.5.1: measurements exist only on the XZ ground plane.
  // Only numerals appear in the viewport; no floating information panel.
  const viewport = page.locator('.viewport')
  await viewport.waitFor()
  assert.equal(await viewport.getAttribute('data-dimensions-plane'), 'XZ')
  assert.equal(await viewport.getAttribute('data-dimension-total-x'), '6000')
  assert.match(await viewport.getAttribute('data-dimension-total-z'), /^\d+$/)
  assert.equal(await page.getByTestId('dimension-readout').count(), 0)
  const dimensionsControl = page.getByTestId('show-wall-dimensions')
  assert.equal(await dimensionsControl.isChecked(), true)
  assert.equal(await viewport.getAttribute('data-dimensions-visible'), 'true')
  await dimensionsControl.uncheck()
  assert.equal(await viewport.getAttribute('data-dimensions-visible'), 'false')
  await dimensionsControl.check()
  assert.equal(await viewport.getAttribute('data-dimensions-visible'), 'true')
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/01-iso.png' })
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/02-isometric.png' })
  // Confirm both wall lengths and the exterior sizes while the CAD
  // annotation layer is enabled. A top and ISO screenshot is retained
  // for visual orientation/legibility inspection of the vector labels.
  assert.equal(await viewport.getAttribute('data-dimension-total-x'), '6000')
  assert.equal(await viewport.getAttribute('data-dimension-total-z'), '3145')
  await page.screenshot({ path: dir + '/09-vector-dimensions-iso.png' })
  // S06.5.3: isometric and top screenshots for 50%-size vector type,
  // in-plane CAD arrowheads and exterior-only extension lines.
  await page.screenshot({ path: dir + '/10-fixed-dimensions-isometric.png' })
  await page.screenshot({ path: dir + '/12-occlusion-isometric.png' })
  // S06.5.5: per-wall dimensions must remain adjacent to the real front
  // and perpendicular side walls, rather than the global opposite boundary.
  await page.screenshot({ path: dir + '/13-dimensions-near-walls-iso.png' })
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: dir + '/11-fixed-dimensions-iso.png' })
  await page.screenshot({ path: dir + '/14-dimensions-near-walls-iso.png' })
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(200)

  const firstDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const exported = JSON.parse(await readFile(await (await firstDownload).path(), 'utf8'))
  assert.equal(exported.building.walls.length, 2)
  assert.deepEqual(exported.building.openings.map(o => o.id), ['W01', 'W02'])
  assert.equal(exported.assembly.elements.length, 46)
  assert.deepEqual(exported.building.walls[0].openings, ['W01', 'W02'])
  assert.deepEqual(exported.building.walls[1].openings, [])
  const stud = exported.assembly.elements.find(e => e.elementId === 'warm-corner-stud')
  assert.equal(stud.position.x, 5810)
  assert.equal(stud.orientation.roll, 90)
  stud.position.x += 10
  await page.locator('#import-file').setInputFiles([{
    name: 'old.sigma4.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  }])
  await page.getByText('Rev: 2').waitFor()
  await page.getByText('Валидация: OK').waitFor()
  const secondDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const rebuilt = JSON.parse(await readFile(await (await secondDownload).path(), 'utf8'))
  assert.equal(rebuilt.assembly.elements.find(e => e.elementId === 'warm-corner-stud').position.x, 5810)
  assert.deepEqual(errors, [], 'Uncaught browser errors')
  await tree.getByTestId('wall-node-wall-002').waitFor()
  // S06.3: window and door on the *second* (perpendicular) wall.
  await tree.locator('[data-testid="wall-node-wall-002"] > summary').click()
  await page.getByRole('button', { name: 'Добавить окно' }).click()
  await tree.getByTestId('tree-opening-W03').waitFor()
  await page.getByRole('button', { name: 'Добавить дверь' }).click()
  await tree.getByTestId('tree-opening-D01').waitFor()
  await page.getByText('Валидация: OK').waitFor()
  const sideDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const side = JSON.parse(await readFile(await (await sideDownload).path(), 'utf8'))
  assert.deepEqual(side.building.walls[1].openings, ['W03', 'D01'])
  assert.deepEqual(side.building.openings.filter(o => o.wallId === 'wall-002').map(o => o.id), ['W03', 'D01'])
  assert.ok(side.assembly.elements.some(e => e.wallId === 'wall-002' && e.elementId.includes('W03')))
  assert.ok(side.assembly.elements.some(e => e.wallId === 'wall-002' && e.elementId.includes('D01')))
  assert.equal(side.building.markers.filter(m => ['W03', 'D01'].includes(m.openingId)).length, 2)
  // Screenshot with its own opening framing before nine-wall overview.
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/03-second-wall-openings.png' })
  for (let n = 3; n <= 9; n++) {
    await page.getByRole('button', { name: '+ Продолжить стену' }).click()
    await tree.getByTestId('wall-node-wall-' + String(n).padStart(3, '0')).waitFor()
    await page.getByText('Количество стен: ' + n).waitFor()
  }
  await page.getByText('Валидация: OK').waitFor()
  const nineDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const nine = JSON.parse(await readFile(await (await nineDownload).path(), 'utf8'))
  assert.equal(nine.building.walls.length, 9)
  assert.equal(nine.building.connections.length, 8)
  assert.equal(nine.building.connections[0].type, 'california-right')
  assert.ok(nine.assembly.elements.length > 46)
  assert.equal(new Set(nine.assembly.elements.map(e => e.elementId)).size, nine.assembly.elements.length)
  // Only one wall branch is expanded; verify selection and switching even
  // after adding nine real walls to the 3D scene.
  const selectedNinth = tree.getByTestId('wall-node-wall-009')
  assert.notEqual(await selectedNinth.getAttribute('open'), null)
  assert.equal(await tree.getByTestId('wall-node-wall-001').getAttribute('open'), null)
  await tree.locator('[data-testid="wall-node-wall-003"] > summary').click()
  assert.notEqual(await tree.getByTestId('wall-node-wall-003').getAttribute('open'), null)
  assert.equal(await selectedNinth.getAttribute('open'), null)
  await tree.locator('[data-testid="wall-node-wall-009"] > summary').click()
  assert.notEqual(await selectedNinth.getAttribute('open'), null)
  // All nine walls inherit the same ADD_OPENING mechanics.
  await page.getByRole('button', { name: 'Добавить дверь' }).click()
  await tree.getByTestId('tree-opening-D02').waitFor()
  const finalDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const finalProject = JSON.parse(await readFile(await (await finalDownload).path(), 'utf8'))
  assert.deepEqual(finalProject.building.walls[8].openings, ['D02'])
  assert.ok(finalProject.assembly.elements.some(e =>
    e.wallId === 'wall-009' && e.elementId.includes('D02')))
  assert.equal(finalProject.building.markers.some(m => m.openingId === 'D02'), true)
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: dir + '/04-nine-walls-with-openings.png' })
  const beforeMove = nine.building.walls[8].origin.z
  await page.getByRole('button', { name: 'Отменить' }).count() // Undo must remain available
  assert.equal(errors.length, 0, 'Unexpected browser exception')
  assert.ok(Number.isFinite(beforeMove))
  // S06.4: garage is an independent opening type on ANY wall.
  await tree.locator('[data-testid="wall-node-wall-003"] > summary').click()
  await page.getByTestId('add-garage-door').click()
  await tree.getByTestId('tree-opening-G01').waitFor()
  await page.getByText('Свойства гаражных ворот (G01)').waitFor()
  await page.getByText('НЕ проверены', { exact: false }).waitFor()
  await page.getByText('Валидация: OK').waitFor()
  const garageDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const garageProject = JSON.parse(await readFile(await (await garageDownload).path(), 'utf8'))
  const garage = garageProject.building.openings.find(o => o.id === 'G01')
  assert.equal(garage.type, 'garage-door')
  assert.equal(garage.wallId, 'wall-003')
  assert.equal(garage.widthMm, 2438)
  assert.equal(garage.heightMm, 2134)
  assert.equal(garage.sillHeightMm, 0)
  assert.equal(garage.garage.lintelPreviewDepthMm, 286)
  assert.equal(garage.garage.jackStudsPerSide, 2)
  assert.ok(garageProject.assembly.elements.some(e => e.elementId === 'wall-003:G01-header-1' && e.role === 'garage-lintel-preview'))
  assert.ok(garageProject.validation.issues.some(i => i.code === 'GARAGE_LINTEL_REQUIRES_ENGINEERING'))
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: dir + '/05-garage-door.png' })
  assert.equal(errors.length, 0, 'Unexpected browser exception')
  // Focused real-3D visual check: one untouched facade, one garage wall.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('tab-frame').click()
  await page.getByRole('button', { name: '+ Добавить вторую стену' }).click()
  await page.getByTestId('add-garage-door').click()
  await page.getByText('Свойства гаражных ворот (G01)').waitFor()
  await page.getByText('Гаражные ворота: расчёт несущей перемычки', { exact: false }).waitFor()
  await page.getByText('Валидация: OK').waitFor()
  const focusedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const focused = JSON.parse(await readFile(await (await focusedDownload).path(), 'utf8'))
  assert.equal(focused.building.openings.find(o => o.id === 'G01').wallId, 'wall-002')
  assert.equal(focused.assembly.elements.filter(e => e.wallId === 'wall-002' &&
    e.role === 'garage-lintel-preview').length, 2)
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/06-focused-second-wall-garage.png' })
  assert.equal(errors.length, 0)
  // Regression from an actual 12-m wall with G01 3500@2230, W03 @6435,
  // then D01 on the SAME wall. The old generator duplicated
  // wall-002:plate-bottom-right, and rejected this valid operation.
  const lengthInput = page.getByText('Длина (мм)', { exact: true }).locator('..').locator('input')
  await lengthInput.fill('12000')
  await lengthInput.press('Tab')
  const props = page.locator('.props').filter({ hasText: 'Свойства гаражных ворот (G01)' })
  const garageWidth = props.getByText('Ширина (мм)', { exact: true }).locator('..').locator('input')
  await garageWidth.fill('3500')
  await garageWidth.press('Tab')
  const garagePosition = props.getByText('Положение вдоль стены U (мм)', { exact: true }).locator('..').locator('input')
  await garagePosition.fill('2230')
  await garagePosition.press('Tab')
  const garageHeight = props.getByText('Высота (мм)', { exact: true }).locator('..').locator('input')
  await garageHeight.fill('2000')
  await garageHeight.press('Tab')
  await page.getByRole('button', { name: 'Добавить окно' }).click()
  await tree.getByTestId('tree-opening-W03').waitFor()
  const windowProps = page.locator('.props').filter({ hasText: 'Свойства оконного проёма (W03)' })
  const windowPosition = windowProps.getByText('Положение вдоль стены U (мм)', { exact: true }).locator('..').locator('input')
  await windowPosition.fill('6435')
  await windowPosition.press('Tab')
  await page.getByRole('button', { name: 'Добавить дверь' }).click()
  await tree.getByTestId('tree-opening-D01').waitFor()
  await page.getByText('Свойства дверного проёма (D01)').waitFor()
  const mixedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const mixed = JSON.parse(await readFile(await (await mixedDownload).path(), 'utf8'))
  const sideOpenings = mixed.building.openings.filter(o => o.wallId === 'wall-002')
  assert.deepEqual(sideOpenings.map(o => [o.id, o.positionUmm, o.widthMm]), [
    ['G01', 2230, 3500], ['W03', 6435, 450], ['D01', 135, 900],
  ])
  const plates = mixed.assembly.elements.filter(e => e.wallId === 'wall-002' && e.role === 'bottom-plate')
    .sort((a, b) => a.position.x - b.position.x)
    .map(e => [e.elementId, e.position.x, e.lengthMm])
  assert.deepEqual(plates, [
    ['wall-002:plate-bottom-left', 0, 135],
    ['wall-002:plate-bottom-mid-1', 1035, 1195],
    ['wall-002:plate-bottom-right', 5730, 6270],
  ])
  assert.equal(new Set(mixed.assembly.elements.map(e => e.elementId)).size, mixed.assembly.elements.length)
  await page.getByText('Валидация: OK').waitFor()
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(450)
  await page.screenshot({ path: dir + '/07-garage-window-and-door-fixed.png' })
  assert.equal(errors.length, 0)
  // S06.5: import a clean 4 m wall, prove the left end stays at X=0,
  // inspect the dimension readout and capture a real-world-axis screenshot.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('tab-frame').click()
  const blankDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const single = JSON.parse(await readFile(await (await blankDownload).path(), 'utf8'))
  single.building.walls[0].lengthMm = 4000
  single.project.schemaVersion = '1.0.0'
  // Simulate an imported *legacy* project whose wall centre plane,
  // rather than its physical exterior lower-left corner, was at world zero.
  single.building.walls[0].origin = { x: 0, y: 0, z: 0 }
  single.building.walls[0].openings = []
  single.building.openings = []
  single.building.markers = []
  await page.locator('#import-file').setInputFiles([{
    name: 's06-5-four-metre-wall.sigma4.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(single)),
  }])
  await page.locator('.viewport[data-dimension-total-x="4000"]').waitFor()
  assert.equal(await page.locator('.viewport').getAttribute('data-dimension-total-z'), '145')
  const fourDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const four = JSON.parse(await readFile(await (await fourDownload).path(), 'utf8'))
  assert.equal(four.project.schemaVersion, '1.1.0')
  assert.deepEqual(four.building.walls[0].origin, { x: 0, y: 0, z: 72.5 })
  assert.match(await page.getByTestId('first-wall-exterior-corner').textContent(), /Z=72\.5/)
  const snapButton = page.getByTestId('anchor-first-wall-to-zero')
  await snapButton.click()
  await snapButton.waitFor({ state: 'hidden' })
  assert.match(await page.getByTestId('first-wall-exterior-corner').textContent(), /X=0, Y=0, Z=0/)
  const alignedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const aligned = JSON.parse(await readFile(await (await alignedDownload).path(), 'utf8'))
  assert.deepEqual(aligned.building.walls[0].origin, { x: 0, y: 0, z: 0 })
  assert.equal(aligned.building.walls[0].lengthMm, 4000)
  assert.equal(aligned.building.openings.length, 0)
  assert.equal(aligned.validation.valid, true)
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/15-physical-corner-at-world-zero-iso.png' })
  assert.equal(four.building.walls[0].lengthMm, 4000)
  assert.equal(four.assembly.elements.find(e => e.elementId === 'plate-bottom-1').position.x, 0)
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: dir + '/08-first-wall-4000mm.png' })
  const wallLengthInput = page.getByText('Длина (мм)', { exact: true }).locator('..').locator('input')
  await wallLengthInput.fill('5000')
  await wallLengthInput.press('Tab')
  await page.locator('.viewport[data-dimension-total-x="5000"]').waitFor()
  assert.equal(errors.length, 0, 'Unexpected browser exceptions')

  // 0.1.0: draw a real 6 × 4 m perimeter point-by-point using exact
  // decimal-metre input, close it by clicking the first point, then
  // verify dimensions, area, canonical JSON, reopening and mouse input.
  await page.getByTestId('tab-plan').click()
  await page.getByTestId('plan-workspace').waitFor()
  await page.getByTestId('plan-add-exact').click()
  await page.getByTestId('plan-point-0').waitFor()
  assert.equal(await page.getByTestId('plan-close').isEnabled(), false)
  await page.getByTestId('plan-add-exact').click() // +X 6 m
  await page.getByTestId('plan-point-1').waitFor()
  await page.getByTestId('plan-length-input').fill('4')
  await page.getByTestId('plan-add-exact').click() // -Z 4 m
  await page.getByTestId('plan-point-2').waitFor()
  await page.getByTestId('plan-length-input').fill('6')
  await page.getByTestId('plan-add-exact').click() // -X 6 m
  await page.getByTestId('plan-point-3').waitFor()
  assert.equal(await page.getByTestId('plan-close').isEnabled(), true)
  await page.screenshot({ path: dir + '/19-plan-drawing-6x4-open.png' })
  await page.getByTestId('plan-point-0').click() // snap and close
  await page.getByTestId('plan-closed-status').waitFor()
  assert.match(await page.getByTestId('plan-dimensions').textContent(), /6,00.*4,00/)
  assert.match(await page.getByTestId('plan-perimeter').textContent(), /20,00/)
  assert.match(await page.getByTestId('plan-area').textContent(), /24/)
  await page.screenshot({ path: dir + '/20-plan-perimeter-6x4-closed.png' })
  const planDownload = page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const planSaved = JSON.parse(await readFile(await (await planDownload).path(), 'utf8'))
  assert.deepEqual(planSaved.building.floorPlan, {
    exterior: [
      {xMm:0,zMm:0},{xMm:6000,zMm:0},
      {xMm:6000,zMm:-4000},{xMm:0,zMm:-4000},
    ], closed:true, interiorWalls:[],
  })
  assert.equal(planSaved.validation.valid, true)
  assert.equal(planSaved.building.walls.length, 1) // existing 3D mode unchanged
  // v0.1.12: keep the old 6x4 exterior construction, then start a fresh
  // 10x7 metre garage to prove genuinely free points and segment-only erasure.
  await page.getByTestId('plan-reopen').click()
  await page.once('dialog', d=>d.accept())
  await page.getByTestId('plan-reset').click()
  await page.getByTestId('plan-point-0').waitFor({state:'detached'})
  await page.getByTestId('plan-add-exact').click() // (0,0)
  await page.getByTestId('plan-direction').selectOption('+x')
  await page.getByTestId('plan-length-input').fill('10')
  await page.getByTestId('plan-add-exact').click() // (10,0)
  await page.getByTestId('plan-length-input').fill('7')
  await page.getByTestId('plan-add-exact').click() // (10,-7)
  await page.getByTestId('plan-length-input').fill('10')
  await page.getByTestId('plan-add-exact').click() // (0,-7)
  await page.getByTestId('plan-close').click()
  await page.getByTestId('plan-closed-status').waitFor()
  assert.match(await page.getByTestId('plan-dimensions').textContent(),/10,00.*7,00/)
  assert.match(await page.getByTestId('plan-area').textContent(),/70/)
  await page.screenshot({path:dir+'/23-garage-10x7-empty.png'})

  const garagePoint = async (xMm,zMm, targetPage = page) =>
    targetPage.getByTestId('plan-canvas').evaluate((svg,p)=>{
      const circle=i=>svg.querySelector('[data-testid="plan-point-'+i+'"] circle')
      const a=circle(0),b=circle(1),c=circle(2)
      if(!a||!b||!c)throw Error('Cannot find garage perimeter')
      const x0=Number(a.getAttribute('cx')),y0=Number(a.getAttribute('cy'))
      const dx=Number(b.getAttribute('cx'))-x0
      const dy=Number(c.getAttribute('cy'))-y0
      const point=new DOMPoint(x0+dx*p.xMm/10000,y0+dy*(-p.zMm)/7000)
        .matrixTransform(svg.getScreenCTM())
      return{x:point.x,y:point.y,screenPxPerMeter:dx/10}
    },{xMm,zMm})
  const clickGarage = async (xMm,zMm) => {
    const pos = await garagePoint(xMm,zMm)
    await page.mouse.click(pos.x,pos.y)
    return pos
  }

  // 0.10m grid permits a 4.70m side wall while numeric edits retain 1mm accuracy.
  await page.getByTestId('plan-grid-step').selectOption('100')
  // Free point: the earlier wall-to-wall restriction must no longer apply.
  await page.getByTestId('plan-tool-point').click()
  await clickGarage(2500,-3500)
  assert.equal((await page.getByTestId('plan-node-count').textContent())?.trim(),'1')
  await page.getByTestId('plan-tool-interior').click()
  await clickGarage(0,-2000)
  await page.getByTestId('plan-anchor-info').waitFor()
  await clickGarage(10000,-2000)
  await page.keyboard.press('Enter') // Finish polyline: no implicit next wall
  assert.equal((await page.getByTestId('plan-wall-count').textContent())?.trim(),'1')
  await clickGarage(4700,0)
  await clickGarage(4700,-2000)
  await page.keyboard.press('Enter')
  assert.equal((await page.getByTestId('plan-wall-count').textContent())?.trim(),'3')
  await page.screenshot({path:dir+'/24-garage-before-erase.png'})

  // Delete only the right horizontal piece, after automatic junction split.
  await page.getByTestId('plan-tool-erase').click()
  await clickGarage(7500,-2000)
  assert.equal((await page.getByTestId('plan-wall-count').textContent())?.trim(),'2')
  const deletedDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const deleted=JSON.parse(await readFile(await (await deletedDownload).path(),'utf8'))
  assert.equal(deleted.building.floorPlan.graph.edges.length,2)
  assert.equal(deleted.building.floorPlan.interiorWalls.length,0)
  assert.equal(deleted.building.floorPlan.graph.nodes.some(n=>n.xMm===2500&&n.zMm===-3500),true)
  assert.equal(deleted.validation.valid,true)
  assert.equal(deleted.building.walls.length,1) // Legacy 3D timber not regenerated
  await page.screenshot({path:dir+'/25-garage-angular-storage-after-erase.png'})

  // Exact dimension moves a connected wall with its shared T node.
  await page.getByTestId('plan-tool-select').click()
  await clickGarage(4700,-1000)
  await page.getByTestId('plan-clearance-negative').waitFor()
  assert.match(await page.getByTestId('plan-clearance-negative').textContent(),/4,70/)
  await page.getByTestId('plan-clearance-negative').locator('.plan-click-dimension').click()
  await page.getByTestId('plan-dimension-input').fill('5,20')
  await page.getByTestId('plan-dimension-input').press('Enter')
  await page.getByTestId('plan-dimension-input').waitFor({state:'detached'})
  assert.match(await page.getByTestId('plan-clearance-negative').textContent(),/5,20/)
  await page.getByTestId('plan-outer-thickness').fill('200')
  await page.getByTestId('plan-save-outer-thickness').click()
  const movedDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const moved=JSON.parse(await readFile(await (await movedDownload).path(),'utf8'))
  const nodes=moved.building.floorPlan.graph.nodes
  const edgeWalls=moved.building.floorPlan.graph.edges.map(edge=>{
    const a=nodes.find(n=>n.id===edge.a),b=nodes.find(n=>n.id===edge.b)
    return {start:a,end:b}
  })
  assert.equal(edgeWalls.some(w=>w.start.xMm===5200&&w.end.xMm===5200),true)
  assert.equal(edgeWalls.some(w=>w.start.xMm===0&&w.end.xMm===5200),true)
  assert.equal(moved.building.floorPlan.exteriorThicknessMm,200)
  assert.equal(moved.validation.valid,true)
  await page.screenshot({path:dir+'/26-garage-moved-connected-wall.png'})

  // Split an existing segment at an arbitrary point, then delete only a
  // sub-segment. The shared T-node and the outer house remain intact.
  await page.getByTestId('plan-tool-split').click()
  await clickGarage(2300,-2000) // 0.10m snap -> 2.30m
  assert.equal((await page.getByTestId('plan-wall-count').textContent())?.trim(),'3')
  await page.getByTestId('plan-tool-erase').click()
  await clickGarage(1000,-2000)
  assert.equal((await page.getByTestId('plan-wall-count').textContent())?.trim(),'2')

  // 0.1.28: change length of a free end, retaining the T-connected fixed endpoint.
  await page.getByTestId('plan-tool-select').click()
  await clickGarage(3500,-2000)
  await page.getByTestId('plan-length-editor').waitFor()
  await page.getByTestId('plan-length-anchor').selectOption('end')
  await page.getByTestId('plan-length-value').fill('3,200')
  await page.getByTestId('plan-save-length').click()
  const lengthDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const afterLength=JSON.parse(await readFile(await (await lengthDownload).path(),'utf8'))
  const lengthNodes=afterLength.building.floorPlan.graph.nodes
  const lengthWalls=afterLength.building.floorPlan.graph.edges.map(edge=>[
    lengthNodes.find(n=>n.id===edge.a),lengthNodes.find(n=>n.id===edge.b),
  ])
  assert.ok(lengthWalls.some(([a,b])=>
    a.xMm===2000&&b.xMm===5200&&a.zMm===-2000&&b.zMm===-2000))
  await page.screenshot({path:dir+'/41-wall-length-fixed-T-anchor.png'})
  await page.keyboard.press('Control+z')
  const undoLengthDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const undoLength=JSON.parse(await readFile(await (await undoLengthDownload).path(),'utf8'))
  assert.ok(undoLength.building.floorPlan.graph.nodes.some(n=>n.xMm===2300&&n.zMm===-2000))
  await page.keyboard.press('Control+y')

  // Delete isolated point without touching connected wall nodes.
  await page.getByTestId('plan-tool-select').click()
  await clickGarage(2500,-3500)
  await page.getByTestId('plan-selected-graph-node').waitFor()
  await page.getByTestId('plan-node-edit-x').fill('2,75')
  await page.getByTestId('plan-save-graph-node').click()
  const graphFinalDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const final=JSON.parse(await readFile(await (await graphFinalDownload).path(),'utf8'))
  assert.equal(final.building.floorPlan.graph.nodes.some(n=>n.xMm===2750&&n.zMm===-3500),true)
  assert.equal(final.validation.valid,true)

  await page.locator('#import-file').setInputFiles([{
    name:'garage-0.1.12.sigma4.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(final)),
  }])
  await page.getByTestId('plan-wall-count').waitFor()
  const reexport=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const imported=JSON.parse(await readFile(await (await reexport).path(),'utf8'))
  assert.deepEqual(imported.building.floorPlan.graph,final.building.floorPlan.graph)
  assert.equal(imported.validation.valid,true)
  // New linked project: draw and edit the same geometry used by the real 3D scene.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('plan-add-exact').click()
  for (const length of ['10', '7', '10']) {
    await page.getByTestId('plan-length-input').fill(length)
    await page.getByTestId('plan-add-exact').click()
  }
  await page.getByTestId('plan-close').click()
  await page.getByTestId('plan-manual-openings').click()
  await page.getByTestId('plan-frame-pick').click()
  await clickGarage(1000, 0)
  await page.getByTestId('plan-frame-opening-positionUmm').waitFor()
  assert.equal(await page.getByTestId('plan-frame-opening-positionUmm').inputValue(), '1000')
  await page.getByTestId('plan-frame-save-opening').click()
  for (const [type, wall, offset] of [['door', 'plan-left', '1800'], ['garage-door', 'plan-back', '2000']]) {
    await page.getByTestId('plan-frame-add-opening').click()
    await page.getByTestId('plan-frame-opening-type').selectOption(type)
    await page.getByTestId('plan-frame-opening-wall').selectOption(wall)
    await page.getByTestId('plan-frame-opening-positionUmm').fill(offset)
    await page.getByTestId('plan-frame-save-opening').click()
  }
  await page.getByTestId('plan-frame-opening-W01').waitFor()
  await page.getByTestId('plan-frame-opening-D01').waitFor()
  await page.getByTestId('plan-frame-opening-G01').waitFor()
  await page.screenshot({ path: dir + '/27-linked-garage-plan.png' })

  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 4', { exact: true }).waitFor()
  for (const [side, length] of [['front', 10000], ['right', 6710], ['back', 10000], ['left', 6710]]) {
    assert.match(await page.getByTestId('wall-node-plan-' + side).locator(':scope > summary').textContent(),
      new RegExp(length + ' мм'))
  }
  await page.locator('.viewport[data-dimension-total-x="10000"][data-dimension-total-z="7000"]').waitFor()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
  await page.screenshot({ path: dir + '/28-linked-garage-frame.png' })

  await page.getByTestId('tab-plan').click()
  await page.getByTestId('plan-frame-width').fill('11')
  await page.getByTestId('plan-frame-resize').click()
  assert.match(await page.getByTestId('plan-dimensions').textContent(), /11,00.*7,00/)
  await page.getByTestId('plan-frame-width').fill('4')
  await page.getByTestId('plan-frame-resize').click()
  assert.match(await page.getByTestId('plan-frame-error').textContent(), /G01/)
  assert.equal(await page.getByTestId('plan-frame-opening-G01').getAttribute('data-conflict'), 'true')
  assert.match(await page.getByTestId('plan-dimensions').textContent(), /11,00.*7,00/)
  const linkedDownload = page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const linkedJson = await readFile(await (await linkedDownload).path(), 'utf8')
  const linked = JSON.parse(linkedJson)
  assert.equal(linked.building.floorPlan.frame.built, true)
  assert.equal(linked.building.floorPlan.frame.openings.length, 3)
  assert.equal(linked.building.floorPlan.frame.openings.find(o => o.id === 'G01').positionUmm, 2000)
  assert.deepEqual(linked.building.walls.map(wall => wall.lengthMm), [11000, 6710, 11000, 6710])
  assert.equal(linked.validation.valid, true)

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#import-file').setInputFiles([{
    name: 'linked-garage.sigma4.json', mimeType: 'application/json', buffer: Buffer.from(linkedJson),
  }])
  await page.getByTestId('plan-frame-opening-G01').waitFor()
  assert.match(await page.getByTestId('plan-dimensions').textContent(), /11,00.*7,00/)
  await page.getByTestId('plan-frame-build').click()
  await page.locator('.viewport[data-dimension-total-x="11000"][data-dimension-total-z="7000"]').waitFor()
  await page.getByTestId('tab-plan').click()
  await page.getByTestId('plan-frame-width').fill('10')
  await page.getByTestId('plan-frame-resize').click()
  await page.getByTestId('plan-tool-interior').click()
  await clickGarage(0, -3000)
  await clickGarage(4000, -3000)
  await clickGarage(4000, 0)
  await page.keyboard.press('Enter')
  assert.equal((await page.getByTestId('plan-wall-count').textContent())?.trim(), '2')
  await page.getByTestId('plan-frame-enable-partitions').click()
  await page.getByTestId('plan-manual-openings').click()
  await page.getByTestId('plan-frame-add-opening').click()
  await page.getByTestId('plan-frame-opening-wall').selectOption('partition-I001')
  assert.equal(await page.getByTestId('plan-frame-opening-type').inputValue(), 'door')
  await page.getByTestId('plan-frame-opening-positionUmm').fill('1200')
  await page.getByTestId('plan-frame-save-opening').click()
  await page.getByTestId('plan-frame-opening-D02').waitFor()
  await page.getByTestId('plan-tool-select').click()
  await clickGarage(4000, -1500)
  const cleanSize = page.getByTestId('plan-clearance-negative')
  assert.match(await cleanSize.textContent(), /3,805/)
  await cleanSize.getByRole('button').click()
  await page.getByTestId('plan-dimension-input').fill('4,105')
  await page.getByTestId('plan-dimension-input').press('Enter')
  assert.match(await cleanSize.textContent(), /4,105/)
  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 6', { exact: true }).waitFor()
  await page.locator('.viewport[data-dimension-total-x="10000"][data-dimension-total-z="7000"]').waitFor()
  await page.getByTestId('frame-section-toggle').click()
  const section = page.getByTestId('frame-section')
  await section.locator('[data-wall-id="partition-I001"]').first().waitFor()
  const atDoorHeight = await section.getByTestId('frame-section-piece').count()
  await page.getByTestId('frame-section-height').fill('2120')
  assert.ok(await section.getByTestId('frame-section-piece').count() > atDoorHeight)
  await page.screenshot({ path: dir + '/29-garage-partition-section.png' })
  await section.getByTestId('frame-section-height').fill('1200')
  await section.locator('[data-element-id*="partition-backing-"]').first().waitFor()
  assert.equal(await section.locator('[data-element-id*="partition-backing-"]').count(),6)
  assert.equal(await section.locator('[data-element-id$="-flat"]').count(),2)
  const flatAreas=await section.locator('[data-element-id$="-flat"]').evaluateAll(
    nodes=>nodes.map(node=>Number(node.getAttribute('data-area-mm2'))))
  assert.equal(flatAreas.every(area=>Math.abs(area-4500)<0.001),true)
  await page.screenshot({ path: dir + '/34-haun-three-stud-channel-1200.png' })
  // v0.1.20: the second upper course must bridge the 3D partition junction.
  // The first cap remains at 2635 mm; the new lapped caps appear at 2680.
  await section.getByTestId('frame-section-height').fill('2635')
  const firstCourse=await section.locator('[data-wall-id^="partition-"][data-role="top-plate"]').count()
  assert.equal(firstCourse,2)
  await section.getByTestId('frame-section-height').fill('2680')
  const secondCourse=section.locator('[data-wall-id^="partition-"][data-element-id*=":plate-top-2"]')
  assert.equal(await secondCourse.count(),2)
  const exteriorParts=section.locator('[data-wall-id="plan-front"][data-element-id*=":plate-top-2"]')
  assert.equal(await exteriorParts.count(),2)
  const capAreas=await secondCourse.evaluateAll(nodes=>
    nodes.map(node=>Number(node.getAttribute('data-area-mm2'))))
  assert.equal(capAreas.every(value=>value>0),true)
  await page.screenshot({path:dir+'/35-haun-upper-plate-laps-2680.png'})

  // 0.1.17: the actual generated assembly (not only a drawn 2D symbol)
  // must contain two transverse receiving studs per outside T connection.
  await page.getByTestId('tab-plan').click()
  const receiverDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const receiverDoc=JSON.parse(await readFile(await (await receiverDownload).path(),'utf8'))
  const receiving=receiverDoc.assembly.elements.filter(e=>e.elementId.includes(':partition-backing-'))
  assert.equal(receiving.length,6)
  const frontReceiving=receiving.filter(e=>e.wallId==='plan-front')
  const leftReceiving=receiving.filter(e=>e.wallId==='plan-left')
  assert.equal(frontReceiving.length,3)
  assert.equal(leftReceiving.length,3)
  assert.equal(frontReceiving.filter(e=>e.elementId.endsWith('-flat')).length,1)
  const flatNailer=frontReceiving.find(e=>e.elementId.endsWith('-flat'))
  assert.equal(flatNailer.sectionMm.width,45)
  assert.equal(flatNailer.sectionMm.height,100)
  assert.equal(flatNailer.orientation.roll,90)
  assert.equal(frontReceiving.filter(e=>!e.elementId.endsWith('-flat')).every(
    e=>e.sectionMm.width===45&&e.sectionMm.height===145),true)
  assert.equal(flatNailer.connectionIds.some(id=>id.startsWith('partition-')),true)
  assert.equal(receiverDoc.validation.valid,true)

  // Direct 2D editing uses the selected host, a transient preview, and one
  // canonical command when a placement or drag is confirmed.
  await page.reload({ waitUntil: 'networkidle' })
  const drawDirectGarage = async targetPage => {
    await targetPage.getByTestId('plan-add-exact').click()
    for (const length of ['10', '7', '10']) {
      await targetPage.getByTestId('plan-length-input').fill(length)
      await targetPage.getByTestId('plan-add-exact').click()
    }
    await targetPage.getByTestId('plan-close').click()
  }
  await drawDirectGarage(page)
  const hoverGarage = async (xMm, zMm, steps = 4) => {
    const point = await garagePoint(xMm, zMm)
    await page.mouse.move(point.x, point.y, { steps })
  }
  const revision = async () => Number((await page.locator('.top-bar').getByText(/Rev:/).textContent()).match(/\d+/)[0])
  const wallActions = page.getByTestId('plan-wall-actions')
  const ghost = page.getByTestId('plan-opening-preview')

  await clickGarage(2500, 0)
  assert.equal(await wallActions.getAttribute('data-wall-id'), 'plan-front')
  await page.screenshot({ path: dir + '/30-direct-wall-actions.png' })
  await wallActions.getByTestId('plan-add-window').click()
  await hoverGarage(2400, 0)
  assert.equal(await ghost.getAttribute('data-offset-mm'), '1800')
  assert.equal(await ghost.getAttribute('data-invalid'), 'false')
  await clickGarage(2400, 0)
  assert.equal(await page.getByTestId('plan-frame-opening-W01').getAttribute('data-offset-mm'), '1800')

  const beforeCollision = await revision()
  await clickGarage(4000, 0)
  await wallActions.getByTestId('plan-add-window').click()
  await hoverGarage(2300, 0)
  assert.equal(await ghost.getAttribute('data-invalid'), 'true')
  const conflictText = await page.getByTestId('plan-canvas-feedback').textContent()
  assert.match(conflictText, /W01/)
  assert.match(conflictText, /W02/)
  await clickGarage(2300, 0)
  assert.equal(await revision(), beforeCollision)
  await page.keyboard.press('Escape')
  await ghost.waitFor({ state: 'detached' })
  await wallActions.getByTestId('plan-add-window').click()
  await hoverGarage(5000, 0)
  assert.equal(await ghost.getAttribute('data-invalid'), 'false')
  await page.getByRole('button', { name: 'Отменить размещение' }).press('Enter')
  await ghost.waitFor({ state: 'detached' })
  assert.equal(await revision(), beforeCollision)

  await clickGarage(5500, -7000)
  assert.equal(await wallActions.getAttribute('data-wall-id'), 'plan-back')
  await wallActions.getByTestId('plan-add-garage-door').click()
  await hoverGarage(5500, -7000)
  assert.equal(await ghost.getAttribute('data-offset-mm'), '3300')
  await clickGarage(5500, -7000)
  assert.equal(await page.getByTestId('plan-frame-opening-G01').getAttribute('data-offset-mm'), '3300')

  await page.getByTestId('plan-toolbar-wall').click()
  const beforeAnchor = await revision()
  await clickGarage(0, -3000)
  await hoverGarage(4000, -3000)
  assert.match(await page.getByTestId('plan-wall-draft').textContent(), /4,00/)
  assert.equal(await page.getByTestId('plan-wall-draft').getAttribute('data-invalid'), 'false')
  await page.keyboard.press('Escape')
  await page.getByTestId('plan-wall-draft').waitFor({ state: 'detached' })
  assert.equal(await revision(), beforeAnchor)
  assert.equal((await page.getByTestId('plan-node-count').textContent()).trim(), '0')

  await page.getByTestId('plan-toolbar-wall').click()
  await clickGarage(0, -3000)
  await clickGarage(4000, -3000)
  await clickGarage(4000, 0)
  await page.keyboard.press('Enter')
  assert.equal((await page.getByTestId('plan-wall-count').textContent()).trim(), '2')
  await page.getByTestId('plan-toolbar-select').click()
  await clickGarage(2000, -3000)
  assert.equal(await wallActions.getAttribute('data-wall-id'), 'partition-I001')
  assert.equal(await wallActions.getByTestId('plan-add-window').count(), 0)
  assert.equal(await wallActions.getByTestId('plan-add-garage-door').count(), 0)
  await wallActions.getByTestId('plan-add-door').click()
  await hoverGarage(1650, -3000)
  assert.equal(await ghost.getAttribute('data-invalid'), 'false')
  await clickGarage(1650, -3000)
  const door = page.getByTestId('plan-frame-opening-D01')
  assert.equal(await door.getAttribute('data-offset-mm'), '1200')
  await door.locator('.plan-door-arc').waitFor()
  await page.getByTestId('plan-opening-inspector').waitFor()

  const beforeDrag = await revision()
  await hoverGarage(1650, -3000)
  await page.mouse.down()
  await hoverGarage(1950, -2820)
  assert.equal(await ghost.getAttribute('data-offset-mm'), '1500')
  assert.equal(await ghost.getAttribute('data-invalid'), 'false')
  await hoverGarage(4350, -2820, 1)
  assert.equal(await ghost.getAttribute('data-invalid'), 'true')
  await page.screenshot({ path: dir + '/31-direct-opening-conflict.png' })
  assert.equal(await revision(), beforeDrag)
  await page.mouse.up()
  await ghost.waitFor({ state: 'detached' })
  assert.equal(await door.getAttribute('data-offset-mm'), '1500')
  assert.equal(await revision(), beforeDrag + 1)
  await page.getByTitle('Отменить', { exact: true }).click()
  assert.equal(await door.getAttribute('data-offset-mm'), '1200')
  await page.getByTitle('Повторить', { exact: true }).click()
  assert.equal(await door.getAttribute('data-offset-mm'), '1500')

  await hoverGarage(1950, -3000)
  await page.mouse.down()
  await hoverGarage(2250, -2900)
  await ghost.waitFor()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal(await door.getAttribute('data-offset-mm'), '1500')

  await page.getByTestId('plan-opening-dimension-start').getByRole('button').click()
  await page.getByTestId('plan-opening-dimension-input').fill('1,537')
  await page.getByTestId('plan-opening-dimension-input').press('Enter')
  assert.equal(await door.getAttribute('data-offset-mm'), '1537')
  await page.getByTestId('plan-door-flip-hinge').click()
  await page.getByTestId('plan-door-flip-swing').click()
  await page.screenshot({ path: dir + '/32-direct-opening-dimensions.png' })

  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 6', { exact: true }).waitFor()
  const directDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const direct = JSON.parse(await readFile(await (await directDownload).path(), 'utf8'))
  const authored = direct.building.floorPlan.frame.openings
  assert.equal(authored.length, 3)
  assert.deepEqual(authored.find(opening => opening.id === 'D01').swing, { hinge: 'end', side: 'right' })
  const physicalDoor = direct.building.openings.find(opening => opening.id === 'D01')
  const physicalWall = direct.building.walls.find(wall => wall.wallId === physicalDoor.wallId)
  assert.equal(physicalWall.origin.x + physicalDoor.positionUmm, 1537)
  assert.equal(authored.find(opening => opening.id === 'D01').positionUmm, 1537)
  assert.equal(direct.validation.valid, true)
  await page.screenshot({ path: dir + '/33-direct-openings-frame.png' })

  // Screenshot regression: 9 x 6 metre house with a north-west 3 x 3.25 m
  // room, through internal Z wall, left-facing T branch and door on the
  // upper wall. Run it through the actual UI, not just the ProjectStore.
  await page.reload({waitUntil:'networkidle'})
  await page.getByTestId('plan-add-exact').click()
  for(const length of ['9','6','9']){
    await page.getByTestId('plan-length-input').fill(length)
    await page.getByTestId('plan-add-exact').click()
  }
  await page.getByTestId('plan-close').click()
  const clickNorthwest=async (xMm,zMm)=>{
    const pos=await page.getByTestId('plan-canvas').evaluate((svg,p)=>{
      const circle=i=>svg.querySelector('[data-testid="plan-point-'+i+'"] circle')
      const a=circle(0),b=circle(1),c=circle(2)
      if(!a||!b||!c)throw Error('Missing north-west perimeter nodes')
      const x0=Number(a.getAttribute('cx')),y0=Number(a.getAttribute('cy'))
      const dx=Number(b.getAttribute('cx'))-x0
      const dy=Number(c.getAttribute('cy'))-y0
      const point=new DOMPoint(x0+dx*p.xMm/9000,y0+dy*(-p.zMm)/6000)
        .matrixTransform(svg.getScreenCTM())
      return {x:point.x,y:point.y}
    },{xMm,zMm})
    await page.mouse.click(pos.x,pos.y)
  }
  await page.getByTestId('plan-toolbar-wall').click()
  await clickNorthwest(3000,-6000)
  await clickNorthwest(3000,0)
  await page.keyboard.press('Enter')
  await clickNorthwest(0,-3250)
  await clickNorthwest(3000,-3250)
  await page.keyboard.press('Enter')
  assert.equal((await page.getByTestId('plan-wall-count').textContent()).trim(),'3')
  const nwDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const nwDoc=JSON.parse(await readFile(await (await nwDownload).path(),'utf8'))
  const nwNodes=nwDoc.building.floorPlan.graph.nodes
  const topEdge=nwDoc.building.floorPlan.graph.edges.find(edge=>{
    const a=nwNodes.find(n=>n.id===edge.a),b=nwNodes.find(n=>n.id===edge.b)
    return a.xMm===3000 && b.xMm===3000 && Math.min(a.zMm,b.zMm)===-6000
  })
  assert.ok(topEdge,'Must split north-south wall at the 3.25m T node')
  await page.getByTestId('plan-frame-enable-partitions').click()
  await page.getByTestId('plan-manual-openings').click()
  await page.getByTestId('plan-frame-add-opening').click()
  await page.getByTestId('plan-frame-opening-wall').selectOption('partition-'+topEdge.id)
  await page.getByTestId('plan-frame-opening-positionUmm').fill('1500')
  await page.getByTestId('plan-frame-save-opening').click()
  await page.getByTestId('plan-frame-opening-D01').waitFor()
  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 6',{exact:true}).waitFor()
  await page.getByTestId('frame-section-toggle').click()
  await page.getByTestId('frame-section-height').fill('2680')
  assert.ok(await page.locator('[data-element-id*=":plate-top-2"]').count()>=7)
  await page.screenshot({path:dir+'/36-northwest-9x6-tee-door-lapped-caps.png'})
  await page.getByTestId('tab-plan').click()
  await page.getByTestId('plan-toolbar-select').click()
  await clickNorthwest(3000,-5100)
  await page.getByTestId('plan-selected-interior').waitFor()
  const originalClearanceText=await page.getByTestId('plan-clearance-negative').textContent()
  const originalClearanceMatch=originalClearanceText.match(/(\d+),(\d+)/)
  assert.ok(originalClearanceMatch,'A numeric negative clearance must exist')
  const clearanceMm=Math.round(Number(originalClearanceMatch[0].replace(',','.'))*1000)
  for(const desiredMm of [clearanceMm+250,clearanceMm]){
    const desired=(desiredMm/1000).toFixed(3).replace('.',',')
    await page.getByTestId('plan-clearance-negative').locator('.plan-click-dimension').click()
    await page.getByTestId('plan-dimension-input').fill(desired)
    await page.getByTestId('plan-dimension-input').press('Enter')
    await page.getByTestId('plan-dimension-input').waitFor({state:'detached'})
    assert.match(await page.getByTestId('plan-clearance-negative').textContent(),
      new RegExp(desired.replace(',','[,]')))
  }
  await page.screenshot({path:dir+'/37-northwest-9x6-wall-resized-back.png'})
  const nwBuiltDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const nwBuilt=JSON.parse(await readFile(await (await nwBuiltDownload).path(),'utf8'))
  assert.equal(nwBuilt.validation.valid,true)
  assert.equal(nwBuilt.building.walls.length,6)
  assert.equal(nwBuilt.building.floorPlan.frame.openings.length,1)
  // v0.1.21: ordinary studs are generated AFTER obligatory support posts,
  // openings and three-stud channels. They must not extend into the door.
  const frameStuds=nwBuilt.assembly.elements.filter(e=>
    e.elementId.includes(':stud-layout-')&&e.role==='stud')
  assert.ok(frameStuds.length>=12,'Expected feature-first ordinary stud detailing')
  const framedDoor=nwBuilt.building.openings.find(o=>o.id==='D01')
  assert.ok(framedDoor)
  assert.equal(frameStuds.filter(e=>e.wallId===framedDoor.wallId).every(e=>
    e.position.x<framedDoor.positionUmm-45 ||
    e.position.x>framedDoor.positionUmm+framedDoor.widthMm+45),true)
  assert.ok(nwBuilt.assembly.elements.some(e=>
    e.elementId.includes('D01-cripple-top-layout-')))


  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  mobile.on('pageerror', error => errors.push(error.message))
  await mobile.goto(base, { waitUntil: 'networkidle' })
  await drawDirectGarage(mobile)
  const mobileWall = await garagePoint(4500, 0, mobile)
  await mobile.touchscreen.tap(mobileWall.x, mobileWall.y)
  const mobileActions = mobile.getByTestId('plan-wall-actions')
  await mobileActions.waitFor()
  const mobileRect = await mobileActions.boundingBox()
  assert.ok(mobileRect && mobileRect.x >= 0 && mobileRect.x + mobileRect.width <= 390)
  await mobileActions.getByTestId('plan-add-door').tap()
  const mobileDoor = await garagePoint(4500, 0, mobile)
  await mobile.touchscreen.tap(mobileDoor.x, mobileDoor.y)
  await mobile.getByTestId('plan-frame-opening-D01').waitFor()
  await mobile.screenshot({ path: dir + '/34-direct-openings-touch.png' })
  await mobile.close()
  assert.deepEqual(errors, [], 'Browser exceptions')
  // Stage 3: use real UI fields to add a 235-mm exterior header,
  // two jack studs per side and explicit line-load demands.
  const openPanel = page.locator('details.plan-manual-openings')
  if (!(await openPanel.getAttribute('open'))) {
    await page.getByTestId('plan-manual-openings').click()
  }
  await page.getByTestId('plan-frame-add-opening').click()
  await page.getByTestId('plan-frame-opening-wall').selectOption('plan-front')
  await page.getByTestId('plan-frame-opening-positionUmm').fill('6000')
  await page.getByTestId('plan-header-profile-toggle').click()
  await page.getByTestId('plan-header-depth').fill('235')
  await page.getByTestId('plan-header-jacks').fill('2')
  await page.getByTestId('plan-header-loads-enable').check()
  await page.getByTestId('plan-header-dead-load').fill('3')
  await page.getByTestId('plan-header-live-load').fill('2')
  await page.getByTestId('plan-frame-save-opening').click()
  await page.getByTestId('plan-frame-opening-W01').waitFor()
  const structuralExport=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const structural=JSON.parse(await readFile(await (await structuralExport).path(),'utf8'))
  const profileOpening=structural.building.floorPlan.frame.openings.find(o=>o.id==='W01')
  assert.deepEqual(profileOpening.headerPreview,{depthMm:235,jackStudsPerSide:2})
  assert.deepEqual(profileOpening.designLoads,{permanentKNPerM:3,variableKNPerM:2})
  assert.equal(structural.validation.valid,true)
  assert.equal(structural.validation.engineeringStatus,'not_evaluated')
  assert.ok(structural.validation.issues.some(i=>
    i.code==='HEADER_DEMAND_REQUIRES_DESIGN' && i.messageRu.includes('0.90')))
  assert.equal(structural.assembly.elements.filter(e=>e.wallId==='plan-front' &&
    e.elementId.startsWith('plan-front:W01-jack-')).length,4)
  assert.equal(structural.assembly.elements.filter(e=>e.wallId==='plan-front' &&
    e.elementId.startsWith('plan-front:W01-header-')).every(e=>
      e.sectionMm.height===235),true)
  await page.screenshot({path:dir+'/38-stage3-header-profile-235mm-jacks2.png'})
  // S17: resize a completed 9x6 plan to 10x7 through the actual UI.
  // The bottom exterior attachment of a partition moves to -7000 mm,
  // but the shared T node, D01 and configured W01 must remain valid.
  await page.getByTestId('plan-frame-width').fill('10')
  await page.getByTestId('plan-frame-depth').fill('7')
  await page.getByTestId('plan-frame-resize').click()
  assert.match(await page.getByTestId('plan-dimensions').textContent(),/10,00.*7,00/)
  const s17Export=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const s17=JSON.parse(await readFile(await (await s17Export).path(),'utf8'))
  assert.equal(s17.validation.valid,true)
  assert.equal(s17.building.floorPlan.frame.openings.length,2)
  assert.ok(s17.building.floorPlan.graph.nodes.some(n=>
    n.xMm===3000 && n.zMm===-7000),'Partition bottom end must follow resized exterior')
  assert.equal(s17.building.floorPlan.graph.nodes.filter(n=>
    n.xMm===3000&&n.zMm===-6000).length,0)
  assert.equal(s17.building.floorPlan.frame.openings.find(o=>o.id==='D01').wallId,
    nwBuilt.building.floorPlan.frame.openings.find(o=>o.id==='D01').wallId)
  assert.equal(s17.building.floorPlan.frame.openings.find(o=>o.id==='W01').headerPreview.depthMm,235)
  await page.screenshot({path:dir+'/39-stage4-resize-bound-partition-10x7.png'})
  // S18 — real built 3D assembly must have no reported contact/collision
  // failures, but must still remain "engineering not evaluated".
  assert.equal(s17.validation.issues.filter(i=>
    i.code.startsWith('STRUCTURAL_') && i.severity==='error').length,0)
  assert.equal(s17.validation.engineeringStatus,'not_evaluated')
  await page.getByTestId('tab-frame').click()
  await page.getByTestId('structural-validator-summary').waitFor()
  assert.match(await page.getByTestId('structural-validator-summary').textContent(),
    /0 ошибок/)
  await page.screenshot({path:dir+'/40-stage5-structural-contact-validation.png'})
  // v0.1.25: two authored halves of one graph-split wall produce ONE
  // physical through-run, with doors on both sides of the T junction.
  await page.getByTestId('tab-plan').click()
  const s19Nodes=s17.building.floorPlan.graph.nodes
  const s19Lower=s17.building.floorPlan.graph.edges.find(edge=>{
    const a=s19Nodes.find(n=>n.id===edge.a),b=s19Nodes.find(n=>n.id===edge.b)
    return a.xMm===3000&&b.xMm===3000&&
      Math.max(a.zMm,b.zMm)===0
  })
  assert.ok(s19Lower,'The lower edited half must still be selectable in the authored graph')
  // Switching away from Plan collapses the manual-opening disclosure.
  // Open it explicitly before acting on its hidden controls.
  if (!(await page.locator('details.plan-manual-openings').getAttribute('open'))) {
    await page.getByTestId('plan-manual-openings').click()
  }
  await page.getByTestId('plan-frame-add-opening').click()
  await page.getByTestId('plan-frame-opening-type').selectOption('door')
  await page.getByTestId('plan-frame-opening-wall').selectOption('partition-'+s19Lower.id)
  await page.getByTestId('plan-frame-opening-positionUmm').fill('1200')
  await page.getByTestId('plan-frame-save-opening').click()
  await page.getByTestId('plan-frame-opening-D02').waitFor()
  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 6',{exact:true}).waitFor()
  // On an already-built frame this button opens the 3D tab, so return
  // to the plan before requesting its JSON download.
  await page.getByTestId('tab-plan').click()
  const s19Download=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const s19=JSON.parse(await readFile(await (await s19Download).path(),'utf8'))
  assert.equal(s19.validation.valid,true)
  assert.equal(s19.building.floorPlan.frame.openings.filter(o=>o.type==='door').length,2)
  const s19Doors=s19.building.openings.filter(o=>o.type==='door')
  assert.equal(new Set(s19Doors.map(o=>o.wallId)).size,1,
    'Both doors must share the single physical through-wall')
  const owner=s19Doors[0].wallId
  assert.equal(s19.building.walls.find(w=>w.wallId===owner).lengthMm,6710)
  assert.equal(s19.assembly.elements.filter(e=>e.elementId===owner+':plate-top-1').length,1)
  assert.equal(s19.assembly.elements.filter(e=>e.wallId===owner&&
    e.elementId.includes(':partition-backing-')).length,3)
  assert.equal(s19.validation.issues.filter(i=>i.code.startsWith('HAUN_')).length,0)
  // S20: a single shared door-framing engine keeps distinct, intentional
  // nonbearing/garage member packages and canonical opening coordinates.
  for(const inside of s19Doors) {
    assert.ok(s19.assembly.elements.some(e=>e.elementId===inside.wallId+':'+inside.id+'-header'))
    assert.equal(s19.assembly.elements.some(e=>e.elementId.startsWith(
      inside.wallId+':'+inside.id+'-jack-')),false)
  }
  assert.equal(s19.assembly.elements.filter(e=>
    e.elementId.startsWith('plan-front:W01-header-')).length,2)
  assert.equal(s19.assembly.elements.filter(e=>
    e.elementId.startsWith('plan-front:W01-jack-')).length,4)

  await page.screenshot({path:dir+'/41-haun-physical-through-2doors-3stud-channel.png'})

  // v0.1.27: browser integration of a genuine four-arm X in a new garage.
  // The drawn graph keeps four independently editable arms, while the
  // physical framing builds ONE X-through and TWO Z-butt wall modules.
  await page.reload({waitUntil:'networkidle'})
  await page.getByTestId('plan-add-exact').click()
  for(const length of ['10','7','10']){
    await page.getByTestId('plan-length-input').fill(length)
    await page.getByTestId('plan-add-exact').click()
  }
  await page.getByTestId('plan-close').click()
  const crossClick=async (xMm,zMm)=>{
    const point=await page.getByTestId('plan-canvas').evaluate((svg,p)=>{
      const circle=i=>svg.querySelector('[data-testid="plan-point-'+i+'"] circle')
      const a=circle(0),b=circle(1),c=circle(2)
      if(!a||!b||!c)throw Error('Missing perimeter points for 10x7 X plan')
      const x0=Number(a.getAttribute('cx')),y0=Number(a.getAttribute('cy'))
      const dx=Number(b.getAttribute('cx'))-x0
      const dy=Number(c.getAttribute('cy'))-y0
      const q=new DOMPoint(x0+dx*p.xMm/10000,y0+dy*(-p.zMm)/7000)
        .matrixTransform(svg.getScreenCTM())
      return {x:q.x,y:q.y}
    },{xMm,zMm})
    await page.mouse.click(point.x,point.y)
  }
  await page.getByTestId('plan-toolbar-wall').click()
  await crossClick(0,-3000)
  await crossClick(10000,-3000)
  await page.keyboard.press('Enter')
  await crossClick(4000,0)
  await crossClick(4000,-7000)
  await page.keyboard.press('Enter')
  assert.equal((await page.getByTestId('plan-wall-count').textContent()).trim(),'4')
  await page.getByTestId('plan-frame-enable-partitions').click()
  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 7',{exact:true}).waitFor()
  await page.getByTestId('frame-section-toggle').click()
  await page.getByTestId('frame-section-height').fill('1200')
  await page.screenshot({path:dir+'/42-stage21-X-four-member-receiver-cut-1200.png'})
  await page.getByTestId('frame-section-height').fill('2680')
  await page.screenshot({path:dir+'/43-stage21-X-two-course-overlap-cut-2680.png'})
  await page.getByTestId('tab-plan').click()
  const crossDownload=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const crossDoc=JSON.parse(await readFile(await (await crossDownload).path(),'utf8'))
  assert.equal(crossDoc.building.floorPlan.graph.edges.length,4)
  assert.equal(crossDoc.building.walls.length,7)
  assert.equal(crossDoc.validation.valid,true)
  assert.equal(crossDoc.validation.engineeringStatus,'not_evaluated')
  assert.equal(crossDoc.validation.issues.filter(i=>
    i.severity==='error' && (i.code.startsWith('HAUN_') ||
      i.code.startsWith('STRUCTURAL_'))).length,0)
  const xParts=crossDoc.assembly.elements.filter(e=>
    e.elementId.includes(':cross-backing-'))
  assert.equal(xParts.length,4)
  const xWall=crossDoc.building.walls.find(w=>w.wallId===xParts[0].wallId)
  assert.equal(xWall.orientation,'x')
  assert.equal(xWall.lengthMm,9710)
  assert.equal(crossDoc.assembly.elements.filter(e=>
    e.elementId===xWall.wallId+':plate-top-1').length,1)
  assert.equal(crossDoc.assembly.elements.filter(e=>
    e.wallId===xWall.wallId && e.elementId.includes(':plate-top-2')).length,2)



  // S22.1: reproduce user screenshot (9 x 6, through 6m, T arm 3m).
  // Do NOT press "Enable partitions" before the single Build click.
  await page.reload({waitUntil:'networkidle'})
  await page.getByTestId('plan-add-exact').click()
  for(const length of ['9','6','9']){
    await page.getByTestId('plan-length-input').fill(length)
    await page.getByTestId('plan-add-exact').click()
  }
  await page.getByTestId('plan-close').click()
  const tClick=async(xMm,zMm)=>{
    const pt=await page.getByTestId('plan-canvas').evaluate((svg,p)=>{
      const circle=i=>svg.querySelector('[data-testid="plan-point-'+i+'"] circle')
      const a=circle(0),b=circle(1),c=circle(2)
      if(!a||!b||!c)throw Error('Missing 9 x 6 corners')
      const x0=Number(a.getAttribute('cx')),y0=Number(a.getAttribute('cy'))
      const dx=Number(b.getAttribute('cx'))-x0
      const dy=Number(c.getAttribute('cy'))-y0
      const q=new DOMPoint(x0+dx*p.xMm/9000,y0+dy*(-p.zMm)/6000)
        .matrixTransform(svg.getScreenCTM())
      return {x:q.x,y:q.y}
    },{xMm,zMm})
    await page.mouse.click(pt.x,pt.y)
  }
  await page.getByTestId('plan-toolbar-wall').click()
  await tClick(3000,0)
  await tClick(3000,-6000)
  await page.keyboard.press('Enter')
  await tClick(0,-3000)
  await tClick(3000,-3000)
  await page.keyboard.press('Enter')
  assert.equal((await page.getByTestId('plan-wall-count').textContent()).trim(),'3')
  await page.getByTestId('plan-frame-auto-partitions').waitFor()
  await page.screenshot({path:dir+'/44-user-9x6-T-before-auto-build.png'})
  await page.getByTestId('plan-frame-build').click()
  await page.getByText('Количество стен: 6',{exact:true}).waitFor()
  await page.screenshot({path:dir+'/45-user-9x6-T-built-3D.png'})
  await page.getByTestId('tab-plan').click()
  const tExport=page.waitForEvent('download')
  await page.getByTestId('plan-export').click()
  const tJson=JSON.parse(await readFile(await (await tExport).path(),'utf8'))
  assert.equal(tJson.building.floorPlan.frame.partitions,true)
  assert.equal(tJson.building.floorPlan.graph.edges.length,3)
  assert.equal(tJson.building.walls.length,6)
  assert.equal(tJson.validation.valid,true)
  assert.equal(tJson.assembly.elements.filter(e=>
    e.elementId.includes(':partition-backing-')).length,3)

  console.log('SIGMA4 BROWSER PASS: v0.1.27 all straight/L/T/X joinery; v0.1.26 unified door framing with distinct nonbearing and bearing profiles; v0.1.25 continuous through-wall, two doors and internal T channel; v0.1.24 structural contact/overlap/support validation; v0.1.23 boundary-bound nodes and preserved openings on rectangle resize; v0.1.22 structural opening profiles, supported headers and load demand UI; v0.1.21 feature-first stud detailing around openings and Haun channels; northwest screenshot 9x6 T room and D01 UI regression; v0.1.20 Haun overlapping upper plates at exterior T and interior L, real horizontal sections; v0.1.19 Haun 3-stud channels (two full-depth + one flat nailer), verified in cut; v0.1.18 true horizontal cuts of ALL boards at different elevations; v0.1.17 T/X junction topology, T/X topology; legacy 3D, free graph plan, linked 2D-to-3D garage, resize, JSON roundtrip, partition doors, horizontal section and direct 2D opening editing on desktop and touch')

} finally {
  await browser?.close()
  processVite.kill('SIGTERM')
}
