import { describe, it, expect } from 'vitest'
import { gridCell, roomKey, authorHash } from './key'

describe('gridCell', () => {
  it('snaps lat/lng into a stable ~15m bucket', () => {
    const a = gridCell(43.07295, -89.40124)
    const b = gridCell(43.07296, -89.40123) // ~1m away
    expect(a).toBe(b)
  })
  it('yields different buckets for points ~100m apart', () => {
    const a = gridCell(43.07295, -89.40124)
    const b = gridCell(43.07395, -89.40124)
    expect(a).not.toBe(b)
  })
})

describe('roomKey', () => {
  it('is deterministic for same cell+ip', () => {
    const k1 = roomKey('cell_x', '1.2.3.4')
    const k2 = roomKey('cell_x', '1.2.3.4')
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(64)
  })
  it('differs when IP differs', () => {
    expect(roomKey('cell_x', '1.2.3.4')).not.toBe(roomKey('cell_x', '5.6.7.8'))
  })
  it('differs when cell differs', () => {
    expect(roomKey('cell_a', '1.2.3.4')).not.toBe(roomKey('cell_b', '1.2.3.4'))
  })
})

describe('authorHash', () => {
  it('is stable for same user+room', () => {
    const a = authorHash('user_123', 'roomkey_abc')
    const b = authorHash('user_123', 'roomkey_abc')
    expect(a).toBe(b)
    expect(a).toHaveLength(8)
  })
  it('differs across rooms for same user (no cross-room linkage)', () => {
    expect(authorHash('user_123', 'room_a')).not.toBe(authorHash('user_123', 'room_b'))
  })
  it('differs across users in same room', () => {
    expect(authorHash('user_1', 'room_x')).not.toBe(authorHash('user_2', 'room_x'))
  })
})
