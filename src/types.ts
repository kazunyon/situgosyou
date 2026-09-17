export type Memo = {
  id: string
  section: MemoSection
  displayNumber: number
  sortOrder: number
  categoryNumber: CategoryNumber
  title: string
  titleColor: TitleColor
  meaning: string
  steps: GuideStep[]
  marked: boolean
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export type Filter = 'all' | 'marked'
export type MemoSection = 'daily' | 'pc-linux'
export type TitleColor = 'black' | 'red' | 'blue' | 'green' | 'gray'
export type CategoryNumber = number

export type GuideStep = {
  id: string
  imageDataUrl: string
  description: string
}

export type MemoCategory = {
  number: CategoryNumber
  name: string
}
