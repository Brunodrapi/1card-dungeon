import { useState, useCallback, useEffect } from 'react';
import type { GameState, Phase, CharacterClass, Pos, BaseStats, DungeonConfig, MovementArrow, BossDef } from './types';
import { DUNGEON_CONFIGS, LEVEL_DEFS, CLASS_DESCRIPTIONS, BOSS_DEFS } from './gameData';
import {
  rollDice,
  getReachableTiles,
  getAttackableMonsters,
  moveMonsters,
  calcMonsterDamage,
  computeTotalStats,
  rangeDistance,
  hasLoS,
} from './gameLogic';
import './App.css';
import coverImg from './assets/cover.jpg';
import bannerImg from './assets/banner-title.png';
import advImg from './assets/class-adventurer.png';
import paladinImg from './assets/class-paladin.png';
import barbarianImg from './assets/class-barbarian.png';
import rangerImg from './assets/class-ranger.png';
import wizardImg from './assets/class-wizard.png';
import bootsIcon from './assets/icon-boots.png';
import swordIcon from './assets/icon-sword.png';
import shieldIcon from './assets/icon-shield.png';
import bowIcon from './assets/icon-bow.png';
import heartIcon from './assets/icon-heart.png';
import spiderImg from './assets/monster-spider.png';
import goblinImg from './assets/monster-goblin.png';
import skeletonImg from './assets/monster-skeleton.png';
import dragonImg from './assets/monster-dragon.png';
import necromancerImg from './assets/class-necromancer.png';
import clericImg from './assets/class-cleric.png';
import knightImg from './assets/class-knight.png';
import rogueImg from './assets/class-rogue.png';
import bossOrcImg from './assets/boss-orc.png';
import bossLichImg from './assets/boss-lich.png';
import bossWyvernImg from './assets/boss-wyvern.png';
import bossMgufynImg from './assets/boss-mgufyn.png';
import boardLavaImg from './assets/board-lava.jpg';
import boardIceImg from './assets/board-ice.jpg';

const NAME_KEY = '1cd-name';

// ── Online leaderboard (JSONBin — separate bin from 1 Card Racing) ───────────
interface LBEntry { name: string; cls: CharacterClass; level: number; won: boolean; date: string; ts?: number; exp?: boolean; }
const LB_KEY = '$2a$10$ZhGQjyGQdYCKWCXurwGeBu5QbQu8Y.O9DTGHsqiv6iDahS0mniad6';
const LB_URL = 'https://api.jsonbin.io/v3/b/6a579872da38895dfe615775';

function fetchTimeout(url: string, opts: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// null = network/parse error (distinct from empty list)
async function loadLeaderboard(): Promise<LBEntry[] | null> {
  try {
    const r = await fetchTimeout(LB_URL, { headers: { 'X-Master-Key': LB_KEY, 'X-Bin-Meta': 'false' } });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const arr: LBEntry[] = Array.isArray(data) ? data : Array.isArray(data?.record) ? data.record : [];
    return arr.filter(e => e.level >= 1); // drop the INIT sentinel
  } catch (e) { console.warn('Leaderboard load:', e); return null; }
}

async function saveLeaderboard(arr: LBEntry[]): Promise<boolean> {
  try {
    const r = await fetchTimeout(LB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': LB_KEY },
      body: JSON.stringify(arr),
    });
    return r.ok;
  } catch (e) { console.warn('Leaderboard save:', e); return false; }
}

function rankLB(a: LBEntry, b: LBEntry): number {
  // expansion victories (M'Guf-yn slain) rank above base-game victories
  const score = (e: LBEntry) => (e.won ? (e.exp ? 200 : 100) : 0) + e.level;
  return score(b) - score(a);
}

// Fetch fresh, insert entry (idempotent on retry), sort.
// Storage keeps EVERY victory (they feed the Hall of Fame) and only the
// 20 best defeats; the display trims to the top 20 runs.
// Returns the entry's rank (0-based) or -1 on failure.
async function submitToLeaderboard(entry: LBEntry): Promise<number> {
  const lb = await loadLeaderboard();
  if (lb === null) return -1; // load failed — don't overwrite the bin
  const same = (e: LBEntry) => e.name === entry.name && e.ts === entry.ts;
  if (!lb.some(same)) lb.push(entry); // idempotent on retry after silent success
  lb.sort(rankLB);
  const rank = lb.findIndex(same);
  const wins = lb.filter(e => e.won);
  const losses = lb.filter(e => !e.won).slice(0, 20);
  const ok = await saveLeaderboard([...wins, ...losses]);
  return ok ? rank : -1;
}

const INITIAL_STATS: BaseStats = { speed: 1, attack: 1, defense: 1, range: 2 };

// ── Save codes (retro password system) ───────────────────────────────────────
// Encodes the state at the START of a level: level, class, base stats,
// health, expansion — packed into bits + checksum, Crockford base32.
const SAVE_CLASSES: CharacterClass[] = ['none', 'paladin', 'barbarian', 'ranger', 'wizard', 'necromancer', 'cleric', 'knight', 'rogue'];
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U

interface SaveData { level: number; cls: CharacterClass; stats: BaseStats; health: number; expansion: boolean; }

function encodeSave(d: SaveData): string {
  const cap = (v: number) => Math.max(0, Math.min(15, v));
  const fields = [
    d.level,                       // 4 bits (1-12)
    SAVE_CLASSES.indexOf(d.cls),   // 4 bits
    d.health,                      // 3 bits (1-6)
    cap(d.stats.speed), cap(d.stats.attack), cap(d.stats.defense), cap(d.stats.range), // 4 bits each
  ];
  let bits = d.expansion ? 1 : 0;
  const widths = [4, 4, 3, 4, 4, 4, 4];
  fields.forEach((f, i) => { bits = bits * (1 << widths[i]) + f; });
  const checksum = fields.reduce((a, b) => a + b, d.expansion ? 1 : 0) % 32;
  bits = bits * 32 + checksum;
  let out = '';
  for (let i = 0; i < 7; i++) { out = B32[bits % 32] + out; bits = Math.floor(bits / 32); }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

function decodeSave(codeRaw: string): SaveData | null {
  const code = codeRaw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/I/g, '1').replace(/L/g, '1').replace(/O/g, '0');
  if (code.length !== 7) return null;
  let bits = 0;
  for (const ch of code) {
    const v = B32.indexOf(ch);
    if (v === -1) return null;
    bits = bits * 32 + v;
  }
  const checksum = bits % 32; bits = Math.floor(bits / 32);
  const widths = [4, 4, 3, 4, 4, 4, 4];
  const fields: number[] = [];
  for (let i = widths.length - 1; i >= 0; i--) {
    fields.unshift(bits % (1 << widths[i]));
    bits = Math.floor(bits / (1 << widths[i]));
  }
  const expansion = bits === 1;
  if (bits > 1) return null;
  if (fields.reduce((a, b) => a + b, expansion ? 1 : 0) % 32 !== checksum) return null;
  const [level, clsIdx, health, speed, attack, defense, range] = fields;
  if (level < 1 || level > 12 || clsIdx >= SAVE_CLASSES.length || health < 1 || health > 6) return null;
  const cls = SAVE_CLASSES[clsIdx];
  if (!expansion && EXP_CLASSES.includes(cls)) return null;
  return { level, cls, stats: { speed, attack, defense, range }, health, expansion };
}

