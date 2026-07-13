export const chordOptions = ['C', 'Am', 'F', 'G', 'G7'] as const;

export type ChordName = (typeof chordOptions)[number];

export type ChordResource = {
  name: ChordName;
  title: string;
  frets: number[];
  fingers: string[];
  notes: string[];
  tip: string;
  previous: ChordName;
  next: ChordName;
};

export const chordCatalog: Record<ChordName, ChordResource> = {
  C: {
    name: 'C',
    title: 'C major',
    frets: [0, 0, 0, 3],
    fingers: ['', '', '', '3'],
    notes: ['G', 'C', 'E', 'C'],
    tip: 'Press the first string at the third fret. Let the other strings ring open.',
    previous: 'G7',
    next: 'Am',
  },
  Am: {
    name: 'Am',
    title: 'A minor',
    frets: [2, 0, 0, 0],
    fingers: ['2', '', '', ''],
    notes: ['A', 'C', 'E', 'A'],
    tip: 'Keep your second finger curved so the open strings stay clean.',
    previous: 'C',
    next: 'F',
  },
  F: {
    name: 'F',
    title: 'F major',
    frets: [2, 0, 1, 0],
    fingers: ['2', '', '1', ''],
    notes: ['A', 'C', 'F', 'A'],
    tip: 'Use a light touch on the second string, first fret, then check the open strings.',
    previous: 'Am',
    next: 'G',
  },
  G: {
    name: 'G',
    title: 'G major',
    frets: [0, 2, 3, 2],
    fingers: ['', '1', '3', '2'],
    notes: ['G', 'D', 'G', 'B'],
    tip: 'Make a small triangle with your fretting fingers and keep them close to the frets.',
    previous: 'F',
    next: 'G7',
  },
  G7: {
    name: 'G7',
    title: 'G seven',
    frets: [0, 2, 1, 2],
    fingers: ['', '2', '1', '3'],
    notes: ['G', 'D', 'F', 'B'],
    tip: 'This is like G major with the second string moved down to the first fret.',
    previous: 'G',
    next: 'C',
  },
};

export const chordSpokenNames = Object.fromEntries(
  chordOptions.map((chord) => [chord, chordCatalog[chord].title]),
) as Record<ChordName, string>;

export const targetPitchClasses: Record<ChordName, string[]> = {
  C: ['C', 'E', 'G'],
  Am: ['A', 'C', 'E'],
  F: ['F', 'A', 'C'],
  G: ['G', 'B', 'D'],
  G7: ['G', 'B', 'D', 'F'],
};

const chordAliases: Record<string, ChordName> = {
  c: 'C',
  cmajor: 'C',
  am: 'Am',
  aminor: 'Am',
  a: 'Am',
  f: 'F',
  fmajor: 'F',
  g: 'G',
  gmajor: 'G',
  g7: 'G7',
  gseven: 'G7',
  gdominantseven: 'G7',
};

export function isChordName(value: unknown): value is ChordName {
  return typeof value === 'string' && chordOptions.includes(value as ChordName);
}

export function normalizeChordName(value: unknown): ChordName | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  return chordAliases[normalized] ?? null;
}
