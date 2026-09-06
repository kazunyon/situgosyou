const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php'
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

type WikipediaPage = {
  pageid?: number
  ns?: number
  title?: string
  extract?: string
  missing?: boolean
  invalid?: boolean
  pageprops?: { disambiguation?: string }
}

export type MeaningResult = { text: string; sourceTitle: string; sourceUrl: string }

// Keep the original wording and stop near 500 characters, preferably at a sentence end.
export function shortenExtract(extract: string): string {
  const cleaned = extract
    .replace(/^\s*=+[^\n]*=+\s*$/gm, '')
    .replace(/^.*Category:[^\n]*$/gm, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const characters = Array.from(cleaned)
  if (characters.length <= 500) return cleaned
  const endings = characters.slice(0, 600)
    .flatMap((character, index) => character === '。' && index >= 399 ? [index + 1] : [])
  const end = endings.sort((a, b) => Math.abs(a - 500) - Math.abs(b - 500))[0]
  return end ? characters.slice(0, end).join('').trim() : `${characters.slice(0, 500).join('').trim()}…`
}

export async function lookupMeaning(title: string, signal: AbortSignal): Promise<MeaningResult> {
  const term = title.trim()
  if (!term) throw new Error('先にタイトルを書いてください。')
  if (term.length > 255 || term.includes('|')) throw new Error('タイトルを255文字以内の、調べたいことば1つにしてください。')
  const parameters = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    titles: term, redirects: '1', prop: 'extracts|pageprops', ppprop: 'disambiguation',
    explaintext: '1', exchars: '1200', exlimit: '1',
  })
  const response = await fetch(`${WIKIPEDIA_API}?${parameters}`, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer',
  })
  if (!response.ok) throw new Error('説明を取得できませんでした。少し待ってから、もう一度お試しください。')
  const data: { error?: unknown; query?: { pages?: WikipediaPage[] } } = await response.json()
  if (data.error) throw new Error('説明を取得できませんでした。タイトルを確認して、もう一度お試しください。')
  const page = data.query?.pages?.[0]
  if (!page || page.missing || page.invalid || page.ns !== 0 || !page.title || !page.pageid) {
    throw new Error('説明が見つかりませんでした。別の呼び方で調べるか、説明を直接書いてください。')
  }
  if (page.pageprops && 'disambiguation' in page.pageprops) {
    throw new Error('同じ名前の項目が複数あります。タイトルを、より具体的な名前にして調べてください。')
  }
  const description = shortenExtract(page.extract ?? '')
  if (!description) throw new Error('このことばには取得できる説明がありません。説明を直接書いてください。')
  const sourceUrl = `https://ja.wikipedia.org/?curid=${page.pageid}`
  return {
    text: `${description}\n\n出典：Wikipedia「${page.title}」（抜粋・整形）\n${sourceUrl}\nCC BY-SA 4.0：${LICENSE_URL}`,
    sourceTitle: page.title,
    sourceUrl,
  }
}
