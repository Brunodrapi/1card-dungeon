import { useState, useCallback } from 'react';
import type { GameState, Phase, CharacterClass, Pos, BaseStats, DungeonConfig } from './types';
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

const INITIAL_STATS: BaseStats = { speed: 1, attack: 1, defense: 1, range: 2 };

function buildLevelState(level: number, characterClass: CharacterClass, baseStats: BaseStats, health: number): GameState {
  const def = LEVEL_DEFS[level - 1];
  const config = DUNGEON_CONFIGS[def.configIndex];
  const monsters = def.monsterStartPositions.map((pos, idx) => ({
    id: idx + 1,
    pos: { ...pos },
    health: def.monsterStats.health,
    maxHealth: def.monsterStats.health,
    type: def.monsterStats.type,
  }));
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
    monsters,
    monsterStats: def.monsterStats,
    characterClass,
    classAbilityUsed: false,
    barbarianRerolled: false,
    prevEnergyDice: null,
    log: [`Level ${level}: ${def.monsterStats.type}s appear!`],
    selectedDie: null,
    pendingMoves: [],
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
      const newAssigned = { ...prev.assignedEnergy, [slot]: dieVal };
      const count = [newAssigned.speed, newAssigned.attack, newAssigned.defense].filter(v => v !== null).length;
      const active = prev.energyDice.filter(d => d !== -1).length;
      const done = count >= Math.min(3, active);
      const total = done ? computeTotalStats(prev.baseStats, newAssigned) : prev.totalStats;
      return {
        ...prev, assignedEnergy: newAssigned, totalStats: total,
        phase: done ? ('adventurer' as Phase) : prev.phase,
        spentSpeed: done ? 0 : prev.spentSpeed,
        spentAttack: done ? 0 : prev.spentAttack,
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

  const runMonsterMove = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'monsterMove') return prev;
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
      const moved = moveMonsters(prev.monsters, prev.adventurerPos, config, prev.monsterStats.speed, prev.monsterStats.range);
      return { ...prev, monsters: moved, phase: 'monsterAttack', log: [...prev.log.slice(-20), 'Monsters repositioned.'] };
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

  return <GameScreen state={gameState} rollEnergy={rollEnergy} useWizardReroll={useWizardReroll} usePaladinKeep={usePaladinKeep} useBarbarianReroll={useBarbarianReroll} selectDie={selectDie} assignDie={assignDie} handleTileClick={handleTileClick} handleMonsterClick={handleMonsterClick} endAdventurerPhase={endAdventurerPhase} runMonsterMove={runMonsterMove} runMonsterAttack={runMonsterAttack} chooseLevelReward={chooseLevelReward} onRestart={() => setScreen('title')} />;
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
  monsterAttack: 'Monsters Attack', levelEnd: 'Level Clear', gameOver: 'Game Over', victory: '🏆 Victory',
};

// ── Title ─────────────────────────────────────────────────────────────────────

function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen title-screen">
      <div className="title-content">
        <div className="title-icon">⚔️</div>
        <h1>1 Card Dungeon</h1>
        <p className="subtitle">Solo dungeon crawl · 12 levels</p>
        <button className="btn btn-primary btn-large" onClick={onStart}>Begin Adventure</button>
        <p className="credit">Designed by Barny Skinner · Little Rocket Games</p>
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

// ── Game Screen ───────────────────────────────────────────────────────────────

interface GameScreenProps {
  state: GameState;
  rollEnergy: () => void; useWizardReroll: () => void; usePaladinKeep: () => void; useBarbarianReroll: () => void;
  selectDie: (i: number) => void; assignDie: (slot: 'speed' | 'attack' | 'defense' | 'range') => void;
  handleTileClick: (pos: Pos) => void; handleMonsterClick: (id: number) => void;
  endAdventurerPhase: () => void; runMonsterMove: () => void; runMonsterAttack: () => void;
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

