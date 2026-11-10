/** Two interchangeable voice engines behind one small interface. */

export type PlayResult = 'done' | 'interrupted'

export interface Prepared {
  /** neural engine: ready-made audio */
  samples?: Float32Array
  sampleRate?: number
  /** system engine: text to speak */
  text?: string
}

export interface Engine {
  readonly id: 'piper' | 'system'
  prepare(text: string, voiceId: string, speed: number): Promise<Prepared>
  play(p: Prepared, voiceId: string, speed: number): Promise<PlayResult>
  pause(): void
  resume(): void
  stop(): void
  /** true when pause() freezes in place; false when playback has to restart the unit */
  readonly pausesInPlace: boolean
  /** drop queued work that is no longer needed */
  cancelPending(): void
}

// ---------------------------------------------------------------- Piper (neural, bundled with the app)

export interface NeuralStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  /** the voice being loaded / loaded */
  voice: string
  progress: number
  message?: string
  threads?: number
  isolated?: boolean
}

type Pending = { resolve: (p: Prepared) => void; reject: (e: Error) => void }

export class PiperEngine implements Engine {
  readonly id = 'piper' as const
  readonly pausesInPlace = true
  status: NeuralStatus = { state: 'idle', voice: '', progress: 0 }
  private worker: Worker | null = null
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private finish: ((r: PlayResult) => void) | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private epoch = 0
  private listeners = new Set<() => void>()
  /** newest synthesis speed measurements, for diagnostics */
  log: { genMs: number; phonMs: number; audioMs: number }[] = []

  onStatus(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private setStatus(s: Partial<NeuralStatus>) {
    this.status = { ...this.status, ...s }
    this.listeners.forEach((l) => l())
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./piperWorker.ts', import.meta.url), { type: 'module' })
    this.worker = w
    w.onerror = (e) => this.setStatus({ state: 'error', message: e.message || 'Voice engine failed to start' })
    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'voiceLoading') this.setStatus({ state: 'loading', voice: m.voice, progress: 0 })
      else if (m.type === 'progress') this.setStatus({ progress: Math.min(1, m.loaded / m.total) })
      else if (m.type === 'voiceReady') this.setStatus({ state: 'ready', voice: m.voice, progress: 1, threads: m.threads, isolated: m.isolated })
      else if (m.type === 'error') this.setStatus({ state: 'error', message: m.message })
      else if (m.type === 'audio') {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        this.log.push({ genMs: m.genMs, phonMs: m.phonMs, audioMs: (m.samples.length / m.sampleRate) * 1000 })
        if (this.log.length > 200) this.log.shift()
        p?.resolve({ samples: m.samples, sampleRate: m.sampleRate })
      } else if (m.type === 'skipped') {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        p?.reject(new Error('cancelled'))
      } else if (m.type === 'synthError') {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        p?.reject(new Error(m.message))
      }
    }
    return w
  }

  /** Start loading a voice (safe to call many times). */
  load(voiceId: string) {
    const v = voiceId.replace(/^piper:/, '')
    if (this.status.voice === v && this.status.state !== 'error') return
    this.setStatus({ state: 'loading', voice: v, progress: 0, message: undefined })
    this.ensureWorker().postMessage({ type: 'voice', voice: v })
  }

  async prepare(text: string, voiceId: string, speed: number): Promise<Prepared> {
    this.load(voiceId)
    const id = this.nextId++
    return new Promise<Prepared>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ensureWorker().postMessage({
        type: 'synth',
        id,
        epoch: this.epoch,
        text,
        voice: voiceId.replace(/^piper:/, ''),
        speed,
      })
    })
  }

  cancelPending() {
    this.epoch++
    this.worker?.postMessage({ type: 'epoch', epoch: this.epoch })
  }

  private audio(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }

  /** Must be called from a user gesture once, so browsers allow audio. */
  unlock() {
    void this.audio().resume()
  }

  play(p: Prepared): Promise<PlayResult> {
    const ctx = this.audio()
    return new Promise<PlayResult>((resolve) => {
      void ctx.resume()
      const samples = p.samples!
      // tiny fades remove clicks at the trimmed edges
      const fade = Math.min(Math.round(p.sampleRate! * 0.008), samples.length >> 1)
      for (let i = 0; i < fade; i++) {
        const g = i / fade
        samples[i] *= g
        samples[samples.length - 1 - i] *= g
      }
      const buf = ctx.createBuffer(1, samples.length, p.sampleRate!)
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      this.source = src
      this.finish = resolve
      src.onended = () => {
        if (this.source === src) {
          this.source = null
          this.finish = null
          resolve('done')
        }
      }
      src.start()
    })
  }

  pause() {
    void this.ctx?.suspend()
  }
  resume() {
    void this.ctx?.resume()
  }
  stop() {
    const src = this.source
    const fin = this.finish
    this.source = null
    this.finish = null
    if (src) {
      src.onended = null
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
    }
    fin?.('interrupted')
    void this.ctx?.resume()
  }
}

// ---------------------------------------------------------------- System voices (instant, built in to the device)

export class SystemEngine implements Engine {
  readonly id = 'system' as const
  readonly pausesInPlace = false
  private finish: ((r: PlayResult) => void) | null = null
  private utter: SpeechSynthesisUtterance | null = null

  static available() {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
  }

  async prepare(text: string): Promise<Prepared> {
    return { text }
  }
  cancelPending() {}

  play(p: Prepared, voiceId: string, speed: number): Promise<PlayResult> {
    return new Promise<PlayResult>((resolve) => {
      const u = new SpeechSynthesisUtterance(p.text!)
      const uri = voiceId.replace(/^sys:/, '')
      const v = speechSynthesis.getVoices().find((x) => x.voiceURI === uri)
      if (v) {
        u.voice = v
        u.lang = v.lang
      } else u.lang = 'en-US'
      u.rate = Math.max(0.5, Math.min(2.5, speed))
      this.utter = u
      this.finish = resolve
      let settled = false
      const done = (r: PlayResult) => {
        if (settled) return
        settled = true
        if (this.utter === u) {
          this.utter = null
          this.finish = null
        }
        resolve(r)
      }
      u.onend = () => done('done')
      u.onerror = (e) => done(e.error === 'interrupted' || e.error === 'canceled' ? 'interrupted' : 'done')
      speechSynthesis.speak(u)
    })
  }

  pause() {
    this.stop()
  }
  resume() {}
  stop() {
    const fin = this.finish
    this.utter = null
    this.finish = null
    speechSynthesis.cancel()
    fin?.('interrupted')
  }
}
