import { useState, useCallback, useEffect } from 'react';
import type { GameState, Phase, CharacterClass, Pos, BaseStats, DungeonConfig, MovementArrow } from './types';
import { DUNGEON_CONFIGS, LEVEL_DEFS, CLASS_DESCRIPTIONS } from './gameData';
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
import advImg from './assets/class-adventurer.png';
import paladinImg from './assets/class-paladin.png';
import barbarianImg from './assets/class-barbarian.png';
import rangerImg from './assets/class-ranger.png';
import wizardImg from './assets/class-wizard.png';
import spiderImg from './assets/monster-spider.png';
import goblinImg from './assets/monster-goblin.png';
import skeletonImg from './assets/monster-skeleton.png';
import dragonImg from './assets/monster-dragon.png';

const NAME_KEY = '1cd-name';

// ── Online leaderboard (JSONBin — separate bin from 1 Card Racing) ───────────
interface LBEntry { name: string; cls: CharacterClass; level: number; won: boolean; date: string; ts?: number; }
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
  return (b.won ? 1 : 0) - (a.won ? 1 : 0) || b.level - a.level;
}

// Fetch fresh, insert entry (idempotent on retry), sort, keep top 20.
// Returns the entry's rank (0-based) or -1 on failure.
async function submitToLeaderboard(entry: LBEntry): Promise<number> {
  const lb = await loadLeaderboard();
  if (lb === null) return -1; // load failed — don't overwrite the bin
  const same = (e: LBEntry) => e.name === entry.name && e.ts === entry.ts;
  if (!lb.some(same)) lb.push(entry); // idempotent on retry after silent success
  lb.sort(rankLB);
  const rank = lb.findIndex(same);
  const ok = await saveLeaderboard(lb.slice(0, 20));
  return ok ? rank : -1;
}

const INITIAL_STATS: BaseStats = { speed: 1, attack: 1, defense: 1, range: 2 };

function buildLevelState(level: number, characterClass: CharacterClass, baseStats: BaseStats, health: number): GameState {
  const def = LEVEL_DEFS[level - 1];
  const config = DUNGEON_CONFIGS[def.configIndex];
  return {
    phase: 'energy',
    level,
    adventurerPos: { ...config.adventurerStart },
    adventurerHealth: health,
    baseStats,
    energyDice: [0, 0, 0],
    assignedEnergy: { speed: null, attack: null, defense: null },
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
    log: [`Level ${level}: ${def.monsterStats.type}s appear!`],
    selectedDie: null,
    pendingMovements: [],
  };
}

