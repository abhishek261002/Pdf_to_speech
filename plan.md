
---

## STATUS UPDATE: BUILT (rev 3)

The app is built in `app/` (see `app/README.md`). What changed from the plan above:

- **Voice engine: Piper instead of Kokoro.** The plan assumed Kokoro. Measured on this machine (Ryzen 7 3750H, no fast GPU path), the bundled Kokoro q8 model ran about 7 to 10 times slower than real time in the browser (0.14x), so it could not read to you. The uncompressed fp32 Kokoro model was about 2x too slow on CPU, and only reached real time on WebGPU with a 326 MB download. Piper voices measured 2.4x to 3x faster than real time on the same machine at 63 MB per voice, so Piper is the bundled engine. Kokoro is the more natural-sounding model; it can return later as an optional premium voice for fast computers.
- **Six bundled voices** (US: Lessac, Amy, Ryan, Joe; UK: Jenny, Alan), each downloaded on first use and cached. Device voices (for example Microsoft David, Zira, Ravi and Heera on Windows) are also listed.
- **Hosting: Vercel** (your choice). `vercel.json` sets the needed headers. If the deployment is too large, `VITE_VOICE_BASE=hf` serves the voices from Hugging Face instead.
- **OCR is in version 1**, as requested (English, bundled).
- Verified by automated tests in real Chrome: text cleaning, the Mumbai example, columns, OCR of a scanned PDF, playback, pause, seek, click-to-jump, a 300-page PDF, broken and password-protected files, and no third-party network requests.
- **Not verified by me:** how the voices sound to a human ear. I can measure speed and check the text sent to the voice, but you need to listen and judge.

# PDF to Audio: Build Plan

Status: **PLAN ONLY. Nothing is built yet.** Review this, change what you want, then say "go" and I start with Phase 0.

Decisions locked in (rev 2):
1. Kokoro model is **bundled** with the app (no first-use download from a third party).
2. **English only** for version 1.
3. **Scanned PDFs (OCR) are in version 1**, using free local OCR.
4. The app is meant to be **made public**, so it must be a static site that any free host can serve, and the plan now includes a deploy phase and host choice (section 10).

---

## 1. What we are building

A web app where you drop in a PDF and it reads the PDF out loud, like a calm human reader.

Hard requirements (from you):

| Requirement | How the plan satisfies it |
|---|---|
| Free and unlimited | Text-to-speech runs **inside the browser on the user's own machine**. No API, no keys, no quotas, no server cost. |
| No login, no signup | There is no backend and no accounts. Open the page, drop a PDF, press play. |
| Different voices | A voice picker with many voices (see section 4), plus a preview button. |
| Remove PDF noise | A cleaning step strips page numbers, running headers/footers, broken hyphenation, ligature junk, stray symbols. |
| Never say "dot", "comma", etc. | Punctuation is used to decide **pauses and intonation** and is never spoken. |
| Human pauses | "He is going to Mumbai." is spoken as `he is going to Mumbai`, then a pause. Pause length depends on the punctuation (section 5). |
| Do not drop real text | Only layout junk is removed. Every word of the body text is read as written. A "keep everything" toggle disables even that. |
| Local only, no Claude.ai artifacts or links | Everything is local files. The app runs on `localhost`. The PDF never leaves the machine. |

---

## 2. Architecture decision

**Fully client-side web app.** No Python server, no cloud.

```
 PDF file (drag & drop)
        |
        v
 [1] pdf.js          extract text with positions (in a Web Worker)
        |
        v
 [2] Cleaner         remove headers/footers/page numbers, fix hyphens, rebuild paragraphs
        |
        v
 [3] Segmenter       paragraphs -> sentences -> chunks, each tagged with a pause type
        |
        v
 [4] Speakable       per-engine text prep (strip symbols an engine might read aloud)
        |
        v
 [5] TTS engine      Kokoro (neural, offline)  or  System voices (instant fallback)
        |
        v
 [6] Player          Web Audio queue + inserted silences + look-ahead buffer
        |
        v
 [7] Reader UI       text view with current-sentence highlight, click to jump, controls
```

