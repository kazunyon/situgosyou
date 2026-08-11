import type { Memo } from './types'
import { isCloudConfigured, supabase } from './supabase'

const LOCAL_KEY = 'kotoba-memo-items'
const BACKUP_FORMAT = 'kotoba-memo-backup'
const BACKUP_VERSION = 1
const demoItems: Memo[] = [
  { id: 'demo-1', title: 'sudo passwd root', meaning: 'rootのパスワードを変更する', marked: true, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-2', title: '病院に電話する', meaning: '明日の10時に予約', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-3', title: '田中さん', meaning: 'となりの部屋', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
]

type DbMemo = { id: string; title: string; meaning: string; marked: string; deleted: boolean; created_at: string; updated_at: string }
const fromDb = (row: DbMemo): Memo => ({ ...row, marked: row.marked === '★', createdAt: row.created_at, updatedAt: row.updated_at })
const toDb = (item: Memo) => ({ id: item.id, title: item.title, meaning: item.meaning, marked: item.marked ? '★' : '', deleted: item.deleted, updated_at: item.updatedAt })

type MemoBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  memos: Memo[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isValidDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))

function isMemo(value: unknown): value is Memo {
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

function localItems(): Memo[] {
  const saved = localStorage.getItem(LOCAL_KEY)
  if (saved) return JSON.parse(saved) as Memo[]
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

export function serializeBackup(items: Memo[]): string {
  const backup: MemoBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    memos: items.filter((item) => !item.deleted)
  }
  return JSON.stringify(backup, null, 2)
}

export function parseBackup(contents: string): Memo[] {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    throw new Error('バックアップファイルを読み取れませんでした。')
  }

  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !isValidDate(value.exportedAt) || !Array.isArray(value.memos)) {
    throw new Error('「ことばメモ」のバックアップファイルではありません。')
  }
  if (!value.memos.every(isMemo)) {
    throw new Error('バックアップファイルの内容が壊れています。')
  }

  const ids = new Set(value.memos.map((item) => item.id))
  if (ids.size !== value.memos.length) {
    throw new Error('バックアップファイルに同じメモが重複しています。')
  }
  return value.memos.map((item) => ({ ...item, deleted: false }))
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