export default function App() {
  const [screen, setScreen] = useState<'title' | 'classSelect' | 'game'>('title');
  const [characterClass, setCharacterClass] = useState<CharacterClass>('none');
  const [gameState, setGameState] = useState<GameState | null>(null);

  const startGame = useCallback((cls: CharacterClass) => {
    setGameState(buildLevelState(1, cls, { ...INITIAL_STATS }, 6));
    setScreen('game');
  }, []);

  const rollEnergy = useCallback(() => {
    setGameState(prev => {
      if (!prev) return prev;
      const dice = rollDice(3);
      return { ...prev, energyDice: dice, phase: 'energyAssign' as Phase, assignedEnergy: { speed: null, attack: null, defense: null }, selectedDie: null, log: [...prev.log.slice(-20), `Rolled: ${dice.join(', ')}`] };
    });
  }, []);

  const useWizardReroll = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.classAbilityUsed) return prev;
      const dice = rollDice(3);
      return { ...prev, energyDice: dice, assignedEnergy: { speed: null, attack: null, defense: null }, selectedDie: null, classAbilityUsed: true, log: [...prev.log.slice(-20), `Wizard rerolls: ${dice.join(', ')}`] };
    });
  }, []);

  const usePaladinKeep = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.classAbilityUsed || !prev.prevEnergyDice) return prev;
      return { ...prev, energyDice: prev.prevEnergyDice, assignedEnergy: { speed: null, attack: null, defense: null }, selectedDie: null, classAbilityUsed: true, log: [...prev.log.slice(-20), `Paladin keeps: ${prev.prevEnergyDice.join(', ')}`] };
    });
  }, []);

  const useBarbarianReroll = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.adventurerHealth !== 1 || prev.barbarianRerolled) return prev;
      const dice = rollDice(3);
      return { ...prev, energyDice: dice, assignedEnergy: { speed: null, attack: null, defense: null }, selectedDie: null, barbarianRerolled: true, log: [...prev.log.slice(-20), `Barbarian rage: ${dice.join(', ')}`] };
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
        const newBase = { ...prev.baseStats, range: prev.baseStats.range + dieVal };
        const newDice = [...prev.energyDice]; newDice[dieIdx] = -1;
        return { ...prev, baseStats: newBase, energyDice: newDice, classAbilityUsed: true, selectedDie: null, log: [...prev.log.slice(-20), `Ranger: +${dieVal} Range → ${newBase.range}`] };
      }
      if (prev.assignedEnergy[slot] !== null) return prev;
      const newDice = [...prev.energyDice]; newDice[dieIdx] = -1;
      const newAssigned = { ...prev.assignedEnergy, [slot]: dieVal };
      return {
        ...prev, energyDice: newDice, assignedEnergy: newAssigned,
        selectedDie: null,
        log: [...prev.log.slice(-20), `→ ${slot}: ${dieVal}`],
      };
    });
  }, []);

  // Return an assigned die to the pool (before confirming)
  const unassignDie = useCallback((slot: 'speed' | 'attack' | 'defense') => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'energyAssign') return prev;
      const val = prev.assignedEnergy[slot];
      if (val === null) return prev;
      const newDice = [...prev.energyDice];
      const freeIdx = newDice.indexOf(-1);
      if (freeIdx === -1) return prev;
      newDice[freeIdx] = val;
      return {
        ...prev, energyDice: newDice,
        assignedEnergy: { ...prev.assignedEnergy, [slot]: null },
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
      return {
        ...prev, totalStats: total, phase: 'adventurer' as Phase,
        spentSpeed: 0, spentAttack: 0, selectedDie: null, barbarianRerolled: false,
        log: [...prev.log.slice(-20), `Spd ${total.speed}  Atk ${total.attack}  Def ${total.defense}`],
      };
    });
  }, []);

  const handleTileClick = useCallback((pos: Pos) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer') return prev;
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
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
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
      const def = prev.monsterStats.defense;
      const attackable = getAttackableMonsters(prev.adventurerPos, prev.totalStats.range, prev.totalStats.attack - prev.spentAttack, config, prev.monsters, def);
      if (!attackable.includes(monsterId)) return prev;
      const newMonsters = prev.monsters.map(m => m.id === monsterId ? { ...m, health: m.health - 1 } : m).filter(m => m.health > 0);
      const killed = newMonsters.length < prev.monsters.length;
      const msg = killed ? `Slew a ${prev.monsterStats.type}! (${newMonsters.length} left)` : `Hit ${prev.monsterStats.type} — ${newMonsters.find(m => m.id === monsterId)?.health} HP`;
      if (newMonsters.length === 0) {
        const nextPhase: Phase = prev.level >= 12 ? 'victory' : 'levelEnd';
        return { ...prev, monsters: [], phase: nextPhase, log: [...prev.log.slice(-20), msg, prev.level >= 12 ? "Victory! The Sceptre is yours!" : 'All enemies defeated!'] };
      }
      return { ...prev, monsters: newMonsters, spentAttack: prev.spentAttack + def, log: [...prev.log.slice(-20), msg] };
    });
  }, []);

  const endAdventurerPhase = useCallback(() => {
    setGameState(prev => prev && prev.phase === 'adventurer' ? { ...prev, phase: 'monsterMove', log: [...prev.log.slice(-20), 'Monsters move…'] } : prev);
  }, []);

  // Compute movements and store as arrows — do NOT apply yet
  const computeMonsterMove = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'monsterMove') return prev;
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
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
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
      const { damage, attackingIds } = calcMonsterDamage(prev.monsters, prev.adventurerPos, config, prev.totalStats.defense, prev.monsterStats.attack, prev.monsterStats.range);
      const newHealth = prev.adventurerHealth - damage;
      const msg = attackingIds.length === 0 ? 'No monsters in range — safe!' : `${attackingIds.length} monster(s): ${attackingIds.length * prev.monsterStats.attack} ATK ÷ ${prev.totalStats.defense} DEF = ${damage} dmg`;
      if (newHealth <= 0) return { ...prev, adventurerHealth: 0, phase: 'gameOver', log: [...prev.log.slice(-20), msg, 'You have fallen…'] };
      return { ...prev, adventurerHealth: newHealth, phase: 'energy', prevEnergyDice: [...prev.energyDice], energyDice: [0, 0, 0], assignedEnergy: { speed: null, attack: null, defense: null }, classAbilityUsed: false, log: [...prev.log.slice(-20), msg, '── new turn ──'] };
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
      return { ...buildLevelState(nextLevel, prev.characterClass, newBase, newHealth), log: [...prev.log.slice(-10), msg, `Level ${nextLevel}…`] };
    });
  }, []);

  if (screen === 'title') return <TitleScreen onStart={() => setScreen('classSelect')} />;
  if (screen === 'classSelect') return <ClassSelectScreen selected={characterClass} onSelect={setCharacterClass} onConfirm={() => startGame(characterClass)} />;
  if (!gameState) return null;

  return <GameScreen state={gameState} rollEnergy={rollEnergy} useWizardReroll={useWizardReroll} usePaladinKeep={usePaladinKeep} useBarbarianReroll={useBarbarianReroll} selectDie={selectDie} assignDie={assignDie} unassignDie={unassignDie} confirmEnergy={confirmEnergy} handleTileClick={handleTileClick} handleMonsterClick={handleMonsterClick} endAdventurerPhase={endAdventurerPhase} computeMonsterMove={computeMonsterMove} confirmMonsterMove={confirmMonsterMove} runMonsterAttack={runMonsterAttack} chooseLevelReward={chooseLevelReward} onRestart={() => setScreen('title')} />;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const CLASSES: CharacterClass[] = ['none', 'paladin', 'barbarian', 'ranger', 'wizard'];