function buildLevelState(level: number, characterClass: CharacterClass, baseStats: BaseStats, health: number, expansion: boolean): GameState {
  const def = LEVEL_DEFS[level - 1];
  const config = DUNGEON_CONFIGS[def.configIndex];
  // Treasure chest (expansion): d6 on the exit stairs (opposite the entrance)
  let chest = null;
  if (expansion) {
    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        if (config.grid[r][c] === 'stairs' && !(r === config.adventurerStart.row && c === config.adventurerStart.col)) {
          chest = { pos: { row: r, col: c }, value: rollDice(1)[0], opened: false };
        }
      }
    }
  }
  return {
    phase: 'energy',
    level,
    adventurerPos: { ...config.adventurerStart },
    adventurerHealth: health,
    baseStats,
    energyDice: [0, 0, 0],
    assignedEnergy: { speed: null, attack: null, defense: null, range: null },
    totalStats: { ...baseStats },
    spentSpeed: 0,
    spentAttack: 0,
    monsters: def.monsterStartPositions.map((pos, idx) => ({
      id: idx + 1, pos: { ...pos },
      health: def.monsterStats.health, maxHealth: def.monsterStats.health,
      type: def.monsterStats.type,
    })),
    monsterStats: def.monsterStats,
    characterClass,
    classAbilityUsed: false,
    barbarianRerolled: false,
    prevEnergyDice: null,
    turnRoll: null,
    log: [`Level ${level}: ${def.monsterStats.type}s appear!`],
    selectedDie: null,
    pendingMovements: [],
    expansion,
    isBossLevel: false,
    chest,
    chestPool: 0,
    chestSkillThisTurn: null,
    chestSpentThisTurn: 0,
    knightSlot: null,
    necroTargeting: false,
    saveCode: encodeSave({ level, cls: characterClass, stats: baseStats, health, expansion }),
  };
}

// Boss card is an extension of the current level: no heal, no reward, keep
// the opened chest pool
function buildBossState(prev: GameState): GameState {
  const boss = bossForLevel(prev.level)!;
  return {
    ...prev,
    phase: 'energy',
    adventurerPos: { ...boss.config.adventurerStart },
    energyDice: [0, 0, 0],
    assignedEnergy: { speed: null, attack: null, defense: null, range: null },
    totalStats: { ...prev.baseStats },
    spentSpeed: 0,
    spentAttack: 0,
    monsters: [{ id: 1, pos: { ...boss.startPos }, health: boss.stats.health, maxHealth: boss.stats.health, type: boss.stats.type }],
    monsterStats: boss.stats,
    selectedDie: null,
    pendingMovements: [],
    isBossLevel: true,
    chest: null,
    chestSkillThisTurn: null,
    chestSpentThisTurn: 0,
    knightSlot: null,
    necroTargeting: false,
    log: [...prev.log.slice(-10), `⚔️ ${boss.name} awaits! (${boss.stats.health} HP)`],
  };
}

// All monsters are dead — decide what happens next
function endOfCombat(state: GameState): GameState {
  if (!state.isBossLevel && state.expansion && bossForLevel(state.level)) {
    return { ...state, phase: 'bossIntro', log: [...state.log.slice(-20), 'All enemies defeated!', '👹 A commander approaches…'] };
  }
  if (state.isBossLevel && state.level >= 12) {
    return { ...state, phase: 'victory', log: [...state.log.slice(-20), "M'Guf-yn is vanquished! The world is safe!"] };
  }
  if (!state.isBossLevel && state.level >= 12) {
    return { ...state, phase: 'victory', log: [...state.log.slice(-20), "Victory! The Sceptre is yours!"] };
  }
  return { ...state, phase: 'levelEnd', log: [...state.log.slice(-20), state.isBossLevel ? 'Boss defeated!' : 'All enemies defeated!'] };
}

// Cleric passive: three equal dice each gain +2 (max 6)
function applyCleric(cls: CharacterClass, dice: number[], log: string[]): number[] {
  if (cls === 'cleric' && dice[0] === dice[1] && dice[1] === dice[2]) {
    const boosted = dice.map(d => Math.min(6, d + 2));
    log.push(`✨ Cleric: triple ${dice[0]} → ${boosted.join(', ')}`);
    return boosted;
  }
  return dice;
}