Why not a Python backend: it needs installing, it makes "free and unlimited" depend on the user's server, and it complicates sharing. In-browser runs on any laptop with nothing to install.

### Stack

- **Vite + React + TypeScript + Tailwind CSS.** Common and well supported, so it is easy to maintain later.
- **pdfjs-dist** (Mozilla pdf.js, Apache-2.0) for PDF text extraction.
- **kokoro-js** (Kokoro-82M, Apache-2.0, ONNX via transformers.js) for natural neural voices in the browser.
- **Web Speech API** (`speechSynthesis`) as the instant fallback engine.
- **Web Workers** for PDF parsing and TTS, so the UI never freezes.
- **IndexedDB / localStorage** for saved reading position, settings and (optional) audio cache. Browser-only, nothing is sent anywhere.
- **Vitest** for unit tests on the text pipeline, which is where quality is won or lost.
- **tesseract.js** (Apache-2.0) for scanned PDFs: free, runs in the browser, with the English language data bundled too.

---

## 3. TTS engines

### Engine A: Kokoro-82M (primary, best quality)
- Small neural model (~80 MB quantized), Apache-2.0, free to use without limits.
- Runs in the browser: **WebGPU** if available, otherwise **WASM** (CPU).
- Dozens of English voices (US and UK, female and male). It does not read punctuation aloud; it uses it for rhythm.
- The model files (about 80 MB, q8) are **bundled inside the app** and served from our own site, not fetched from Hugging Face at runtime. The browser caches them after the first visit, so later visits and offline use are instant.
- Because it is public, each new visitor downloads the ~80 MB from our host once. The model is split into chunks under 25 MB so it fits strict free-host file limits (section 10), and the page shows a progress bar and starts with a system voice meanwhile.
- WASM multithreading needs the page to be "cross-origin isolated" (COOP/COEP headers). The host must support custom headers; without them it still works, just slower (single thread).
- Risk: on an older CPU, WASM generation can be slower than real time. Mitigation is the look-ahead buffer (section 6) and Engine B.

### Engine B: System / browser voices (fallback, instant start)
- Uses voices already installed on the device. On Windows with Edge this includes the good "Natural" neural voices; Chrome adds Google voices.
- Starts instantly, no download, near-zero CPU. Voice list differs per device and browser.
- Used while Kokoro is still downloading, on slow machines, or if WebGPU/WASM fails.
- Pauses are produced by us (sentence-by-sentence speaking with our own timed gaps), so the "human" pacing is the same as Engine A.

### Phase 0 go/no-go
Before building the UI, a small spike measures Kokoro on this machine: load time, and seconds of audio produced per second of compute. If it is slower than real time on WASM, we make Engine B the default and keep Kokoro as the "high quality" option.

---

## 4. Voices

- Voice picker grouped by engine and accent (US / UK, female / male), with a "Play sample" button that reads one fixed sentence.
- The last chosen voice is remembered.
- A `voices.ts` registry describes each voice (id, label, accent, gender, engine) so adding voices is a one-line change.
- Stretch: Hindi and other languages via installed system voices, and Kokoro's other languages if they work reliably in-browser. Not in the first version.

---

## 5. Text pipeline (the core of the quality)

### 5.1 Extraction (pdf.js)
- Read each page's text items with coordinates (x, y, font size).
- Rebuild **lines** by grouping items with similar y; rebuild **words** using gaps between items.
- Detect **multi-column** layouts (items cluster in two x ranges) and read column by column, not across.
- Keep page index per line, so the UI can show and jump by page.

### 5.1b Scanned PDFs (OCR)
- **Detection:** if a page has almost no extractable text but contains a large image, treat it as scanned. Mixed PDFs are handled page by page.
- **OCR:** render the page to a canvas with pdf.js, run **tesseract.js** (English, bundled `eng` data, `tessdata_fast` ~4 MB) in a Web Worker. Words come back with bounding boxes, so they feed the same line/column/cleaning pipeline as normal PDFs.
- **Progressive:** OCR runs a few pages ahead of the reading position, so playback starts after the first page or two instead of waiting for the whole document. A small "Reading text from page 14 of 120" indicator shows progress.
- **Cleanup for OCR noise:** drop lines with very low confidence or mostly non-letter characters (speckles, scan borders); these are shown in the "what was removed" panel like any other removal.
- **Honest limits:** OCR is slower than text extraction (roughly a few seconds per page on a normal laptop) and is less accurate on poor scans, handwriting and non-English text.

