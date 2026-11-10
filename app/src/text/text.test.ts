import { describe, expect, it } from 'vitest'
import { buildFromPages } from './build'
import { PAUSE_MS, pauseForEnding } from './pauses'
import { splitSentences } from './segment'
import { toSpeakable } from './speakable'
import { DEFAULT_CLEAN_OPTIONS, type Line, type PageData } from './types'
import { buildPage } from '../pdf/layout'

describe('speakable: punctuation is never spoken', () => {
  it('keeps the words and the end mark, no extra symbols', () => {
    expect(toSpeakable('He is going to Mumbai.')).toBe('He is going to Mumbai.')
  })
  it('strips symbols engines might read out', () => {
    const out = toSpeakable('*** Note: this is #1 | really ~important ***')
    expect(out).not.toMatch(/[*#|~]/)
    expect(out.toLowerCase()).toContain('this is 1')
    expect(out.toLowerCase()).toContain('really important')
  })
  it('turns brackets and dashes into breaks and drops quotes', () => {
    const out = toSpeakable('She said "yes" (quietly) — then left.')
    expect(out).not.toMatch(/["()—]/)
    expect(out).toContain('yes')
    expect(out).toContain('quietly')
    expect(out).toContain('then left.')
  })
  it('splits and/or style slashes', () => {
    expect(toSpeakable('and/or')).toBe('and or')
  })
  it('returns empty for symbol-only input', () => {
    expect(toSpeakable('* * *')).toBe('')
    expect(toSpeakable('------')).toBe('')
  })
  it('normalises ligatures and soft hyphens', () => {
    expect(toSpeakable('ﬁnal of­fice')).toBe('final office')
  })
  it('can skip urls on request', () => {
    expect(toSpeakable('Visit https://example.com/x now.', { skipUrls: true })).toBe('Visit now.')
  })
})

describe('sentence splitting', () => {
  it('does not split on abbreviations, initials, decimals', () => {
    expect(splitSentences('Dr. Smith met Mr. Jones. They talked.')).toEqual(['Dr. Smith met Mr. Jones.', 'They talked.'])
    expect(splitSentences('J. K. Rowling wrote it. It sold well.')).toEqual(['J. K. Rowling wrote it.', 'It sold well.'])
    expect(splitSentences('Pi is 3.14 roughly, e.g. in class. Next.')).toEqual(['Pi is 3.14 roughly, e.g. in class.', 'Next.'])
  })
  it('keeps a list number with its item', () => {
    expect(splitSentences('1. Introduction to the plan.')).toEqual(['1. Introduction to the plan.'])
  })
})

describe('pause model', () => {
  it('maps endings to pauses', () => {
    expect(pauseForEnding('He is going to Mumbai.')).toBe('period')
    expect(pauseForEnding('Really?')).toBe('question')
    expect(pauseForEnding('Well,')).toBe('comma')
    expect(pauseForEnding('Wait...')).toBe('ellipsis')
    expect(pauseForEnding('First:')).toBe('semi')
    expect(PAUSE_MS.period).toBe(550)
  })
})

let y = 100
const L = (text: string, page = 1, o: Partial<Line> = {}): Line => {
  const line: Line = { text, x0: 72, x1: 72 + text.length * 5, y, size: 11, page, col: 0, ...o }
  y += 14
  return line
}
const page = (n: number, lines: Line[]): PageData => ({ page: n, width: 612, height: 792, lines, source: 'text' })

describe('full pipeline', () => {
  it('Mumbai example: spoken text has no punctuation words, then a period pause', () => {
    y = 100
    const doc = buildFromPages([page(1, [L('He is going to Mumbai.')])], DEFAULT_CLEAN_OPTIONS)
    expect(doc.units).toHaveLength(1)
    expect(doc.units[0].spoken).toBe('He is going to Mumbai.')
    expect(doc.units[0].pause === 'paragraph' || doc.units[0].pause === 'period').toBe(true)
  })

  it('removes repeating headers, footers and page numbers but keeps body text', () => {
    const pages: PageData[] = []
    for (let n = 1; n <= 5; n++) {
      y = 100
      pages.push(
        page(n, [
          L('The Great Book of Things', n, { y: 30 }),
          L(`This is the body text of page ${n} and it matters.`, n),
          L(String(n), n, { y: 760 }),
        ]),
      )
    }
    const doc = buildFromPages(pages, DEFAULT_CLEAN_OPTIONS)
    const all = doc.sentences.map((s) => s.text).join(' ')
    expect(all).not.toContain('Great Book')
    for (let n = 1; n <= 5; n++) expect(all).toContain(`body text of page ${n}`)
    expect(doc.removed.some((r) => r.reason === 'repeating header/footer')).toBe(true)
    expect(doc.removed.some((r) => r.reason === 'page number')).toBe(true)
  })

  it('"read everything" keeps headers and page numbers', () => {
    const pages: PageData[] = []
    for (let n = 1; n <= 4; n++) pages.push(page(n, [L('Running Title', n, { y: 30 }), L(`Body ${n} here.`, n, { y: 200 })]))
    const doc = buildFromPages(pages, { ...DEFAULT_CLEAN_OPTIONS, removeHeadersFooters: false })
    expect(doc.sentences.map((s) => s.text).join(' ')).toContain('Running Title')
  })

  it('joins hyphenated line breaks and lines into one paragraph', () => {
    y = 100
    const doc = buildFromPages(
      [page(1, [L('The inter-', 1), L('national community met today to discuss the', 1), L('new agreement in detail.', 1)])],
      DEFAULT_CLEAN_OPTIONS,
    )
    expect(doc.sentences).toHaveLength(1)
    expect(doc.sentences[0].text).toBe('The international community met today to discuss the new agreement in detail.')
  })

  it('continues a sentence across a page break', () => {
    y = 100
    const p1 = page(1, [L('He walked slowly down the long road and finally reached the', 1, { y: 700 })])
    y = 100
    const p2 = page(2, [L('old house where it all began.', 2, { y: 100 })])
    const doc = buildFromPages([p1, p2], DEFAULT_CLEAN_OPTIONS)
    expect(doc.sentences).toHaveLength(1)
    expect(doc.sentences[0].text).toContain('reached the old house')
  })

  it('detects headings and gives them a long pause; separates paragraphs', () => {
    y = 100
    const doc = buildFromPages(
      [
        page(1, [
          L('INTRODUCTION', 1, { size: 18 }),
          L('First paragraph sentence one. Second sentence follows.', 1, { y: 160 }),
          L('A new paragraph starts here.', 1, { y: 220 }),
        ]),
      ],
      DEFAULT_CLEAN_OPTIONS,
    )
    expect(doc.blocks[0].type).toBe('heading')
    expect(doc.units[0].pause).toBe('heading')
    const paraEnd = doc.units.find((u) => u.spoken.startsWith('Second sentence'))!
    expect(paraEnd.pause).toBe('paragraph')
  })

  it('table of contents leaders are dropped, entry kept', () => {
    y = 100
    const doc = buildFromPages([page(1, [L('Chapter One ........ 5')])], DEFAULT_CLEAN_OPTIONS)
    expect(doc.sentences[0].text).toBe('Chapter One')
  })

  it('long sentences become clauses with comma pauses', () => {
    y = 100
    const long = Array.from({ length: 6 }, (_, i) => `this is clause number ${i} of a rather long sentence`).join(', ') + '.'
    const doc = buildFromPages([page(1, [L(long)])], DEFAULT_CLEAN_OPTIONS)
    expect(doc.sentences).toHaveLength(1)
    expect(doc.units.length).toBeGreaterThan(1)
    expect(doc.units[0].pause).toBe('comma')
    expect(Math.max(...doc.units.map((u) => u.spoken.length))).toBeLessThanOrEqual(260)
  })

  it('citation markers are kept by default and removable', () => {
    y = 100
    const p = page(1, [L('This was shown earlier [12] and again [3, 4].')])
    expect(buildFromPages([p], DEFAULT_CLEAN_OPTIONS).sentences[0].text).toContain('[12]')
    expect(buildFromPages([p], { ...DEFAULT_CLEAN_OPTIONS, skipCitations: true }).sentences[0].text).toBe(
      'This was shown earlier and again.',
    )
  })
})

describe('layout: columns', () => {
  it('reads the left column before the right column', () => {
    const items = []
    const mk = (str: string, x: number, yy: number) => ({ str, x, y: yy, w: str.length * 5, size: 11 })
    for (let i = 0; i < 8; i++) {
      items.push(mk(`left line ${i} with some words here`, 50, 100 + i * 14))
      items.push(mk(`right line ${i} with some words here`, 330, 100 + i * 14))
    }
    const p = buildPage(items, 1, 612, 792, 'text')
    const texts = p.lines.map((l) => l.text)
    expect(texts[0]).toBe('left line 0 with some words here')
    expect(texts[7]).toBe('left line 7 with some words here')
    expect(texts[8]).toBe('right line 0 with some words here')
  })
  it('single column pages are not split', () => {
    const items = []
    for (let i = 0; i < 12; i++) items.push({ str: 'a long line of text that crosses the whole width of the page', x: 72, y: 100 + i * 14, w: 460, size: 11 })
    const p = buildPage(items, 1, 612, 792, 'text')
    expect(p.lines.every((l) => l.col === 0)).toBe(true)
    expect(p.lines).toHaveLength(12)
  })
})
