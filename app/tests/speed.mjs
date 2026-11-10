import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await (await b.newContext()).newPage()
await p.goto(process.argv[2] ?? 'http://localhost:5173/')
const r = await p.evaluate(async () => {
  const n = window.__app.player.neural
  const texts = ['He is going to Mumbai.', 'The old lighthouse stood at the edge of the cliff, and every evening the keeper climbed the stairs to light the lamp.', 'Was it a success?', 'Nobody in the village could remember a night when the light had failed.']
  await n.prepare('Warm up.', 'piper:en_US-lessac-medium', 1)
  n.log.length = 0
  for (const t of texts) await n.prepare(t, 'piper:en_US-lessac-medium', 1)
  return n.log.map((l) => ({ gen: Math.round(l.genMs), phon: Math.round(l.phonMs), audio: Math.round(l.audioMs) }))
})
console.log(JSON.stringify(r))
await b.close()
