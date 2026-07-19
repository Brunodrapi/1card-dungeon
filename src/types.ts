export type TileType = 'wall' | 'floor' | 'stairs';

export interface Pos {
  row: number;
  col: number;
}

export interface Monster {
  id: number;
  pos: Pos;
  health: number;
  maxHealth: number;
  type: string;
}

export interface MonsterStats {
  speed: number;
  attack: number;
  defense: number;
  range: number;
  health: number;
  type: string;
  count: number;
}

export interface LevelDef {
  configIndex: number;
  monsterStats: MonsterStats;
  monsterStartPositions: Pos[];
}

export interface DungeonConfig {
  grid: TileType[][];
  adventurerStart: Pos;
  rows: number;
  cols: number;
}

export interface AssignedEnergy {
  speed: number | null;
  attack: number | null;
  defense: number | null;
  /* Ranger class ability: a die assigned to range for this turn */
  range: number | null;
}

export interface MovementArrow {
  id: number;
  from: Pos;
  to: Pos;
}

export type CharacterClass =
  | 'none' | 'paladin' | 'barbarian' | 'ranger' | 'wizard'
  /* M'Guf-yn Returns expansion classes */
  | 'necromancer' | 'cleric' | 'knight' | 'rogue';

export type Phase =
  | 'classSelect'
  | 'energy'
  | 'energyAssign'
  | 'adventurer'
  | 'monsterMove'
  | 'monsterMoveAnimate'
  | 'monsterAttack'
  | 'bossIntro'
  | 'levelEnd'
  | 'gameOver'
  | 'victory';

/* M'Guf-yn Returns: boss encountered after levels 3, 6, 9 and 12 */
export interface BossDef {
  afterLevel: number;
  name: string;
  board: 'lava' | 'ice';
  flipped: boolean;
  config: DungeonConfig;
  startPos: Pos;
  stats: MonsterStats;
}

/* Treasure chest (yellow die) state */
export interface ChestState {
  pos: Pos;
  value: number;   // defense/loot value while closed
  opened: boolean;
}

export interface BaseStats {
  speed: number;
  attack: number;
  defense: number;
  range: number;
}

export interface GameState {
  phase: Phase;
  level: number;
  adventurerPos: Pos;
  adventurerHealth: number;
  baseStats: BaseStats;
  energyDice: number[];
  assignedEnergy: AssignedEnergy;
  totalStats: BaseStats;
  spentSpeed: number;
  spentAttack: number;
  monsters: Monster[];
  monsterStats: MonsterStats;
  characterClass: CharacterClass;
  classAbilityUsed: boolean;
  barbarianRerolled: boolean;
  prevEnergyDice: number[] | null;
  /* Snapshot of the dice as rolled this turn (energyDice entries are
     consumed to -1 on assignment) — becomes prevEnergyDice next turn */
  turnRoll: number[] | null;
  log: string[];
  selectedDie: number | null;
  pendingMovements: MovementArrow[];
  /* ── M'Guf-yn Returns expansion ── */
  expansion: boolean;
  isBossLevel: boolean;
  chest: ChestState | null;
  chestPool: number;                    // loot points left from the opened chest
  chestSkillThisTurn: keyof BaseStats | null; // chest points go to one skill per turn
  chestSpentThisTurn: number;           // points already added to that skill this turn
  knightSlot: 'speed' | 'attack' | 'defense' | null; // slot doubled by the knight
  necroTargeting: boolean;              // necromancer picking a sacrifice target
  saveCode: string;                     // password to resume at this level's start
}
