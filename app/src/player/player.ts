import { pauseMs } from '../text/pauses'
import type { Unit } from '../text/types'
import { PiperEngine, SystemEngine, type Engine, type Prepared } from '../tts/engines'
import { SAMPLE_TEXT } from '../tts/voices'

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'waiting' | 'ended'

export interface PlayerSnapshot {
  state: PlayerState
  /** index into units */
  index: number
  total: number
  sentenceId: number | null
  page: number | null
  voice: string
  speed: number
  pauseScale: number
  error: string | null
}

const LOOKAHEAD = 3

/**
 * Plays a list of units one after another with human-length pauses between them.
 * While one unit plays, the next few are already being prepared, so there are no stutters.
 */
export class Player {
  readonly neural = new PiperEngine()
  readonly system = SystemEngine.available() ? new SystemEngine() : null

  private units: Unit[] = []
  private index = 0
  private state: PlayerState = 'idle'
  private token = 0
  private voice: string
  private speed = 1
  private pauseScale = 1
  private moreComing = false
  private error: string | null = null
  private cache = new Map<string, Promise<Prepared>>()
  private wake: (() => void) | null = null
  private listeners = new Set<() => void>()
  private snap: PlayerSnapshot
  /** test/diagnostic trail of what was actually spoken */
  trail: { spoken: string; pause: string; pauseMs: number }[] = []

  constructor(voice: string) {
    this.voice = voice
    this.snap = this.makeSnap()
  }

  // ------------------------------------------------------------ observable state
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = () => this.snap
  private makeSnap(): PlayerSnapshot {
    const u = this.units[this.index]
    return {
      state: this.state,
      index: this.index,
      total: this.units.length,
      sentenceId: u ? u.sentenceId : null,
      page: u ? u.page : null,
      voice: this.voice,
      speed: this.speed,
      pauseScale: this.pauseScale,
      error: this.error,
    }
  }
  private emit() {
    this.snap = this.makeSnap()
    this.listeners.forEach((l) => l())
  }
  private setState(s: PlayerState) {
    this.state = s
    this.emit()
  }

  // ------------------------------------------------------------ configuration
  private engineFor(voice: string): Engine {
    if (voice.startsWith('sys:') && this.system) return this.system
    return this.neural
  }
  private isPaused() {
    return this.state === 'paused'
  }
  private get engine() {
    return this.engineFor(this.voice)
  }

  /** Replace/extend the text. The current position is kept (by unit index). */
  setUnits(units: Unit[], moreComing: boolean) {
    const sameHead = units.length >= this.index && this.units[this.index]?.spoken === units[this.index]?.spoken
    this.units = units
    this.moreComing = moreComing
    if (!sameHead) this.cache.clear()
    if (this.index >= units.length && units.length > 0 && !moreComing && this.state === 'ended') this.index = 0
    this.emit()
    this.wake?.()
  }

  setVoice(voice: string) {
    if (voice === this.voice) return
    const wasActive = this.state === 'playing' || this.state === 'loading' || this.state === 'waiting'
    this.engine.cancelPending()
    this.engine.stop()
    this.voice = voice
    this.cache.clear()
    this.emit()
    if (wasActive) this.startAt(this.index)
  }
  setSpeed(speed: number) {
    this.speed = speed
    // already-prepared audio keeps its old speed; drop the look-ahead so the next units use the new one
    for (const k of [...this.cache.keys()]) if (!k.startsWith(`${this.index}|`)) this.cache.delete(k)
    this.engine.cancelPending()
    this.emit()
  }
  setPauseScale(scale: number) {
    this.pauseScale = scale
    this.emit()
  }
  getVoice() {
    return this.voice
  }

  // ------------------------------------------------------------ transport
  /** Call from a click/keypress so the browser allows audio. */
  unlock() {
    this.neural.unlock()
  }

