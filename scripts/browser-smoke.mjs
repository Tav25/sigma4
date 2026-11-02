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
  assert.equal((await page.locator('.app-version').textContent())?.trim(), '0.0.21')
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
  await page.getByRole('button', { name: 'Вид сверху' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/01-top.png' })
  await page.getByRole('button', { name: 'Сбросить вид' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: dir + '/02-isometric.png' })

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
  await page.getByRole('button', { name: 'Вид сверху' }).click()
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
  const blankDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const single = JSON.parse(await readFile(await (await blankDownload).path(), 'utf8'))
  single.building.walls[0].lengthMm = 4000
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
  assert.deepEqual(four.building.walls[0].origin, { x: 0, y: 0, z: 0 })
  assert.equal(four.building.walls[0].lengthMm, 4000)
  assert.equal(four.assembly.elements.find(e => e.elementId === 'plate-bottom-1').position.x, 0)
  await page.getByRole('button', { name: 'Вид сверху' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: dir + '/08-first-wall-4000mm.png' })
  const wallLengthInput = page.getByText('Длина (мм)', { exact: true }).locator('..').locator('input')
  await wallLengthInput.fill('5000')
  await wallLengthInput.press('Tab')
  await page.locator('.viewport[data-dimension-total-x="5000"]').waitFor()
  assert.equal(errors.length, 0, 'Unexpected browser exceptions')
  console.log('SIGMA4 BROWSER PASS: v0.0.21 ground-plane dimension numerals only; 4m and 5m; corner; garage+door; JSON')

} finally {
  await browser?.close()
  processVite.kill('SIGTERM')
}
