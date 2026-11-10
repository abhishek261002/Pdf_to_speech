export interface VoiceInfo {
  /** "piper:en_US-lessac-medium" or "sys:<voiceURI>" */
  id: string
  label: string
  group: string
  engine: 'piper' | 'system'
}

/** Natural voices (Piper), all bundled with the app. Each is loaded the first time it is chosen. */
export const NEURAL_VOICES: VoiceInfo[] = [
  ['en_US-lessac-medium', 'Lessac', 'American · female'],
  ['en_US-amy-medium', 'Amy', 'American · female'],
  ['en_US-ryan-medium', 'Ryan', 'American · male'],
  ['en_US-joe-medium', 'Joe', 'American · male'],
  ['en_GB-jenny_dioco-medium', 'Jenny', 'British · female'],
  ['en_GB-alan-medium', 'Alan', 'British · male'],
].map(([id, label, group]) => ({ id: `piper:${id}`, label, group, engine: 'piper' as const }))

export const DEFAULT_VOICE = 'piper:en_US-lessac-medium'
export const SAMPLE_TEXT = 'Hello! This is how I sound when reading your document aloud. He is going to Mumbai.'

export function systemVoiceInfos(): VoiceInfo[] {
  if (typeof speechSynthesis === 'undefined') return []
  return speechSynthesis
    .getVoices()
    .filter((v) => /^en[-_]/i.test(v.lang) || v.lang.toLowerCase() === 'en')
    .map((v) => ({
      id: `sys:${v.voiceURI}`,
      label: v.name.replace(/^(Microsoft|Google)\s+/i, ''),
      group: `Device voices · ${v.lang}`,
      engine: 'system' as const,
    }))
}
