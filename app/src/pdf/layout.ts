import type { Line, PageData, RawItem } from '../text/types'
import { normalizeUnicode } from '../text/speakable'

const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/** Group positioned items into text lines (left to right, joined with sensible spaces). */
function groupLines(items: RawItem[], page: number, col: number): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: RawItem[][] = []
  let rowY = -Infinity
  let rowSize = 0
  for (const it of sorted) {
    if (rows.length && Math.abs(it.y - rowY) <= Math.max(rowSize, it.size) * 0.45) {
      rows[rows.length - 1].push(it)
      // keep the row anchored on its largest text so superscripts do not drift it
      if (it.size > rowSize) {
        rowSize = it.size
        rowY = it.y
      }
    } else {
      rows.push([it])
      rowY = it.y
      rowSize = it.size
    }
  }
  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = row[0].x
    for (const it of row) {
      const gap = it.x - prevEnd
      const needsSpace = it.spaceBefore || gap > it.size * 0.17
      if (text && needsSpace && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' '
      text += it.str
      prevEnd = it.x + it.w
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const sizes = row.map((r) => r.size)
    lines.push({
      text,
      x0: row[0].x,
      x1: Math.max(...row.map((r) => r.x + r.w)),
      y: median(row.map((r) => r.y)),
      size: Math.max(...sizes),
      page,
      col,
    })
  }
  return lines
}

/** Find a vertical gutter (empty band) that splits the page into two text columns. */
function findGutter(items: RawItem[], width: number): number | null {
  if (items.length < 12) return null
  const BINS = 200
  const cover = new Array<number>(BINS).fill(0)
  for (const it of items) {
    const a = Math.max(0, Math.floor((it.x / width) * BINS))
    const b = Math.min(BINS - 1, Math.floor(((it.x + it.w) / width) * BINS))
    for (let i = a; i <= b; i++) cover[i]++
  }
  const tolerance = Math.max(1, Math.floor(items.length * 0.04))
  const lo = Math.floor(BINS * 0.3)
  const hi = Math.floor(BINS * 0.7)
  let best: { start: number; end: number } | null = null
  let start = -1
  for (let i = lo; i <= hi + 1; i++) {
    const empty = i <= hi && cover[i] <= tolerance
    if (empty && start < 0) start = i
    if (!empty && start >= 0) {
      if (!best || i - start > best.end - best.start) best = { start, end: i }
      start = -1
    }
  }
  if (!best || best.end - best.start < 3) return null // narrower than ~1.5% of the page
  const g = ((best.start + best.end) / 2 / BINS) * width
  const left = items.filter((i) => i.x + i.w <= g + width * 0.01).length
  const right = items.filter((i) => i.x >= g - width * 0.01).length
  if (left < items.length * 0.25 || right < items.length * 0.25) return null
  return g
}

/** Turn raw positioned items for one page into lines in natural reading order. */
export function buildPage(
  rawItems: RawItem[],
  page: number,
  width: number,
  height: number,
  source: 'text' | 'ocr',
): PageData {
  const items = rawItems
    .map((i) => ({ ...i, str: normalizeUnicode(i.str) }))
    .filter((i) => i.str.trim().length > 0 && Number.isFinite(i.x) && Number.isFinite(i.y))

  const gutter = findGutter(items, width)
  if (gutter == null) {
    return { page, width, height, lines: groupLines(items, page, 0), source }
  }

  const slack = width * 0.01
  const left: RawItem[] = []
  const right: RawItem[] = []
  const span: RawItem[] = []
  for (const it of items) {
    if (it.x + it.w <= gutter + slack) left.push(it)
    else if (it.x >= gutter - slack) right.push(it)
    else span.push(it)
  }
  // Full-width lines (titles etc.) split the page into vertical regions read top to bottom.
  const spanLines = groupLines(span, page, 0)
  const out: Line[] = []
  let regionTop = -Infinity
  const emit = (top: number, bottom: number) => {
    const inRegion = (it: RawItem) => it.y > top && it.y <= bottom
    out.push(...groupLines(left.filter(inRegion), page, 1))
    out.push(...groupLines(right.filter(inRegion), page, 2))
  }
  for (const sl of spanLines.sort((a, b) => a.y - b.y)) {
    emit(regionTop, sl.y - sl.size * 0.5)
    out.push(sl)
    regionTop = sl.y + sl.size * 0.5
  }
  emit(regionTop, Infinity)
  return { page, width, height, lines: out, source }
}
