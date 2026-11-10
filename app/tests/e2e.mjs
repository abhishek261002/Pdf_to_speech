// End-to-end check in real Chrome against the running app.
// Usage: node tests/e2e.mjs [url]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const URL_ = process.argv[2] ?? 'http://localhost:5173/'
const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

let failures = 0
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } })
const page = await ctx.newPage()
const external = []
page.on('request', (r) => {
  const u = new URL(r.url())
  if (!['localhost', '127.0.0.1'].includes(u.hostname) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url())
})
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE.ERROR', m.text().slice(0, 300))
})

await page.goto(URL_)
check(await page.getByText('Drop a PDF here').isVisible(), 'landing page shows drop zone')
check(await page.evaluate(() => crossOriginIsolated), 'page is cross-origin isolated (multi-thread WASM)')

// ---------------------------------------------------------------- text PDF
await page.setInputFiles('[data-testid=file-input]', fx('sample.pdf'))
await page.waitForSelector('.reader-text [data-s]', { timeout: 30000 })
const text = await page.locator('.reader-text').innerText()
check(!text.includes('Great Book of Things'), 'running header removed')
check(/CHAPTER ONE/.test(text), 'heading kept')
check(text.includes('He is going to Mumbai.'), 'body text kept as written')
const sentences = await page.locator('.reader-text [data-s]').allInnerTexts()
check(!sentences.some((s) => /^Dr\.\s*$|^Mr\.\s*$/.test(s.trim())), 'no sentence split after Dr./Mr.')
console.log('  sentences on page 1:', sentences.slice(0, 6).map((s) => JSON.stringify(s.trim())).join(' | '))
const removed = await page.evaluate(() => window.__app.doc.removed.length)
check(removed >= 8, 'headers/page numbers reported as removed', `(${removed})`)

// ---------------------------------------------------------------- play with the neural voice
const t0 = Date.now()
await page.getByTestId('play').click()
await page.waitForFunction(() => window.__app.player.neural.status.state === 'ready', null, { timeout: 180000 })
const loadMs = Date.now() - t0
check(true, 'Natural voice (Piper) loaded from our own site', `${(loadMs / 1000).toFixed(1)}s`)
const status = await page.evaluate(() => window.__app.player.neural.status)
console.log('  threads:', status.threads, 'isolated:', status.isolated)
await page.waitForFunction(() => window.__app.player.trail.length >= 5, null, { timeout: 180000 })
const trail = await page.evaluate(() => window.__app.player.trail.slice(0, 8))
console.log('  first spoken units:')
for (const t of trail) console.log(`    ${JSON.stringify(t.spoken)}  -> pause ${t.pause} ${t.pauseMs}ms`)
check(!trail.some((t) => /\b(dot|period|comma|quote)\b/i.test(t.spoken) && !/\bperiod\b/.test('')), 'no punctuation words in spoken text')
check(trail.every((t) => !/[*#_~|<>{}()"\[\]]/.test(t.spoken)), 'no symbols in spoken text')
const perf = await page.evaluate(() => window.__app.player.neural.log)
const gen = perf.reduce((a, b) => a + b.genMs, 0)
const aud = perf.reduce((a, b) => a + b.audioMs, 0)
check(aud / gen >= 1, `synthesis faster than real time`, `(${(aud / gen).toFixed(2)}x: ${(aud / 1000).toFixed(1)}s audio in ${(gen / 1000).toFixed(1)}s)`)
const hl = await page.locator('.reader-text [data-s].active').count()
check(hl === 1, 'current sentence is highlighted')

// pause / resume / seek
await page.getByTestId('play').click()
await page.waitForTimeout(300)
check((await page.evaluate(() => window.__app.player.getSnapshot().state)) === 'paused', 'pause works')
const idxBefore = await page.evaluate(() => window.__app.player.getSnapshot().index)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(200)
const idxAfter = await page.evaluate(() => window.__app.player.getSnapshot().index)
check(idxAfter > idxBefore, 'next sentence works while paused', `(${idxBefore} -> ${idxAfter})`)
await page.locator('.reader-text [data-s]').nth(6).click()
await page.waitForFunction(() => window.__app.player.getSnapshot().state === 'playing', null, { timeout: 60000 })
check(true, 'click-to-jump starts playing from that sentence')
await page.getByTestId('play').click()

// ---------------------------------------------------------------- columns
await page.setInputFiles('[data-testid=file-input]', fx('columns.pdf'))
await page.waitForFunction(() => window.__app.doc && window.__app.doc.sentences.length > 0 && window.__app.doc.sentences[0].text.startsWith('Left column'), null, { timeout: 30000 })
const colText = await page.evaluate(() => window.__app.doc.sentences.map((s) => s.text).join(' '))
check(colText.indexOf('apples') < colText.indexOf('rivers'), 'two columns read left then right')

// ---------------------------------------------------------------- scanned PDF (OCR)
const o0 = Date.now()
await page.setInputFiles('[data-testid=file-input]', fx('scan.pdf'))
await page.waitForFunction(() => window.__app.doc && window.__app.doc.sentences.length > 0, null, { timeout: 120000 })
const ocrMs = Date.now() - o0
const ocrText = await page.evaluate(() => window.__app.doc.sentences.map((s) => s.text).join(' '))
console.log('  OCR text:', JSON.stringify(ocrText.slice(0, 260)))
check(/lighthouse/i.test(ocrText) && /Mumbai/i.test(ocrText), 'scanned PDF recognised via bundled OCR', `(first text after ${(ocrMs / 1000).toFixed(1)}s)`)

check(external.length === 0, 'no requests to third-party servers', external.slice(0, 3).join(' '))
await browser.close()
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
