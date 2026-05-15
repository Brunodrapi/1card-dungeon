import type { DungeonConfig, LevelDef, TileType } from './types';

const W: TileType = 'wall';
const F: TileType = 'floor';
const S: TileType = 'stairs';

// ── 4 configurations (5×5) based on the physical card ───────────────────────
//
// Config 0 & 1 = front of card (stone-wall obstacles), two orientations
// Config 2 & 3 = back of card (pit-style obstacles), two orientations
//
// Legend: S = stairs (adventurer start), W = wall, F = floor

export const DUNGEON_CONFIGS: DungeonConfig[] = [
  // Config 0 — front side, orientation A (levels 1–3)
  // Adventurer starts bottom-right; monsters spawn top rows
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 4 },
    grid: [
      [F, F, F, F, F],
      [F, W, F, F, F],
      [F, W, F, F, W],
      [F, F, F, F, F],
      [F, F, F, F, S],
    ],
  },
  // Config 1 — front side, orientation B / rotated 180° (levels 4–6)
  // (1,1)→(3,3), (2,1)→(2,3), (2,4)→(2,0)
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 4 },
    grid: [
      [F, F, F, F, F],
      [F, F, F, F, F],
      [W, F, F, W, F],
      [F, F, F, W, F],
      [F, F, F, F, S],
    ],
  },
  // Config 2 — back side, orientation A (levels 7–9)
  // Pit-style walls; adventurer starts bottom-left
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 0 },
    grid: [
      [F, F, F, F, F],
      [F, W, F, W, F],
      [F, W, F, F, F],
      [F, W, F, F, F],
      [S, F, F, F, F],
    ],
  },
  // Config 3 — back side, orientation B / rotated 180° (levels 10–12)
  // (1,1)→(3,3), (2,1)→(2,3), (3,1)→(1,3)
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 0 },
    grid: [
      [F, F, F, F, F],
      [F, F, F, W, F],
      [F, F, F, W, F],
      [F, W, F, W, F],
      [S, F, F, F, F],
    ],
  },
];

export const LEVEL_DEFS: LevelDef[] = [
  // ── Levels 1–3  (Config 0, front-A) ───────────────────────────────────────
  {
    configIndex: 0,
    monsterStats: { type: 'Spider',   health: 2, speed: 4, attack: 2, defense: 1, range: 2, count: 2 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 3 }],
  },
  {
    configIndex: 0,
    monsterStats: { type: 'Spider',   health: 2, speed: 4, attack: 3, defense: 1, range: 2, count: 2 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 4 }],
  },
  {
    configIndex: 0,
    monsterStats: { type: 'Goblin',   health: 3, speed: 4, attack: 3, defense: 2, range: 2, count: 3 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }],
  },
  // ── Levels 4–6  (Config 1, front-B) ───────────────────────────────────────
  {
    configIndex: 1,
    monsterStats: { type: 'Goblin',   health: 3, speed: 4, attack: 3, defense: 2, range: 3, count: 2 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 4 }],
  },
  {
    configIndex: 1,
    monsterStats: { type: 'Skeleton', health: 3, speed: 4, attack: 4, defense: 2, range: 3, count: 3 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }],
  },
  {
    configIndex: 1,
    monsterStats: { type: 'Skeleton', health: 4, speed: 5, attack: 4, defense: 2, range: 3, count: 3 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 1, col: 4 }, { row: 0, col: 4 }],
  },
  // ── Levels 7–9  (Config 2, back-A) ────────────────────────────────────────
  {
    configIndex: 2,
    monsterStats: { type: 'Orc',      health: 4, speed: 4, attack: 4, defense: 3, range: 2, count: 2 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 3 }],
  },
  {
    configIndex: 2,
    monsterStats: { type: 'Orc',      health: 4, speed: 5, attack: 5, defense: 3, range: 2, count: 3 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }],
  },
  {
    configIndex: 2,
    monsterStats: { type: 'Troll',    health: 5, speed: 4, attack: 5, defense: 3, range: 3, count: 2 },
    monsterStartPositions: [{ row: 0, col: 2 }, { row: 0, col: 4 }],
  },
  // ── Levels 10–12 (Config 3, back-B) ───────────────────────────────────────
  {
    configIndex: 3,
    monsterStats: { type: 'Troll',    health: 5, speed: 5, attack: 6, defense: 3, range: 3, count: 3 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 4 }, { row: 1, col: 4 }],
  },
  {
    configIndex: 3,
    monsterStats: { type: 'Dragon',   health: 5, speed: 5, attack: 6, defense: 4, range: 4, count: 2 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 4 }],
  },
  {
    configIndex: 3,
    monsterStats: { type: 'Lich King', health: 6, speed: 5, attack: 7, defense: 4, range: 4, count: 3 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 4 }],
  },
];

export const CLASS_DESCRIPTIONS: Record<string, string> = {
  none:      'Standard adventurer. No special abilities.',
  paladin:   'Once per level, keep one Energy die from the previous turn.',
  barbarian: 'Once per turn, reroll all Energy dice when at 1 Health.',
  ranger:    'Once per level, assign an Energy die to Range instead.',
  wizard:    'Once per level, reroll all Energy dice.',
};
