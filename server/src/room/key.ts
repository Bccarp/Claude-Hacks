import { createHash } from 'node:crypto'

const CELL_SIZE_DEG = 0.00015 // ~16.7m of latitude; adequate for MVP proximity rooms

export function gridCell(lat: number, lng: number): string {
  const latBucket = Math.round(lat / CELL_SIZE_DEG)
  const lngBucket = Math.round(lng / CELL_SIZE_DEG)
  return `${latBucket}:${lngBucket}`
}

export function roomKey(cell: string, ip: string): string {
  return createHash('sha256').update(`${cell}||${ip}`).digest('hex')
}

export function authorHash(userId: string, roomKeyHex: string): string {
  return createHash('sha256').update(`${userId}||${roomKeyHex}`).digest('hex').slice(0, 8)
}
