/// <reference lib="webworker" />
// Runs the Piper voice model off the main thread. Voices, the phonemiser and the WASM runtime are all
// served from this site (public/voices, public/piper, public/ort): nothing is fetched from third parties.
import * as ort from 'onnxruntime-web/wasm'

// Voices are served from this site (/voices). Setting VITE_VOICE_BASE=hf at build time serves them from
// Hugging Face instead (free, CORS-enabled), which keeps the deployed site small if a host limits upload size.
const VOICE_SOURCE = (import.meta.env.VITE_VOICE_BASE as string | undefined) || ''
function voiceUrl(id: string, ext: '.onnx' | '.onnx.json'): string {
  if (VOICE_SOURCE === 'hf') {
    const [region, name, quality] = id.split('-')
    return `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/${region}/${name}/${quality}/${id}${ext}`
  }
  return `${VOICE_SOURCE || '/voices'}/${id}${ext}`
}

const hw = self.navigator?.hardwareConcurrency ?? 4
ort.env.wasm.wasmPaths = '/ort/'
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, hw - 1)) : 1

const send = (m: unknown, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? [])

interface VoiceModel {
  id: string
  session: ort.InferenceSession
  config: {
    audio: { sample_rate: number }
    espeak: { voice: string }
    inference: { noise_scale: number; length_scale: number; noise_w: number }
    num_speakers: number
  }
}

let current: VoiceModel | null = null
let loading: Promise<VoiceModel> | null = null
let loadingId = ''
let epoch = 0

async function fetchWithProgress(url: string, onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`Could not load ${url} (${r.status})`)
  const total = Number(r.headers.get('Content-Length')) || 63_000_000
  const reader = r.body.getReader()
  const parts: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.length
    onProgress(loaded, total)
  }
  const out = new Uint8Array(loaded)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out.buffer
}

function loadVoice(id: string): Promise<VoiceModel> {
  if (current?.id === id) return Promise.resolve(current)
  if (loading && loadingId === id) return loading
  loadingId = id
  send({ type: 'voiceLoading', voice: id })
  loading = (async () => {
    const config = await (await fetch(voiceUrl(id, '.onnx.json'))).json()
    const buf = await fetchWithProgress(voiceUrl(id, '.onnx'), (loaded, total) =>
      send({ type: 'progress', voice: id, loaded, total }),
    )
    const session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })
    await current?.session.release().catch(() => {})
    current = { id, session, config }
    send({ type: 'voiceReady', voice: id, threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated })
    return current
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

// --- phonemiser (espeak-ng compiled to wasm, as used by Piper itself) ---
// Created once and reused: its 18 MB data file is fetched and unpacked a single time.
type PhonemizeModule = { callMain: (args: string[]) => void }
type CreatePhonemize = (opts: Record<string, unknown>) => Promise<PhonemizeModule>
let phonemizer: Promise<PhonemizeModule> | null = null
let onLine: ((line: string) => void) | null = null

function getPhonemizer(): Promise<PhonemizeModule> {
  if (!phonemizer) {
    phonemizer = (async () => {
      const url = '/piper/phonemize.mjs'
      const create = ((await import(/* @vite-ignore */ url)) as { default: CreatePhonemize }).default
      const [data, wasmBinary] = await Promise.all([
        fetch('/piper/piper_phonemize.data').then((r) => r.arrayBuffer()),
        fetch('/piper/piper_phonemize.wasm').then((r) => r.arrayBuffer()),
      ])
      return create({
        print: (line: string) => onLine?.(line),
        printErr: () => {},
        getPreloadedPackage: () => data,
        wasmBinary,
        locateFile: (u: string) => u,
      })
    })()
    phonemizer.catch(() => {
      phonemizer = null
    })
  }
  return phonemizer
}

async function phonemeIds(text: string, espeakVoice: string): Promise<number[]> {
  const mod = await getPhonemizer()
  return new Promise<number[]>((resolve, reject) => {
    onLine = (line) => {
      try {
        resolve(JSON.parse(line).phoneme_ids as number[])
      } catch (e) {
        reject(e)
      }
    }
    try {
      mod.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])
    } catch (e) {
      reject(e)
    }
  })
}

/** Remove silence at both ends so our own pause lengths are exact. */
function trim(samples: Float32Array, sr: number): Float32Array {
  const thr = 0.006
  let a = 0
  let b = samples.length - 1
  while (a < b && Math.abs(samples[a]) < thr) a++
  while (b > a && Math.abs(samples[b]) < thr) b--
  const pad = Math.round(sr * 0.03)
  a = Math.max(0, a - pad)
  b = Math.min(samples.length - 1, b + pad)
  return samples.slice(a, b + 1)
}

type Msg =
  | { type: 'epoch'; epoch: number }
  | { type: 'voice'; voice: string }
  | { type: 'synth'; id: number; epoch: number; text: string; voice: string; speed: number }

let chain: Promise<unknown> = Promise.resolve()

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  if (m.type === 'epoch') epoch = m.epoch
  else if (m.type === 'voice') {
    loadVoice(m.voice).catch((err) => send({ type: 'error', message: String(err?.message ?? err) }))
  } else if (m.type === 'synth') {
    chain = chain.then(async () => {
      if (m.epoch < epoch) return send({ type: 'skipped', id: m.id })
      try {
        const voice = await loadVoice(m.voice)
        const t0 = performance.now()
        if (m.epoch < epoch) return send({ type: 'skipped', id: m.id })
        const tp = performance.now()
        const ids = await phonemeIds(m.text, voice.config.espeak.voice)
        const phonMs = performance.now() - tp
        const inf = voice.config.inference
        const feeds: Record<string, ort.Tensor> = {
          input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
          input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
          scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale / Math.max(0.5, m.speed), inf.noise_w]), [3]),
        }
        if (voice.config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1])
        const out = await voice.session.run(feeds)
        const pcm = (Object.values(out)[0] as ort.Tensor).data as Float32Array
        const sr = voice.config.audio.sample_rate
        const samples = trim(pcm, sr)
        send({ type: 'audio', id: m.id, samples, sampleRate: sr, genMs: performance.now() - t0, phonMs }, [samples.buffer])
      } catch (err) {
        send({ type: 'synthError', id: m.id, message: String((err as Error)?.message ?? err) })
      }
    })
  }
}
