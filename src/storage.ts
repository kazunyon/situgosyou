import type { CategoryNumber, Memo, MemoCategory } from './types'
import { isCloudConfigured, supabase } from './supabase'

const LOCAL_KEY = 'kotoba-memo-items'
const BACKUP_FORMAT = 'kotoba-memo-backup'
const BACKUP_VERSION = 4
const MAX_BACKUP_CATEGORIES = 5
const demoItems: Memo[] = [
  { id: 'demo-1', displayNumber: 1, categoryNumber: 3, title: 'sudo passwd root', meaning: 'rootのパスワードを変更する', marked: true, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-2', displayNumber: 2, categoryNumber: 2, title: '病院に電話する', meaning: '明日の10時に予約', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-3', displayNumber: 3, categoryNumber: 1, title: '田中さん', meaning: 'となりの部屋', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
]

type DbMemo = { id: string; display_number?: number | null; category_number?: number | null; title: string; meaning: string; marked: string; deleted: boolean; created_at: string; updated_at: string }
const fromDb = (row: DbMemo, index: number): Memo => ({ id: row.id, displayNumber: row.display_number ?? index + 1, categoryNumber: isCategoryNumber(row.category_number) ? row.category_number : 1, title: row.title, meaning: row.meaning, marked: row.marked === '★', deleted: row.deleted, createdAt: row.created_at, updatedAt: row.updated_at })
const toDb = (item: Memo) => ({ id: item.id, display_number: item.displayNumber, category_number: item.categoryNumber, title: item.title, meaning: item.meaning, marked: item.marked ? '★' : '', deleted: item.deleted, updated_at: item.updatedAt })

type MemoBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  memos: Memo[]
  categories: MemoCategory[]
}

export type ParsedBackup = {
  memos: Memo[]
  categories: MemoCategory[] | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isValidDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const isDisplayNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 9999
const isCategoryNumber = (value: unknown): value is CategoryNumber => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 9999
const isMemoCategory = (value: unknown): value is MemoCategory => isRecord(value)
  && isCategoryNumber(value.number)
  && typeof value.name === 'string'
  && value.name.trim().length > 0
  && value.name.trim().length <= 20

function isMemoBase(value: unknown): value is Omit<Memo, 'displayNumber' | 'categoryNumber'> {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.title === 'string'
    && value.title.length > 0
    && value.title.length <= 255
    && typeof value.meaning === 'string'
    && value.meaning.length <= 2000
    && typeof value.marked === 'boolean'
    && typeof value.deleted === 'boolean'
    && isValidDate(value.createdAt)
    && isValidDate(value.updatedAt)
}

function isMemo(value: unknown): value is Memo {
  return isMemoBase(value) && isDisplayNumber((value as Record<string, unknown>).displayNumber) && isCategoryNumber((value as Record<string, unknown>).categoryNumber)
}

function isNumberedMemo(value: unknown): value is Omit<Memo, 'categoryNumber'> {
  return isMemoBase(value) && isDisplayNumber((value as Record<string, unknown>).displayNumber)
}

const isLegacyMemo = (value: unknown): value is Omit<Memo, 'displayNumber' | 'categoryNumber'> => isMemoBase(value)

type StoredMemo = Memo | Omit<Memo, 'categoryNumber'> | Omit<Memo, 'displayNumber' | 'categoryNumber'>

function withMemoDefaults(items: StoredMemo[]): Memo[] {
  return items.map((item, index) => ({
    ...item,
    displayNumber: 'displayNumber' in item && isDisplayNumber(item.displayNumber) ? item.displayNumber : index + 1,
    categoryNumber: 'categoryNumber' in item && isCategoryNumber(item.categoryNumber) ? item.categoryNumber : 1
  }))
}

function localItems(): Memo[] {
  const saved = localStorage.getItem(LOCAL_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as StoredMemo[]
    const normalized = withMemoDefaults(parsed)
    if (normalized.some((item, index) => !('displayNumber' in parsed[index]) || parsed[index].displayNumber !== item.displayNumber || !('categoryNumber' in parsed[index]) || parsed[index].categoryNumber !== item.categoryNumber)) {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(normalized))
    }
    return normalized
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(demoItems))
  return demoItems
}

