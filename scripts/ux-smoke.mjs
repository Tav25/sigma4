import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:4175'
const dir = 'artifacts/sigma4-browser'
await mkdir(dir, { recursive: true })
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1',
  '--port', '4175', '--strictPort',
], { stdio: 'ignore' })
let browser
try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  assert.ok(ready, 'UX smoke preview did not start')
  browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader',
  ] })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  await page.goto(base, { waitUntil: 'networkidle' })
  assert.equal((await page.locator('.app-version').textContent())?.trim(), '0.1.33')

  // UI-02: one set of design tokens controls all sidebars and buttons.
  const styleOf = async selector => page.locator(selector).first().evaluate(el => {
    const style = getComputedStyle(el)
    return {
      width: Math.round(el.getBoundingClientRect().width),
      background: style.backgroundColor,
      border: style.borderRightColor,
      padding: style.paddingLeft,
      radius: style.borderRadius,
      height: Math.round(el.getBoundingClientRect().height),
      color: style.color,
      font: style.fontFamily,
    }
  })
  const planPanel = await styleOf('.plan-controls')
  assert.equal(planPanel.width, 302)
  const planPrimary = await styleOf('[data-testid="plan-add-exact"]')
  const planSecondary = await styleOf('[data-testid="plan-close"]')

  await page.getByTestId('tab-frame').click()
  await page.screenshot({ path: dir + '/ui02-desktop-frame.png' })
  const framePanel = await styleOf('.left-panel')
  const framePrimary = await styleOf('.left-panel .plan-primary')
  const frameSecondary = await styleOf('.left-panel .plan-secondary')
  for (const key of ['width', 'background', 'border', 'padding']) {
    assert.equal(framePanel[key], planPanel[key], 'Mismatched sidebar ' + key)
  }
  for (const key of ['background', 'radius', 'height', 'font']) {
    assert.equal(framePrimary[key], planPrimary[key], 'Mismatched primary button ' + key)
    assert.equal(frameSecondary[key], planSecondary[key], 'Mismatched secondary button ' + key)
  }
  await page.getByTestId('frame-section-toggle').click()
  const sectionSecondary = await styleOf('[data-testid="frame-section-toggle"]')
  assert.equal(sectionSecondary.background, planSecondary.background)
  assert.equal(sectionSecondary.radius, planSecondary.radius)
  const sectionAction = await styleOf('.frame-section-main-controls button')
  for (const key of ['background', 'radius', 'font']) {
    assert.equal(sectionAction[key], planSecondary[key], 'Mismatched section control ' + key)
  }
  await page.screenshot({ path: dir + '/ui02-desktop-section.png' })
  await page.getByTestId('frame-section-toggle').click()
  await page.getByTestId('tab-plan').click()

  // Preserve the exact workspace view when switching between 2D and 3D.
  await page.locator('button[title="Увеличить масштаб"]').click()
  const initialZoom = await page.getByTestId('plan-zoom').textContent()
  assert.notEqual(initialZoom?.trim(), '100%')
  await page.getByTestId('tab-frame').click()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
  await page.getByTestId('tab-plan').click()
  assert.equal(await page.getByTestId('plan-zoom').textContent(), initialZoom)
  await page.screenshot({ path: dir + '/ux-plan-state.png' })

  // Committed JSON must survive a full reload without exposing the starter template to Undo.
  await page.getByTestId('plan-add-exact').click()
  await page.getByTestId('plan-add-exact').click()
  await page.getByTestId('plan-point-1').waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('plan-point-1').waitFor()
  assert.match(await page.locator('.project-autosave').textContent(), /Локальная копия/)
  assert.ok(await page.locator('.top-bar button[title="Отменить"]').isDisabled())

  // Invalid import errors must be visible in 2D and leave the project intact.
  await page.locator('#import-file').setInputFiles({
    name: 'invalid.sigma4.json', mimeType: 'application/json',
    buffer: Buffer.from('{ invalid json'),
  })
  await page.getByRole('alert').filter({ hasText: /Синтаксическая ошибка JSON/ }).waitFor()
  await page.getByRole('button', { name: 'Закрыть сообщение' }).click()
  assert.equal(await page.getByTestId('plan-point-1').count(), 1)

  // Enter plus blur must commit once, never twice.
  await page.getByTestId('tab-frame').click()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
  const revision = async () => Number((await page.locator('.project-revision').textContent()).match(/\d+/)?.[0])
  const before = await revision()
  const input = page.getByRole('textbox', { name: 'Высота (мм)' })
  await input.fill('2800')
  await input.press('Enter')
  assert.equal(await revision(), before + 1)
  assert.equal(await input.inputValue(), '2800')

  // A cut selects the same timber element as the 3D tree, without remounting WebGL.
  await page.locator('.viewport canvas').evaluate(el => { el.dataset.uxOriginal = '1' })
  await page.getByTestId('frame-section-toggle').click()
  const section = page.getByTestId('frame-section')
  await section.getByTestId('frame-section-height').fill('10')
  const piece = section.getByTestId('frame-section-piece').first()
  const id = await piece.getAttribute('data-element-id')
  assert.ok(id)
  await piece.click()
  assert.ok((await section.getByTestId('frame-section-selected').textContent()).includes(id))
  assert.match(await page.getByTestId('tree-board-' + id).getAttribute('class'), /tree-selected/)
  await page.getByTestId('frame-section-toggle').click()
  await page.locator('.viewport canvas[data-ux-original="1"]').waitFor({ state: 'visible' })
  await page.screenshot({ path: dir + '/ux-frame-preserved.png' })

  // The actual changed structural parameter must also survive the next reload.
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('tab-frame').click()
  await page.locator('.viewport canvas').waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('textbox', { name: 'Высота (мм)' }).inputValue(), '2800')
  // Both workspaces collapse to the same 260px sidebar at medium sizes.
  await page.setViewportSize({ width: 900, height: 850 })
  await page.getByTestId('tab-plan').click()
  assert.equal((await styleOf('.plan-controls')).width, 260)
  await page.getByTestId('tab-frame').click()
  assert.equal((await styleOf('.left-panel')).width, 260)

  // Both workspaces use a full-width bottom inspector on mobile.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('tab-plan').click()
  assert.equal((await styleOf('.plan-controls')).width, 390)
  await page.getByTestId('tab-frame').click()
  assert.equal((await styleOf('.left-panel')).width, 390)
  const frameLayout = await page.evaluate(() => {
    const panel = document.querySelector('.left-panel').getBoundingClientRect()
    const canvas = document.querySelector('.main .viewport-wrap').getBoundingClientRect()
    return { panelY: panel.y, canvasBottom: canvas.bottom }
  })
  assert.ok(frameLayout.panelY >= frameLayout.canvasBottom - 2, '3D inspector should be below mobile canvas')
  await page.screenshot({ path: dir + '/ui02-mobile-frame.png' })

  assert.deepEqual(errors, [], 'Uncaught browser exceptions')
  console.log('SIGMA4 UX-01 + UI-02 regressions: PASS')
} finally {
  if (browser) await browser.close()
  vite.kill('SIGTERM')
}
