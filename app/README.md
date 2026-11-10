# Read It To Me

Drop in a PDF and listen to it. Free, no sign-up, and the file never leaves the browser.

- Natural voices (Piper) and device voices, with human-length pauses; punctuation is never spoken.
- Cleans PDF noise (page numbers, running headers/footers, hyphenation, column order) without dropping body text.
- Scanned PDFs are read through built-in OCR (English).
- Everything (voices, OCR, PDF engine) is served from this site; there are no third-party requests.

## Run it locally

```bash
cd app
npm install            # installs packages
npm run assets         # one-time: copies runtime files and downloads the voices (about 400 MB) into public/
npm run dev            # http://localhost:5173
```

On Windows run these from PowerShell or a normal terminal (not Git Bash) so the test runner behaves.

## Tests

```bash
npm test               # unit tests for the text pipeline (cleaning, sentences, pauses)
npm run e2e            # real-Chrome test against the running dev server (uses tests/fixtures)
node tests/edge.mjs    # bad files, password-protected PDF, 300-page PDF
```

The e2e scripts use the system Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.

## Deploy to Vercel

1. Push this `app` folder to a GitHub repository (the `public/voices` files are about 63 MB each; none exceed GitHub's 100 MB limit).
2. In Vercel: New Project, import the repo, set the root directory to `app`, framework Vite. The build command is `npm run build`, output `dist`.
3. `vercel.json` already sets the headers the app needs (cross-origin isolation for fast multi-threaded WASM, long caching for voices).

If Vercel rejects the deployment because it is too large, set the environment variable `VITE_VOICE_BASE=hf` in the Vercel project and redeploy. The build then drops `public/voices` and the app loads the voices from Hugging Face instead (free, CORS-enabled). Everything else still comes from your own site.

Vercel's Hobby plan is for non-commercial use and has a monthly bandwidth cap (check vercel.com/docs/limits). A first-time visitor downloads about 12 MB for the app plus 63 MB for the first voice, then everything is cached.

## Voices and licences

The voices are Piper voices from <https://huggingface.co/rhasspy/piper-voices>. Check each dataset's licence before you use the site commercially:

| Voice | Dataset licence |
|---|---|
| Lessac | Blizzard 2013 licence (see the dataset page) |
| Amy | See Mycroft mimic3-voices |
| Ryan | CC BY-NC-SA 4.0 (**non-commercial only**) |
| Joe | CC0 |
| Jenny (British) | See jenny-tts-dataset |
| Alan (British) | See Mycroft mimic3-voices |

To remove a voice, delete it from `VOICES` in `scripts/prepare-assets.mjs` and from `NEURAL_VOICES` in `src/tts/voices.ts`.

Other open-source parts: Piper phonemiser (MIT), ONNX Runtime (MIT), PDF.js (Apache-2.0), Tesseract.js (Apache-2.0).

## How it is built

`src/pdf` extracts text (PDF.js) and runs OCR when a page has no text. `src/text` cleans it, splits sentences and assigns pauses. `src/tts` holds the two voice engines (Piper in a Web Worker, device voices via the browser). `src/player` plays sentences in order with look-ahead so there are no gaps. `src/components` is the interface.