export async function loadMemos(): Promise<Memo[]> {
  if (!isCloudConfigured || !supabase) return localItems()
  const { data, error } = await supabase.from('memos').select('*').eq('deleted', false).order('updated_at', { ascending: false })
  if (error) throw error
  return (data as DbMemo[]).map(fromDb)
}

export async function saveMemo(item: Memo): Promise<void> {
  if (!isCloudConfigured || !supabase) {
    const next = [item, ...localItems().filter((memo) => memo.id !== item.id)]
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
    return
  }
  const { error } = await supabase.from('memos').upsert(toDb(item))
  if (error) throw error
}

export async function removeMemo(item: Memo): Promise<void> {
  await saveMemo({ ...item, deleted: true, updatedAt: new Date().toISOString() })
}

export function serializeBackup(items: Memo[], categories: MemoCategory[]): string {
  const backup: MemoBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    memos: items.filter((item) => !item.deleted),
    categories: categories.map((item) => ({ number: item.number, name: item.name.trim() }))
  }
  return JSON.stringify(backup, null, 2)
}

export function parseBackup(contents: string): ParsedBackup {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    throw new Error('バックアップファイルを読み取れませんでした。')
  }

  if (!isRecord(value) || value.format !== BACKUP_FORMAT || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== BACKUP_VERSION) || !isValidDate(value.exportedAt) || !Array.isArray(value.memos)) {
    throw new Error('「ことばメモ」のバックアップファイルではありません。')
  }
  const isValidMemo = value.version === 1 ? isLegacyMemo : value.version === 2 ? isNumberedMemo : isMemo
  if (!value.memos.every(isValidMemo)) {
    throw new Error('バックアップファイルの内容が壊れています。')
  }

  const ids = new Set(value.memos.map((item) => item.id))
  if (ids.size !== value.memos.length) {
    throw new Error('バックアップファイルに同じメモが重複しています。')
  }

  const memos = withMemoDefaults(value.memos as StoredMemo[]).map((item) => ({ ...item, deleted: false }))
  if (value.version !== BACKUP_VERSION) return { memos, categories: null }

  if (!Array.isArray(value.categories) || value.categories.length < 1 || value.categories.length > MAX_BACKUP_CATEGORIES || !value.categories.every(isMemoCategory)) {
    throw new Error('バックアップファイルのカテゴリ情報が壊れています。')
  }

  const categories = value.categories
    .map((item) => ({ number: item.number, name: item.name.trim() }))
    .sort((a, b) => a.number - b.number)
  const categoryNumbers = new Set(categories.map((item) => item.number))
  const categoryNames = new Set(categories.map((item) => item.name))
  if (categoryNumbers.size !== categories.length || categoryNames.size !== categories.length) {
    throw new Error('バックアップファイルに同じカテゴリが重複しています。')
  }
  if (memos.some((item) => !categoryNumbers.has(item.categoryNumber))) {
    throw new Error('バックアップファイルのメモに対応するカテゴリがありません。')
  }

  return { memos, categories }
}

export async function replaceMemos(items: Memo[]): Promise<Memo[]> {
  const restored = items.map((item) => ({ ...item, id: crypto.randomUUID(), deleted: false }))

  if (!isCloudConfigured || !supabase) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(restored))
    return restored
  }

  const { data: current, error: readError } = await supabase.from('memos').select('id').eq('deleted', false)
  if (readError) throw readError

  if (restored.length > 0) {
    const rows = restored.map((item) => ({ ...toDb(item), created_at: item.createdAt }))
    const { error: insertError } = await supabase.from('memos').insert(rows)
    if (insertError) throw insertError
  }

  const currentIds = (current as { id: string }[]).map((item) => item.id)
  if (currentIds.length > 0) {
    const { error: updateError } = await supabase
      .from('memos')
      .update({ deleted: true, updated_at: new Date().toISOString() })
      .in('id', currentIds)
    if (updateError) {
      if (restored.length > 0) await supabase.from('memos').delete().in('id', restored.map((item) => item.id))
      throw updateError
    }
  }

  return restored
}
