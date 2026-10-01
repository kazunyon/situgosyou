import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase, supabaseProjectUrl, supabasePublicKey } from './supabase'
import type { MemoCategory } from './types'

export type CloudMemoRow = {
  id: string; section: string; display_number: number; sort_order: number; category_number: number
  title: string; title_color: string; meaning: string; steps: unknown; marked: string
  deleted: boolean; created_at: string; updated_at: string
}
type PendingMemo = { row: CloudMemoRow; expected: string | null }
type Snapshot = {
  rows: CloudMemoRow[]; categories: MemoCategory[]; versions: Record<string, string>; categoryRevision: number
  pending: PendingMemo[]; pendingCategories: { items: MemoCategory[]; expected: number } | null
  conflict: boolean; error: string
}
export type CloudSyncStatus = { pending: number; conflict: boolean; error: string; offline: boolean; categoryRevision: number }
const empty = (): Snapshot => ({ rows: [], categories: [], versions: {}, categoryRevision: 0, pending: [], pendingCategories: null, conflict: false, error: '' })
let currentStatus: CloudSyncStatus = { pending: 0, conflict: false, error: '', offline: !navigator.onLine, categoryRevision: 0 }
let openPromise: Promise<IDBDatabase> | null = null
let chain: Promise<unknown> = Promise.resolve()
let loading: Promise<Snapshot> | null = null
function database() {
  if (!openPromise) openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('kotoba-cloud-cache', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('profiles') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { openPromise = null; reject(Error('端末へ保存できません。ブラウザの保存設定を確認してください。')) }
    request.onblocked = () => { openPromise = null; reject(Error('ほかのことばメモ画面を閉じて、開き直してください。')) }
  })
  return openPromise
}
async function read(key: string): Promise<Snapshot> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('profiles').objectStore('profiles').get(key)
    request.onsuccess = () => resolve(request.result ?? empty())
    request.onerror = () => reject(Error('端末の保存データを読み込めません。'))
  })
}
async function write(key: string, state: Snapshot) {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('profiles', 'readwrite')
    transaction.objectStore('profiles').put(state, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(Error('端末への保存に失敗しました。空き容量を確認してください。'))
  })
}
function announce(state: Snapshot) {
  currentStatus = { pending: state.pending.length + (state.pendingCategories ? 1 : 0), conflict: state.conflict, error: state.error, offline: !navigator.onLine, categoryRevision: state.categoryRevision }
  window.dispatchEvent(new Event('kotoba-sync-status'))
}
export const getCloudSyncStatus = () => currentStatus
export function resetCloudSyncStatus() { currentStatus = { pending: 0, conflict: false, error: '', offline: !navigator.onLine, categoryRevision: 0 }; window.dispatchEvent(new Event('kotoba-sync-status')) }
async function context() {
  if (!supabase) throw Error('Supabaseの設定がありません。')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  // Bind every operation to the captured account token, even if sign-out occurs in another tab.
  const client: SupabaseClient = createClient(supabaseProjectUrl, supabasePublicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'kotoba-request-' + crypto.randomUUID() },
    global: { headers: { Authorization: 'Bearer ' + session.access_token } }
  })
  return { key: supabaseProjectUrl + ':' + session.user.id, client }
}
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const locked = async (): Promise<T> => navigator.locks ? await navigator.locks.request('kotoba-cloud-cache', work) : await work()
  const task = chain.then(locked, locked)
  chain = task.catch(() => undefined)
  return task
}
async function flush(ctx: NonNullable<Awaited<ReturnType<typeof context>>>, state: Snapshot) {
  if (!navigator.onLine || state.conflict) { announce(state); return }
  state.error = ''
  try {
    if (state.pendingCategories) {
      const { data, error } = await ctx.client.rpc('kotoba_save_categories', { p_categories: state.pendingCategories.items, p_expected_revision: state.pendingCategories.expected })
      if (error) throw error
      state.categoryRevision = Number(data); state.pendingCategories = null
      await write(ctx.key, state)
    }
    while (state.pending.length) {
      const pending = state.pending[0]
      const { data, error } = await ctx.client.rpc('kotoba_save_memo', { p_memo: pending.row, p_expected_updated_at: pending.expected })
      if (error) throw error
      if (!Array.isArray(data) || data.length !== 1) throw Error('保存結果を確認できません。')
      const row = data[0] as CloudMemoRow
      state.rows = [row, ...state.rows.filter(item => item.id !== row.id)]
      state.versions[row.id] = row.updated_at
      state.pending.shift(); await write(ctx.key, state)
    }
  } catch (error) {
    const value = error as { code?: string; message?: string }
    state.conflict = value.code === '40001'
    state.error = state.conflict ? '別の端末でも変更されています。下のボタンで、どちらを使うか選んでください。' : '共有先に保存できていません。未送信データはこの端末に保存しています。接続・ログイン・Supabase設定を確認してください。'
    await write(ctx.key, state)
  }
  announce(state)
}
async function fetchRemote(ctx: NonNullable<Awaited<ReturnType<typeof context>>>, state: Snapshot, persist = true) {
  if (!navigator.onLine) return state
  const [memos, categories, version] = await Promise.all([
    ctx.client.from('memos').select('*').order('sort_order').order('display_number'),
    ctx.client.from('memo_categories').select('number,name').order('number'),
    ctx.client.from('memo_category_versions').select('revision').maybeSingle()
  ])
  if (memos.error || categories.error || version.error) throw memos.error || categories.error || version.error
  const rows = memos.data as CloudMemoRow[]
  const pendingIds = new Set(state.pending.map(item => item.row.id))
  state.rows = [...state.pending.map(item => item.row), ...rows.filter(row => !pendingIds.has(row.id))]
  for (const row of rows) if (!pendingIds.has(row.id)) state.versions[row.id] = row.updated_at
  if (!state.pendingCategories) { state.categories = categories.data as MemoCategory[]; state.categoryRevision = Number(version.data?.revision ?? 0) }
  if (persist) { await write(ctx.key, state); announce(state) }
  return state
}
export async function loadCloudData(): Promise<Snapshot> {
  if (loading) return loading
  const task = serialized(async () => {
    const ctx = await context(); if (!ctx) return empty()
    const state = await read(ctx.key)
    await flush(ctx, state)
    try { return await fetchRemote(ctx, state) }
    catch {
      state.error = '最新の内容を取得できません。この端末に保存済みの内容を表示しています。'
      await write(ctx.key, state); announce(state); return state
    }
  })
  loading = task
  try { return await task } finally { if (loading === task) loading = null }
}
export async function queueCloudMemos(rows: CloudMemoRow[], expectations?: Record<string, string | null>) {
  return serialized(async () => {
    const ctx = await context(); if (!ctx) throw Error('先にログインしてください。')
    const state = await read(ctx.key)
    if (state.conflict) throw Error('先に、別端末との変更の競合を解決してください。')
    for (const row of rows) {
      const previous = state.pending.find(item => item.row.id === row.id)
      state.pending = [...state.pending.filter(item => item.row.id !== row.id), { row, expected: previous ? previous.expected : expectations && Object.prototype.hasOwnProperty.call(expectations, row.id) ? expectations[row.id] : state.versions[row.id] ?? null }]
      state.rows = [row, ...state.rows.filter(item => item.id !== row.id)]
    }
    // Commit the durable outbox before starting a network request.
    await write(ctx.key, state); announce(state); await flush(ctx, state)
    return state.rows
  })
}
export async function queueCloudCategories(items: MemoCategory[], expectedRevision?: number) {
  return serialized(async () => {
    const ctx = await context(); if (!ctx) throw Error('先にログインしてください。')
    const state = await read(ctx.key)
    if (state.conflict) throw Error('先に、別端末との変更の競合を解決してください。')
    state.pendingCategories = { items, expected: state.pendingCategories?.expected ?? expectedRevision ?? state.categoryRevision }
    state.categories = items
    await write(ctx.key, state); announce(state); await flush(ctx, state)
    return items
  })
}
export async function resolveCloudConflict(choice: 'remote' | 'local') {
  return serialized(async () => {
    if (!navigator.onLine) throw Error('通信できる状態で選び直してください。')
    const ctx = await context(); if (!ctx) throw Error('先にログインしてください。')
    const state = await read(ctx.key)
    const remote = await fetchRemote(ctx, empty(), false)
    if (choice === 'remote') { await write(ctx.key, remote); announce(remote); return }
    for (const pending of state.pending) pending.expected = remote.versions[pending.row.id] ?? null
    if (state.pendingCategories) state.pendingCategories.expected = remote.categoryRevision
    state.conflict = false; state.error = ''
    await write(ctx.key, state); await flush(ctx, state)
  })
}
