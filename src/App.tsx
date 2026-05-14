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
      return {
        ...prev,
        energyDice: dice,
        phase: 'energyAssign' as Phase,
        assignedEnergy: { speed: null, attack: null, defense: null },
        selectedDie: null,
        log: [...prev.log.slice(-20), `Rolled energy: ${dice.join(', ')}`],
      };
    });
  }, []);

  const useWizardReroll = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.classAbilityUsed) return prev;
      const dice = rollDice(3);
      return {
        ...prev,
        energyDice: dice,
        assignedEnergy: { speed: null, attack: null, defense: null },
        selectedDie: null,
        classAbilityUsed: true,
        log: [...prev.log.slice(-20), `Wizard rerolls: ${dice.join(', ')}`],
      };
    });
  }, []);

  const usePaladinKeep = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.classAbilityUsed || !prev.prevEnergyDice) return prev;
      return {
        ...prev,
        energyDice: prev.prevEnergyDice,
        assignedEnergy: { speed: null, attack: null, defense: null },
        selectedDie: null,
        classAbilityUsed: true,
        log: [...prev.log.slice(-20), `Paladin keeps previous dice: ${prev.prevEnergyDice.join(', ')}`],
      };
    });
  }, []);

  const useBarbarianReroll = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.adventurerHealth !== 1 || prev.barbarianRerolled) return prev;
      const dice = rollDice(3);
      return {
        ...prev,
        energyDice: dice,
        assignedEnergy: { speed: null, attack: null, defense: null },
        selectedDie: null,
        barbarianRerolled: true,
        log: [...prev.log.slice(-20), `Barbarian rage: ${dice.join(', ')}`],
      };
    });
  }, []);

  const selectDie = useCallback((idx: number) => {
    setGameState(prev => {
      if (!prev) return prev;
      return { ...prev, selectedDie: prev.selectedDie === idx ? null : idx };
    });
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
        const newDice = [...prev.energyDice];
        newDice[dieIdx] = -1;
        return {
          ...prev,
          baseStats: newBase,
          energyDice: newDice,
          classAbilityUsed: true,
          selectedDie: null,
          log: [...prev.log.slice(-20), `Ranger: +${dieVal} Range → now ${newBase.range}`],
        };
      }

      if (prev.assignedEnergy[slot] !== null) return prev;
      const newAssigned = { ...prev.assignedEnergy, [slot]: dieVal };
      const assignedCount = [newAssigned.speed, newAssigned.attack, newAssigned.defense].filter(v => v !== null).length;
      const activeDice = prev.energyDice.filter(d => d !== -1).length;
      const done = assignedCount >= Math.min(3, activeDice);

      const total = done ? computeTotalStats(prev.baseStats, newAssigned) : prev.totalStats;

      return {
        ...prev,
        assignedEnergy: newAssigned,
        totalStats: total,
        phase: done ? ('adventurer' as Phase) : prev.phase,
        spentSpeed: done ? 0 : prev.spentSpeed,
        spentAttack: done ? 0 : prev.spentAttack,
        selectedDie: null,
        barbarianRerolled: false,
        log: done
          ? [...prev.log.slice(-20), `Energy assigned — Speed ${total.speed}, Attack ${total.attack}, Defense ${total.defense}`]
          : [...prev.log.slice(-20), `Assigned ${dieVal} to ${slot}`],
      };
    });
  }, []);

  const handleTileClick = useCallback((pos: Pos) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer') return prev;
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
      const speedLeft = prev.totalStats.speed - prev.spentSpeed;
      const reachable = getReachableTiles(prev.adventurerPos, speedLeft, config, prev.monsters);
      const key = `${pos.row},${pos.col}`;
      if (!reachable.has(key)) return prev;
      const cost = reachable.get(key)!;
      return {
        ...prev,
        adventurerPos: pos,
        spentSpeed: prev.spentSpeed + cost,
        log: [...prev.log.slice(-20), `Moved to row ${pos.row}, col ${pos.col} (cost ${cost})`],
      };
    });
  }, []);

  const handleMonsterClick = useCallback((monsterId: number) => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer') return prev;
      const config = DUNGEON_CONFIGS[LEVEL_DEFS[prev.level - 1].configIndex];
      const attackLeft = prev.totalStats.attack - prev.spentAttack;
      const def = prev.monsterStats.defense;
      const attackable = getAttackableMonsters(
        prev.adventurerPos, prev.totalStats.range, attackLeft, config, prev.monsters, def
      );
      if (!attackable.includes(monsterId)) return prev;

      const newMonsters = prev.monsters
        .map(m => m.id === monsterId ? { ...m, health: m.health - 1 } : m)
        .filter(m => m.health > 0);

      const killed = newMonsters.length < prev.monsters.length;
      const remaining = newMonsters.length;
      const msg = killed
        ? `Slew a ${prev.monsterStats.type}! (${remaining} remain)`
        : `Hit ${prev.monsterStats.type} — ${newMonsters.find(m => m.id === monsterId)?.health} HP left`;

      if (newMonsters.length === 0) {
        const nextPhase: Phase = prev.level >= 12 ? 'victory' : 'levelEnd';
        const endMsg = prev.level >= 12 ? "Victory! The Sceptre of M'Guf-yn is yours!" : 'All enemies defeated!';
        return { ...prev, monsters: [], phase: nextPhase, log: [...prev.log.slice(-20), msg, endMsg] };
      }

      return {
        ...prev,
        monsters: newMonsters,
        spentAttack: prev.spentAttack + def,
        log: [...prev.log.slice(-20), msg],
      };
    });
  }, []);

  const endAdventurerPhase = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'adventurer') return prev;
      return { ...prev, phase: 'monsterMove', log: [...prev.log.slice(-20), 'Monsters begin to move…'] };
    });
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
      const { damage, attackingIds } = calcMonsterDamage(
        prev.monsters, prev.adventurerPos, config,
        prev.totalStats.defense, prev.monsterStats.attack, prev.monsterStats.range
      );
      const newHealth = prev.adventurerHealth - damage;
      const msgs: string[] = [];
      if (attackingIds.length === 0) {
        msgs.push('No monsters in range — safe!');
      } else {
        const totalAtk = attackingIds.length * prev.monsterStats.attack;
        msgs.push(`${attackingIds.length} monster(s) attack! ${totalAtk} ATK ÷ ${prev.totalStats.defense} DEF = ${damage} damage`);
      }
      if (newHealth <= 0) {
        msgs.push('You have fallen… Game Over!');
        return { ...prev, adventurerHealth: 0, phase: 'gameOver', log: [...prev.log.slice(-20), ...msgs] };
      }
      return {
        ...prev,
        adventurerHealth: newHealth,
        phase: 'energy',
        prevEnergyDice: [...prev.energyDice],
        energyDice: [0, 0, 0],
        assignedEnergy: { speed: null, attack: null, defense: null },
        classAbilityUsed: false,
        log: [...prev.log.slice(-20), ...msgs, '── New Turn ──'],
      };
    });
  }, []);

  const chooseLevelReward = useCallback((choice: 'heal' | 'speed' | 'attack' | 'defense' | 'range') => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'levelEnd') return prev;
      let newHealth = prev.adventurerHealth;
      let newBase = { ...prev.baseStats };
      let msg: string;
      if (choice === 'heal') {
        newHealth = 6;
        msg = 'Healed to full health (6)!';
      } else {
        (newBase as Record<string, number>)[choice] += 1;
        msg = `${choice.charAt(0).toUpperCase() + choice.slice(1)} upgraded to ${(newBase as Record<string, number>)[choice]}!`;
      }
      const nextLevel = prev.level + 1;
      const nextGs = buildLevelState(nextLevel, prev.characterClass, newBase, newHealth);
      return { ...nextGs, log: [...prev.log.slice(-10), msg, `Descending to Level ${nextLevel}…`] };
    });
  }, []);

  if (screen === 'title') return <TitleScreen onStart={() => setScreen('classSelect')} />;
  if (screen === 'classSelect') {
    return (
      <ClassSelectScreen
        selected={characterClass}
        onSelect={setCharacterClass}
        onConfirm={() => startGame(characterClass)}
      />
    );
  }
  if (!gameState) return null;

  return (
    <GameScreen
      state={gameState}
      rollEnergy={rollEnergy}
      useWizardReroll={useWizardReroll}
      usePaladinKeep={usePaladinKeep}
      useBarbarianReroll={useBarbarianReroll}
      selectDie={selectDie}
      assignDie={assignDie}
      handleTileClick={handleTileClick}
      handleMonsterClick={handleMonsterClick}
      endAdventurerPhase={endAdventurerPhase}
      runMonsterMove={runMonsterMove}
      runMonsterAttack={runMonsterAttack}
      chooseLevelReward={chooseLevelReward}
      onRestart={() => setScreen('title')}
    />
  );
}

