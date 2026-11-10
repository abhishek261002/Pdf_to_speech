import { memo, useEffect, useRef, useState } from 'react'
import type { BuiltDoc } from '../text/types'

interface Props {
  doc: BuiltDoc
  currentSentence: number | null
  playing: boolean
  textSize: number
  onSentence: (id: number) => void
}

const Block = memo(function Block({ doc, index }: { doc: BuiltDoc; index: number }) {
  const b = doc.blocks[index]
  const prev = doc.blocks[index - 1]
  const marker = !prev || prev.page !== b.page
  const sentences = b.sentenceIds.map((id) => (
    <span key={id} data-s={id}>
      {doc.sentences[id].text}{' '}
    </span>
  ))
  return (
    <>
      {marker && (
        <div className="my-8 flex items-center gap-3 text-xs uppercase tracking-wide" style={{ color: 'var(--muted)' }} data-page={b.page}>
          <span>Page {b.page}</span>
          <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
        </div>
      )}
      {b.type === 'heading' ? (
        <h2 className="mb-3 mt-6 text-[1.25em] font-semibold leading-snug">{sentences}</h2>
      ) : b.type === 'bullet' ? (
        <p className="mb-2 pl-6 -indent-4 before:mr-2 before:content-['•']">{sentences}</p>
      ) : (
        <p className="mb-5">{sentences}</p>
      )}
    </>
  )
})

export function Reader({ doc, currentSentence, playing, textSize, onSentence }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const activeEl = useRef<HTMLElement | null>(null)
  const [following, setFollowing] = useState(true)
  const programmatic = useRef(0)

  // highlight the sentence being read, without re-rendering the whole text
  useEffect(() => {
    activeEl.current?.classList.remove('active')
    activeEl.current = null
    if (currentSentence == null || !root.current) return
    const el = root.current.querySelector<HTMLElement>(`[data-s="${currentSentence}"]`)
    if (!el) return
    el.classList.add('active')
    activeEl.current = el
    if (following) {
      programmatic.current = Date.now()
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [currentSentence, following, doc])

  // stop auto-scroll when the reader scrolls by hand
  useEffect(() => {
    const stop = () => {
      if (Date.now() - programmatic.current > 800) setFollowing(false)
    }
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchmove', stop, { passive: true })
    return () => {
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchmove', stop)
    }
  }, [])

  return (
    <div className="relative">
      <div
        ref={root}
        className="reader-text mx-auto max-w-[44rem] px-5 pb-48 pt-6"
        style={{ fontSize: `${textSize}px` }}
        onClick={(e) => {
          const t = (e.target as HTMLElement).closest<HTMLElement>('[data-s]')
          if (t) {
            setFollowing(true)
            onSentence(Number(t.dataset.s))
          }
        }}
      >
        {doc.blocks.map((_, i) => (
          <Block key={i} doc={doc} index={i} />
        ))}
      </div>
      {!following && playing && (
        <button
          className="btn btn-primary fixed bottom-28 left-1/2 -translate-x-1/2 shadow-lg"
          onClick={() => setFollowing(true)}
        >
          Jump to where it is reading
        </button>
      )}
    </div>
  )
}
