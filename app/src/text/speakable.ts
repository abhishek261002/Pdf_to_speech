/**
 * Final preparation of text before it reaches a voice engine.
 * Goal: nothing is ever spoken that is not a word. Punctuation shapes rhythm only.
 * Words are never removed; only symbols are.
 */

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
}

/** Normalise odd unicode from PDFs without touching meaning. */
export function normalizeUnicode(s: string): string {
  return s
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[  -   　\t]/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi

export interface SpeakableOptions {
  skipUrls?: boolean
}

/**
 * Returns text safe to hand to an engine, or '' when nothing speakable is left.
 * Keeps . , ? ! (the engines use them for intonation and never say them).
 */
export function toSpeakable(input: string, opts: SpeakableOptions = {}): string {
  let s = normalizeUnicode(input)
  if (opts.skipUrls) s = s.replace(URL_RE, ' ')

  s = s
    // dot leaders, decoration runs
    .replace(/(?:\s*\.){4,}/g, ' ')
    .replace(/([-_=~*#+•·])\1{2,}/g, ' ')
    // ellipsis -> a single full stop (the pause itself is added by our pause model)
    .replace(/\.{2,}|…/g, '.')
    // dashes used as punctuation become a comma-like break
    .replace(/\s+[-–—]+\s+|\s*[—–]\s*/g, ', ')
    // slash between words: "and/or" -> "and or"
    .replace(/(?<=[A-Za-z])\/(?=[A-Za-z])/g, ' ')
    // brackets, parentheses, braces: keep the words, turn the brackets into a short break
    .replace(/\s*[(\[{«]\s*/g, ', ')
    .replace(/\s*[)\]}»]\s*/g, ', ')
    // quotes are never spoken
    .replace(/"/g, ' ')
    .replace(/(^|\s)'+|'+(?=\s|$)/g, '$1')
    // semicolon / colon -> comma (intonation), end-of-sentence marks are kept
    .replace(/[;:；：]/g, ',')
    // symbols an engine could vocalise
    .replace(/[*#_~|^<>\\`§¶†‡•◦▪■●○‣∙·]/g, ' ')
    .replace(/[=]+/g, ' equals ')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/\s+([,.?!])/g, '$1')
    .replace(/^[\s,.]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  // collapse ",." or ",?" produced by closing brackets before sentence-end marks
  s = s.replace(/,\s*([.?!])/g, '$1').replace(/([.?!])\s*,/g, '$1')

  if (!/[\p{L}\p{N}]/u.test(s)) return ''
  return s
}