// ── Title Screen ──────────────────────────────────────────────────────────────

function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen title-screen">
      <div className="title-content">
        <div className="title-icon">⚔️</div>
        <h1>1 Card Dungeon</h1>
        <p className="subtitle">A solo dice-placement dungeon crawl</p>
        <p className="desc">Fight through 12 levels to claim the Sceptre of M'Guf-yn</p>
        <button className="btn btn-primary btn-large" onClick={onStart}>Begin Adventure</button>
        <p className="credit">Based on the game by Barny Skinner · Little Rocket Games</p>
      </div>
    </div>
  );
}

// ── Class Select ──────────────────────────────────────────────────────────────

const CLASSES: CharacterClass[] = ['none', 'paladin', 'barbarian', 'ranger', 'wizard'];
const CLASS_ICONS: Record<CharacterClass, string> = {
  none: '🗡️', paladin: '🛡️', barbarian: '🪓', ranger: '🏹', wizard: '🔮',
};
const CLASS_NAMES: Record<CharacterClass, string> = {
  none: 'Adventurer', paladin: 'Paladin', barbarian: 'Barbarian', ranger: 'Ranger', wizard: 'Wizard',
};

function ClassSelectScreen({ selected, onSelect, onConfirm }: {
  selected: CharacterClass;
  onSelect: (c: CharacterClass) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="screen class-screen">
      <h2>Choose Your Class</h2>
      <div className="class-grid">
        {CLASSES.map(cls => (
          <button
            key={cls}
            className={`class-card ${selected === cls ? 'selected' : ''}`}
            onClick={() => onSelect(cls)}
          >
            <span className="class-icon">{CLASS_ICONS[cls]}</span>
            <span className="class-name">{CLASS_NAMES[cls]}</span>
            <span className="class-desc">{CLASS_DESCRIPTIONS[cls]}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-primary btn-large" onClick={onConfirm}>
        Enter as {CLASS_NAMES[selected]}
      </button>
    </div>
  );
}

// ── Game Screen ───────────────────────────────────────────────────────────────

interface GameScreenProps {
  state: GameState;
  rollEnergy: () => void;
  useWizardReroll: () => void;
  usePaladinKeep: () => void;
  useBarbarianReroll: () => void;
  selectDie: (i: number) => void;
  assignDie: (slot: 'speed' | 'attack' | 'defense' | 'range') => void;
  handleTileClick: (pos: Pos) => void;
  handleMonsterClick: (id: number) => void;
  endAdventurerPhase: () => void;
  runMonsterMove: () => void;
  runMonsterAttack: () => void;
  chooseLevelReward: (c: 'heal' | 'speed' | 'attack' | 'defense' | 'range') => void;
  onRestart: () => void;
}

const PHASE_LABELS: Record<Phase, string> = {
  classSelect: 'Choose Class',
  energy: 'Energy Phase',
  energyAssign: 'Assign Energy',
  adventurer: 'Your Turn',
  monsterMove: 'Monsters Move',
  monsterAttack: 'Monsters Attack',
  levelEnd: 'Level Complete',
  gameOver: 'Game Over',
  victory: 'Victory!',
};

const MONSTER_EMOJI: Record<string, string> = {
  Spider: '🕷️', Goblin: '👺', Skeleton: '💀', Orc: '👹',
  Troll: '🧌', Dragon: '🐉', 'Lich King': '☠️',
};

const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function GameScreen(props: GameScreenProps) {
  const { state } = props;
  const def = LEVEL_DEFS[state.level - 1];
  const config = DUNGEON_CONFIGS[def.configIndex];
  const speedLeft = state.totalStats.speed - state.spentSpeed;
  const attackLeft = state.totalStats.attack - state.spentAttack;

  const reachable = state.phase === 'adventurer'
    ? getReachableTiles(state.adventurerPos, speedLeft, config, state.monsters)
    : new Map<string, number>();

  const attackable = state.phase === 'adventurer'
    ? getAttackableMonsters(state.adventurerPos, state.totalStats.range, attackLeft, config, state.monsters, state.monsterStats.defense)
    : [];

  const inRangeMonsters = state.phase === 'monsterAttack'
    ? state.monsters.filter(m => {
      const r = rangeDistance(m.pos, state.adventurerPos, config);
      return r <= state.monsterStats.range && hasLoS(m.pos, state.adventurerPos, config, state.monsters, [m.id]);
    }).map(m => m.id)
    : [];

  if (state.phase === 'gameOver') {
    return (
      <div className="screen end-screen">
        <div className="end-content">
          <div className="end-icon">💀</div>
          <h2>Fallen Hero</h2>
          <p>You reached level {state.level} before meeting your end.</p>
          <button className="btn btn-primary" onClick={props.onRestart}>Try Again</button>
        </div>
      </div>
    );
  }

  if (state.phase === 'victory') {
    return (
      <div className="screen end-screen victory">
        <div className="end-content">
          <div className="end-icon">🏆</div>
          <h2>Victory!</h2>
          <p>You claimed the Sceptre of M'Guf-yn!</p>
          <button className="btn btn-primary" onClick={props.onRestart}>Play Again</button>
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
          <p>Choose your reward before descending to level {state.level + 1}:</p>
          <div className="reward-grid">
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('heal')}>❤️ Heal to full</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('speed')}>👟 Speed +1 (→ {state.baseStats.speed + 1})</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('attack')}>⚔️ Attack +1 (→ {state.baseStats.attack + 1})</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('defense')}>🛡️ Defense +1 (→ {state.baseStats.defense + 1})</button>
            <button className="btn btn-reward" onClick={() => props.chooseLevelReward('range')}>🏹 Range +1 (→ {state.baseStats.range + 1})</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game-layout">
      <div className="game-header">
        <span className="level-badge">Level {state.level} / 12</span>
        <span className="monster-type">{def.monsterStats.type}</span>
        <span className={`phase-badge phase-${state.phase}`}>{PHASE_LABELS[state.phase]}</span>
      </div>

      <div className="game-main">
        <div className="panel stats-panel">
          <StatsPanel state={state} speedLeft={speedLeft} attackLeft={attackLeft} />
          <MonsterInfoPanel state={state} inRangeIds={inRangeMonsters} />
        </div>

        <div className="panel dungeon-panel">
          <DungeonGrid
            config={config}
            state={state}
            reachable={reachable}
            attackable={attackable}
            inRangeMonsters={inRangeMonsters}
            onTileClick={props.handleTileClick}
            onMonsterClick={props.handleMonsterClick}
          />
        </div>

        <div className="panel controls-panel">
          <PhaseControls {...props} />
          <GameLog log={state.log} />
        </div>
      </div>
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
    <div className="dungeon-grid" style={{ gridTemplateColumns: `repeat(${config.cols}, 1fr)` }}>
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
            <div
              key={key}
              className={cls}
              onClick={() => {
                if (monster && attackable.includes(monster.id)) onMonsterClick(monster.id);
                else if (isReachable) onTileClick({ row: r, col: c });
              }}
            >
              {tile === 'stairs' && !isAdv && <span className="tile-icon">🪜</span>}
              {isAdv && <span className="tile-icon adv-icon">🧙</span>}
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

// ── Stats Panel ───────────────────────────────────────────────────────────────

function StatsPanel({ state, speedLeft, attackLeft }: { state: GameState; speedLeft: number; attackLeft: number }) {
  const showTotal = ['adventurer', 'monsterMove', 'monsterAttack'].includes(state.phase);
  const hearts = Array(6).fill(null).map((_, i) => i < state.adventurerHealth ? '❤️' : '🖤').join('');
  return (
    <div className="stats-box">
      <h3>{CLASS_ICONS[state.characterClass]} {CLASS_NAMES[state.characterClass]}</h3>
      <div className="hearts">{hearts}</div>
      <div className="stat-row">
        <span>Speed</span>
        <span>{state.baseStats.speed} + {state.assignedEnergy.speed ?? '?'} {showTotal ? `= ${state.totalStats.speed} (${speedLeft} left)` : ''}</span>
      </div>
      <div className="stat-row">
        <span>Attack</span>
        <span>{state.baseStats.attack} + {state.assignedEnergy.attack ?? '?'} {showTotal ? `= ${state.totalStats.attack} (${attackLeft} left)` : ''}</span>
      </div>
      <div className="stat-row">
        <span>Defense</span>
        <span>{state.baseStats.defense} + {state.assignedEnergy.defense ?? '?'} {showTotal ? `= ${state.totalStats.defense}` : ''}</span>
      </div>
      <div className="stat-row">
        <span>Range</span>
        <span>{state.totalStats.range}</span>
      </div>
    </div>
  );
}

function MonsterInfoPanel({ state, inRangeIds }: { state: GameState; inRangeIds: number[] }) {
  const ms = state.monsterStats;
  return (
    <div className="monster-info-box">
      <h3>{MONSTER_EMOJI[ms.type] ?? '👾'} {ms.type}</h3>
      <div className="stat-row"><span>HP</span><b>{ms.health}</b></div>
      <div className="stat-row"><span>Speed</span><b>{ms.speed}</b></div>
      <div className="stat-row"><span>Attack</span><b>{ms.attack}</b></div>
      <div className="stat-row"><span>Defense</span><b>{ms.defense}</b></div>
      <div className="stat-row"><span>Range</span><b>{ms.range}</b></div>
      <div className="alive-count">Alive: {state.monsters.length} / {ms.count}</div>
      {state.monsters.map(m => (
        <div key={m.id} className={`monster-status ${inRangeIds.includes(m.id) ? 'in-range' : ''}`}>
          {MONSTER_EMOJI[m.type] ?? '👾'} #{m.id} — {m.health}/{m.maxHealth} HP
          {inRangeIds.includes(m.id) ? ' ⚠️' : ''}
        </div>
      ))}
    </div>
  );
}

// ── Phase Controls ────────────────────────────────────────────────────────────

function PhaseControls(props: GameScreenProps) {
  const { state } = props;

  if (state.phase === 'energy') {
    return (
      <div className="controls-box">
        <h3>Energy Phase</h3>
        <p>Roll 3 energy dice and assign them to Speed, Attack, and Defense.</p>
        <button className="btn btn-primary" onClick={props.rollEnergy}>Roll Energy Dice</button>
        {state.characterClass === 'paladin' && state.prevEnergyDice && !state.classAbilityUsed && (
          <button className="btn btn-class" onClick={props.usePaladinKeep}>
            🛡️ Keep prev. dice ({state.prevEnergyDice.join(', ')})
          </button>
        )}
      </div>
    );
  }

  if (state.phase === 'energyAssign') {
    const { assignedEnergy: ae, energyDice: dice, characterClass: cls, classAbilityUsed } = state;
    return (
      <div className="controls-box">
        <h3>Assign Energy</h3>
        <div className="dice-row">
          {dice.map((d, i) =>
            d === -1
              ? <div key={i} className="die die-used">✓</div>
              : <button key={i} className={`die ${state.selectedDie === i ? 'die-selected' : ''}`} onClick={() => props.selectDie(i)}>{DIE_FACES[d]}</button>
          )}
        </div>
        {state.selectedDie !== null && state.energyDice[state.selectedDie] !== -1 && (
          <div className="assign-slots">
            <p>Assign {DIE_FACES[state.energyDice[state.selectedDie]]} to:</p>
            <button className="btn btn-slot" disabled={ae.speed !== null} onClick={() => props.assignDie('speed')}>👟 Speed {ae.speed !== null ? `✓ (${ae.speed})` : ''}</button>
            <button className="btn btn-slot" disabled={ae.attack !== null} onClick={() => props.assignDie('attack')}>⚔️ Attack {ae.attack !== null ? `✓ (${ae.attack})` : ''}</button>
            <button className="btn btn-slot" disabled={ae.defense !== null} onClick={() => props.assignDie('defense')}>🛡️ Defense {ae.defense !== null ? `✓ (${ae.defense})` : ''}</button>
            {cls === 'ranger' && !classAbilityUsed && (
              <button className="btn btn-class" onClick={() => props.assignDie('range')}>🏹 Ranger: +Range</button>
            )}
          </div>
        )}
        {cls === 'wizard' && !classAbilityUsed && (
          <button className="btn btn-class" onClick={props.useWizardReroll}>🔮 Wizard: Reroll All</button>
        )}
        {cls === 'barbarian' && state.adventurerHealth === 1 && !state.barbarianRerolled && (
          <button className="btn btn-class btn-danger" onClick={props.useBarbarianReroll}>🪓 Barbarian Rage!</button>
        )}
        <div className="assigned-preview">
          <span>Spd: {ae.speed ?? '—'}</span>
          <span>Atk: {ae.attack ?? '—'}</span>
          <span>Def: {ae.defense ?? '—'}</span>
        </div>
      </div>
    );
  }

  if (state.phase === 'adventurer') {
    return (
      <div className="controls-box">
        <h3>Your Turn</h3>
        <p>Click <span className="highlight-move">blue tiles</span> to move, <span className="highlight-attack">red tiles</span> to attack.</p>
        <div className="turn-stats">
          <div>Speed: <b>{state.totalStats.speed - state.spentSpeed}</b> left</div>
          <div>Attack: <b>{state.totalStats.attack - state.spentAttack}</b> left</div>
        </div>
        <p className="hint">Move: 2pts ortho / 3pts diag<br />Attack cost: {state.monsterStats.defense} pts per hit</p>
        <button className="btn btn-secondary" onClick={props.endAdventurerPhase}>End Turn →</button>
      </div>
    );
  }

  if (state.phase === 'monsterMove') {
    return (
      <div className="controls-box">
        <h3>Monster Movement</h3>
        <p>Each monster moves toward max range with line of sight.</p>
        <button className="btn btn-warning" onClick={props.runMonsterMove}>Resolve →</button>
      </div>
    );
  }

  if (state.phase === 'monsterAttack') {
    return (
      <div className="controls-box">
        <h3>Monster Attack</h3>
        <p>Monsters in range deal damage (total ATK ÷ your DEF).</p>
        <button className="btn btn-danger" onClick={props.runMonsterAttack}>Resolve →</button>
      </div>
    );
  }

  return null;
}

// ── Game Log ──────────────────────────────────────────────────────────────────

function GameLog({ log }: { log: string[] }) {
  return (
    <div className="log-box">
      <h3>Log</h3>
      <div className="log-entries">
        {[...log].reverse().map((entry, i) => (
          <div key={i} className={`log-entry ${entry.startsWith('──') ? 'log-divider' : ''}`}>{entry}</div>
        ))}
      </div>
    </div>
  );
}
