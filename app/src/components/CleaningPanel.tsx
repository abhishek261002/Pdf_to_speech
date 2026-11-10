import type { CleanOptions, RemovedItem } from '../text/types'

interface Props {
  opts: CleanOptions
  onChange: (o: CleanOptions) => void
  removed: RemovedItem[]
  textSize: number
  onTextSize: (n: number) => void
}

export function CleaningPanel({ opts, onChange, removed, textSize, onTextSize }: Props) {
  const Check = ({ k, label, hint }: { k: keyof CleanOptions; label: string; hint: string }) => (
    <label className="flex items-start gap-2 py-1">
      <input type="checkbox" className="mt-1" checked={opts[k]} onChange={(e) => onChange({ ...opts, [k]: e.target.checked })} />
      <span>
        {label}
        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
          {hint}
        </span>
      </span>
    </label>
  )
  return (
    <details className="rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <summary className="cursor-pointer select-none font-medium">Cleaning and display</summary>
      <div className="mt-2">
        <Check k="removeHeadersFooters" label="Skip page numbers, headers and footers" hint="Turn off to read everything exactly as extracted." />
        <Check k="skipCitations" label="Skip citation numbers like [12]" hint="Off by default: the text is read as written." />
        <Check k="skipUrls" label="Skip web addresses and e-mails" hint="Off by default: the text is read as written." />
        <label className="mt-2 flex items-center gap-3">
          <span>Text size</span>
          <input type="range" min={15} max={26} value={textSize} onChange={(e) => onTextSize(Number(e.target.value))} aria-label="Text size" />
        </label>
        <details className="mt-3">
          <summary className="cursor-pointer select-none" style={{ color: 'var(--muted)' }}>
            Removed from the audio ({removed.length})
          </summary>
          {removed.length === 0 ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
              Nothing was removed.
            </p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-auto text-xs" style={{ color: 'var(--muted)' }}>
              {removed.slice(0, 300).map((r, i) => (
                <li key={i} className="py-0.5">
                  p.{r.page} · {r.reason}: <span style={{ color: 'var(--ink)' }}>{r.text}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </details>
  )
}
