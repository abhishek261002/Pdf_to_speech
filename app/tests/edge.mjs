import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const URL_ = process.argv[2] ?? 'http://localhost:5173/'
const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n)
let failures = 0
const check = (ok, msg, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}  ${extra}`); if (!ok) failures++ }
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(URL_)

await page.setInputFiles('[data-testid=file-input]', fx('notes.txt'))
await page.waitForSelector('[role=alert]')
check(/PDF/.test(await page.locator('[role=alert]').first().innerText()), 'non-PDF file gets a friendly message')

await page.setInputFiles('[data-testid=file-input]', fx('broken.pdf'))
await page.waitForSelector('[role=alert]', { timeout: 20000 })
check(/valid PDF|went wrong|Try another/i.test(await page.locator('[role=alert]').first().innerText()), 'broken PDF gets a friendly message', JSON.stringify(await page.locator('[role=alert]').first().innerText()))

await page.setInputFiles('[data-testid=file-input]', fx('locked.pdf'))
await page.waitForSelector('[role=alert]', { timeout: 20000 })
check(/password/i.test(await page.locator('[role=alert]').first().innerText()), 'password-protected PDF gets a clear message')

const t0 = Date.now()
await page.setInputFiles('[data-testid=file-input]', fx('big.pdf'))
await page.waitForSelector('.reader-text [data-s]', { timeout: 120000 })
const first = Date.now() - t0
await page.waitForFunction(() => window.__app.session?.status().finished, null, { timeout: 120000 })
const all = Date.now() - t0
const n = await page.evaluate(() => ({ s: window.__app.doc.sentences.length, pages: window.__app.session.status().numPages, removed: window.__app.doc.removed.length }))
check(n.pages === 300, '300-page PDF opened', JSON.stringify(n))
check(first < 10000, 'text visible quickly', `${(first / 1000).toFixed(1)}s (all pages: ${(all / 1000).toFixed(1)}s)`)
const text = await page.locator('.reader-text').innerText()
check(!text.includes('A Long Book') && n.removed >= 590, 'headers and page numbers removed across 300 pages')
const t1 = Date.now()
await page.getByTestId('play').click()
await page.waitForFunction(() => window.__app.player.getSnapshot().state === 'playing', null, { timeout: 120000 })
check(true, 'playback of big document starts', `${((Date.now() - t1) / 1000).toFixed(1)}s after pressing play`)
await page.waitForTimeout(8000)
const s1 = await page.evaluate(() => window.__app.player.getSnapshot().index)
await page.evaluate(() => window.__app.player.seekPage(150))
await page.waitForTimeout(6000)
const snap = await page.evaluate(() => window.__app.player.getSnapshot())
check(snap.page >= 150 && snap.state === 'playing', 'jump to page 150 keeps playing', `page ${snap.page}`)
await b.close()
console.log(failures ? `${failures} FAILED` : 'All edge checks passed')
process.exit(failures ? 1 : 0)
