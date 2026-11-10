// Runs before `npm run build`. If the build is configured to serve voices from Hugging Face
// (VITE_VOICE_BASE=hf), drop the local voice files so the deployed site stays small.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.env.VITE_VOICE_BASE === 'hf') {
  fs.rmSync(path.join(root, 'public', 'voices'), { recursive: true, force: true })
  console.log('VITE_VOICE_BASE=hf: removed public/voices from this build')
}