export default function App() {
  const [screen, setScreen] = useState<'title' | 'classSelect' | 'game'>('title');
  const [characterClass, setCharacterClass] = useState<CharacterClass>('none');
  const [expansion, setExpansion] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);

  const startGame = useCallback((cls: CharacterClass, exp: boolean) => {
    setGameState(buildLevelState(1, cls, { ...INITIAL_STATS }, 6, exp));
    setScreen('game');
  }, []);

  // Resume from a save code (level start snapshot)
  const loadGame = useCallback((code: string): boolean => {
    const d = decodeSave(code);
    if (!d) return false;
    setCharacterClass(d.cls);
    setExpansion(d.expansion);
    setGameState(buildLevelState(d.level, d.cls, { ...d.stats }, d.health, d.expansion));
    setScreen('game');
    return true;
  }, []);

  const rollEnergy = useCallback(() => {
    setGameState(prev => {
      if (!prev) return prev;
      const extra: string[] = [];
      const dice = applyCleric(prev.characterClass, rollDice(3), extra);
      return { ...prev, energyDice: dice, turnRoll: [...dice], phase: 'energyAssign' as Phase, assignedEnergy: { speed: null, attack: null, defense: null, range: null }, selectedDie: null, log: [...prev.log.slice(-20), `Rolled: ${dice.join(', ')}`, ...extra] };
    });
  }, []);

  const useWizardReroll = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.classAbilityUsed) return prev;
      const dice = rollDice(3);
      return { ...prev, energyDice: dice, turnRoll: [...dice], assignedEnergy: { speed: null, attack: null, defense: null, range: null }, selectedDie: null, classAbilityUsed: true, log: [...prev.log.slice(-20), `Wizard rerolls: ${dice.join(', ')}`] };
    });
  }, []);

  // Paladin: lock one die from the previous turn, roll the other two
  const usePaladinKeep = useCallback((dieIdx: number) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'energy' || prev.classAbilityUsed || !prev.prevEnergyDice) return prev;
      const kept = prev.prevEnergyDice[dieIdx];
      if (kept === undefined || kept < 1) return prev;
      const rolled = rollDice(2);
      const dice = [kept, ...rolled];
      return { ...prev, energyDice: dice, turnRoll: [...dice], phase: 'energyAssign' as Phase, assignedEnergy: { speed: null, attack: null, defense: null, range: null }, selectedDie: null, classAbilityUsed: true, log: [...prev.log.slice(-20), `Paladin keeps ${kept} · rolls ${rolled.join(', ')}`] };
    });
  }, []);

  const useBarbarianReroll = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.adventurerHealth !== 1 || prev.barbarianRerolled) return prev;
      const dice = rollDice(3);
      return { ...prev, energyDice: dice, turnRoll: [...dice], assignedEnergy: { speed: null, attack: null, defense: null, range: null }, selectedDie: null, barbarianRerolled: true, log: [...prev.log.slice(-20), `Barbarian rage: ${dice.join(', ')}`] };
    });
  }, []);

  const selectDie = useCallback((idx: number) => {
    setGameState(prev => prev ? { ...prev, selectedDie: prev.selectedDie === idx ? null : idx } : prev);
  }, []);

  const assignDie = useCallback((slot: 'speed' | 'attack' | 'defense' | 'range') => {
    setGameState(prev => {
      if (!prev || prev.selectedDie === null) return prev;
      const dieIdx = prev.selectedDie;
      const dieVal = prev.energyDice[dieIdx];
      if (dieVal === -1) return prev;
      if (slot === 'range') {
        if (prev.characterClass !== 'ranger' || prev.classAbilityUsed) return prev;
        const newDice = [...prev.energyDice]; newDice[dieIdx] = -1;
        const newAssigned = { ...prev.assignedEnergy, range: dieVal };
        return { ...prev, energyDice: newDice, assignedEnergy: newAssigned, classAbilityUsed: true, selectedDie: null, log: [...prev.log.slice(-20), `Ranger: +${dieVal} Range`] };
      }
      if (prev.assignedEnergy[slot] !== null) {
        // Knight: once per level, a second die may join an assigned skill
        if (prev.characterClass !== 'knight' || prev.classAbilityUsed) return prev;
        const newDice = [...prev.energyDice]; newDice[dieIdx] = -1;
        const newAssigned = { ...prev.assignedEnergy, [slot]: prev.assignedEnergy[slot]! + dieVal };
        return {
          ...prev, energyDice: newDice, assignedEnergy: newAssigned,
          classAbilityUsed: true, knightSlot: slot, selectedDie: null,
          log: [...prev.log.slice(-20), `⚔️ Knight: +${dieVal} ${slot} (double)`],
        };
      }
      const newDice = [...prev.energyDice]; newDice[dieIdx] = -1;
      const newAssigned = { ...prev.assignedEnergy, [slot]: dieVal };
      return {
        ...prev, energyDice: newDice, assignedEnergy: newAssigned,
        selectedDie: null,
        log: [...prev.log.slice(-20), `→ ${slot}: ${dieVal}`],
      };
    });
  }, []);

  // Rogue: once per level, +1 to every rolled die
  const useRogueBoost = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'energyAssign' || prev.characterClass !== 'rogue' || prev.classAbilityUsed) return prev;
      const dice = prev.energyDice.map(d => d === -1 ? d : Math.min(6, d + 1));
      return { ...prev, energyDice: dice, turnRoll: prev.turnRoll ? prev.turnRoll.map(d => Math.min(6, d + 1)) : prev.turnRoll, classAbilityUsed: true, log: [...prev.log.slice(-20), '🗡 Rogue: +1 to all dice'] };
    });
  }, []);

  // Necromancer: once per level, lose 1 Life to deal 1 damage within range
  const toggleNecroTargeting = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer' || prev.characterClass !== 'necromancer' || prev.classAbilityUsed || prev.adventurerHealth <= 1) return prev;
      return { ...prev, necroTargeting: !prev.necroTargeting };
    });
  }, []);

  // Return an assigned die to the pool (before confirming)
  const unassignDie = useCallback((slot: 'speed' | 'attack' | 'defense' | 'range') => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'energyAssign') return prev;
      if (slot === prev.knightSlot) return prev; // a doubled slot can't be split back
      const val = prev.assignedEnergy[slot];
      if (val === null) return prev;
      const newDice = [...prev.energyDice];
      const freeIdx = newDice.indexOf(-1);
      if (freeIdx === -1) return prev;
      newDice[freeIdx] = val;
      return {
        ...prev, energyDice: newDice,
        assignedEnergy: { ...prev.assignedEnergy, [slot]: null },
        // returning the range die refunds the ranger's class ability
        classAbilityUsed: slot === 'range' ? false : prev.classAbilityUsed,
        selectedDie: null,
        log: [...prev.log.slice(-20), `↩ ${slot} annulé`],
      };
    });
  }, []);

  // Lock in the assignment and start the adventurer phase
  const confirmEnergy = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'energyAssign') return prev;
      const count = [prev.assignedEnergy.speed, prev.assignedEnergy.attack, prev.assignedEnergy.defense].filter(v => v !== null).length;
      const active = prev.energyDice.filter(d => d !== -1).length;
      if (count < 3 && active > 0) return prev;
      const total = computeTotalStats(prev.baseStats, prev.assignedEnergy);
      if (prev.chestSkillThisTurn && prev.chestSpentThisTurn > 0) {
        total[prev.chestSkillThisTurn] += prev.chestSpentThisTurn;
      }
      return {
        ...prev, totalStats: total, phase: 'adventurer' as Phase,
        spentSpeed: 0, spentAttack: 0, selectedDie: null, barbarianRerolled: false,
        log: [...prev.log.slice(-20), `Spd ${total.speed}  Atk ${total.attack}  Def ${total.defense}`],
      };
    });
  }, []);

  // Spend 1 treasure-chest point on a skill (one skill per turn)
  const spendChestPoint = useCallback((skill: keyof BaseStats) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'energyAssign' || prev.chestPool <= 0) return prev;
      if (prev.chestSkillThisTurn && prev.chestSkillThisTurn !== skill) return prev;
      return {
        ...prev,
        chestPool: prev.chestPool - 1,
        chestSkillThisTurn: skill,
        chestSpentThisTurn: prev.chestSpentThisTurn + 1,
        log: [...prev.log.slice(-20), `🧰 +1 ${skill} (${prev.chestPool - 1} left)`],
      };
    });
  }, []);

  const handleTileClick = useCallback((pos: Pos) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer') return prev;
      const config = getConfig(prev);
      // Closed chest on the clicked tile → try to open it (attack, cost = value)
      if (prev.chest && !prev.chest.opened && prev.chest.pos.row === pos.row && prev.chest.pos.col === pos.col) {
        const chest = prev.chest;
        const attackLeft = prev.totalStats.attack - prev.spentAttack;
        const dist = rangeDistance(prev.adventurerPos, chest.pos, config, false);
        const los = hasLoS(prev.adventurerPos, chest.pos, config, prev.monsters);
        if (dist > prev.totalStats.range || !los || attackLeft < chest.value) return prev;
        return {
          ...prev,
          chest: { ...chest, opened: true },
          chestPool: prev.chestPool + chest.value,
          spentAttack: prev.spentAttack + chest.value,
          log: [...prev.log.slice(-20), `🧰 Chest opened! +${chest.value} loot points`],
        };
      }
      const reachable = getReachableTiles(prev.adventurerPos, prev.totalStats.speed - prev.spentSpeed, config, prev.monsters);
      const key = `${pos.row},${pos.col}`;
      if (!reachable.has(key)) return prev;
      const cost = reachable.get(key)!;
      return { ...prev, adventurerPos: pos, spentSpeed: prev.spentSpeed + cost, log: [...prev.log.slice(-20), `Moved (cost ${cost})`] };
    });
  }, []);

  const handleMonsterClick = useCallback((monsterId: number) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer') return prev;
      const config = getConfig(prev);
      // Necromancer sacrifice: 1 Life → 1 damage, within range
      if (prev.necroTargeting) {
        const target = prev.monsters.find(m => m.id === monsterId);
        if (!target) return prev;
        const dist = rangeDistance(prev.adventurerPos, target.pos, config);
        const los = hasLoS(prev.adventurerPos, target.pos, config, prev.monsters, [monsterId]);
        if (dist > prev.totalStats.range || !los) return prev;
        const newMonsters = prev.monsters.map(m => m.id === monsterId ? { ...m, health: m.health - 1 } : m).filter(m => m.health > 0);
        const base = {
          ...prev, monsters: newMonsters, adventurerHealth: prev.adventurerHealth - 1,
          classAbilityUsed: true, necroTargeting: false,
          log: [...prev.log.slice(-20), `☠️ Sacrifice: 1 damage to ${target.type}`],
        };
        return newMonsters.length === 0 ? endOfCombat(base) : base;
      }
      const def = prev.monsterStats.defense;
      const attackable = getAttackableMonsters(prev.adventurerPos, prev.totalStats.range, prev.totalStats.attack - prev.spentAttack, config, prev.monsters, def);
      if (!attackable.includes(monsterId)) return prev;
      const newMonsters = prev.monsters.map(m => m.id === monsterId ? { ...m, health: m.health - 1 } : m).filter(m => m.health > 0);
      const killed = newMonsters.length < prev.monsters.length;
      const msg = killed ? `Slew a ${prev.monsterStats.type}! (${newMonsters.length} left)` : `Hit ${prev.monsterStats.type} — ${newMonsters.find(m => m.id === monsterId)?.health} HP`;
      const next = { ...prev, monsters: newMonsters, spentAttack: prev.spentAttack + def, log: [...prev.log.slice(-20), msg] };
      return newMonsters.length === 0 ? endOfCombat(next) : next;
    });
  }, []);

  const startBoss = useCallback(() => {
    setGameState(prev => prev && prev.phase === 'bossIntro' ? buildBossState(prev) : prev);
  }, []);

  const endAdventurerPhase = useCallback(() => {
    setGameState(prev => prev && prev.phase === 'adventurer' ? { ...prev, phase: 'monsterMove', log: [...prev.log.slice(-20), 'Monsters move…'] } : prev);
  }, []);

  // Compute movements and store as arrows — do NOT apply yet
  const computeMonsterMove = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'monsterMove') return prev;
      const config = getConfig(prev);
      const movedMonsters = moveMonsters(prev.monsters, prev.adventurerPos, config, prev.monsterStats.speed, prev.monsterStats.range);
      const arrows: MovementArrow[] = prev.monsters
        .map(m => ({ id: m.id, from: m.pos, to: movedMonsters.find(nm => nm.id === m.id)!.pos }))
        .filter(a => a.from.row !== a.to.row || a.from.col !== a.to.col);
      return {
        ...prev,
        phase: 'monsterMoveAnimate',
        pendingMovements: arrows,
        log: [...prev.log.slice(-20), arrows.length ? `${arrows.length} monster(s) move.` : 'Monsters hold position.'],
      };
    });
  }, []);

  // Apply pending movements
  const confirmMonsterMove = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'monsterMoveAnimate') return prev;
      const newMonsters = prev.monsters.map(m => {
        const mv = prev.pendingMovements.find(a => a.id === m.id);
        return mv ? { ...m, pos: mv.to } : m;
      });
      return { ...prev, monsters: newMonsters, pendingMovements: [], phase: 'monsterAttack', log: [...prev.log.slice(-20), 'Monsters repositioned.'] };
    });
  }, []);

  const runMonsterAttack = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'monsterAttack') return prev;
      const config = getConfig(prev);
      const { damage, attackingIds } = calcMonsterDamage(prev.monsters, prev.adventurerPos, config, prev.totalStats.defense, prev.monsterStats.attack, prev.monsterStats.range);
      const newHealth = prev.adventurerHealth - damage;
      const msg = attackingIds.length === 0 ? 'No monsters in range — safe!' : `${attackingIds.length} monster(s): ${attackingIds.length * prev.monsterStats.attack} ATK ÷ ${prev.totalStats.defense} DEF = ${damage} dmg`;
      if (newHealth <= 0) return { ...prev, adventurerHealth: 0, phase: 'gameOver', log: [...prev.log.slice(-20), msg, 'You have fallen…'] };
      // classAbilityUsed intentionally NOT reset — class abilities are once per LEVEL
      return { ...prev, adventurerHealth: newHealth, phase: 'energy', prevEnergyDice: prev.turnRoll ? [...prev.turnRoll] : null, energyDice: [0, 0, 0], assignedEnergy: { speed: null, attack: null, defense: null, range: null }, chestSkillThisTurn: null, chestSpentThisTurn: 0, knightSlot: null, necroTargeting: false, log: [...prev.log.slice(-20), msg, '── new turn ──'] };
    });
  }, []);

  const chooseLevelReward = useCallback((choice: 'heal' | 'speed' | 'attack' | 'defense' | 'range') => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'levelEnd') return prev;
      let newHealth = prev.adventurerHealth;
      let newBase = { ...prev.baseStats };
      let msg: string;
      if (choice === 'heal') { newHealth = 6; msg = 'Healed to full!'; }
      else { (newBase as Record<string, number>)[choice] += 1; msg = `${choice} → ${(newBase as Record<string, number>)[choice]}`; }
      const nextLevel = prev.level + 1;
      return { ...buildLevelState(nextLevel, prev.characterClass, newBase, newHealth, prev.expansion), log: [...prev.log.slice(-10), msg, `Level ${nextLevel}…`] };
    });
  }, []);

  if (screen === 'title') return <TitleScreen onStart={() => setScreen('classSelect')} onLoad={loadGame} />;
  if (screen === 'classSelect') return <ClassSelectScreen selected={characterClass} onSelect={setCharacterClass} expansion={expansion} onToggleExpansion={setExpansion} onConfirm={() => startGame(characterClass, expansion)} />;
  if (!gameState) return null;

  return <GameScreen state={gameState} rollEnergy={rollEnergy} useWizardReroll={useWizardReroll} usePaladinKeep={usePaladinKeep} useBarbarianReroll={useBarbarianReroll} useRogueBoost={useRogueBoost} toggleNecroTargeting={toggleNecroTargeting} selectDie={selectDie} assignDie={assignDie} unassignDie={unassignDie} confirmEnergy={confirmEnergy} spendChestPoint={spendChestPoint} handleTileClick={handleTileClick} handleMonsterClick={handleMonsterClick} endAdventurerPhase={endAdventurerPhase} computeMonsterMove={computeMonsterMove} confirmMonsterMove={confirmMonsterMove} runMonsterAttack={runMonsterAttack} startBoss={startBoss} chooseLevelReward={chooseLevelReward} onRestart={() => setScreen('title')} />;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const CLASSES: CharacterClass[] = ['none', 'paladin', 'barbarian', 'ranger', 'wizard'];