### 5.2 Cleaning (remove noise, keep content)
| Noise | Handling |
|---|---|
| Page numbers (`12`, `Page 12 of 40`, `- 12 -`) | Removed when at top/bottom margin and matching a page-number pattern. |
| Running headers and footers | Detected as lines that repeat on many pages at the same vertical position; removed. |
| Hyphenated line breaks (`inter-` / `national`) | Joined to `international`. Real hyphens (`well-known`) are kept. |
| Line breaks inside a paragraph | Joined into one paragraph using line spacing and indentation. |
| Ligatures and odd Unicode (`ﬁ`, `ﬂ`, soft hyphen, zero-width chars, NBSP) | Normalized. |
| Bullet glyphs, decoration rows (`*****`, `_____`, `-----`) | Removed. Bulleted items become separate short sentences with a small pause. |
| Headings | Detected by larger font or bold, spoken with a longer pause before and after. |
| Table of contents dot leaders (`Chapter 1 ........ 5`) | Dots removed, entry kept. |
| Footnote markers and citation numbers (`[12]`, superscripts) | Default: kept as written. Toggle "skip citation markers". |

Rule: **cleaning may only remove layout artifacts, never body words.** A toggle "Read everything exactly as extracted" turns off the header/footer/page-number removal.

### 5.3 Segmentation
- Split paragraph -> sentences using `Intl.Segmenter`, with a guard so these do **not** end a sentence: `Dr.`, `Mr.`, `Mrs.`, `Prof.`, `e.g.`, `i.e.`, `etc.`, `vs.`, `U.S.`, initials (`J. K. Rowling`), decimals (`3.14`), numbered lists (`1.`).
- Very long sentences (over about 250 characters) are split at commas, semicolons or conjunctions into **chunks**, each with a small pause, so synthesis stays fast and the voice breathes.
- Each chunk keeps a **pause type** taken from the punctuation that ended it, and the punctuation itself is then removed from what is spoken (see 5.4).

### 5.4 Pause model (default values, user-adjustable)
| Ends with | Pause after |
|---|---|
| comma `,` | 250 ms |
| semicolon `;` / colon `:` | 350 ms |
| dash ` - ` / em dash | 300 ms |
| period `.` | 550 ms |
| `?` / `!` | 600 ms |
| ellipsis `...` | 750 ms |
| end of paragraph | 1000 ms |
| after a heading | 1200 ms |
| bullet item | 450 ms |

A **"Pause length"** slider scales all of them (0.5x to 2x). Example:

```
Input : He is going to Mumbai.
Spoken: "he is going to Mumbai"   (the word "dot" or "period" is never said)
Then  : 550 ms of silence
```

