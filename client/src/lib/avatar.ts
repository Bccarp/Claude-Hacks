export const ANIMALS = [
  "fox",
  "otter",
  "koala",
  "badger",
  "heron",
  "lynx",
  "puffin",
  "gecko",
  "marmot",
  "kiwi",
  "newt",
  "raven",
] as const;

export const COLORS = [
  "amber",
  "rose",
  "violet",
  "sky",
  "emerald",
  "indigo",
  "teal",
  "fuchsia",
  "lime",
  "orange",
] as const;

export type Animal = (typeof ANIMALS)[number];
export type Color = (typeof COLORS)[number];

export function randomAvatar(): { animal: Animal; color: Color } {
  return {
    animal: ANIMALS[Math.floor(Math.random() * ANIMALS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}
