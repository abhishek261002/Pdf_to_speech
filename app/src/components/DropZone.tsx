import { useRef, useState } from 'react'

export function DropZone({ onFile, compact = false }: { onFile: (f: File) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const pick = (files: FileList | null) => {
    const f = files?.[0]
    if (f) onFile(f)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose a PDF file"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        pick(e.dataTransfer.files)
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed text-center transition-colors ${
        compact ? 'px-4 py-3' : 'px-6 py-16 sm:py-20'
      }`}
      style={{
        borderColor: over ? 'var(--accent)' : 'var(--line)',
        background: over ? 'color-mix(in srgb, var(--accent) 8%, var(--panel))' : 'var(--panel)',
      }}
    >
      <input ref={input} data-testid="file-input" type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files)} />
      {compact ? (
        <span className="text-sm">Open another PDF</span>
      ) : (
        <>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }} aria-hidden>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9.5 15.5v-3l3-1.5v6z" />
          </svg>
          <p className="mt-4 text-xl font-medium">Drop a PDF here</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            or click to choose a file
          </p>
        </>
      )}
    </div>
  )
}
