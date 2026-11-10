// Prepares every static asset the app needs so it runs with ZERO third-party requests:
//  - onnxruntime wasm files          -> public/ort
//  - Piper phonemiser (espeak-ng)    -> public/piper
//  - Piper voices (.onnx + .json)    -> public/voices   (downloaded once from Hugging Face)
//  - tesseract worker + wasm core    -> public/ocr
//  - eng.traineddata.gz (OCR data)   -> public/ocr/lang
//  - pdf.js worker                   -> public/pdf
// Run: npm run assets   (safe to re-run; skips what already exists)
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = (...p) => path.join(root, 'public', ...p)
const nm = (...p) => path.join(root, 'node_modules', ...p)
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en'
const VOICES = [
  ['en_US', 'lessac'],
  ['en_US', 'amy'],
  ['en_US', 'ryan'],
  ['en_US', 'joe'],
  ['en_GB', 'jenny_dioco'],
  ['en_GB', 'alan'],
]

const ensure = (d) => fs.mkdirSync(d, { recursive: true })
const copy = (from, to) => {
  ensure(path.dirname(to))
  fs.copyFileSync(from, to)
}
async function download(url, to) {
  if (fs.existsSync(to)) return
  ensure(path.dirname(to))
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${url}`)
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()))
  console.log('downloaded', path.relative(root, to))
}

// 1. ONNX runtime (CPU/WASM build)
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) copy(nm('onnxruntime-web', 'dist', f), pub('ort', f))

// 2. Piper phonemiser: the emscripten script is a classic script, so wrap it as an ES module
const phon = fs.readFileSync(nm('@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.js'), 'utf8')
ensure(pub('piper'))
fs.writeFileSync(pub('piper', 'phonemize.mjs'), phon + '\nexport default createPiperPhonemize;\n')
copy(nm('@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.wasm'), pub('piper', 'piper_phonemize.wasm'))
copy(nm('@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.data'), pub('piper', 'piper_phonemize.data'))

// 3. Voices
for (const [region, name] of VOICES) {
  const id = `${region}-${name}-medium`
  for (const ext of ['.onnx', '.onnx.json']) await download(`${HF}/${region}/${name}/medium/${id}${ext}`, pub('voices', id + ext))
}

// 4. Tesseract worker + core
copy(nm('tesseract.js', 'dist', 'worker.min.js'), pub('ocr', 'worker.min.js'))
for (const f of fs.readdirSync(nm('tesseract.js-core'))) {
  if (/^tesseract-core(-relaxedsimd|-simd)?-lstm\.wasm\.js$/.test(f)) copy(nm('tesseract.js-core', f), pub('ocr', 'core', f))
}
const eng = pub('ocr', 'lang', 'eng.traineddata.gz')
if (!fs.existsSync(eng)) {
  const r = await fetch('https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata')
  if (!r.ok) throw new Error('eng.traineddata download failed ' + r.status)
  ensure(path.dirname(eng))
  fs.writeFileSync(eng, zlib.gzipSync(Buffer.from(await r.arrayBuffer())))
  console.log('downloaded eng.traineddata.gz')
}

// 5. pdf.js worker
copy(nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), pub('pdf', 'pdf.worker.min.mjs'))
console.log('assets ready')
