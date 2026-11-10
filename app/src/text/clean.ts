import type { Block, BlockType, CleanOptions, Line, PageData, RemovedItem } from './types'

/**
 * Turns page lines into clean blocks (headings, paragraphs, bullet items).
 * Rule: only layout artifacts are removed (page numbers, repeating headers/footers,
 * decoration lines, OCR speckle). Body words are never dropped.
 */

const TERMINAL = /[.!?:;"'”’)\]»…]$/
const SENTENCE_END = /[.!?…]["'”’)\]»]*$/
const PAGE_NUMBER = [
  /^(?:page|p\.?|pg\.?)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
  /^\d{1,4}\s*(?:of|\/)\s*\d{1,4}$/i,
  /^[-–—‑]\s*\d{1,4}\s*[-–—‑]$/,
  /^\d{1,4}$/,
  /^[ivxlcdm]{1,7}$/i,
  /^\[\s*\d{1,4}\s*\]$/,
]
const BULLET = /^(?:[•◦▪■●○‣∙·*►▶➤✓✔–—-]|\(?\d{1,3}[.)]|\(?[a-z]\))\s+(?=\S)/
const GLYPH_BULLET = /^[•◦▪■●○‣∙·*►▶➤✓✔]\s*/

const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

const normKey = (t: string) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

function isDecoration(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text)
}

function letterRatio(text: string): number {
  const letters = (text.match(/\p{L}/gu) ?? []).length
  return text.length ? letters / text.length : 0
}

function bodySize(pages: PageData[]): number {
  const weight = new Map<number, number>()
  for (const p of pages)
    for (const l of p.lines) {
      const k = Math.round(l.size * 2) / 2
      weight.set(k, (weight.get(k) ?? 0) + l.text.length)
    }
  let best = 10
  let bestW = -1
  for (const [k, w] of weight) if (w > bestW) { best = k; bestW = w }
  return best
}

export function cleanPages(
  pages: PageData[],
  opts: CleanOptions,
): { blocks: Block[]; removed: RemovedItem[] } {
  const removed: RemovedItem[] = []
  const drop = (l: Line, reason: string) => removed.push({ page: l.page, text: l.text, reason })

  // ---- 1. find repeating headers / footers ----
  const repeated = new Set<string>()
  if (opts.removeHeadersFooters && pages.length >= 3) {
    const seen = new Map<string, Set<number>>()
    for (const p of pages) {
      for (const l of p.lines) {
        if (!inMargin(l, p)) continue
        const k = normKey(l.text)
        if (k.length < 2) continue
        if (!seen.has(k)) seen.set(k, new Set())
        seen.get(k)!.add(p.page)
      }
    }
    const need = Math.max(3, Math.ceil(pages.length * 0.35))
    for (const [k, set] of seen) if (set.size >= need) repeated.add(k)
  }

  // ---- 2. filter lines ----
  const kept: PageData[] = pages.map((p) => {
    const lines = p.lines.filter((l) => {
      if (isDecoration(l.text)) {
        drop(l, 'decoration line')
        return false
      }
      if (p.source === 'ocr' && letterRatio(l.text) < 0.35 && l.text.length < 40) {
        drop(l, 'scan noise')
        return false
      }
      if (opts.removeHeadersFooters && inMargin(l, p)) {
        if (repeated.has(normKey(l.text))) {
          drop(l, 'repeating header/footer')
          return false
        }
        if (PAGE_NUMBER.some((re) => re.test(l.text.trim()))) {
          drop(l, 'page number')
          return false
        }
      }
      return true
    })
    return { ...p, lines }
  })

  // ---- 3. lines -> blocks ----
  const body = bodySize(kept)
  const blocks: Block[] = []
  for (const p of kept) pageToBlocks(p, body, blocks)

  // ---- 4. text-level tidy-ups ----
  const out: Block[] = []
  for (const b of blocks) {
    let t = b.text
    t = t.replace(/\s*(?:\.{3,}|(?:\. ){3,}|…{2,})\s*\d{1,4}\s*$/, '') // table of contents leaders + page no.
    t = t.replace(/(?:\.\s*){4,}/g, ' ')
    if (opts.skipCitations) t = t.replace(/\s*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
    t = t.replace(/\s+/g, ' ').trim()
    if (!t || isDecoration(t)) continue
    out.push({ ...b, text: t })
  }

  // ---- 5. merge paragraphs that were cut by a page or column break ----
  const merged: Block[] = []
  for (const b of out) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.type === 'paragraph' &&
      b.type === 'paragraph' &&
      !SENTENCE_END.test(prev.text) &&
      /^[a-z(“"']/.test(b.text)
    ) {
      prev.text = joinText(prev.text, b.text)
    } else merged.push({ ...b })
  }
  return { blocks: merged, removed }
}

function inMargin(l: Line, p: PageData): boolean {
  if (!p.height) return false
  const r = l.y / p.height
  return r < 0.09 || r > 0.91
}

function joinText(a: string, b: string): string {
  if (/[A-Za-z]{2,}[-‐‑]$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b
  return a + ' ' + b
}

function isHeading(l: Line, body: number): boolean {
  const t = l.text
  if (t.length > 140) return false
  if (l.size >= body * 1.18 && !/[,;]$/.test(t)) return true
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 3 && t.length <= 90 && letters === letters.toUpperCase() && !/[.,;]$/.test(t)) return true
  return false
}

function pageToBlocks(p: PageData, body: number, blocks: Block[]) {
  const lines = p.lines
  if (!lines.length) return

  // geometry per column
  const colLines = new Map<number, Line[]>()
  for (const l of lines) {
    if (!colLines.has(l.col)) colLines.set(l.col, [])
    colLines.get(l.col)!.push(l)
  }
  const geom = new Map<number, { margin: number; maxW: number; pitch: number }>()
  for (const [c, ls] of colLines) {
    const xs = ls.map((l) => l.x0).sort((a, b) => a - b)
    const margin = xs[Math.floor(xs.length * 0.2)]
    const maxW = Math.max(...ls.map((l) => l.x1 - margin))
    const dys: number[] = []
    for (let i = 1; i < ls.length; i++) {
      const dy = ls[i].y - ls[i - 1].y
      if (dy > 0 && dy < ls[i].size * 3) dys.push(dy)
    }
    geom.set(c, { margin, maxW, pitch: median(dys) || body * 1.3 })
  }

  let cur: { type: BlockType; text: string; size: number } | null = null
  let prev: Line | null = null
  const flush = () => {
    if (cur && cur.text.trim()) blocks.push({ type: cur.type, text: cur.text, page: p.page })
    cur = null
  }

  for (const l of lines) {
    const g = geom.get(l.col)!
    const heading = isHeading(l, body)
    const bulletMatch = !heading && BULLET.test(l.text)
    let startNew = false
    if (!cur || !prev) startNew = true
    else if (l.col !== prev.col) startNew = false // may continue; merged later if mid-sentence
    else {
      const dy = l.y - prev.y
      const sameHeading = cur.type === 'heading' && heading && Math.abs(l.size - prev.size) < 1 && dy < l.size * 1.7
      if (heading || cur.type === 'heading') startNew = !sameHeading
      else if (bulletMatch) startNew = true
      else if (dy > g.pitch * 1.55) startNew = true
      else if (Math.abs(l.size - prev.size) > body * 0.12) startNew = true
      else if (l.x0 - g.margin > l.size * 0.9 && TERMINAL.test(prev.text)) startNew = true
      else if (TERMINAL.test(prev.text) && prev.x1 - g.margin < g.maxW * 0.7 && prev.col === l.col) startNew = true
    }
    if (startNew) {
      flush()
      const type: BlockType = heading ? 'heading' : bulletMatch ? 'bullet' : 'paragraph'
      let text = l.text
      if (type === 'bullet') text = text.replace(GLYPH_BULLET, '')
      cur = { type, text, size: l.size }
    } else if (cur) {
      cur.text = joinText(cur.text, l.text)
    }
    prev = l
  }
  flush()
}