  play() {
    this.unlock()
    if (this.state === 'paused') {
      this.error = null
      this.setState('playing')
      if (this.engine.pausesInPlace) this.engine.resume()
      this.wake?.()
      return
    }
    if (this.state === 'playing' || this.state === 'loading' || this.state === 'waiting') return
    if (!this.units.length) return
    const from = this.state === 'ended' || this.index >= this.units.length ? 0 : this.index
    this.startAt(from)
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'loading' && this.state !== 'waiting') return
    this.setState('paused')
    this.engine.pause()
  }

  toggle() {
    if (this.state === 'playing' || this.state === 'loading' || this.state === 'waiting') this.pause()
    else this.play()
  }

  /** Speak one sample sentence in a voice (pauses whatever is playing). */
  async preview(voice: string) {
    this.unlock()
    this.pause()
    const e = this.engineFor(voice)
    e.stop()
    const p = await e.prepare(SAMPLE_TEXT, voice, 1)
    await e.play(p, voice, 1)
  }

  stopAll() {
    this.token++
    this.engine.cancelPending()
    this.engine.stop()
    this.cache.clear()
    this.units = []
    this.index = 0
    this.state = 'idle'
    this.emit()
  }

  seekUnit(i: number) {
    i = Math.max(0, Math.min(i, this.units.length - 1))
    const active = this.state === 'playing' || this.state === 'loading' || this.state === 'waiting'
    if (active) this.startAt(i)
    else {
      this.token++
      this.wake?.()
      this.engine.stop()
      this.index = i
      if (this.state === 'ended') this.state = 'paused'
      this.emit()
    }
  }
  seekSentence(sentenceId: number, play = true) {
    const i = this.units.findIndex((u) => u.sentenceId === sentenceId)
    if (i < 0) return
    if (play && this.state !== 'playing') {
      this.startAt(i)
    } else this.seekUnit(i)
  }
  nextSentence() {
    const cur = this.units[this.index]?.sentenceId
    const i = this.units.findIndex((u, k) => k > this.index && u.sentenceId !== cur)
    this.seekUnit(i < 0 ? this.units.length - 1 : i)
  }
  prevSentence() {
    const cur = this.units[this.index]?.sentenceId
    // first unit of the current sentence; if already there, go to the previous sentence
    let start = this.index
    while (start > 0 && this.units[start - 1].sentenceId === cur) start--
    if (start < this.index) return this.seekUnit(start)
    if (start === 0) return this.seekUnit(0)
    const prev = this.units[start - 1].sentenceId
    let s = start - 1
    while (s > 0 && this.units[s - 1].sentenceId === prev) s--
    this.seekUnit(s)
  }
  seekPage(page: number) {
    const i = this.units.findIndex((u) => u.page >= page)
    if (i >= 0) this.seekUnit(i)
  }

  // ------------------------------------------------------------ internals
  private startAt(i: number) {
    this.token++
    this.wake?.()
    this.engine.cancelPending()
    this.engine.stop()
    this.index = Math.max(0, Math.min(i, this.units.length - 1))
    this.error = null
    void this.run(this.token)
  }

  private key(i: number) {
    return `${i}|${this.voice}|${this.speed}`
  }
  private prepared(i: number): Promise<Prepared> {
    const k = this.key(i)
    let p = this.cache.get(k)
    if (!p) {
      p = this.engine.prepare(this.units[i].spoken, this.voice, this.speed)
      p.catch(() => this.cache.delete(k))
      this.cache.set(k, p)
    }
    return p
  }
  private prefetch(from: number) {
    for (let i = from; i < Math.min(this.units.length, from + LOOKAHEAD); i++) void this.prepared(i).catch(() => {})
    for (const k of [...this.cache.keys()]) if (parseInt(k) < this.index - 1) this.cache.delete(k)
  }

  private async untilResumed(token: number) {
    while (this.isPaused() && token === this.token) await new Promise<void>((r) => (this.wake = r))
    this.wake = null
  }

  private async gap(ms: number, token: number) {
    let left = ms
    while (left > 0 && token === this.token) {
      if (this.isPaused()) {
        await this.untilResumed(token)
        continue
      }
      const step = Math.min(left, 40)
      await new Promise((r) => setTimeout(r, step))
      left -= step
    }
  }

  private async run(token: number) {
    const alive = () => token === this.token
    this.setState('loading')
    try {
      while (alive()) {
        if (this.index >= this.units.length) {
          if (this.moreComing) {
            this.setState('waiting')
            await new Promise<void>((r) => (this.wake = r))
            this.wake = null
            if (alive() && this.state === 'waiting') this.setState('loading')
            continue
          }
          this.setState('ended')
          return
        }
        if (this.isPaused()) {
          await this.untilResumed(token)
          continue
        }
        const i = this.index
        const unit = this.units[i]
        this.emit()
        const prep = await this.prepared(i)
        if (!alive()) return
        if (this.isPaused()) {
          await this.untilResumed(token)
          if (!alive()) return
        }
        this.prefetch(i + 1)
        if (this.state !== 'playing') this.setState('playing')
        const result = await this.engine.play(prep, this.voice, this.speed)
        if (!alive()) return
        if (result === 'interrupted') {
          // paused on an engine that cannot freeze mid-sentence: say this unit again after resuming
          if (this.isPaused()) {
            await this.untilResumed(token)
            continue
          }
          return
        }
        const ms = pauseMs(unit.pause, this.pauseScale)
        this.trail.push({ spoken: unit.spoken, pause: unit.pause, pauseMs: ms })
        if (this.trail.length > 500) this.trail.shift()
        await this.gap(ms, token)
        if (!alive()) return
        this.index = i + 1
      }
    } catch (e) {
      if (!alive()) return
      if ((e as Error).message === 'cancelled') {
        // a stale request was dropped by a voice/speed change; try again
        if (alive()) return void this.run(token)
        return
      }
      this.error = (e as Error).message || 'The voice engine had a problem.'
      this.setState('paused')
    }
  }
}
