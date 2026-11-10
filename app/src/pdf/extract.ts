import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { PageData, RawItem } from '../text/types'
import { buildPage } from './layout'

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs'

export class PdfError extends Error {
  code: 'password' | 'invalid' | 'other'
  constructor(code: 'password' | 'invalid' | 'other', message: string) {
    super(message)
    this.code = code
  }
}

const IMAGE_OPS = [
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
].filter((n): n is number => typeof n === 'number')

export async function openPdf(data: ArrayBuffer): Promise<{ doc: PDFDocumentProxy; destroy: () => Promise<void> }> {
  try {
    // pdf.js transfers (detaches) the buffer, so give it its own copy
    const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) })
    const doc = await task.promise
    return { doc, destroy: () => task.destroy() }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err?.name === 'PasswordException') {
      throw new PdfError('password', 'This PDF is password protected.')
    }
    if (err?.name === 'InvalidPDFException' || err?.name === 'FormatError') {
      throw new PdfError('invalid', 'This file does not look like a valid PDF.')
    }
    throw new PdfError('other', err?.message ?? 'Could not open this PDF.')
  }
}

export interface ExtractedPage {
  data: PageData
  chars: number
  hasImages: boolean
}

export async function extractPage(doc: PDFDocumentProxy, pageNo: number): Promise<{ page: PDFPageProxy; result: ExtractedPage }> {
  const page = await doc.getPage(pageNo)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: RawItem[] = []
  let chars = 0
  for (const it of content.items) {
    if (!('str' in it)) continue
    const t = it as TextItem
    if (!t.str) continue
    const tm = pdfjs.Util.transform(viewport.transform, t.transform)
    const size = Math.hypot(tm[2], tm[3]) || Math.abs(t.height) || 10
    items.push({ str: t.str, x: tm[4], y: tm[5], w: Math.abs(t.width) * viewport.scale, size })
    chars += t.str.replace(/\s/g, '').length
  }
  let hasImages = false
  if (chars < 20) {
    try {
      const ops = await page.getOperatorList()
      hasImages = ops.fnArray.some((fn: number) => IMAGE_OPS.includes(fn))
    } catch {
      hasImages = true
    }
  }
  return {
    page,
    result: {
      data: buildPage(items, pageNo, viewport.width, viewport.height, 'text'),
      chars,
      hasImages,
    },
  }
}
