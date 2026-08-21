export type Memo = {
  id: string
  displayNumber: number
  categoryNumber: CategoryNumber
  title: string
  meaning: string
  marked: boolean
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export type Filter = 'all' | 'marked'
export type CategoryNumber = 1 | 2 | 3
