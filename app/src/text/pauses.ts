import type { PauseKind } from './types'

/** Default silence (ms) after each kind of boundary. Scaled by the user's "pause length" slider. */
export const PAUSE_MS: Record<PauseKind, number> = {
  none: 0,
  comma: 250,
  semi: 350,
  dash: 300,
  period: 550,
  question: 600,
  ellipsis: 750,
  bullet: 450,
  paragraph: 1000,
  heading: 1200,
}

/** Which pause follows a piece of text, judged by the punctuation it ends with. */
export function pauseForEnding(text: string): PauseKind {
  const t = text.trimEnd().replace(/["'”’)\]»*]+$/u, '')
  if (/(\.\.\.|…)$/.test(t)) return 'ellipsis'
  if (/[?!？！]$/.test(t)) return 'question'
  if (/[.。]$/.test(t)) return 'period'
  if (/[;:；：]$/.test(t)) return 'semi'
  if (/[—–]$/.test(t)) return 'dash'
  if (/[,，、]$/.test(t)) return 'comma'
  // A sentence with no punctuation at all (a title, a list item): treat as a full stop.
  return 'period'
}

const RANK: Record<PauseKind, number> = {
  none: 0, comma: 1, dash: 2, semi: 3, bullet: 4, period: 5, question: 6, ellipsis: 7, paragraph: 8, heading: 9,
}

/** The longer of two pauses. */
export function longerPause(a: PauseKind, b: PauseKind): PauseKind {
  return RANK[a] >= RANK[b] ? a : b
}

export function pauseMs(kind: PauseKind, scale: number): number {
  return Math.round(PAUSE_MS[kind] * scale)
}
