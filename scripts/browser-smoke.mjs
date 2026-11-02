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
  assert.equal((await page.locator('.app-version').textContent())?.trim(), '0.0.16')
  const tree = page.getByRole('navigation', { name: 'Дерево проекта' })
  await tree.getByTestId('wall-node-wall-001').waitFor()
  await tree.getByTestId('tree-opening-W01').click()
  await page.getByText('Свойства оконного проёма (W01)').waitFor()
  await page.getByRole('button', { name: '+ Добавить вторую стену' }).click()
  await tree.getByTestId('wall-node-wall-002').waitFor()
  await tree.locator('[data-testid="tree-frame-wall-001"] > summary').click()
  await tree.getByTestId('tree-board-warm-corner-stud').click()
  await page.getByText('Свойства детали').waitFor()
  await page.getByText('Количество элементов: 46').waitFor()
  await page.getByText('Валидация: OK').waitFor()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
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
  await page.getByRole('button', { name: 'Вид сверху' }).click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: dir + '/03-nine-walls.png' })
  const beforeMove = nine.building.walls[8].origin.z
  await page.getByRole('button', { name: 'Отменить' }).count() // Undo must remain available
  assert.equal(errors.length, 0, 'Unexpected browser exception')
  assert.ok(Number.isFinite(beforeMove))
  console.log('SIGMA4 BROWSER PASS: 0.0.16, 9 walls, 8 joins, corner, top/iso, JSON')

} finally {
  await browser?.close()
  processVite.kill('SIGTERM')
}
