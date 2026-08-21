export type Memo = {
  id: string
  displayNumber: number
  title: string
  meaning: string
  marked: boolean
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export type Filter = 'all' | 'marked' | number
