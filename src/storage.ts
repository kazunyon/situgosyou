import type { Memo } from './types'
import { isCloudConfigured, supabase } from './supabase'

const LOCAL_KEY = 'kotoba-memo-items'
const demoItems: Memo[] = [
  { id: 'demo-1', title: 'sudo passwd root', meaning: 'rootのパスワードを変更する', marked: true, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-2', title: '病院に電話する', meaning: '明日の10時に予約', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'demo-3', title: '田中さん', meaning: 'となりの部屋', marked: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
]

type DbMemo = { id: string; title: string; meaning: string; marked: string; deleted: boolean; created_at: string; updated_at: string }
const fromDb = (row: DbMemo): Memo => ({ ...row, marked: row.marked === '★', createdAt: row.created_at, updatedAt: row.updated_at })
const toDb = (item: Memo) => ({ id: item.id, title: item.title, meaning: item.meaning, marked: item.marked ? '★' : '', deleted: item.deleted, updated_at: item.updatedAt })

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
