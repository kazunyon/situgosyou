import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Use the project's existing compiler so these tests also run on Node 20.
const source = await readFile(new URL('../src/readAloud.ts', import.meta.url), 'utf8')
const textFormattingSource = await readFile(new URL('../src/textFormatting.ts', import.meta.url), 'utf8')
const { outputText: textFormattingOutput } = ts.transpileModule(textFormattingSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const textFormattingUrl = `data:text/javascript;base64,${Buffer.from(textFormattingOutput).toString('base64')}`
const { parseInlineMarkdown, withoutMarkdownSyntax } = await import(textFormattingUrl)
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const readAloudOutput = outputText.replace("'./textFormatting'", `'${textFormattingUrl}'`)
const { spokenMeaning, spokenTitle, speechChunks, loadReadingSpeed } = await import(`data:text/javascript;base64,${Buffer.from(readAloudOutput).toString('base64')}`)

test('Wikipedia attribution is silent and later personal notes remain', () => {
  const input = '音楽を作ったり演奏したりする人です。\r\n\r\n出典：Wikipedia「音楽家」（抜粋・整形）\r\nhttps://ja.wikipedia.org/?curid=141\r\nCC BY-SA 4.0：https://creativecommons.org/licenses/by-sa/4.0/\r\n\r\n去年ライブに行きました。'
  assert.equal(spokenMeaning(input), '音楽を作ったり演奏したりする人です。\n\n去年ライブに行きました。')
  assert.ok(input.includes('出典：'))
})

test('inline links retain readable labels and Japanese punctuation', () => {
  assert.equal(spokenMeaning('案内は[公式サイト](https://example.com/info)。\nhttps://example.com。\nwww.example.com\n参考資料：辞書'), '案内は公式サイト。\n。')
  assert.equal(spokenMeaning('出典とは情報の元になった資料です。'), '出典とは情報の元になった資料です。')
})

test('source-only and blank descriptions have no speech', () => {
  assert.equal(spokenMeaning('出典：Wikipedia\nhttps://example.com\nCC BY-SA 4.0：ライセンス'), '')
  assert.deepEqual(speechChunks(' \n '), [])
})

test('strikethrough markers are silent for titles and explanations', () => {
  assert.equal(spokenTitle('前の文章。~~訂正を入れる。~~次の文章。'), '前の文章。訂正を入れる。次の文章。')
  assert.equal(spokenMeaning('前の文章。~~訂正を入れる。~~次の文章。'), '前の文章。訂正を入れる。次の文章。')
})

test('the supported Markdown subset preserves readable text for speech', () => {
  assert.equal(withoutMarkdownSyntax('# 見出し\n- **太字**と*斜体*\n- [案内](https://example.com)\n- ~~訂正~~'), '見出し\n太字と斜体\n案内\n訂正')
  assert.deepEqual(parseInlineMarkdown('**太字** *斜体* [案内](https://example.com) ~~訂正~~').map((item) => item.type), ['strong', 'text', 'emphasis', 'text', 'link', 'text', 'strikethrough'])
})

test('long speech preserves the complete text without splitting Unicode characters', () => {
  const input = ('音楽を聞きます。🎵'.repeat(60)) + '最後の文章です。'
  const chunks = speechChunks(input)
  assert.ok(chunks.length > 1)
  assert.equal(chunks.join(''), input)
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 160))
  assert.ok(chunks.every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk)))
  const noPunctuation = 'あ'.repeat(501)
  assert.equal(speechChunks(noPunctuation).join(''), noPunctuation)
})

test('speed setting defaults safely when storage is unavailable or invalid', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    for (const [saved, expected] of [['slow', 'slow'], ['normal', 'normal'], ['corrupt', 'normal'], [null, 'normal']]) {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved } })
      assert.equal(loadReadingSpeed(), expected)
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked') } })
    assert.equal(loadReadingSpeed(), 'normal')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})
