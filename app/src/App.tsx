import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CleaningPanel } from './components/CleaningPanel'
import { DropZone } from './components/DropZone'
import { PlayerBar } from './components/PlayerBar'
import { Reader } from './components/Reader'
import { PdfSession, type SessionStatus } from './pdf/session'
import { Player } from './player/player'
import { loadJson, saveJson } from './store'
import { buildFromPages } from './text/build'
import { DEFAULT_CLEAN_OPTIONS, type BuiltDoc, type CleanOptions } from './text/types'
import { DEFAULT_VOICE, systemVoiceInfos, type VoiceInfo } from './tts/voices'

interface Settings {
  voice: string
  speed: number
  pauseScale: number
  textSize: number
  clean: CleanOptions
}
const DEFAULTS: Settings = { voice: DEFAULT_VOICE, speed: 1, pauseScale: 1, textSize: 19, clean: DEFAULT_CLEAN_OPTIONS }

const supported = typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined' && typeof AudioContext !== 'undefined'

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = { ...DEFAULTS, ...loadJson<Partial<Settings>>('settings', {}) }
    if (!/^(piper|sys):/.test(saved.voice)) saved.voice = DEFAULT_VOICE
    return saved
  })
  const [player] = useState(() => {
    const p = new Player(settings.voice)
    p.setSpeed(settings.speed)
    p.setPauseScale(settings.pauseScale)
    return p
  })
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const neural = useSyncExternalStore(
    (cb) => player.neural.onStatus(cb),
    () => player.neural.status,
  )

  const [session, setSession] = useState<PdfSession | null>(null)
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [doc, setDoc] = useState<BuiltDoc | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [systemVoices, setSystemVoices] = useState<VoiceInfo[]>([])

  const sessionRef = useRef<PdfSession | null>(null)
  const optsRef = useRef(settings.clean)
  const timer = useRef<number | undefined>(undefined)
  const restored = useRef(false)
  const lastPage = useRef<number | null>(null)

  const update = useCallback(
    (patch: Partial<Settings>) =>
      setSettings((s) => {
        const next = { ...s, ...patch }
        saveJson('settings', next)
        return next
      }),
    [],
  )

  // ------------------------------------------------------------------ device voices
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    const load = () => setSystemVoices(systemVoiceInfos())
    load()
    speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [])

  const bestDeviceVoice = useCallback(() => {
    const natural = systemVoices.find((v) => /natural|online/i.test(v.label))
    return (natural ?? systemVoices.find((v) => /en-US/i.test(v.group)) ?? systemVoices[0])?.id
  }, [systemVoices])

  // if the natural voice cannot run on this device, fall back to a device voice automatically
  useEffect(() => {
    if (neural.state === 'error' && snap.voice.startsWith('piper:')) {
      const v = bestDeviceVoice()
      if (v) player.setVoice(v)
    }
  }, [neural.state, snap.voice, bestDeviceVoice, player])

  // ------------------------------------------------------------------ build text from the PDF
  const rebuild = useCallback(
    (s: PdfSession, opts: CleanOptions) => {
      const st = s.status()
      const built = buildFromPages(s.readyPageData(), opts)
      setStatus(st)
      setDoc(built)
      player.setUnits(built.units, !st.finished)

      if (!restored.current && s.hash && built.sentences.length) {
        const saved = loadJson<{ id: number; prefix: string } | null>(`pos:${s.hash}`, null)
        if (!saved) restored.current = true
        else if (saved.id < built.sentences.length && built.sentences[saved.id].text.startsWith(saved.prefix)) {
          restored.current = true
          if (saved.id > 0) {
            player.seekSentence(saved.id, false)
            setToast(`Picked up where you left off (page ${built.sentences[saved.id].page})`)
          }
        } else if (st.finished) restored.current = true
      }
    },
    [player],
  )

  const schedule = useCallback(
    (s: PdfSession, delay = 350) => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => rebuild(s, optsRef.current), delay)
    },
    [rebuild],
  )

  const openFile = useCallback(
    (file: File) => {
      setFileError(null)
      if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
        setFileError('That does not look like a PDF. Please choose a .pdf file.')
        return
      }
      sessionRef.current?.destroy()
      player.stopAll()
      restored.current = false
      lastPage.current = null
      const s = new PdfSession(file)
      sessionRef.current = s
      setSession(s)
      setDoc(null)
      setStatus(s.status())
      s.subscribe(() => schedule(s, s.status().finished ? 0 : 400))
      if (player.getVoice().startsWith('piper:')) player.neural.load(player.getVoice())
      void s.start()
    },
    [player, schedule],
  )

  // clean-option changes rebuild the text, keeping the reading position by page
  const onClean = (clean: CleanOptions) => {
    update({ clean })
    optsRef.current = clean
    const page = player.getSnapshot().page
    if (sessionRef.current) {
      rebuild(sessionRef.current, clean)
      if (page) player.seekPage(page)
    }
  }

  // ------------------------------------------------------------------ save position
  useEffect(() => {
    if (!session || !doc || snap.sentenceId == null || !restored.current) return
    const s = doc.sentences[snap.sentenceId]
    if (s && session.hash) saveJson(`pos:${session.hash}`, { id: s.id, prefix: s.text.slice(0, 40) })
  }, [snap.sentenceId, doc, session])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(t)
  }, [toast])

  // ------------------------------------------------------------------ keyboard + media keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea, [role="button"]') && e.key === ' ') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ' && !t.closest('button, summary')) (e.preventDefault(), player.toggle())
      else if (e.key === 'ArrowRight' && !t.closest('input, select')) player.nextSentence()
      else if (e.key === 'ArrowLeft' && !t.closest('input, select')) player.prevSentence()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player])

  useEffect(() => {
    if (!('mediaSession' in navigator) || !session) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: session.name.replace(/\.pdf$/i, ''), artist: 'Read It To Me' })
    navigator.mediaSession.setActionHandler('play', () => player.play())
    navigator.mediaSession.setActionHandler('pause', () => player.pause())
    navigator.mediaSession.setActionHandler('nexttrack', () => player.nextSentence())
    navigator.mediaSession.setActionHandler('previoustrack', () => player.prevSentence())
  }, [session, player])

  useEffect(() => {
    ;(window as unknown as { __app: unknown }).__app = { player, get session() { return sessionRef.current }, get doc() { return doc } }
  }, [player, doc])

  // ------------------------------------------------------------------ view
  if (!supported) {
    return (
      <Shell>
        <p className="mx-auto mt-24 max-w-md px-6 text-center">
          This browser is too old for in-browser speech. Please use a recent version of Chrome, Edge, Firefox or Safari.
        </p>
      </Shell>
    )
  }

  const noText = !!status?.finished && !status.error && !!doc && doc.units.length === 0
  const ocrLine =
    status && status.ocrCurrent
      ? `Reading text from scanned page ${status.ocrCurrent} of ${status.numPages}…`
      : snap.state === 'waiting'
        ? 'Waiting for text recognition to catch up…'
        : null

  return (
    <Shell
      right={
        session && (
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[16rem] truncate text-sm sm:block" style={{ color: 'var(--muted)' }} title={session.name}>
              {session.name}
            </span>
            <div className="w-44">
              <DropZone compact onFile={openFile} />
            </div>
          </div>
        )
      }
    >
      {!session ? (
        <div className="mx-auto max-w-2xl px-5 pb-16 pt-10 sm:pt-16">
          <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Listen to any PDF</h1>
          <p className="mx-auto mt-3 max-w-md text-center" style={{ color: 'var(--muted)' }}>
            Drop in a PDF and it is read aloud like a person would: natural voices, real pauses, no punctuation spoken.
          </p>
          <div className="mt-8">
            <DropZone onFile={openFile} />
          </div>
          {fileError && (
            <p role="alert" className="mt-3 text-center text-sm" style={{ color: '#b91c1c' }}>
              {fileError}
            </p>
          )}
          <ul className="mx-auto mt-8 flex max-w-md flex-col gap-1 text-center text-sm" style={{ color: 'var(--muted)' }}>
            <li>Free and unlimited. No sign-up.</li>
            <li>Your file never leaves your device: everything runs in your browser.</li>
            <li>Scanned PDFs work too, using built-in text recognition.</li>
          </ul>
        </div>
      ) : (
        <div className="mx-auto max-w-[44rem] px-5 pt-5">
          {status?.error ? (
            <p role="alert" className="rounded-xl border p-4" style={{ borderColor: '#fca5a5', background: 'color-mix(in srgb, #ef4444 8%, var(--panel))' }}>
              {status.error} Try another file.
            </p>
          ) : (
            <>
              {!doc && <p style={{ color: 'var(--muted)' }}>Opening your PDF…</p>}
              {doc && (
                <CleaningPanel
                  opts={settings.clean}
                  onChange={onClean}
                  removed={doc.removed}
                  textSize={settings.textSize}
                  onTextSize={(textSize) => update({ textSize })}
                />
              )}
              {noText && (
                <p role="alert" className="mt-6 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                  No readable text was found in this PDF. If it is made of pictures that are not text, text recognition only handles clear English scans.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {session && doc && doc.units.length > 0 && (
        <Reader
          doc={doc}
          currentSentence={snap.sentenceId}
          playing={snap.state === 'playing'}
          textSize={settings.textSize}
          onSentence={(id) => player.seekSentence(id, true)}
        />
      )}
      {session && doc && status?.ocrCurrent && doc.units.length === 0 && (
        <p className="mx-auto mt-6 max-w-[44rem] px-5" style={{ color: 'var(--muted)' }}>
          This looks like a scan. Reading its text now, the first page will appear shortly…
        </p>
      )}

      {session && (doc?.units.length ?? 0) > 0 && (
        <PlayerBar
          snap={snap}
          numPages={status?.numPages ?? 0}
          systemVoices={systemVoices}
          voiceLoading={neural.state === 'loading'}
          voiceProgress={neural.progress}
          voiceError={neural.state === 'error' ? (neural.message ?? 'error') : null}
          statusLine={ocrLine}
          onToggle={() => {
            player.toggle()
          }}
          onPrev={() => player.prevSentence()}
          onNext={() => player.nextSentence()}
          onVoice={(voice) => {
            update({ voice })
            player.setVoice(voice)
          }}
          onSpeed={(speed) => {
            update({ speed })
            player.setSpeed(speed)
          }}
          onPauseScale={(pauseScale) => {
            update({ pauseScale })
            player.setPauseScale(pauseScale)
          }}
          onPage={(p) => player.seekPage(p)}
          onPreview={() => void player.preview(player.getVoice())}
          onUseDeviceVoice={() => {
            const v = bestDeviceVoice()
            if (v) {
              update({ voice: v })
              player.setVoice(v)
            } else setToast('No device voice was found in this browser.')
          }}
        />
      )}
      {toast && (
        <div role="status" className="fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>
          {toast}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b px-5 py-3 backdrop-blur" style={{ borderColor: 'var(--line)', background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}>
        <a href="/" className="flex items-center gap-2 font-semibold">
          <img src="/favicon.svg" alt="" width="26" height="26" />
          Read It To Me
        </a>
        {right}
      </header>
      <main>{children}</main>
      <footer className="px-5 pb-28 pt-4 text-center text-xs" style={{ color: 'var(--muted)' }}>
        Voices by Piper (MIT) · PDF.js · Tesseract OCR · ONNX Runtime. Open-source parts keep their licences.
      </footer>
    </div>
  )
}
