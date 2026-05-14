import type { DungeonConfig, LevelDef, TileType } from './types';

const W: TileType = 'wall';
const F: TileType = 'floor';
const S: TileType = 'stairs';

// 4 dungeon configurations (card's 4 orientations)
export const DUNGEON_CONFIGS: DungeonConfig[] = [
  // Config 0 — Levels 1–3: simple hall with alcoves
  {
    rows: 7, cols: 7,
    adventurerStart: { row: 6, col: 3 },
    grid: [
      [W, W, W, W, W, W, W],
      [W, F, F, W, F, F, W],
      [W, F, W, W, W, F, W],
      [W, F, F, F, F, F, W],
      [W, F, W, W, W, F, W],
      [W, F, F, W, F, F, W],
      [W, W, W, S, W, W, W],
    ],
  },
  // Config 1 — Levels 4–6: cross-shaped
  {
    rows: 7, cols: 7,
    adventurerStart: { row: 5, col: 3 },
    grid: [
      [W, W, W, F, W, W, W],
      [W, W, F, F, F, W, W],
      [W, F, F, F, F, F, W],
      [F, F, F, F, F, F, F],
      [W, F, F, F, F, F, W],
      [W, W, F, S, F, W, W],
      [W, W, W, F, W, W, W],
    ],
  },
  // Config 2 — Levels 7–9: winding corridor
  {
    rows: 7, cols: 7,
    adventurerStart: { row: 6, col: 1 },
    grid: [
      [W, F, F, F, F, F, W],
      [W, F, W, W, W, F, W],
      [W, F, F, F, W, F, W],
      [W, W, W, F, W, F, W],
      [W, F, F, F, F, F, W],
      [W, F, W, W, W, W, W],
      [W, S, F, F, F, F, W],
    ],
  },
  // Config 3 — Levels 10–12: open arena with pillars
  {
    rows: 7, cols: 7,
    adventurerStart: { row: 5, col: 3 },
    grid: [
      [W, W, W, W, W, W, W],
      [W, F, F, F, F, F, W],
      [W, F, W, F, W, F, W],
      [W, F, F, F, F, F, W],
      [W, F, W, F, W, F, W],
      [W, F, F, S, F, F, W],
      [W, W, W, W, W, W, W],
    ],
  },
];

export const LEVEL_DEFS: LevelDef[] = [
  // Level 1
  {
    configIndex: 0,
    monsterStats: { type: 'Spider', health: 2, speed: 4, attack: 2, defense: 1, range: 2, count: 2 },
    monsterStartPositions: [{ row: 1, col: 1 }, { row: 1, col: 5 }],
  },
  // Level 2
  {
    configIndex: 0,
    monsterStats: { type: 'Spider', health: 2, speed: 4, attack: 3, defense: 1, range: 2, count: 2 },
    monsterStartPositions: [{ row: 1, col: 1 }, { row: 1, col: 5 }],
  },
  // Level 3
  {
    configIndex: 0,
    monsterStats: { type: 'Goblin', health: 3, speed: 4, attack: 3, defense: 2, range: 2, count: 3 },
    monsterStartPositions: [{ row: 1, col: 1 }, { row: 1, col: 5 }, { row: 3, col: 3 }],
  },
  // Level 4
  {
    configIndex: 1,
    monsterStats: { type: 'Goblin', health: 3, speed: 4, attack: 3, defense: 2, range: 3, count: 2 },
    monsterStartPositions: [{ row: 0, col: 3 }, { row: 3, col: 0 }],
  },
  // Level 5
  {
    configIndex: 1,
    monsterStats: { type: 'Skeleton', health: 3, speed: 4, attack: 4, defense: 2, range: 3, count: 3 },
    monsterStartPositions: [{ row: 0, col: 3 }, { row: 3, col: 0 }, { row: 3, col: 6 }],
  },
  // Level 6
  {
    configIndex: 1,
    monsterStats: { type: 'Skeleton', health: 4, speed: 5, attack: 4, defense: 2, range: 3, count: 3 },
    monsterStartPositions: [{ row: 0, col: 3 }, { row: 1, col: 2 }, { row: 1, col: 4 }],
  },
  // Level 7
  {
    configIndex: 2,
    monsterStats: { type: 'Orc', health: 4, speed: 4, attack: 4, defense: 3, range: 2, count: 2 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 5 }],
  },
  // Level 8
  {
    configIndex: 2,
    monsterStats: { type: 'Orc', health: 4, speed: 5, attack: 5, defense: 3, range: 2, count: 3 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 4 }, { row: 2, col: 5 }],
  },
  // Level 9
  {
    configIndex: 2,
    monsterStats: { type: 'Troll', health: 5, speed: 4, attack: 5, defense: 3, range: 3, count: 2 },
    monsterStartPositions: [{ row: 0, col: 1 }, { row: 0, col: 5 }],
  },
  // Level 10
  {
    configIndex: 3,
    monsterStats: { type: 'Troll', health: 5, speed: 5, attack: 6, defense: 3, range: 3, count: 3 },
    monsterStartPositions: [{ row: 1, col: 1 }, { row: 1, col: 5 }, { row: 3, col: 3 }],
  },
  // Level 11
  {
    configIndex: 3,
    monsterStats: { type: 'Dragon', health: 5, speed: 5, attack: 6, defense: 4, range: 4, count: 2 },
    monsterStartPositions: [{ row: 1, col: 1 }, { row: 1, col: 5 }],
  },
  // Level 12 — Final Boss
  {
    configIndex: 3,
    monsterStats: { type: 'Lich King', health: 6, speed: 5, attack: 7, defense: 4, range: 4, count: 3 },
    monsterStartPositions: [{ row: 1, col: 1 }, { row: 1, col: 3 }, { row: 1, col: 5 }],
  },
];

export const CLASS_DESCRIPTIONS: Record<string, string> = {
  none: 'Standard adventurer. No special abilities.',
  paladin: 'Once per level, keep one Energy die from the previous turn.',
  barbarian: 'Once per turn, reroll all Energy dice when at 1 Health.',
  ranger: 'Once per level, assign an Energy die to Range instead of Speed/Attack/Defense.',
  wizard: 'Once per level, reroll all Energy dice.',
};