  if (state.phase === 'gameOver') {
    return <div className="screen end-screen"><div className="end-content"><div className="end-icon">💀</div><h2>Fallen Hero</h2><p>You reached level {state.level}.</p><button className="btn btn-primary" onClick={props.onRestart}>Try Again</button></div></div>;
  }
  if (state.phase === 'victory') {
    return <div className="screen end-screen victory"><div className="end-content"><div className="end-icon">🏆</div><h2>Victory!</h2><p>The Sceptre of M'Guf-yn is yours!</p><button className="btn btn-primary" onClick={props.onRestart}>Play Again</button></div></div>;
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
      {/* ── Header ── */}
      <div className="game-header">
        <span className="level-badge">Lvl {state.level}/12</span>
        <span className={`phase-badge phase-${state.phase}`}>{PHASE_LABELS[state.phase]}</span>
        <button className="btn-restart" onClick={props.onRestart} title="Restart">✕</button>
      </div>

      {/* ── Adventurer stat bar (top of card) ── */}
      <div className="adv-bar">
        <div className="adv-class">{CLASS_ICONS[state.characterClass]}</div>
        <div className="hearts-row">{Array(6).fill(0).map((_, i) => <span key={i} className={i < state.adventurerHealth ? 'heart-full' : 'heart-empty'}>♥</span>)}</div>
        <StatChip icon="👟" label="SPD" base={state.baseStats.speed} energy={state.assignedEnergy.speed} left={state.phase === 'adventurer' ? speedLeft : null} />
        <StatChip icon="⚔️" label="ATK" base={state.baseStats.attack} energy={state.assignedEnergy.attack} left={state.phase === 'adventurer' ? attackLeft : null} />
        <StatChip icon="🛡️" label="DEF" base={state.baseStats.defense} energy={state.assignedEnergy.defense} left={null} />
        <StatChip icon="🏹" label="RNG" base={state.totalStats.range} energy={null} left={null} />
      </div>

      {/* ── Dungeon grid (center of card) ── */}
      <div className="dungeon-wrapper">
        <DungeonGrid config={config} state={state} reachable={reachable} attackable={attackable} inRangeMonsters={inRangeMonsters} onTileClick={props.handleTileClick} onMonsterClick={props.handleMonsterClick} />
      </div>

      {/* ── Monster bar (bottom of card) ── */}
      <div className="monster-bar">
        <div className="monster-bar-icon">{MONSTER_EMOJI[def.monsterStats.type] ?? '👾'}</div>
        <div className="monster-bar-name">{def.monsterStats.type}</div>
        <MonsterChip label="HP" value={def.monsterStats.health} />
        <MonsterChip label="SPD" value={def.monsterStats.speed} />
        <MonsterChip label="ATK" value={def.monsterStats.attack} />
        <MonsterChip label="DEF" value={def.monsterStats.defense} />
        <MonsterChip label="RNG" value={def.monsterStats.range} />
        <div className="monster-alive">{state.monsters.map(m => <span key={m.id} className={inRangeMonsters.includes(m.id) ? 'alive-dot dot-danger' : 'alive-dot'}>{m.health}</span>)}</div>
      </div>

      {/* ── Phase controls ── */}
      <div className="phase-area">
        <PhaseControls {...props} />
      </div>

      {/* ── Log ── */}
      <div className="log-strip">
        {[...state.log].reverse().slice(0, 5).map((entry, i) => (
          <span key={i} className={`log-item ${entry.startsWith('──') ? 'log-sep' : ''}`}>{entry}</span>
        ))}
      </div>
    </div>
  );
}

// ── Stat chip (top bar) ───────────────────────────────────────────────────────

function StatChip({ label, base, energy, left }: { icon?: string; label: string; base: number; energy: number | null; left: number | null }) {
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

// ── Monster stat chip (bottom bar) ───────────────────────────────────────────

function MonsterChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="monster-chip">
      <div className="monster-chip-val">{value}</div>
      <div className="monster-chip-label">{label}</div>
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
          const isReachable = reachable.has(key);
          const isAttackable = monster ? attackable.includes(monster.id) : false;
          const isInRange = monster ? inRangeMonsters.includes(monster.id) : false;
          let cls = `tile tile-${tile}`;
          if (isReachable) cls += ' tile-reachable';
          if (isAttackable) cls += ' tile-attackable';
          if (isInRange) cls += ' tile-in-range';
          return (
            <div key={key} className={cls} onClick={() => {
              if (monster && attackable.includes(monster.id)) onMonsterClick(monster.id);
              else if (isReachable) onTileClick({ row: r, col: c });
            }}>
              {tile === 'stairs' && !isAdv && <span className="tile-icon">🪜</span>}
              {isAdv && <span className="adv-icon">🧙</span>}
              {monster && (
                <div className="monster-token">
                  <span>{MONSTER_EMOJI[monster.type] ?? '👾'}</span>
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
            <button className="btn btn-slot" disabled={ae.speed !== null} onClick={() => props.assignDie('speed')}>👟{ae.speed !== null ? ` ✓` : ''}</button>
            <button className="btn btn-slot" disabled={ae.attack !== null} onClick={() => props.assignDie('attack')}>⚔️{ae.attack !== null ? ` ✓` : ''}</button>
            <button className="btn btn-slot" disabled={ae.defense !== null} onClick={() => props.assignDie('defense')}>🛡️{ae.defense !== null ? ` ✓` : ''}</button>
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
          <span className="hint-move">■ Move</span> 2pts ortho · 3pts diag
          &nbsp;&nbsp;
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
        <button className="btn btn-warning btn-large" onClick={props.runMonsterMove}>Resolve Movement →</button>
      </div>
    );
  }

  if (state.phase === 'monsterAttack') {
    return (
      <div className="controls-inner">
        <p className="phase-desc">Monsters in range attack (total ATK ÷ your DEF).</p>
        <button className="btn btn-danger btn-large" onClick={props.runMonsterAttack}>Resolve Attack →</button>
      </div>
    );
  }

  return null;
}
