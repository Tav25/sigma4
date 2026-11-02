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
  await page.getByRole('button', { name: '+ Добавить вторую стену' }).click()
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
  const stud = exported.assembly.elements.find(e => e.elementId === 'warm-corner-stud')
  assert.equal(stud.position.x, 5810)
  assert.equal(stud.orientation.roll, 90)
  stud.position.x += 10
  await page.locator('#import-file').setInputFiles([{
    name: 'old.sigma4.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  }])
  await page.getByText('Валидация: OK').waitFor()
  const secondDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт JSON' }).click()
  const rebuilt = JSON.parse(await readFile(await (await secondDownload).path(), 'utf8'))
  assert.equal(rebuilt.assembly.elements.find(e => e.elementId === 'warm-corner-stud').position.x, 5810)
  assert.deepEqual(errors, [], 'Uncaught browser errors')
  console.log('SIGMA4 BROWSER PASS: L corner, top and iso, export/import')
} finally {
  await browser?.close()
  processVite.kill('SIGTERM')
}
