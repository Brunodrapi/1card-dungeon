import type { DungeonConfig, LevelDef, TileType } from './types';

const W: TileType = 'wall';
const F: TileType = 'floor';
const S: TileType = 'stairs';

// ── 4 configurations (5×5) matching the physical card ───────────────────────
//
// Config 0 & 1 = front of card (stone-wall obstacles), two orientations
// Config 2 & 3 = back of card (pit-style obstacles), two orientations
//
// Config 0: Dragon    (levels  4, 8, 12) — front side, right-side up
// Config 1: Skeleton  (levels  2, 9, 10) — front side, rotated 180°
// Config 2: Goblin    (levels  3, 7, 11) — back side, right-side up
// Config 3: Spider    (levels  1, 5,  6) — back side, rotated 180°
//
// S = stairs (adventurer start or exit), W = wall, F = floor

export const DUNGEON_CONFIGS: DungeonConfig[] = [
  // Config 0 — front side, Dragon orientation (levels 4, 8, 12)
  // Adventurer starts bottom-right; exit top-left
  // Walls: (1,1), (2,1), (2,4)
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 4 },
    grid: [
      [S, F, F, F, F],
      [F, W, F, F, F],
      [F, W, F, F, W],
      [F, F, F, F, F],
      [F, F, F, F, S],
    ],
  },
  // Config 1 — front side, Skeleton orientation — rotated 180° of Config 0 (levels 2, 9, 10)
  // Adventurer starts bottom-right; exit top-left
  // Walls at rotated positions: (2,0), (2,3), (3,3)
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 4 },
    grid: [
      [S, F, F, F, F],
      [F, F, F, F, F],
      [W, F, F, W, F],
      [F, F, F, W, F],
      [F, F, F, F, S],
    ],
  },
  // Config 2 — back side, Goblin orientation (levels 3, 7, 11)
  // Adventurer starts bottom-left; exit top-right
  // Pits: (1,1), (1,3), (3,1)
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 0 },
    grid: [
      [F, F, F, F, S],
      [F, W, F, W, F],
      [F, F, F, F, F],
      [F, W, F, F, F],
      [S, F, F, F, F],
    ],
  },
  // Config 3 — back side, Spider orientation — rotated 180° of Config 2 (levels 1, 5, 6)
  // Adventurer starts bottom-left; exit top-right
  // Pits at rotated positions: (1,3), (3,1), (3,3)
  {
    rows: 5, cols: 5,
    adventurerStart: { row: 4, col: 0 },
    grid: [
      [F, F, F, F, S],
      [F, F, F, W, F],
      [F, F, F, F, F],
      [F, W, F, W, F],
      [S, F, F, F, F],
    ],
  },
];

// Monster stats from the physical card images
const SPIDER_STATS   = { type: 'Spider',   health: 2, speed: 5, attack: 4, defense: 4, range: 3 };
const SKELETON_STATS = { type: 'Skeleton', health: 3, speed: 4, attack: 5, defense: 4, range: 4 };
const GOBLIN_STATS   = { type: 'Goblin',   health: 5, speed: 3, attack: 7, defense: 7, range: 2 };
const DRAGON_STATS   = { type: 'Dragon',   health: 5, speed: 5, attack: 5, defense: 5, range: 5 };

// Spawn positions read from the printed level digits on the card tiles.
// Beware: digits from the opposite orientation appear upside-down (a spider
// "9" reads as "6" in goblin orientation) — always read in the monster's own
// orientation. Spider levels 1/5/9, Skeleton 2/6/10, Goblin 3/7/11,
// Dragon 4/8/12. Spider & Skeleton scale 2/3/4, Goblin & Dragon 1/2/3.
export const LEVEL_DEFS: LevelDef[] = [
  // ── Level 1: Spider × 2 (Config 3) ────────────────────────────────────────
  {
    configIndex: 3,
    monsterStats: { ...SPIDER_STATS, count: 2 },
    monsterStartPositions: [{ row: 0, col: 3 }, { row: 2, col: 4 }],
  },
  // ── Level 2: Skeleton × 2 (Config 1) ──────────────────────────────────────
  {
    configIndex: 1,
    monsterStats: { ...SKELETON_STATS, count: 2 },
    monsterStartPositions: [{ row: 0, col: 2 }, { row: 1, col: 0 }],
  },
  // ── Level 3: Goblin × 1 (Config 2) ────────────────────────────────────────
  {
    configIndex: 2,
    monsterStats: { ...GOBLIN_STATS, count: 1 },
    monsterStartPositions: [{ row: 1, col: 4 }],
  },
  // ── Level 4: Dragon × 1 (Config 0) ────────────────────────────────────────
  {
    configIndex: 0,
    monsterStats: { ...DRAGON_STATS, count: 1 },
    monsterStartPositions: [{ row: 0, col: 1 }],
  },
  // ── Level 5: Spider × 3 (Config 3) ────────────────────────────────────────
  {
    configIndex: 3,
    monsterStats: { ...SPIDER_STATS, count: 3 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 1, col: 4 }, { row: 4, col: 4 }],
  },
  // ── Level 6: Skeleton × 3 (Config 1) ──────────────────────────────────────
  {
    configIndex: 1,
    monsterStats: { ...SKELETON_STATS, count: 3 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 4, col: 0 }],
  },
  // ── Level 7: Goblin × 2 (Config 2) ────────────────────────────────────────
  {
    configIndex: 2,
    monsterStats: { ...GOBLIN_STATS, count: 2 },
    monsterStartPositions: [{ row: 1, col: 2 }, { row: 3, col: 4 }],
  },
  // ── Level 8: Dragon × 2 (Config 0) ────────────────────────────────────────
  {
    configIndex: 0,
    monsterStats: { ...DRAGON_STATS, count: 2 },
    monsterStartPositions: [{ row: 0, col: 3 }, { row: 4, col: 1 }],
  },
  // ── Level 9: Spider × 4 (Config 3) ────────────────────────────────────────
  {
    configIndex: 3,
    monsterStats: { ...SPIDER_STATS, count: 4 },
    monsterStartPositions: [{ row: 0, col: 0 }, { row: 2, col: 2 }, { row: 3, col: 4 }, { row: 4, col: 2 }],
  },
  // ── Level 10: Skeleton × 4 (Config 1) ─────────────────────────────────────
  {
    configIndex: 1,
    monsterStats: { ...SKELETON_STATS, count: 4 },
    monsterStartPositions: [{ row: 0, col: 4 }, { row: 1, col: 2 }, { row: 2, col: 1 }, { row: 3, col: 0 }],
  },
  // ── Level 11: Goblin × 3 (Config 2) ───────────────────────────────────────
  {
    configIndex: 2,
    monsterStats: { ...GOBLIN_STATS, count: 3 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 3 }, { row: 2, col: 4 }],
  },
  // ── Level 12: Dragon × 3 (Config 0) ───────────────────────────────────────
  {
    configIndex: 0,
    monsterStats: { ...DRAGON_STATS, count: 3 },
    monsterStartPositions: [{ row: 1, col: 0 }, { row: 1, col: 2 }, { row: 3, col: 0 }],
  },
];

export const CLASS_DESCRIPTIONS: Record<string, string> = {
  none:      'Standard adventurer. No special abilities.',
  paladin:   'Once per level, keep one Energy die from the previous turn.',
  barbarian: 'Once per turn, reroll all Energy dice when at 1 Health.',
  ranger:    'Once per level, assign an Energy die to Range instead.',
  wizard:    'Once per level, reroll all Energy dice.',
};
