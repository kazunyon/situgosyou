import { isCloudConfigured, supabase } from './supabase'
import type { MemoCategory } from './types'

const LOCAL_CATEGORY_KEY = 'kotoba-memo-categories'

export const MAX_CATEGORIES = 10
export const DEFAULT_CATEGORIES: MemoCategory[] = []

const isCategory = (value: unknown): value is MemoCategory => {
  if (typeof value !== 'object' || value === null) return false
  const category = value as Record<string, unknown>
  return Number.isInteger(category.number)
    && (category.number as number) > 0
    && (category.number as number) <= 9999
    && typeof category.name === 'string'
    && category.name.trim().length > 0
    && category.name.trim().length <= 20
}

const normalizedCategories = (items: MemoCategory[]) => items
  .filter(isCategory)
  .map((item) => ({ number: item.number, name: item.name.trim() }))
  .sort((a, b) => a.number - b.number)
  .slice(0, MAX_CATEGORIES)

function localCategories(): MemoCategory[] {
  const saved = localStorage.getItem(LOCAL_CATEGORY_KEY)
  if (!saved) {
    localStorage.setItem(LOCAL_CATEGORY_KEY, JSON.stringify(DEFAULT_CATEGORIES))
    return DEFAULT_CATEGORIES.map((item) => ({ ...item }))
  }
  try {
    const parsed = JSON.parse(saved) as MemoCategory[]
    return normalizedCategories(parsed)
  } catch {
    const defaults = DEFAULT_CATEGORIES.map((item) => ({ ...item }))
    localStorage.setItem(LOCAL_CATEGORY_KEY, JSON.stringify(defaults))
    return defaults
  }
}

export async function loadCategories(): Promise<MemoCategory[]> {
  if (!isCloudConfigured || !supabase) return localCategories()

  const { data, error } = await supabase.from('memo_categories').select('number,name').order('number')
  if (error) throw error
  return normalizedCategories(data as MemoCategory[])
}

export async function saveCategories(items: MemoCategory[]): Promise<MemoCategory[]> {
  if (items.length > MAX_CATEGORIES) throw new Error(`エラー：カテゴリは${MAX_CATEGORIES}件までです。11件目は追加できません。`)
  const normalized = normalizedCategories(items)
  if (normalized.length !== items.length) throw new Error('カテゴリ名は20文字以内で入力してください。')

  if (!isCloudConfigured || !supabase) {
    localStorage.setItem(LOCAL_CATEGORY_KEY, JSON.stringify(normalized))
    return normalized
  }

  const { data: current, error: readError } = await supabase.from('memo_categories').select('number')
  if (readError) throw readError

  if (normalized.length > 0) {
    const { error: upsertError } = await supabase.from('memo_categories').upsert(normalized, { onConflict: 'user_id,number' })
    if (upsertError) throw upsertError
  }

  const nextNumbers = new Set(normalized.map((item) => item.number))
  const removedNumbers = (current as { number: number }[]).map((item) => item.number).filter((number) => !nextNumbers.has(number))
  if (removedNumbers.length > 0) {
    const { error: deleteError } = await supabase.from('memo_categories').delete().in('number', removedNumbers)
    if (deleteError) throw deleteError
  }

  return normalized
}
