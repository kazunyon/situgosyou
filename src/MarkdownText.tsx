import { Fragment } from 'react'
import { parseInlineMarkdown } from './textFormatting'
import './markdown.css'

type InlineProps = { text: string; links?: boolean }

export function MarkdownInline({ text, links = true }: InlineProps) {
  return <>{parseInlineMarkdown(text).map((segment, index) => {
    if (segment.type === 'strong') return <b className="markdown-strong" key={index}>{segment.text}</b>
    if (segment.type === 'emphasis') return <em key={index}>{segment.text}</em>
    if (segment.type === 'strikethrough') return <s className="strikethrough" key={index}>{segment.text}</s>
    if (segment.type === 'link') return links
      ? <a className="markdown-link" key={index} href={segment.href} target="_blank" rel="noopener noreferrer">{segment.text}</a>
      : <span className="markdown-link-text" key={index}>{segment.text}</span>
    return <Fragment key={index}>{segment.text}</Fragment>
  })}</>
}

export function MarkdownContent({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: JSX.Element[] = []
  let index = 0
  while (index < lines.length) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index])
    const unordered = /^\s*[-+*]\s+(.+)$/.exec(lines[index])
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(lines[index])
    if (heading) {
      blocks.push(<h3 className={`markdown-heading markdown-heading-${heading[1].length}`} key={index}><MarkdownInline text={heading[2]} /></h3>)
      index += 1
    } else if (unordered || ordered) {
      const items: string[] = []
      const matcher = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+\.\s+(.+)$/
      while (index < lines.length) {
        const item = matcher.exec(lines[index])
        if (!item) break
        items.push(item[1])
        index += 1
      }
      const List = unordered ? 'ul' : 'ol'
      blocks.push(<List className="markdown-list" key={index}>{items.map((item, itemIndex) => <li key={itemIndex}><MarkdownInline text={item} /></li>)}</List>)
    } else if (lines[index].trim() === '') {
      index += 1
    } else {
      const paragraph: string[] = []
      while (index < lines.length && lines[index].trim() !== '' && !/^(#{1,6})\s+|^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index])) {
        paragraph.push(lines[index])
        index += 1
      }
      blocks.push(<p key={index}><MarkdownInline text={paragraph.join('\n')} /></p>)
    }
  }
  return <div className="markdown-content">{blocks}</div>
}
