interface CursorData {
  timestamp: number
  id: string
  sort?: number
  /** 字符串排序键（地址 / 主题 / 发件人排序时用，时间排序时不用） */
  key?: string
}

export function encodeCursor(timestamp: number, id: string, sort?: number, key?: string): string {
  const data: CursorData = { timestamp, id, sort, key }
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

export function decodeCursor(cursor: string): CursorData {
  const data = JSON.parse(Buffer.from(cursor, 'base64').toString())
  return data as CursorData
} 