const CLASS_ICONS: Record<CharacterClass, string> = { none: '🗡️', paladin: '🛡️', barbarian: '🪓', ranger: '🏹', wizard: '🔮' };
const CLASS_NAMES: Record<CharacterClass, string> = { none: 'Adventurer', paladin: 'Paladin', barbarian: 'Barbarian', ranger: 'Ranger', wizard: 'Wizard' };
const CLASS_IMG: Record<CharacterClass, string> = { none: advImg, paladin: paladinImg, barbarian: barbarianImg, ranger: rangerImg, wizard: wizardImg };
const MONSTER_EMOJI: Record<string, string> = { Spider: '🕷️', Goblin: '👺', Skeleton: '💀', Orc: '👹', Troll: '🧌', Dragon: '🐉', 'Lich King': '☠️' };
// Sprites extracted from the physical card photos
const MONSTER_IMG: Record<string, string> = { Spider: spiderImg, Goblin: goblinImg, Skeleton: skeletonImg, Dragon: dragonImg };
const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const PHASE_LABELS: Record<Phase, string> = {
  classSelect: 'Class', energy: 'Energy', energyAssign: 'Assign',
  adventurer: 'Your Turn', monsterMove: 'Monsters Move',
  monsterMoveAnimate: 'Preview', monsterAttack: 'Monsters Attack',
  levelEnd: 'Level Clear', gameOver: 'Game Over', victory: '🏆 Victory',
};

// ── Title ─────────────────────────────────────────────────────────────────────

function TitleScreen({ onStart }: { onStart: () => void }) {
  const [lb, setLb] = useState<LBEntry[] | null | 'loading'>('loading');
  useEffect(() => { loadLeaderboard().then(setLb); }, []);
  return (
    <div className="screen title-screen">
      <div className="title-content">
        <div className="title-icon">⚔️</div>
        <h1>1 Card Dungeon</h1>
        <p className="subtitle">Solo dungeon crawl · 12 levels</p>
        <button className="btn btn-primary btn-large" onClick={onStart}>Begin Adventure</button>
        <div className="score-list">
          <div className="score-heading">🏆 Tableau des meilleurs héros</div>
          {lb === 'loading' && <div className="score-empty">Chargement…</div>}
          {lb === null && <div className="score-empty">Classement indisponible</div>}
          {Array.isArray(lb) && lb.length === 0 && <div className="score-empty">Aucun score — sois le premier !</div>}
          {Array.isArray(lb) && lb.slice(0, 10).map((e, i) => (
            <div key={i} className={`score-row${e.won ? ' score-won' : ''}`}>
              <span className="score-rank">{i + 1}</span>
              <span className="score-icon">{CLASS_ICONS[e.cls] ?? '🗡️'}</span>
              <span className="score-name">{e.name}</span>
              <span className="score-result">{e.won ? '🏆 Victory' : `Lvl ${e.level}`}</span>
              <span className="score-date">{e.date}</span>
            </div>
          ))}
        </div>
        <p className="credit">Designed by Barny Skinner · Little Rocket Games</p>
        <p className="credit">Web app réalisée par un fan — <a className="credit-link" href="https://boardgamegeek.com/profile/apiiii" target="_blank" rel="noreferrer">mon profil BGG</a> — non affiliée à Little Rocket Games</p>
      </div>
    </div>
  );
}

