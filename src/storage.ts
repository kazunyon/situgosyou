import type { CategoryNumber, GuideStep, Memo, MemoCategory, MemoSection } from './types'
import { isCloudConfigured, supabase } from './supabase'

const LOCAL_KEY = 'kotoba-memo-items'
const BACKUP_FORMAT = 'kotoba-memo-backup'
const BACKUP_VERSION = 5
const MAX_BACKUP_CATEGORIES = 5
const demoItems: Memo[] = [
  { id: 'demo-1', section: 'daily', displayNumber: 1, categoryNumber: 3, title: 'sudo passwd root', meaning: 'rootのパスワードを変更する', steps: [], marked: true, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-2', section: 'daily', displayNumber: 2, categoryNumber: 2, title: '病院に電話する', meaning: '明日の10時に予約', steps: [], marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-3', section: 'daily', displayNumber: 3, categoryNumber: 1, title: '田中さん', meaning: 'となりの部屋', steps: [], marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
]

type DbMemo = { id: string; section?: string | null; display_number?: number | null; category_number?: number | null; title: string; meaning: string; steps?: unknown; marked: string; deleted: boolean; created_at: string; updated_at: string }
const fromDb = (row: DbMemo, index: number): Memo => ({ id: row.id, section: isMemoSection(row.section) ? row.section : 'daily', displayNumber: row.display_number ?? index + 1, categoryNumber: isCategoryNumber(row.category_number) ? row.category_number : 1, title: row.title, meaning: row.meaning, steps: Array.isArray(row.steps) && row.steps.every(isGuideStep) ? row.steps : [], marked: row.marked === '★', deleted: row.deleted, createdAt: row.created_at, updatedAt: row.updated_at })
const toDb = (item: Memo) => ({ id: item.id, section: item.section, display_number: item.displayNumber, category_number: item.categoryNumber, title: item.title, meaning: item.meaning, steps: item.steps, marked: item.marked ? '★' : '', deleted: item.deleted, updated_at: item.updatedAt })

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
const isMemoSection = (value: unknown): value is MemoSection => value === 'daily' || value === 'pc-linux'
const isGuideStep = (value: unknown): value is GuideStep => isRecord(value)
  && typeof value.id === 'string'
  && value.id.length > 0
  && typeof value.imageDataUrl === 'string'
  && /^data:image\/(?:png|jpe?g|webp);base64,/.test(value.imageDataUrl)
  && typeof value.description === 'string'
  && value.description.trim().length > 0
  && value.description.length <= 2000
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
  return isMemoBase(value)
    && isMemoSection((value as Record<string, unknown>).section)
    && isDisplayNumber((value as Record<string, unknown>).displayNumber)
    && isCategoryNumber((value as Record<string, unknown>).categoryNumber)
    && Array.isArray((value as Record<string, unknown>).steps)
    && ((value as Record<string, unknown>).steps as unknown[]).length <= 10
    && ((value as Record<string, unknown>).steps as unknown[]).every(isGuideStep)
}

function isNumberedMemo(value: unknown): value is Omit<Memo, 'categoryNumber'> {
  return isMemoBase(value) && isDisplayNumber((value as Record<string, unknown>).displayNumber)
}

const isLegacyMemo = (value: unknown): value is Omit<Memo, 'displayNumber' | 'categoryNumber'> => isMemoBase(value)

type StoredMemo = Memo | (Omit<Memo, 'section' | 'steps'> & { section?: MemoSection; steps?: GuideStep[] }) | Omit<Memo, 'categoryNumber' | 'section' | 'steps'> | Omit<Memo, 'displayNumber' | 'categoryNumber' | 'section' | 'steps'>

function withMemoDefaults(items: StoredMemo[]): Memo[] {
  return items.map((item, index) => ({
    ...item,
    section: 'section' in item && isMemoSection(item.section) ? item.section : 'daily',
    displayNumber: 'displayNumber' in item && isDisplayNumber(item.displayNumber) ? item.displayNumber : index + 1,
    categoryNumber: 'categoryNumber' in item && isCategoryNumber(item.categoryNumber) ? item.categoryNumber : 1,
    steps: 'steps' in item && Array.isArray(item.steps) && item.steps.every(isGuideStep) ? item.steps : []
  }))
}

function localItems(): Memo[] {
  const saved = localStorage.getItem(LOCAL_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as StoredMemo[]
    const normalized = withMemoDefaults(parsed)
    if (normalized.some((item, index) => !('section' in parsed[index]) || parsed[index].section !== item.section || !('displayNumber' in parsed[index]) || parsed[index].displayNumber !== item.displayNumber || !('categoryNumber' in parsed[index]) || parsed[index].categoryNumber !== item.categoryNumber || !('steps' in parsed[index]))) {
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

  const backupVersion = isRecord(value) && typeof value.version === 'number' ? value.version : 0
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || ![1, 2, 3, 4, BACKUP_VERSION].includes(backupVersion) || !isValidDate(value.exportedAt) || !Array.isArray(value.memos)) {
    throw new Error('「ことばメモ」のバックアップファイルではありません。')
  }
  const isValidMemo = backupVersion === 1 ? isLegacyMemo : backupVersion === 2 ? isNumberedMemo : backupVersion < BACKUP_VERSION ? (item: unknown) => isMemoBase(item) && isDisplayNumber((item as Record<string, unknown>).displayNumber) && isCategoryNumber((item as Record<string, unknown>).categoryNumber) : isMemo
  if (!value.memos.every(isValidMemo)) {
    throw new Error('バックアップファイルの内容が壊れています。')
  }

  const ids = new Set(value.memos.map((item) => item.id))
  if (ids.size !== value.memos.length) {
    throw new Error('バックアップファイルに同じメモが重複しています。')
  }

  const memos = withMemoDefaults(value.memos as StoredMemo[]).map((item) => ({ ...item, deleted: false }))
  if (backupVersion < 4) return { memos, categories: null }

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
