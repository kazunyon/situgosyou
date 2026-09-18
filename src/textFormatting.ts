export type InlineMarkdown =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'emphasis' | 'strikethrough'; text: string }
  | { type: 'link'; text: string; href: string }

const inlineToken = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*)/g

// The editor and storage keep source Markdown. Read-only views use this safe subset.
export function parseInlineMarkdown(text: string): InlineMarkdown[] {
  const segments: InlineMarkdown[] = []
  const matcher = new RegExp(inlineToken)
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    if (match[2] && match[3]) segments.push({ type: 'link', text: match[2], href: match[3] })
    else if (match[4]) segments.push({ type: 'strong', text: match[4] })
    else if (match[5]) segments.push({ type: 'strikethrough', text: match[5] })
    else if (match[6]) segments.push({ type: 'emphasis', text: match[6] })
    lastIndex = matcher.lastIndex
  }
  if (lastIndex < text.length || segments.length === 0) segments.push({ type: 'text', text: text.slice(lastIndex) })
  return segments
}

export function withoutMarkdownSyntax(text: string): string {
  return text.split(/\r?\n/).map((line) => line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/, '')
  ).join('\n').replace(inlineToken, (_token, _link, linkText, _href, strongText, strikeText, emphasisText) => linkText ?? strongText ?? strikeText ?? emphasisText ?? '')
}
