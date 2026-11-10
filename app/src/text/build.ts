import { cleanPages } from './clean'
import { buildDocument } from './segment'
import type { BuiltDoc, CleanOptions, PageData } from './types'

/** Whole pipeline: page lines -> clean blocks -> sentences -> speakable units with pauses. */
export function buildFromPages(pages: PageData[], opts: CleanOptions): BuiltDoc {
  const { blocks, removed } = cleanPages(pages, opts)
  return buildDocument(blocks, removed, opts.skipUrls)
}
