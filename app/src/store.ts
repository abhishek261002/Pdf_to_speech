/** Tiny wrapper around localStorage that never throws (private windows, blocked storage). */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`rit:${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(`rit:${key}`, JSON.stringify(value))
  } catch {
    /* storage unavailable: the app works fine without it */
  }
}
