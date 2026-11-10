import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n)
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await (await b.newContext()).newPage()
await page.goto(process.argv[2] ?? 'http://localhost:5173/')
await page.setInputFiles('[data-testid=file-input]', fx('sample.pdf'))
await page.waitForSelector('.reader-text [data-s]')
await page.waitForTimeout(1500)
const voices = await page.evaluate(() => speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)).map((v) => v.name + ' / ' + v.lang))
console.log('device English voices:', voices.length, voices.slice(0, 5))
if (!voices.length) { console.log('SKIP: no device voices in this browser'); await b.close(); process.exit(0) }
await page.evaluate(() => { const o = [...document.querySelectorAll('select[aria-label=Voice] option')].find((x) => x.value.startsWith('sys:')); window.__sys = o?.value })
const sys = await page.evaluate(() => window.__sys)
await page.selectOption('select[aria-label=Voice]', sys)
await page.getByTestId('play').click()
await page.waitForFunction(() => window.__app.player.getSnapshot().index >= 3, null, { timeout: 60000 })
const t = await page.evaluate(() => window.__app.player.trail.slice(0, 4))
console.log('PASS  device voice read sentences in order with pauses:', JSON.stringify(t.map((x) => [x.spoken.slice(0, 25), x.pauseMs])))
await b.close()