### 5.5 Speakable text (per engine)
Final step before the engine sees text:
- Remove symbols an engine might vocalize: `* # _ ~ | ^ < > { } \` and stray brackets or quotes.
- Parentheses become a comma-style pause instead of being read.
- For Kokoro we keep sentence-ending `. ? !` and commas inside a chunk because they shape intonation, and the engine does not say them. If testing shows an engine reads any symbol, it is added to that engine's strip list.
- URLs and emails: read as written by default; option to skip them.
- Numbers, dates, abbreviations: left to the engine, with a small override table for known bad cases (found during testing).

---

## 6. Playback

- **Chunk queue with look-ahead:** while chunk N plays, chunks N+1 to N+3 are already being synthesized. Silence for pauses is generated in the audio graph, not as audio data.
- **Web Audio API** for gapless playback and precise timing.
- Controls: play/pause, previous/next sentence, previous/next paragraph, speed (0.75x to 2x), voice, pause length, progress bar by page.
- **Speed** uses the engine's own speed setting (Kokoro `speed`; system voices `rate`) so the pitch does not change. Changing speed applies from the next chunk.
- **Click any sentence** to start reading from there.
- **Highlight** the sentence being read and auto-scroll to it.
- **Resume:** reading position is saved per document (fingerprint of the PDF) in the browser and restored when the same file is dropped again.
- **Media Session API** so keyboard media keys and lock-screen controls work.
- Keyboard: Space = play/pause, Left/Right = sentence, Up/Down = speed.

---

## 7. User interface

One screen, no accounts, no settings maze.

1. **Empty state:** big drop zone, "Drop a PDF here or click to choose". A line below it: "Free. No sign-up. Your file never leaves your computer."
2. **Reader view:** cleaned text in comfortable typography (adjustable text size), current sentence highlighted.
3. **Bottom player bar:** play/pause, back/forward, progress, speed, voice picker, pause-length slider.
4. **Small "Cleaning" panel:** toggles for removing headers/footers, citation markers and URLs, plus a preview of what was removed so the user can trust that nothing real was dropped.
5. Light and dark theme (follows the system). Works on phone width.
6. Clear states for: parsing, model downloading (with progress and "use system voice meanwhile"), OCR in progress, password-protected PDF, and errors.
7. Public-site basics: a short "How it works / privacy" note (files stay in your browser), page title and description for sharing, favicon, and a friendly message for unsupported browsers.

---

## 8. Project structure

```
Pdf_to_audio/
  plan.md
  package.json, vite.config.ts, tsconfig.json
  public/
    models/kokoro/     bundled Kokoro model, split into chunks under 25 MB
    ocr/               bundled tesseract worker, wasm core and eng.traineddata
    _headers           COOP/COEP + long cache headers (Cloudflare Pages / Netlify format)
  src/
    main.tsx, App.tsx
    components/        DropZone, Reader, PlayerBar, VoicePicker, CleaningPanel, SettingsPanel
    pdf/               extract.ts, layout.ts (lines, columns), ocr.ts, worker.ts
    text/              clean.ts, segment.ts, pauses.ts, speakable.ts
    tts/               engine.ts (interface), kokoro.ts, webspeech.ts, voices.ts, worker.ts
    player/            queue.ts (look-ahead), audioGraph.ts, mediaSession.ts
    store/             settings.ts, progress.ts
  tests/
    fixtures/          sample text blocks with headers, hyphens, abbreviations, columns
    clean.test.ts, segment.test.ts, pauses.test.ts, speakable.test.ts
