export type ReadingSpeed = 'normal' | 'slow'
export const READING_SPEED_KEY = 'kotoba-memo-reading-speed'
export const READING_RATES: Record<ReadingSpeed, number> = { normal: 1, slow: 0.7 }

export function loadReadingSpeed(): ReadingSpeed {
  try { return localStorage.getItem(READING_SPEED_KEY) === 'slow' ? 'slow' : 'normal' }
  catch { return 'normal' }
}

// Remove source/licence lines without changing the saved memo or later personal notes.
export function spokenMeaning(meaning: string): string {
  return meaning.split(/\r?\n/)
    .filter((line) => !/^\s*(?:(?:出典|引用元|参考資料|参考情報|参照元|source)\s*[:：]|CC\s+BY-SA\b)/i.test(line))
    .join('\n')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/gi, '$1')
    .replace(/(?:https?:\/\/|www\.)[^\s<>「」『』（）()。、！？]+/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Short utterances keep long explanations usable with browser speech engines.
export function speechChunks(text: string): string[] {
  const remaining = Array.from(text.trim())
  const chunks: string[] = []
  while (remaining.length > 0) {
    let end = Math.min(remaining.length, 160)
    if (remaining.length > 160) {
      for (let index = end - 1; index >= 40; index -= 1) {
        if (/[。！？.!?\n]/.test(remaining[index])) { end = index + 1; break }
      }
    }
    const chunk = remaining.splice(0, end).join('').trim()
    if (chunk) chunks.push(chunk)
  }
  return chunks
}
