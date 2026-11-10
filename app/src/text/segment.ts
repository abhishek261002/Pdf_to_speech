import { longerPause, pauseForEnding } from './pauses'
import { toSpeakable } from './speakable'
import type { Block, BuiltDoc, DocBlock, PauseKind, Sentence, Unit } from './types'

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'gen', 'col', 'lt', 'sgt', 'capt', 'maj', 'rev', 'hon',
  'gov', 'sen', 'rep', 'pres', 'vs', 'inc', 'ltd', 'corp', 'dept', 'univ', 'approx', 'fig',
  'figs', 'eq', 'eqs', 'vol', 'vols', 'pp', 'al', 'cf', 'viz',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])

const MAX_CHUNK = 230

/** Does this text end in a way that should NOT end a sentence (Dr., e.g., J., 3.)? */
function endsWithNonTerminal(s: string): boolean {
  const t = s.trimEnd()
  if (!/\.["'”’)]*$/.test(t)) return false
  const last = (t.match(/(\S+)$/)?.[1] ?? '').replace(/["'”’()]+/g, '')
  const word = last.replace(/\.$/, '')
  if (/^\d{1,3}$/.test(word) && t.length === last.length) return true // list number at the start "1."
  if (/^(?:[A-Za-z]\.){2,}$/.test(last)) return true // e.g. i.e. U.S.
  if (/^[A-Za-z]$/.test(word)) return true // initials: J.
  if (ABBREV.has(word.toLowerCase())) return true
  return false
}

/** Split a block of text into sentences, guarding against abbreviation false-positives. */
export function splitSentences(text: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' })
  const raw = [...seg.segment(text)].map((s) => s.segment.trim()).filter(Boolean)
  const out: string[] = []
  for (const s of raw) {
    const prev = out[out.length - 1]
    if (prev && (endsWithNonTerminal(prev) || /^[a-z]/.test(s) || /^[,;)\]]/.test(s))) {
      out[out.length - 1] = prev + ' ' + s
    } else out.push(s)
  }
  return out
}

/** Break an over-long sentence into clauses at natural places. */
function splitLong(s: string): string[] {
  if (s.length <= MAX_CHUNK) return [s]
  const parts: string[] = []
  let rest = s
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK)
    let cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf('— '), window.lastIndexOf('– '))
    if (cut < MAX_CHUNK * 0.35) cut = window.lastIndexOf(', ')
    if (cut < MAX_CHUNK * 0.35) {
      const m = [...window.matchAll(/\s(?:and|but|or|which|that|because|while|although|when|where)\s/g)].pop()
      cut = m?.index ?? -1
    }
    if (cut < MAX_CHUNK * 0.35) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = MAX_CHUNK
    const end = rest[cut] === ' ' ? cut : cut + 1
    parts.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

const BLOCK_PAUSE: Record<string, PauseKind> = { paragraph: 'paragraph', heading: 'heading', bullet: 'bullet' }

export function buildDocument(blocks: Block[], removed: BuiltDoc['removed'], skipUrls: boolean): BuiltDoc {
  const sentences: Sentence[] = []
  const units: Unit[] = []
  const docBlocks: DocBlock[] = []

  for (const block of blocks) {
    const blockIndex = docBlocks.length
    const sentenceIds: number[] = []
    const texts = block.type === 'heading' ? [block.text] : splitSentences(block.text)
    texts.forEach((sText, si) => {
      const isLastInBlock = si === texts.length - 1
      const sentence: Sentence = { id: sentences.length, text: sText, page: block.page, blockIndex, units: [] }
      const chunks = splitLong(sText)
      chunks.forEach((chunk, ci) => {
        const spoken = toSpeakable(chunk, { skipUrls })
        if (!spoken) return
        const lastChunk = ci === chunks.length - 1
        let pause: PauseKind = pauseForEnding(chunk)
        if (!lastChunk && pause === 'period') pause = 'comma'
        if (lastChunk && isLastInBlock) pause = longerPause(pause, BLOCK_PAUSE[block.type] ?? 'paragraph')
        const unit: Unit = { id: units.length, sentenceId: sentence.id, spoken, pause, page: block.page }
        units.push(unit)
        sentence.units.push(unit)
      })
      // keep sentences that have no speakable text out of the reader's playback order but still show them
      sentences.push(sentence)
      sentenceIds.push(sentence.id)
    })
    docBlocks.push({ type: block.type, page: block.page, sentenceIds })
  }
  return { blocks: docBlocks, sentences, units, removed }
}
