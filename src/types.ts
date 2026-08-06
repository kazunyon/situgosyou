export type Memo = {
  id: string
  title: string
  meaning: string
  marked: boolean
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export type Filter = 'all' | 'marked'
