import { createWorker, type Worker } from 'tesseract.js'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PageData, RawItem } from '../text/types'
import { buildPage } from './layout'

/** Everything (worker, wasm core, English data) is served from our own site: no third-party requests. */
let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/core',
      langPath: '/ocr/lang',
      gzip: true,
      workerBlobURL: false,
    })
  }
  return workerPromise
}

export async function terminateOcr() {
  if (!workerPromise) return
  const w = await workerPromise.catch(() => null)
  workerPromise = null
  await w?.terminate()
}

/** OCR scale: about 190 dpi, a good balance of accuracy and speed. */
const SCALE = 2.6

export async function ocrPage(page: PDFPageProxy, pageNo: number): Promise<PageData> {
  const viewport = page.getViewport({ scale: SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, canvas, viewport }).promise

  const worker = await getWorker()
  const res = await worker.recognize(canvas, {}, { blocks: true, text: true })
  canvas.width = canvas.height = 0

  const items: RawItem[] = []
  for (const block of res.data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = line.text.replace(/\s+/g, ' ').trim()
        if (!text || line.confidence < 35) continue
        const h = (line.bbox.y1 - line.bbox.y0) / SCALE
        items.push({
          str: text,
          x: line.bbox.x0 / SCALE,
          y: line.bbox.y1 / SCALE,
          w: (line.bbox.x1 - line.bbox.x0) / SCALE,
          size: h / 1.15,
          spaceBefore: true,
        })
      }
    }
  }
  return buildPage(items, pageNo, viewport.width / SCALE, viewport.height / SCALE, 'ocr')
}