```

Engines share one `TTSEngine` interface (`listVoices`, `synthesize(text, voice, speed)`), so a third engine can be added later without touching the player or UI.

---

## 9. Build phases

Each phase ends with something runnable and a check I will run before moving on.

| Phase | Goal | Done when |
|---|---|---|
| **0. Spike** | Prove Kokoro runs in the browser on your machine; measure speed. Confirm WebGPU/WASM fallback. Confirm system voices work. | A throwaway page speaks a sentence with Kokoro and reports speed. Decision made on the default engine. |
| **1. Skeleton** | Vite + React + Tailwind app, drop zone, empty state, theme. | `npm run dev` shows the drop zone on localhost. |
| **2. Extract and clean** | pdf.js extraction, column detection, cleaning, paragraphs. Unit tests with fixtures. | A real PDF shows clean text in the reader. Tests pass. |
| **2b. OCR** | Scanned-page detection, tesseract.js worker with bundled English data, progressive OCR a few pages ahead, OCR-noise filtering. | A scanned PDF shows readable text in the reader and the first pages are ready within seconds to tens of seconds. |
| **3. Segment and pauses** | Sentence splitter with abbreviation guard, pause model, speakable step. | The Mumbai example yields text `he is going to Mumbai` plus a 550 ms pause. Tests pass. |
| **4. Engines and player** | Kokoro engine and system-voice engine behind one interface, look-ahead queue, play/pause/seek, highlight. | A full PDF plays start to finish with natural pauses and no stutter between sentences. |
| **5. Voices and controls** | Voice picker with samples, speed, pause slider, click-to-jump, keyboard shortcuts, resume position, Media Session. | All controls work; reload restores position. |
| **6. Polish and edge cases** | Error states, model download progress (the ~80 MB bundled model), large PDFs (hundreds of pages), mobile layout, unsupported-browser message, privacy/how-it-works note. | A 300-page PDF opens and starts speaking quickly without freezing. |
| **7. Package for public hosting** | Split the model into chunks under 25 MB, bundle OCR files, add `_headers` (COOP/COEP + cache), `npm run build`, README with deploy steps. | The built `dist/` runs from a plain static server with the network off after first load. |
| **8. Deploy checklist** | Walk through publishing on the chosen free host (section 10), with exact steps for you to run. Test on the live URL: cross-origin isolation active, model loads, OCR works, phone browser works. | The public URL works end to end on desktop and phone. |

---

## 10. Public hosting

The app is a pure static site, so it costs nothing to run beyond hosting the files. Because all speech and OCR happen on each visitor's device, your host never does heavy work and there is nothing to rate-limit. "Unlimited" holds for users. The only limit is your host's bandwidth, because each new visitor downloads about 80 MB (model) plus about 10 MB (OCR and app), cached afterward.

What the host must support:
- Static files with **individual file size limits that fit** (we split the model into chunks under 25 MB).
- **Custom response headers** (COOP and COEP) for fast multithreaded WASM. Without them the app still works but speech generation is slower.
- Generous or unlimited bandwidth on the free tier.

| Host | Free bandwidth | Per-file limit | Custom headers | Fit |
|---|---|---|---|---|
| **Cloudflare Pages** | Unlimited | 25 MB | Yes (`_headers`) | **Recommended** |
| Netlify | 100 GB/month (soft cap) | Higher | Yes (`_headers`) | Good second choice |
| GitHub Pages | ~100 GB/month (soft) | 100 MB | **No** | Works, but slower speech (no isolation) |

I will build for Cloudflare Pages by default; the same `dist/` also works on Netlify. Deploying means pushing the built folder to the host from your own account. I can prepare everything and give you the exact steps, but I will not publish anything on your behalf unless you ask me to.

Public-site extras included in the plan: privacy note, no cookies or tracking, page title and description for link sharing, and licence notices for the open-source parts (Kokoro, pdf.js, tesseract.js are all Apache-2.0; their licence texts ship with the build).

Not needed because there are no accounts: abuse protection, rate limiting, user data storage, or a privacy-law consent banner (no personal data is collected).

---

## 11. Risks and how we handle them

| Risk | Handling |
|---|---|
| Kokoro slower than real time on weak CPUs | Look-ahead buffering, WebGPU when available, system-voice fallback, "Fast mode" switch. |
| Large first model download (~80 MB on every new visitor's first visit) | Progress bar, start immediately with a system voice while it downloads, long-lived cache headers so repeat visits are free, chunked files. |
| Host bandwidth if the site becomes popular | Cloudflare Pages has unlimited bandwidth; the app is also movable to another static host without code changes. |
| Free host rejects the 80 MB model file | Split into chunks under 25 MB, reassembled in the browser. Verified in Phase 7. |
| No COOP/COEP headers on some hosts | App detects it and falls back to single-threaded WASM, with a hint to prefer WebGPU or the system voice. |
| OCR slow or inaccurate on bad scans | Progressive OCR ahead of the reader, low-confidence filtering, honest message for poor scans. English only. |
| PDFs with messy layout (columns, tables, sidebars) | Column detection, tests with real fixtures, "show what was removed" panel, "read everything" toggle. |
| Header/footer removal deleting real text | Only remove lines that repeat on many pages at the same position, or match strict page-number patterns. Everything removed is shown and can be restored. |
| An engine reading a symbol out loud | Per-engine strip list in `speakable.ts`, expanded from listening tests. |
| Sentence splitter breaking on abbreviations | Abbreviation guard and tests for each case. |
| Browser differences in system voices | Engine B is a fallback, not the main path; the voice list is discovered at runtime. |
| Library or model changes | Pin exact versions in `package.json`; check the Kokoro API in Phase 0 before relying on it. |

---

## 12. What I will not do

- No Claude.ai artifacts, Claude Docs or Claude-hosted pages. All work is local files in this folder and `localhost` while building.
- No publishing to a public host on my own. Going public is your step, with instructions from me (Phase 8).
- No login, accounts, analytics, tracking or uploads of your PDFs.
- No paid or rate-limited speech APIs.
- No code until you approve this plan.
