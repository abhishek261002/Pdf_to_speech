/** A piece of text with its position on a page. y is the baseline measured from the TOP of the page. */
export interface RawItem {
  str: string
  x: number
  y: number
  w: number
  size: number
  /** true when this item is always a separate word (OCR words) */
  spaceBefore?: boolean
}

export interface Line {
  text: string
  x0: number
  x1: number
  y: number
  size: number
  page: number
  col: number
}

export interface PageData {
  page: number
  width: number
  height: number
  lines: Line[]
  source: 'text' | 'ocr'
}

export type BlockType = 'heading' | 'paragraph' | 'bullet'

export interface Block {
  type: BlockType
  text: string
  page: number
}

export interface RemovedItem {
  page: number
  text: string
  reason: string
}

export type PauseKind =
  | 'none'
  | 'comma'
  | 'semi'
  | 'dash'
  | 'period'
  | 'question'
  | 'ellipsis'
  | 'bullet'
  | 'paragraph'
  | 'heading'

/** One thing sent to the voice engine: a sentence, or a clause of a very long sentence. */
export interface Unit {
  id: number
  sentenceId: number
  /** text prepared for the engine (no symbols that could be read aloud) */
  spoken: string
  /** silence after this unit */
  pause: PauseKind
  page: number
}

/** A sentence as shown in the reader (text exactly as written). */
export interface Sentence {
  id: number
  text: string
  page: number
  blockIndex: number
  units: Unit[]
}

export interface DocBlock {
  type: BlockType
  page: number
  sentenceIds: number[]
}

export interface BuiltDoc {
  blocks: DocBlock[]
  sentences: Sentence[]
  units: Unit[]
  removed: RemovedItem[]
}

export interface CleanOptions {
  /** remove running headers, footers and page numbers */
  removeHeadersFooters: boolean
  /** remove numeric citation markers like [12] or [3, 4] */
  skipCitations: boolean
  /** remove web addresses and e-mail addresses */
  skipUrls: boolean
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  removeHeadersFooters: true,
  skipCitations: false,
  skipUrls: false,
}
