import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Use the project's existing compiler so these tests also run on Node 20.
const source = await readFile(new URL('../src/readAloud.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } })
const { spokenMeaning, speechChunks, loadReadingSpeed } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

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
