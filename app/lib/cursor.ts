interface CursorData {
  timestamp: number
  id: string
  sort?: number
}

export function encodeCursor(timestamp: number, id: string, sort?: number): string {
  const data: CursorData = { timestamp, id, sort }
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

export function decodeCursor(cursor: string): CursorData {
  const data = JSON.parse(Buffer.from(cursor, 'base64').toString())
  return data as CursorData
} 