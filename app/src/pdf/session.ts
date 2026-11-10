import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageData } from '../text/types'
import { extractPage, openPdf, PdfError } from './extract'
import { ocrPage, terminateOcr } from './ocr'

export interface SessionStatus {
  numPages: number
  /** pages (from page 1, no gaps) whose text is ready */
  readyPages: number
  ocrTotal: number
  ocrDone: number
  /** page the OCR engine is working on right now, if any */
  ocrCurrent: number | null
  finished: boolean
  error: string | null
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `${buf.byteLength}`
  }
}

/** Opens a PDF, extracts text immediately, and runs OCR in the background for scanned pages. */
export class PdfSession {
  name: string
  hash = ''
  numPages = 0
  private pages: (PageData | null)[] = []
  private pending: number[] = []
  private ocrDone = 0
  private ocrCurrent: number | null = null
  private finished = false
  private error: string | null = null
  private doc: PDFDocumentProxy | null = null
  private destroyed = false
  private listeners = new Set<() => void>()

  private file: File
  private closeDoc: (() => Promise<void>) | null = null

  constructor(file: File) {
    this.file = file
    this.name = file.name
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  status(): SessionStatus {
    let ready = 0
    while (ready < this.pages.length && this.pages[ready]) ready++
    return {
      numPages: this.numPages,
      readyPages: ready,
      ocrTotal: this.pending.length + this.ocrDone,
      ocrDone: this.ocrDone,
      ocrCurrent: this.ocrCurrent,
      finished: this.finished,
      error: this.error,
    }
  }

  /** Pages that are ready, in order, up to the first page still waiting for OCR. */
  readyPageData(): PageData[] {
    const out: PageData[] = []
    for (const p of this.pages) {
      if (!p) break
      out.push(p)
    }
    return out
  }

  async start() {
    try {
      const buf = await this.file.arrayBuffer()
      this.hash = await sha256(buf)
      const opened = await openPdf(buf)
      this.doc = opened.doc
      this.closeDoc = opened.destroy
      this.numPages = this.doc.numPages
      this.pages = new Array(this.numPages).fill(null)
      this.emit()

      for (let n = 1; n <= this.numPages; n++) {
        if (this.destroyed) return
        const { page, result } = await extractPage(this.doc, n)
        if (result.chars < 20 && result.hasImages) {
          this.pending.push(n)
        } else {
          this.pages[n - 1] = result.data
        }
        page.cleanup()
        if (n % 10 === 0 || n === this.numPages) {
          this.emit()
          await new Promise((r) => setTimeout(r)) // let the UI breathe
        }
      }
      this.emit()

      for (const n of [...this.pending]) {
        if (this.destroyed) return
        this.ocrCurrent = n
        this.emit()
        try {
          const page = await this.doc.getPage(n)
          this.pages[n - 1] = await ocrPage(page, n)
          page.cleanup()
        } catch (e) {
          console.warn('OCR failed on page', n, e)
          this.pages[n - 1] = { page: n, width: 0, height: 0, lines: [], source: 'ocr' }
        }
        this.pending = this.pending.filter((p) => p !== n)
        this.ocrDone++
        this.ocrCurrent = null
        this.emit()
      }
      this.finished = true
      this.emit()
    } catch (e) {
      this.error = e instanceof PdfError ? e.message : 'Something went wrong while reading this PDF.'
      this.finished = true
      this.emit()
    }
  }

  destroy() {
    this.destroyed = true
    this.listeners.clear()
    void this.closeDoc?.()
    void terminateOcr()
  }
}
