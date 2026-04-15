const ANIMALS = [
  'fox', 'otter', 'koala', 'badger', 'heron', 'lynx',
  'puffin', 'gecko', 'marmot', 'kiwi', 'newt', 'raven',
] as const

const COLORS = [
  'amber', 'rose', 'violet', 'sky', 'emerald', 'indigo',
  'teal', 'fuchsia', 'lime', 'orange',
] as const

export function randomAvatar(): { animal: string; color: string } {
  return {
    animal: ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
  }
}
