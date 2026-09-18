export type TextSegment = { text: string; struck: boolean }

// `~~文字~~` is kept in storage and editors; only read-only views format it.
export function splitStrikethrough(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  const matcher = /~~([^~]+)~~/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), struck: false })
    segments.push({ text: match[1], struck: true })
    lastIndex = matcher.lastIndex
  }
  if (lastIndex < text.length || segments.length === 0) segments.push({ text: text.slice(lastIndex), struck: false })
  return segments
}

export function withoutStrikethroughMarkers(text: string): string {
  return text.replace(/~~([^~]+)~~/g, '$1')
}