const EXP_CLASSES: CharacterClass[] = ['necromancer', 'cleric', 'knight', 'rogue'];
const CLASS_ICONS: Record<CharacterClass, string> = { none: '🗡️', paladin: '🛡️', barbarian: '🪓', ranger: '🏹', wizard: '🔮', necromancer: '☠️', cleric: '✨', knight: '⚔️', rogue: '🗡' };
const CLASS_NAMES: Record<CharacterClass, string> = { none: 'Adventurer', paladin: 'Paladin', barbarian: 'Barbarian', ranger: 'Ranger', wizard: 'Wizard', necromancer: 'Necromancer', cleric: 'Cleric', knight: 'Knight', rogue: 'Rogue' };
const CLASS_IMG: Record<CharacterClass, string> = { none: advImg, paladin: paladinImg, barbarian: barbarianImg, ranger: rangerImg, wizard: wizardImg, necromancer: necromancerImg, cleric: clericImg, knight: knightImg, rogue: rogueImg };
const MONSTER_EMOJI: Record<string, string> = { Spider: '🕷️', Goblin: '👺', Skeleton: '💀', Orc: '👹', Troll: '🧌', Dragon: '🐉', 'Lich King': '☠️' };
// Sprites extracted from the physical card photos
const MONSTER_IMG: Record<string, string> = {
  Spider: spiderImg, Goblin: goblinImg, Skeleton: skeletonImg, Dragon: dragonImg,
  'Orc Commander': bossOrcImg, 'Lich Commander': bossLichImg, 'Wyvern Commander': bossWyvernImg, "M'Guf-yn": bossMgufynImg,
};
const BOARD_IMG: Record<'lava' | 'ice', string> = { lava: boardLavaImg, ice: boardIceImg };
const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const PHASE_LABELS: Record<Phase, string> = {
  classSelect: 'Class', energy: 'Energy', energyAssign: 'Assign',
  adventurer: 'Your Turn', monsterMove: 'Monsters Move',
  monsterMoveAnimate: 'Preview', monsterAttack: 'Monsters Attack',
  bossIntro: '👹 Boss', levelEnd: 'Level Clear', gameOver: 'Game Over', victory: '🏆 Victory',
};

