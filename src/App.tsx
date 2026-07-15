import { useState, useCallback } from 'react';
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
import heroImg from './assets/869D39DA-CA85-45E0-91D4-B498B377CBB3.png';

// ── Score persistence ─────────────────────────────────────────────────────────
interface GameRecord { date: string; cls: CharacterClass; level: number; won: boolean; name?: string; }
const SCORES_KEY = '1cd-scores';
const NAME_KEY = '1cd-name';
function loadScores(): GameRecord[] {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY) ?? '[]'); } catch { return []; }
}
function saveRecord(r: GameRecord) {
  const list = loadScores(); list.unshift(r);
  localStorage.setItem(SCORES_KEY, JSON.stringify(list.slice(0, 20)));
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
      const count = [newAssigned.speed, newAssigned.attack, newAssigned.defense].filter(v => v !== null).length;
      const active = newDice.filter(d => d !== -1).length;
      const done = count >= 3 || active === 0;
      const total = done ? computeTotalStats(prev.baseStats, newAssigned) : prev.totalStats;
      return {
        ...prev, energyDice: newDice, assignedEnergy: newAssigned, totalStats: total,
        phase: done ? ('adventurer' as Phase) : prev.phase,
        spentSpeed: done ? 0 : prev.spentSpeed, spentAttack: done ? 0 : prev.spentAttack,
        selectedDie: null, barbarianRerolled: false,
        log: done ? [...prev.log.slice(-20), `Spd ${total.speed}  Atk ${total.attack}  Def ${total.defense}`] : [...prev.log.slice(-20), `→ ${slot}: ${dieVal}`],
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

  return <GameScreen state={gameState} rollEnergy={rollEnergy} useWizardReroll={useWizardReroll} usePaladinKeep={usePaladinKeep} useBarbarianReroll={useBarbarianReroll} selectDie={selectDie} assignDie={assignDie} handleTileClick={handleTileClick} handleMonsterClick={handleMonsterClick} endAdventurerPhase={endAdventurerPhase} computeMonsterMove={computeMonsterMove} confirmMonsterMove={confirmMonsterMove} runMonsterAttack={runMonsterAttack} chooseLevelReward={chooseLevelReward} onRestart={() => setScreen('title')} />;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const CLASSES: CharacterClass[] = ['none', 'paladin', 'barbarian', 'ranger', 'wizard'];
const CLASS_ICONS: Record<CharacterClass, string> = { none: '🗡️', paladin: '🛡️', barbarian: '🪓', ranger: '🏹', wizard: '🔮' };
const CLASS_NAMES: Record<CharacterClass, string> = { none: 'Adventurer', paladin: 'Paladin', barbarian: 'Barbarian', ranger: 'Ranger', wizard: 'Wizard' };
const MONSTER_EMOJI: Record<string, string> = { Spider: '🕷️', Goblin: '👺', Skeleton: '💀', Orc: '👹', Troll: '🧌', Dragon: '🐉', 'Lich King': '☠️' };
const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const PHASE_LABELS: Record<Phase, string> = {
  classSelect: 'Class', energy: 'Energy', energyAssign: 'Assign',
  adventurer: 'Your Turn', monsterMove: 'Monsters Move',
  monsterMoveAnimate: 'Preview', monsterAttack: 'Monsters Attack',
  levelEnd: 'Level Clear', gameOver: 'Game Over', victory: '🏆 Victory',
};

// ── Title ─────────────────────────────────────────────────────────────────────

function TitleScreen({ onStart }: { onStart: () => void }) {
  const scores = loadScores().slice(0, 5);
  return (
    <div className="screen title-screen">
      <div className="title-content">
        <div className="title-icon">⚔️</div>
        <h1>1 Card Dungeon</h1>
        <p className="subtitle">Solo dungeon crawl · 12 levels</p>
        <button className="btn btn-primary btn-large" onClick={onStart}>Begin Adventure</button>
        {scores.length > 0 && (
          <div className="score-list">
            <div className="score-heading">Recent runs</div>
            {scores.map((r, i) => (
              <div key={i} className={`score-row${r.won ? ' score-won' : ''}`}>
                <span className="score-icon">{CLASS_ICONS[r.cls]}</span>
                <span className="score-name">{r.name ?? CLASS_NAMES[r.cls]}</span>
                <span className="score-result">{r.won ? '🏆 Victory' : `Lvl ${r.level}`}</span>
                <span className="score-date">{new Date(r.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
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
            <span className="class-icon">{CLASS_ICONS[cls]}</span>
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
  const [saved, setSaved] = useState(false);

  const save = () => {
    const pseudo = name.trim();
    if (!pseudo || saved) return;
    localStorage.setItem(NAME_KEY, pseudo);
    saveRecord({ date: new Date().toISOString(), cls, level, won, name: pseudo });
    setSaved(true);
  };

  return (
    <div className={`screen end-screen${won ? ' victory' : ''}`}>
      <div className="end-content">
        <div className="end-icon">{won ? '🏆' : '💀'}</div>
        <h2>{won ? 'Victory!' : 'Fallen Hero'}</h2>
        <p>{won ? "The Sceptre of M'Guf-yn is yours!" : `You reached level ${level}.`}</p>
        {saved ? (
          <p className="save-confirm">✓ Score enregistré — {name.trim()}</p>
        ) : (
          <div className="name-entry">
            <input
              className="name-input"
              type="text"
              maxLength={16}
              placeholder="Ton pseudo"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
            />
            <button className="btn btn-primary" disabled={!name.trim()} onClick={save}>Enregistrer</button>
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
        <div className="adv-class">{CLASS_ICONS[state.characterClass]}</div>
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
              {isAdv && <img src={heroImg} className="adv-icon" alt="adventurer" />}
              {monster && (
                <div className="monster-token">
                  <span className="monster-emoji">{MONSTER_EMOJI[monster.type] ?? '👾'}</span>
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
    return (
      <div className="controls-inner">
        <div className="dice-row">
          {state.energyDice.map((d, i) =>
            d === -1
              ? <div key={i} className="die die-used">✓</div>
              : <button key={i} className={`die ${state.selectedDie === i ? 'die-selected' : ''}`} onClick={() => props.selectDie(i)}>{DIE_FACES[d]}</button>
          )}
        </div>
        {state.selectedDie !== null && state.energyDice[state.selectedDie] !== -1 && (
          <div className="assign-row">
            <button className="btn btn-slot" disabled={ae.speed !== null} onClick={() => props.assignDie('speed')}>👟 SPD{ae.speed !== null ? ' ✓' : ''}</button>
            <button className="btn btn-slot" disabled={ae.attack !== null} onClick={() => props.assignDie('attack')}>⚔️ ATK{ae.attack !== null ? ' ✓' : ''}</button>
            <button className="btn btn-slot" disabled={ae.defense !== null} onClick={() => props.assignDie('defense')}>🛡️ DEF{ae.defense !== null ? ' ✓' : ''}</button>
            {state.characterClass === 'ranger' && !state.classAbilityUsed && (
              <button className="btn btn-class" onClick={() => props.assignDie('range')}>🏹+</button>
            )}
          </div>
        )}
        <div className="assign-preview">
          <span className={ae.speed !== null ? 'assigned' : ''}>Spd {ae.speed ?? '?'}</span>
          <span className={ae.attack !== null ? 'assigned' : ''}>Atk {ae.attack ?? '?'}</span>
          <span className={ae.defense !== null ? 'assigned' : ''}>Def {ae.defense ?? '?'}</span>
        </div>
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
