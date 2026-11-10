import { useMemo } from 'react'
import type { PlayerSnapshot } from '../player/player'
import { NEURAL_VOICES, type VoiceInfo } from '../tts/voices'

interface Props {
  snap: PlayerSnapshot
  numPages: number
  systemVoices: VoiceInfo[]
  voiceLoading: boolean
  voiceProgress: number
  voiceError: string | null
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
  onVoice: (v: string) => void
  onSpeed: (s: number) => void
  onPauseScale: (s: number) => void
  onPage: (p: number) => void
  onPreview: () => void
  onUseDeviceVoice: () => void
  statusLine: string | null
}

const SPEEDS = [0.75, 1, 1.15, 1.3, 1.5, 1.75, 2]

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d={d} />
  </svg>
)

export function PlayerBar(p: Props) {
  const { snap } = p
  const active = snap.state === 'playing' || snap.state === 'loading' || snap.state === 'waiting'
  const voices = useMemo(() => {
    const groups = new Map<string, VoiceInfo[]>()
    for (const v of [...NEURAL_VOICES, ...p.systemVoices]) {
      const g = v.engine === 'piper' ? `Natural voices · ${v.group.split(' · ')[0]}` : v.group
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g)!.push(v)
    }
    return [...groups]
  }, [p.systemVoices])

  const loadingVoice = snap.state === 'loading' && snap.voice.startsWith('piper:') && p.voiceLoading

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
      <div className="mx-auto max-w-[56rem] px-4 pb-3 pt-2">
        {(loadingVoice || p.voiceError || snap.error || p.statusLine) && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status" style={{ color: 'var(--muted)' }}>
            {loadingVoice && (
              <>
                <span>Downloading the voice (once)… {Math.round(p.voiceProgress * 100)}%</span>
                <button className="underline" onClick={p.onUseDeviceVoice}>
                  Start now with a device voice
                </button>
              </>
            )}
            {p.voiceError && !loadingVoice && <span style={{ color: '#b91c1c' }}>Natural voice unavailable ({p.voiceError}). Device voices still work.</span>}
            {snap.error && <span style={{ color: '#b91c1c' }}>{snap.error}</span>}
            {p.statusLine && <span>{p.statusLine}</span>}
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            Page {snap.page ?? 1} / {p.numPages || '–'}
          </span>
          <input
            aria-label="Position in document"
            type="range"
            min={1}
            max={Math.max(1, p.numPages)}
            value={snap.page ?? 1}
            onChange={(e) => p.onPage(Number(e.target.value))}
            className="h-1 w-full"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <button className="btn" aria-label="Previous sentence" title="Previous sentence (←)" onClick={p.onPrev}>
              <Icon d="M6 6h2v12H6zM9.5 12 18 6v12z" />
            </button>
            <button
              className="btn btn-primary !h-12 !w-12 !p-0"
              aria-label={active ? 'Pause' : 'Play'}
              title="Play / pause (Space)"
              data-testid="play"
              onClick={p.onToggle}
            >
              {active ? <Icon d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <Icon d="M8 5v14l11-7z" />}
            </button>
            <button className="btn" aria-label="Next sentence" title="Next sentence (→)" onClick={p.onNext}>
              <Icon d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="sr-only">Voice</span>
              <select aria-label="Voice" value={snap.voice} onChange={(e) => p.onVoice(e.target.value)} className="max-w-[11rem]">
                {voices.map(([g, vs]) => (
                  <optgroup key={g} label={g}>
                    {vs.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button className="btn !px-3 !py-1 text-xs" onClick={p.onPreview}>
                Sample
              </button>
            </label>
            <label className="flex items-center gap-2">
              <span style={{ color: 'var(--muted)' }}>Speed</span>
              <select aria-label="Speed" value={snap.speed} onChange={(e) => p.onSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span style={{ color: 'var(--muted)' }}>Pauses</span>
              <input
                aria-label="Pause length"
                type="range"
                min={0.5}
                max={2}
                step={0.25}
                value={snap.pauseScale}
                onChange={(e) => p.onPauseScale(Number(e.target.value))}
                className="w-24"
              />
              <span className="w-8 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                {snap.pauseScale}×
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