// Boss encountered after this level (expansion only)
function bossForLevel(level: number): BossDef | undefined {
  return BOSS_DEFS.find(b => b.afterLevel === level);
}

// Config for the current state (base level or boss card), with the closed
// treasure chest blocking its tile like a wall
function getConfig(state: GameState): DungeonConfig {
  const base = state.isBossLevel
    ? bossForLevel(state.level)!.config
    : DUNGEON_CONFIGS[LEVEL_DEFS[state.level - 1].configIndex];
  if (state.chest && !state.chest.opened) {
    const grid = base.grid.map(r => [...r]);
    grid[state.chest.pos.row][state.chest.pos.col] = 'wall';
    return { ...base, grid };
  }
  return base;
}

// ── Title ─────────────────────────────────────────────────────────────────────

function TitleScreen({ onStart, onLoad }: { onStart: () => void; onLoad: (code: string) => boolean }) {
  const [lb, setLb] = useState<LBEntry[] | null | 'loading'>('loading');
  const [showLoad, setShowLoad] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  useEffect(() => { loadLeaderboard().then(setLb); }, []);
  const tryLoad = () => { if (!onLoad(code)) setCodeError(true); };
  // Hall of fame: heroes who cleared the dungeon — 🏆 per base victory,
  // 👑 per expansion victory (M'Guf-yn slain)
  const fame: Array<[string, { base: number; exp: number }]> = Array.isArray(lb)
    ? [...lb.filter(e => e.won).reduce((m, e) => {
        const cur = m.get(e.name) ?? { base: 0, exp: 0 };
        if (e.exp) cur.exp += 1; else cur.base += 1;
        return m.set(e.name, cur);
      }, new Map<string, { base: number; exp: number }>())]
        .sort((a, b) => (b[1].exp * 2 + b[1].base) - (a[1].exp * 2 + a[1].base))
    : [];
  return (
    <div className="screen title-screen">
      <div className="title-content">
        <img className="title-cover" src={coverImg} alt="One Card Dungeon" />
        <p className="subtitle">Solo dungeon crawl · 12 levels</p>
        <button className="btn btn-primary btn-large" onClick={onStart}>Begin Adventure</button>
        {!showLoad ? (
          <button className="btn btn-secondary load-toggle" onClick={() => setShowLoad(true)}>💾 Reprendre avec un code</button>
        ) : (
          <div className="load-block">
            <div className="name-entry">
              <input
                className="name-input load-input"
                type="text"
                maxLength={10}
                placeholder="XXX-XXXX"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setCodeError(false); }}
                onKeyDown={e => { if (e.key === 'Enter') tryLoad(); }}
              />
              <button className="btn btn-primary" disabled={!code.trim()} onClick={tryLoad}>Charger</button>
            </div>
            {codeError && <p className="save-error">Code invalide — vérifie et réessaie.</p>}
          </div>
        )}
        {fame.length > 0 && (
          <div className="score-list fame-list">
            <div className="score-heading">👑 Hall of Fame</div>
            {fame.map(([n, c]) => (
              <div key={n} className="fame-row">
                <span className="fame-name">{n}</span>
                <span className="fame-cups">
                  {'👑'.repeat(Math.min(c.exp, 6))}{c.exp > 6 ? `×${c.exp} ` : ''}
                  {'🏆'.repeat(Math.min(c.base, 6))}{c.base > 6 ? `×${c.base}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="score-list">
          <div className="score-heading">Meilleurs runs</div>
          {lb === 'loading' && <div className="score-empty">Chargement…</div>}
          {lb === null && <div className="score-empty">Classement indisponible</div>}
          {Array.isArray(lb) && lb.length === 0 && <div className="score-empty">Aucun score — sois le premier !</div>}
          {Array.isArray(lb) && lb.slice(0, 20).map((e, i) => (
            <div key={i} className={`score-row${e.won ? ' score-won' : ''}`}>
              <span className="score-rank">{i + 1}</span>
              <span className="score-icon">{CLASS_ICONS[e.cls] ?? '🗡️'}</span>
              <span className="score-name">{e.name}</span>
              <span className="score-result">{e.exp ? '😈 ' : ''}{e.won ? (e.exp ? '👑' : '🏆') : '💀'} Lvl {e.level}</span>
              <span className="score-date">{e.date}</span>
            </div>
          ))}
        </div>
        <p className="credit">Designed by Barny Skinner · Little Rocket Games</p>
        <p className="credit">Fan-made web app — <a className="credit-link" href="https://boardgamegeek.com/profile/apiiii" target="_blank" rel="noreferrer">my BGG profile</a> — not affiliated with Little Rocket Games</p>
      </div>
    </div>
  );
}

// ── Class Select ──────────────────────────────────────────────────────────────

function ClassSelectScreen({ selected, onSelect, expansion, onToggleExpansion, onConfirm }: {
  selected: CharacterClass; onSelect: (c: CharacterClass) => void;
  expansion: boolean; onToggleExpansion: (v: boolean) => void; onConfirm: () => void;
}) {
  const pick = (cls: CharacterClass) => onSelect(cls);
  const confirmDisabled = !expansion && EXP_CLASSES.includes(selected);
  return (
    <div className="screen class-screen">
      <h2>Choose Your Class</h2>
      <div className="class-grid">
        {CLASSES.map(cls => (
          <button key={cls} className={`class-card ${selected === cls ? 'selected' : ''}`} onClick={() => pick(cls)}>
            <img className="class-img" src={CLASS_IMG[cls]} alt={CLASS_NAMES[cls]} />
            <span className="class-name">{CLASS_NAMES[cls]}</span>
            <span className="class-desc">{CLASS_DESCRIPTIONS[cls]}</span>
          </button>
        ))}
      </div>
      <button className={`exp-toggle${expansion ? ' exp-on' : ''}`} onClick={() => { if (expansion && EXP_CLASSES.includes(selected)) onSelect('none'); onToggleExpansion(!expansion); }}>
        <span className="exp-toggle-box">{expansion ? '✔' : ''}</span>
        <span className="exp-toggle-label">😈 Extension M'Guf-yn Returns</span>
        <span className="exp-toggle-desc">Boss, coffres au trésor & nouvelles classes</span>
      </button>
      {expansion && (
        <div className="class-grid class-grid-exp">
          {EXP_CLASSES.map(cls => (
            <button key={cls} className={`class-card ${selected === cls ? 'selected' : ''}`} onClick={() => pick(cls)}>
              <img className="class-img" src={CLASS_IMG[cls]} alt={CLASS_NAMES[cls]} />
              <span className="class-name">{CLASS_NAMES[cls]}</span>
              <span className="class-desc">{CLASS_DESCRIPTIONS[cls]}</span>
            </button>
          ))}
        </div>
      )}
      <button className="btn btn-primary btn-large" disabled={confirmDisabled} onClick={onConfirm}>Enter as {CLASS_NAMES[selected]}</button>
    </div>
  );
}

// ── End Screen (game over / victory) ─────────────────────────────────────────

function EndScreen({ won, level, cls, exp, onRestart }: { won: boolean; level: number; cls: CharacterClass; exp: boolean; onRestart: () => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [rank, setRank] = useState(-1);
  const [pending, setPending] = useState<LBEntry | null>(null);

  const save = async () => {
    const pseudo = name.trim();
    if (!pseudo || status === 'saving' || status === 'saved') return;
    setStatus('saving');
    localStorage.setItem(NAME_KEY, pseudo);
    // Freeze the entry on first attempt so retries stay idempotent
    let entry = pending;
    if (!entry) {
      entry = { name: pseudo, cls, level, won, exp, date: new Date().toLocaleDateString('fr-FR'), ts: Date.now() };
      setPending(entry);
    }
    const r = await submitToLeaderboard(entry);
    if (r === -1) { setStatus('error'); return; }
    setRank(r);
    setStatus('saved');
  };

  return (
    <div className={`screen end-screen${won ? ' victory' : ''}`}>
      <div className="end-content">
        <div className="end-icon">{won ? '🏆' : '💀'}</div>
        {won ? <h2>Victory!</h2> : <h2 className="game-over-title">GAME OVER</h2>}
        <p className="end-subtitle">{won ? (exp ? "M'Guf-yn is defeated — the world is saved!" : "The Sceptre of M'Guf-yn is yours!") : 'Your hero has fallen.'}</p>
        {!won && <p>You reached level {level}.</p>}
        {status === 'saved' ? (
          <p className="save-confirm">✓ Score enregistré — {name.trim()}{rank >= 0 && rank < 20 ? ` · #${rank + 1} au classement` : ''}</p>
        ) : (
          <div className="name-entry-block">
            <div className="name-entry">
              <input
                className="name-input"
                type="text"
                maxLength={16}
                placeholder="Ton pseudo"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); }}
                disabled={status === 'saving'}
              />
              <button className="btn btn-primary" disabled={!name.trim() || status === 'saving'} onClick={save}>
                {status === 'saving' ? '…' : status === 'error' ? 'Réessayer' : 'Enregistrer'}
              </button>
            </div>
            {status === 'error' && <p className="save-error">Impossible d'enregistrer en ligne — réessaie.</p>}
          </div>
        )}
        <button className="btn btn-secondary" onClick={onRestart}>{won ? 'Play Again' : 'New Run'}</button>
      </div>
    </div>
  );
}

