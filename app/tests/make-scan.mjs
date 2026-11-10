// Renders a page of text to a PNG (a stand-in for a scanned page), then builds scan.pdf from it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
fs.mkdirSync(dir, { recursive: true })
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 612, height: 792 }, deviceScaleFactor: 2.5 })
await page.setContent(`<body style="margin:0;background:#fff"><div style="padding:70px 72px;font:13px/1.55 'Times New Roman',serif;color:#222">
<h1 style="font-size:24px;margin:0 0 18px">SCANNED CHAPTER</h1>
<p>The old lighthouse stood at the edge of the cliff, and every evening the keeper climbed the stairs to light the lamp. He is going to Mumbai tomorrow.</p>
<p>Nobody in the village could remember a night when the light had failed. Ships passed safely, and the sea was calm under the stars.</p>
</div></body>`)
await page.screenshot({ path: path.join(dir, 'scan.png') })
await browser.close()
console.log('scan.png written')