// ── Class Select ──────────────────────────────────────────────────────────────

function ClassSelectScreen({ selected, onSelect, onConfirm }: { selected: CharacterClass; onSelect: (c: CharacterClass) => void; onConfirm: () => void }) {
  return (
    <div className="screen class-screen">
      <h2>Choose Your Class</h2>
      <div className="class-grid">
        {CLASSES.map(cls => (
          <button key={cls} className={`class-card ${selected === cls ? 'selected' : ''}`} onClick={() => onSelect(cls)}>
            <img className="class-img" src={CLASS_IMG[cls]} alt={CLASS_NAMES[cls]} />
            <span className="class-name">{CLASS_NAMES[cls]}</span>
            <span className="class-desc">{CLASS_DESCRIPTIONS[cls]}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-primary btn-large" onClick={onConfirm}>Enter as {CLASS_NAMES[selected]}</button>
    </div>
  );
}

// ── End Screen (game over / victory) ─────────────────────────────────────────

function EndScreen({ won, level, cls, onRestart }: { won: boolean; level: number; cls: CharacterClass; onRestart: () => void }) {
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
      entry = { name: pseudo, cls, level, won, date: new Date().toLocaleDateString('fr-FR'), ts: Date.now() };
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
        <h2>{won ? 'Victory!' : 'Fallen Hero'}</h2>
        <p>{won ? "The Sceptre of M'Guf-yn is yours!" : `You reached level ${level}.`}</p>
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
        <button className="btn btn-secondary" onClick={onRestart}>{won ? 'Play Again' : 'Try Again'}</button>
      </div>
    </div>
  );
}

// ── Game Screen ───────────────────────────────────────────────────────────────

interface GameScreenProps {
  state: GameState;
  rollEnergy: () => void; useWizardReroll: () => void; usePaladinKeep: () => void; useBarbarianReroll: () => void;
  selectDie: (i: number) => void; assignDie: (slot: 'speed' | 'attack' | 'defense' | 'range') => void;
  unassignDie: (slot: 'speed' | 'attack' | 'defense') => void; confirmEnergy: () => void;
  handleTileClick: (pos: Pos) => void; handleMonsterClick: (id: number) => void;
  endAdventurerPhase: () => void;
  computeMonsterMove: () => void; confirmMonsterMove: () => void;
  runMonsterAttack: () => void;
  chooseLevelReward: (c: 'heal' | 'speed' | 'attack' | 'defense' | 'range') => void;
  onRestart: () => void;
}

function GameScreen(props: GameScreenProps) {
  const { state } = props;
  const def = LEVEL_DEFS[state.level - 1];
  const config = DUNGEON_CONFIGS[def.configIndex];
  const speedLeft = state.totalStats.speed - state.spentSpeed;
  const attackLeft = state.totalStats.attack - state.spentAttack;

  const reachable = state.phase === 'adventurer'
    ? getReachableTiles(state.adventurerPos, speedLeft, config, state.monsters) : new Map<string, number>();
  const attackable = state.phase === 'adventurer'
    ? getAttackableMonsters(state.adventurerPos, state.totalStats.range, attackLeft, config, state.monsters, state.monsterStats.defense) : [];
  const inRangeMonsters = state.phase === 'monsterAttack'
    ? state.monsters.filter(m => rangeDistance(m.pos, state.adventurerPos, config) <= state.monsterStats.range && hasLoS(m.pos, state.adventurerPos, config, state.monsters, [m.id])).map(m => m.id) : [];

  if (state.phase === 'gameOver' || state.phase === 'victory') {
    return <EndScreen won={state.phase === 'victory'} level={state.level} cls={state.characterClass} onRestart={props.onRestart} />;
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
        <span className={`phase-badge phase-${state.phase}`}>{PHASE_LABELS[state.phase]}</span>
        <button className="btn-restart" onClick={props.onRestart}>✕</button>
      </div>

      {/* Adventurer stat bar */}
      <div className="adv-bar">
        <img className="adv-class-img" src={CLASS_IMG[state.characterClass]} alt={CLASS_NAMES[state.characterClass]} />
        <div className="hearts-row">{Array(6).fill(0).map((_, i) => <span key={i} className={i < state.adventurerHealth ? 'heart-full' : 'heart-empty'}>♥</span>)}</div>
        <StatChip label="SPD" base={state.baseStats.speed} energy={state.assignedEnergy.speed} left={state.phase === 'adventurer' ? speedLeft : null} />
        <StatChip label="ATK" base={state.baseStats.attack} energy={state.assignedEnergy.attack} left={state.phase === 'adventurer' ? attackLeft : null} />
        <StatChip label="DEF" base={state.baseStats.defense} energy={state.assignedEnergy.defense} left={null} />
        <StatChip label="RNG" base={state.totalStats.range} energy={null} left={null} />
      </div>

      {/* Card zone: dungeon grid + monster strip, joined with no gap */}
      <div className="card-zone">
        <div className="dungeon-outer">
          <div
            className={`card-bg card-bg-${def.configIndex < 2 ? 'front' : 'back'}${def.configIndex === 1 || def.configIndex === 3 ? ' card-bg-flip' : ''}`}
            style={{ backgroundImage: `url('${import.meta.env.BASE_URL}${def.configIndex < 2 ? 'IMG_2351' : 'IMG_2348'}.jpeg')` }}
          />
          <DungeonGrid config={config} state={state} reachable={reachable} attackable={attackable} inRangeMonsters={inRangeMonsters} onTileClick={props.handleTileClick} onMonsterClick={props.handleMonsterClick} />
          {state.phase === 'monsterMoveAnimate' && state.pendingMovements.length > 0 && (
            <MovementArrows movements={state.pendingMovements} cols={config.cols} rows={config.rows} />
          )}
        </div>
        {/* Monster stats strip — bottom of card photo */}
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
      </div>

      {/* Phase controls */}
      <div className="phase-area">
        <PhaseControls {...props} />
      </div>

      {/* Log */}
      <div className="log-strip">
        {[...state.log].reverse().slice(0, 5).map((entry, i) => (
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

function StatChip({ label, base, energy, left }: { label: string; base: number; energy: number | null; left: number | null }) {
  const total = base + (energy ?? 0);
  return (
    <div className="stat-chip">
      <div className="stat-chip-label">{label}</div>
      <div className="stat-chip-total">{energy !== null ? total : base}</div>
      {energy !== null && <div className="stat-chip-detail">{base}+{energy}</div>}
      {left !== null && <div className="stat-chip-left">{left}←</div>}
    </div>
  );
}


// ── Dungeon Grid ──────────────────────────────────────────────────────────────

function DungeonGrid({ config, state, reachable, attackable, inRangeMonsters, onTileClick, onMonsterClick }: {
  config: DungeonConfig; state: GameState; reachable: Map<string, number>;
  attackable: number[]; inRangeMonsters: number[];
  onTileClick: (pos: Pos) => void; onMonsterClick: (id: number) => void;
}) {
  return (
    <div className="dungeon-grid" style={{ '--cols': config.cols } as React.CSSProperties}>
      {config.grid.map((row, r) =>
        row.map((tile, c) => {
          const key = `${r},${c}`;
          const isAdv = state.adventurerPos.row === r && state.adventurerPos.col === c;
          const monster = state.monsters.find(m => m.pos.row === r && m.pos.col === c);
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
          return (
            <div key={key} className={cls} onClick={() => {
              if (monster && attackable.includes(monster.id)) onMonsterClick(monster.id);
              else if (reachable.has(key)) onTileClick({ row: r, col: c });
            }}>
              {tile === 'stairs' && !isAdv && <span className="tile-icon">🪜</span>}
              {isAdv && <img src={CLASS_IMG[state.characterClass]} className="adv-icon" alt="adventurer" />}
              {monster && (
                <div className="monster-token">
                  {MONSTER_IMG[monster.type]
                    ? <img className="monster-img" src={MONSTER_IMG[monster.type]} alt={monster.type} />
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
        {state.characterClass === 'paladin' && state.prevEnergyDice && !state.classAbilityUsed && (
          <button className="btn btn-class" onClick={props.usePaladinKeep}>🛡️ Keep prev ({state.prevEnergyDice.join(', ')})</button>
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
          {state.characterClass === 'ranger' && !state.classAbilityUsed && state.selectedDie !== null && (
            <button className="btn btn-class" onClick={() => props.assignDie('range')}>🏹+</button>
          )}
        </div>
        {ready && <button className="btn btn-primary btn-large" onClick={props.confirmEnergy}>Valider →</button>}
        {state.characterClass === 'wizard' && !state.classAbilityUsed && (
          <button className="btn btn-class" onClick={props.useWizardReroll}>🔮 Reroll all</button>
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
        <div className="action-hint">
          <span className="hint-move">■ Move</span> 2pts ortho · 3pts diag &nbsp;
          <span className="hint-attack">■ Attack</span> cost {state.monsterStats.defense}
        </div>
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