// ── Game Screen ───────────────────────────────────────────────────────────────

interface GameScreenProps {
  state: GameState;
  rollEnergy: () => void; useWizardReroll: () => void; usePaladinKeep: (dieIdx: number) => void; useBarbarianReroll: () => void;
  useRogueBoost: () => void; toggleNecroTargeting: () => void;
  selectDie: (i: number) => void; assignDie: (slot: 'speed' | 'attack' | 'defense' | 'range') => void;
  unassignDie: (slot: 'speed' | 'attack' | 'defense' | 'range') => void; confirmEnergy: () => void;
  spendChestPoint: (skill: keyof BaseStats) => void;
  handleTileClick: (pos: Pos) => void; handleMonsterClick: (id: number) => void;
  endAdventurerPhase: () => void;
  computeMonsterMove: () => void; confirmMonsterMove: () => void;
  runMonsterAttack: () => void; startBoss: () => void;
  chooseLevelReward: (c: 'heal' | 'speed' | 'attack' | 'defense' | 'range') => void;
  onRestart: () => void;
}

function GameScreen(props: GameScreenProps) {
  const { state } = props;
  const boss = state.isBossLevel ? bossForLevel(state.level) : undefined;
  const def = LEVEL_DEFS[state.level - 1];
  const config = getConfig(state);
  const speedLeft = state.totalStats.speed - state.spentSpeed;
  const attackLeft = state.totalStats.attack - state.spentAttack;

  const reachable = state.phase === 'adventurer' && !state.necroTargeting
    ? getReachableTiles(state.adventurerPos, speedLeft, config, state.monsters) : new Map<string, number>();
  const attackable = state.phase === 'adventurer'
    ? (state.necroTargeting
        ? state.monsters.filter(m => rangeDistance(state.adventurerPos, m.pos, config) <= state.totalStats.range && hasLoS(state.adventurerPos, m.pos, config, state.monsters, [m.id])).map(m => m.id)
        : getAttackableMonsters(state.adventurerPos, state.totalStats.range, attackLeft, config, state.monsters, state.monsterStats.defense))
    : [];
  const inRangeMonsters = state.phase === 'monsterAttack'
    ? state.monsters.filter(m => rangeDistance(m.pos, state.adventurerPos, config) <= state.monsterStats.range && hasLoS(m.pos, state.adventurerPos, config, state.monsters, [m.id])).map(m => m.id) : [];
  // Closed chest attackable?
  const chestAttackable = state.phase === 'adventurer' && !state.necroTargeting && state.chest && !state.chest.opened
    && rangeDistance(state.adventurerPos, state.chest.pos, config, false) <= state.totalStats.range
    && hasLoS(state.adventurerPos, state.chest.pos, config, state.monsters)
    && attackLeft >= state.chest.value;

  if (state.phase === 'gameOver' || state.phase === 'victory') {
    return <EndScreen won={state.phase === 'victory'} level={state.level} cls={state.characterClass} exp={state.expansion} onRestart={props.onRestart} />;
  }
  if (state.phase === 'bossIntro') {
    const nextBoss = bossForLevel(state.level)!;
    return (
      <div className="screen end-screen boss-intro">
        <div className="end-content">
          <img className="boss-intro-img" src={MONSTER_IMG[nextBoss.stats.type]} alt={nextBoss.name} />
          <h2 className="boss-intro-title">{nextBoss.name}</h2>
          <p className="end-subtitle">{nextBoss.afterLevel >= 12 ? 'The lord of the underworld himself blocks your path!' : "One of M'Guf-yn's commanders blocks your path!"}</p>
          <p>No healing or reward before the fight — the boss card extends level {state.level}.{state.chestPool > 0 ? ` Your chest loot (${state.chestPool} pts) carries over.` : ''}</p>
          <button className="btn btn-danger btn-large" onClick={props.startBoss}>⚔️ Face the Boss</button>
        </div>
      </div>
    );
  }
  if (state.phase === 'levelEnd') {
    return (
      <div className="screen end-screen level-end">
        <div className="end-content">
          <div className="end-icon">⬇️</div>
          <h2>Level {state.level} Cleared!</h2>
          <p>Choose your reward:</p>
          <div className="reward-grid">
            <button className="btn btn-reward full" onClick={() => props.chooseLevelReward('heal')}>❤️ Heal to full</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('speed')}>👟 Speed → {state.baseStats.speed + 1}</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('attack')}>⚔️ Attack → {state.baseStats.attack + 1}</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('defense')}>🛡️ Defense → {state.baseStats.defense + 1}</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('range')}>🏹 Range → {state.baseStats.range + 1}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game-layout">
      {/* Header */}
      <div className="game-header">
        <span className="level-badge">Lvl {state.level}/12</span>
        <img className="header-banner" src={bannerImg} alt="One Card Dungeon" />
        <span className={`phase-badge phase-${state.phase}`}>{PHASE_LABELS[state.phase]}</span>
        <button className="btn-restart" onClick={props.onRestart}>EXIT</button>
      </div>

      {/* Adventurer strip — mirrors the monster strip below the grid */}
      <div className="adv-bar">
        <div className="adv-portrait">
          <img className="adv-class-img" src={CLASS_IMG[state.characterClass]} alt={CLASS_NAMES[state.characterClass]} />
          <div className="adv-heart">
            <img src={heartIcon} alt="PV" />
            <span className="adv-heart-val">{state.adventurerHealth}</span>
          </div>
        </div>
        <StatChip icon={bootsIcon} base={state.baseStats.speed} energy={state.assignedEnergy.speed} left={state.phase === 'adventurer' ? speedLeft : null} />
        <StatChip icon={swordIcon} base={state.baseStats.attack} energy={state.assignedEnergy.attack} left={state.phase === 'adventurer' ? attackLeft : null} />
        <StatChip icon={shieldIcon} base={state.baseStats.defense} energy={state.assignedEnergy.defense} left={null} />
        <StatChip icon={bowIcon} base={state.baseStats.range} energy={state.assignedEnergy.range} left={null} />
      </div>

      {/* Card zone: dungeon grid + monster strip, joined with no gap */}
      <div className="card-zone">
        <div className="dungeon-outer">
          {boss ? (
            <div
              className={`card-bg card-bg-boss${boss.flipped ? ' card-bg-flip' : ''}`}
              style={{ backgroundImage: `url('${BOARD_IMG[boss.board]}')` }}
            />
          ) : (
            <div
              className={`card-bg card-bg-${def.configIndex < 2 ? 'front' : 'back'}${def.configIndex === 1 || def.configIndex === 3 ? ' card-bg-flip' : ''}`}
              style={{ backgroundImage: `url('${import.meta.env.BASE_URL}${def.configIndex < 2 ? 'IMG_2351' : 'IMG_2348'}.jpeg')` }}
            />
          )}
          <DungeonGrid config={config} state={state} reachable={reachable} attackable={attackable} inRangeMonsters={inRangeMonsters} chestAttackable={!!chestAttackable} onTileClick={props.handleTileClick} onMonsterClick={props.handleMonsterClick} />
          {state.phase === 'monsterMoveAnimate' && state.pendingMovements.length > 0 && (
            <MovementArrows movements={state.pendingMovements} cols={config.cols} rows={config.rows} />
          )}
        </div>
        {boss ? (
          /* Boss stats bar — replaces the card photo strip */
          <div className="boss-bar">
            <div className="boss-bar-portrait">
              <img src={MONSTER_IMG[boss.stats.type]} alt={boss.name} />
              <div className="adv-heart boss-heart">
                <img src={heartIcon} alt="PV" />
                <span className="adv-heart-val">{state.monsters[0]?.health ?? 0}</span>
              </div>
            </div>
            <StatChip icon={bootsIcon} base={boss.stats.speed} energy={null} left={null} />
            <StatChip icon={swordIcon} base={boss.stats.attack} energy={null} left={null} />
            <StatChip icon={shieldIcon} base={boss.stats.defense} energy={null} left={null} />
            <StatChip icon={bowIcon} base={boss.stats.range} energy={null} left={null} />
          </div>
        ) : (
          <div className="monster-strip-wrap">
            <div
              className={`monster-strip-bg monster-strip-${def.configIndex < 2 ? 'front' : 'back'}${def.configIndex === 1 || def.configIndex === 3 ? ' monster-strip-flip' : ''}`}
              style={{ backgroundImage: `url('${import.meta.env.BASE_URL}${def.configIndex < 2 ? 'IMG_2351' : 'IMG_2348'}.jpeg')` }}
            />
            <div className="monster-strip-overlay">
              <div className="monster-alive">
                {state.monsters.map(m => <span key={m.id} className={`alive-dot ${inRangeMonsters.includes(m.id) ? 'dot-danger' : ''}`}>{m.health}</span>)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Phase controls */}
      <div className="phase-area">
        <PhaseControls {...props} />
      </div>

      {/* Log */}
      <div className="log-strip">
        {[...state.log].reverse().slice(0, 4).map((entry, i) => (
          <span key={i} className={`log-item ${entry.startsWith('──') ? 'log-sep' : ''}`}>{entry}</span>
        ))}
      </div>
    </div>
  );
}

// ── Movement Arrows (SVG overlay) ─────────────────────────────────────────────

function MovementArrows({ movements, cols, rows }: { movements: MovementArrow[]; cols: number; rows: number }) {
  return (
    <svg
      className="movement-svg"
      viewBox={`0 0 ${cols} ${rows}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker id="mv-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
          <polygon points="0,0 4,2 0,4" fill="#ff7700" />
        </marker>
      </defs>
      {movements.map((mv, idx) => {
        const x1 = mv.from.col + 0.5;
        const y1 = mv.from.row + 0.5;
        const x2 = mv.to.col + 0.5;
        const y2 = mv.to.row + 0.5;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;
        const nx = dx / len, ny = dy / len;
        // start a bit away from center, end before arrowhead
        const sx = x1 + nx * 0.28, sy = y1 + ny * 0.28;
        const ex = x2 - nx * 0.22, ey = y2 - ny * 0.22;
        return (
          <line
            key={mv.id}
            x1={sx} y1={sy} x2={ex} y2={ey}
            stroke="#ff7700"
            strokeWidth="0.13"
            strokeLinecap="round"
            markerEnd="url(#mv-arrow)"
            className="mv-line"
            style={{ animationDelay: `${idx * 80}ms` }}
          />
        );
      })}
    </svg>
  );
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({ icon, base, energy, left }: { icon: string; base: number; energy: number | null; left: number | null }) {
  const total = base + (energy ?? 0);
  return (
    <div className="stat-chip">
      <img className="stat-chip-icon" src={icon} alt="" />
      <div className="stat-chip-total">{energy !== null ? total : base}</div>
      {energy !== null && <div className="stat-chip-detail">{base}+{energy}</div>}
      {left !== null && <div className="stat-chip-left">{left}←</div>}
    </div>
  );
}


// ── Dungeon Grid ──────────────────────────────────────────────────────────────

function DungeonGrid({ config, state, reachable, attackable, inRangeMonsters, chestAttackable, onTileClick, onMonsterClick }: {
  config: DungeonConfig; state: GameState; reachable: Map<string, number>;
  attackable: number[]; inRangeMonsters: number[]; chestAttackable: boolean;
  onTileClick: (pos: Pos) => void; onMonsterClick: (id: number) => void;
}) {
  return (
    <div className="dungeon-grid" style={{ '--cols': config.cols } as React.CSSProperties}>
      {config.grid.map((row, r) =>
        row.map((tile, c) => {
          const key = `${r},${c}`;
          const isAdv = state.adventurerPos.row === r && state.adventurerPos.col === c;
          const monster = state.monsters.find(m => m.pos.row === r && m.pos.col === c);
          const isBossToken = monster !== undefined && state.isBossLevel;
          const chestHere = state.chest && !state.chest.opened && state.chest.pos.row === r && state.chest.pos.col === c;
          // During animate phase, also highlight destination tiles
          const isDestination = state.phase === 'monsterMoveAnimate' &&
            state.pendingMovements.some(a => a.to.row === r && a.to.col === c);
          const isAttackable = monster ? attackable.includes(monster.id) : false;
          const isInRange = monster ? inRangeMonsters.includes(monster.id) : false;
          let cls = `tile tile-${tile}`;
          if (reachable.has(key)) cls += ' tile-reachable';
          if (isAttackable) cls += ' tile-attackable';
          if (isInRange) cls += ' tile-in-range';
          if (isDestination) cls += ' tile-destination';
          if (chestHere && chestAttackable) cls += ' tile-attackable';
          return (
            <div key={key} className={cls} onClick={() => {
              if (monster && attackable.includes(monster.id)) onMonsterClick(monster.id);
              else if (chestHere) onTileClick({ row: r, col: c });
              else if (reachable.has(key)) onTileClick({ row: r, col: c });
            }}>
              {tile === 'stairs' && !isAdv && !chestHere && <span className="tile-icon">🪜</span>}
              {chestHere && (
                <div className="chest-token">
                  <span className="chest-die">{state.chest!.value}</span>
                </div>
              )}
              {isAdv && <img src={CLASS_IMG[state.characterClass]} className="adv-icon" alt="adventurer" />}
              {monster && (
                <div className="monster-token">
                  {MONSTER_IMG[monster.type]
                    ? <img className={`monster-img${isBossToken ? ' monster-img-boss' : ''}`} src={MONSTER_IMG[monster.type]} alt={monster.type} />
                    : <span className="monster-emoji">{MONSTER_EMOJI[monster.type] ?? '👾'}</span>}
                  <span className="monster-hp">{monster.health}</span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Phase Controls ────────────────────────────────────────────────────────────

function PhaseControls(props: GameScreenProps) {
  const { state } = props;
  const ae = state.assignedEnergy;

  if (state.phase === 'energy') {
    return (
      <div className="controls-inner">
        <button className="btn btn-primary btn-large" onClick={props.rollEnergy}>🎲 Roll Energy</button>
        <div className="save-code">💾 Code niveau {state.level} : <b>{state.saveCode}</b></div>
        {state.characterClass === 'paladin' && state.prevEnergyDice && !state.classAbilityUsed && (
          <div className="paladin-keep">
            <span className="paladin-keep-label">🛡️ Keep a die, roll the other two:</span>
            <div className="dice-row">
              {state.prevEnergyDice.map((d, i) => (
                <button key={i} className="die" onClick={() => props.usePaladinKeep(i)}>{DIE_FACES[d]}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (state.phase === 'energyAssign') {
    const assignedCount = [ae.speed, ae.attack, ae.defense].filter(v => v !== null).length;
    const activeDice = state.energyDice.filter(d => d !== -1).length;
    const ready = assignedCount >= 3 || activeDice === 0;
    return (
      <div className="controls-inner">
        <div className="dice-row">
          {state.energyDice.map((d, i) =>
            d === -1
              ? <div key={i} className="die die-used">✓</div>
              : <button key={i} className={`die ${state.selectedDie === i ? 'die-selected' : ''}`} onClick={() => props.selectDie(i)}>{DIE_FACES[d]}</button>
          )}
        </div>
        <div className="assign-row">
          {(['speed', 'attack', 'defense'] as const).map(slot => {
            const icons = { speed: '👟 SPD', attack: '⚔️ ATK', defense: '🛡️ DEF' };
            const val = ae[slot];
            return val !== null
              ? <button key={slot} className="btn btn-slot btn-slot-filled" onClick={() => props.unassignDie(slot)}>{icons[slot]} {val} ✕</button>
              : <button key={slot} className="btn btn-slot" disabled={state.selectedDie === null} onClick={() => props.assignDie(slot)}>{icons[slot]}</button>;
          })}
          {state.characterClass === 'ranger' && ae.range !== null && (
            <button className="btn btn-class" onClick={() => props.unassignDie('range')}>🏹 {ae.range} ✕</button>
          )}
          {state.characterClass === 'ranger' && ae.range === null && !state.classAbilityUsed && state.selectedDie !== null && (
            <button className="btn btn-class" onClick={() => props.assignDie('range')}>🏹+</button>
          )}
        </div>
        {state.chestPool > 0 && (
          <div className="chest-spend">
            <span className="chest-spend-label">🧰 <b>{state.chestPool}</b> loot pts{state.chestSkillThisTurn ? ` → ${state.chestSkillThisTurn}` : ''}{state.chestSpentThisTurn > 0 ? ` (+${state.chestSpentThisTurn})` : ''}</span>
            <div className="chest-spend-row">
              {(['speed', 'attack', 'defense', 'range'] as const).map(sk => {
                const icons = { speed: '👟', attack: '⚔️', defense: '🛡️', range: '🏹' };
                const locked = state.chestSkillThisTurn !== null && state.chestSkillThisTurn !== sk;
                return <button key={sk} className="btn btn-chest" disabled={locked} onClick={() => props.spendChestPoint(sk)}>{icons[sk]}+1</button>;
              })}
            </div>
          </div>
        )}
        {ready && <button className="btn btn-primary btn-large" onClick={props.confirmEnergy}>Valider →</button>}
        {state.characterClass === 'wizard' && !state.classAbilityUsed && (
          <button className="btn btn-class" onClick={props.useWizardReroll}>🔮 Reroll all</button>
        )}
        {state.characterClass === 'rogue' && !state.classAbilityUsed && (
          <button className="btn btn-class" onClick={props.useRogueBoost}>🗡 +1 to all dice</button>
        )}
        {state.characterClass === 'barbarian' && state.adventurerHealth === 1 && !state.barbarianRerolled && (
          <button className="btn btn-danger" onClick={props.useBarbarianReroll}>🪓 Barbarian Rage!</button>
        )}
      </div>
    );
  }

  if (state.phase === 'adventurer') {
    return (
      <div className="controls-inner">
        {state.necroTargeting ? (
          <div className="action-hint necro-hint">☠️ Choose a target within range (−1 Life, 1 damage)</div>
        ) : (
          <div className="action-hint">
            <span className="hint-move">■ Move</span> 2pts ortho · 3pts diag &nbsp;
            <span className="hint-attack">■ Attack</span> cost {state.monsterStats.defense}
            {state.chest && !state.chest.opened ? <> &nbsp;<span className="hint-chest">■ Chest</span> cost {state.chest.value}</> : null}
          </div>
        )}
        {state.characterClass === 'necromancer' && !state.classAbilityUsed && state.adventurerHealth > 1 && state.monsters.length > 0 && (
          <button className={`btn ${state.necroTargeting ? 'btn-secondary' : 'btn-class'}`} onClick={props.toggleNecroTargeting}>
            {state.necroTargeting ? 'Cancel sacrifice' : '☠️ Sacrifice: 1 Life → 1 dmg'}
          </button>
        )}
        <button className="btn btn-secondary btn-large" onClick={props.endAdventurerPhase}>End Turn →</button>
      </div>
    );
  }

  if (state.phase === 'monsterMove') {
    return (
      <div className="controls-inner">
        <p className="phase-desc">Monsters move toward max range with LoS.</p>
        <button className="btn btn-warning btn-large" onClick={props.computeMonsterMove}>Show Moves →</button>
      </div>
    );
  }

  if (state.phase === 'monsterMoveAnimate') {
    const moved = state.pendingMovements.length;
    return (
      <div className="controls-inner">
        <p className="phase-desc">
          {moved > 0
            ? `${moved} monster(s) will move (arrows show destinations).`
            : 'No monsters can move this turn.'}
        </p>
        <button className="btn btn-warning btn-large" onClick={props.confirmMonsterMove}>Confirm Moves →</button>
      </div>
    );
  }

  if (state.phase === 'monsterAttack') {
    return (
      <div className="controls-inner">
        <p className="phase-desc">Monsters in range attack (ATK ÷ DEF = damage).</p>
        <button className="btn btn-danger btn-large" onClick={props.runMonsterAttack}>Resolve Attack →</button>
      </div>
    );
  }

  return null;
}
