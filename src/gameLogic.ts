import type { Pos, Monster, DungeonConfig, BaseStats } from './types';

export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function rollDice(count: number): number[] {
  return Array.from({ length: count }, rollDie);
}

// Movement cost between two adjacent tiles
export function moveCost(a: Pos, b: Pos): number {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  if (dr === 1 && dc === 0) return 2;
  if (dr === 0 && dc === 1) return 2;
  if (dr === 1 && dc === 1) return 3;
  return Infinity;
}

// BFS shortest movement-point distance between two tiles (ignoring monsters/walls for range calc)
export function rangeDistance(from: Pos, to: Pos, config: DungeonConfig, blockWalls = true): number {
  const { grid, rows, cols } = config;
  const dist = Array.from({ length: rows }, () => Array(cols).fill(Infinity));
  dist[from.row][from.col] = 0;
  const queue: Array<{ pos: Pos; cost: number }> = [{ pos: from, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { pos, cost } = queue.shift()!;
    if (pos.row === to.row && pos.col === to.col) return cost;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = pos.row + dr;
        const nc = pos.col + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (blockWalls && grid[nr][nc] === 'wall') continue;
        const c = cost + moveCost(pos, { row: nr, col: nc });
        if (c < dist[nr][nc]) {
          dist[nr][nc] = c;
          queue.push({ pos: { row: nr, col: nc }, cost: c });
        }
      }
    }
  }
  return dist[to.row][to.col];
}

// Check line of sight: draw line from any corner of `from` to any corner of `to`
// LoS is blocked by wall tiles and (optionally) monster tiles
export function hasLoS(
  from: Pos,
  to: Pos,
  config: DungeonConfig,
  monsters: Monster[],
  ignoreMonsterIds: number[] = []
): boolean {
  const { grid, rows, cols } = config;

  const blockedTiles = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 'wall') blockedTiles.add(`${r},${c}`);
    }
  }
  for (const m of monsters) {
    if (!ignoreMonsterIds.includes(m.id) && (m.pos.row !== to.row || m.pos.col !== to.col)) {
      blockedTiles.add(`${m.pos.row},${m.pos.col}`);
    }
  }

  // Try all 4 corner pairs
  const corners = [
    [0, 0], [0, 1], [1, 0], [1, 1],
  ];

  for (const [fr, fc] of corners) {
    for (const [tr, tc] of corners) {
      const x1 = from.col + fc;
      const y1 = from.row + fr;
      const x2 = to.col + tc;
      const y2 = to.row + tr;

      if (linePassesClear(x1, y1, x2, y2, blockedTiles, from, to)) return true;
    }
  }
  return false;
}

function linePassesClear(
  x1: number, y1: number, x2: number, y2: number,
  blockedTiles: Set<string>,
  from: Pos, to: Pos
): boolean {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 10;
  if (steps === 0) return true;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);

    // Check the tile this point is in
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (row === from.row && col === from.col) continue;
    if (row === to.row && col === to.col) continue;
    if (blockedTiles.has(`${row},${col}`)) return false;

    // Also check adjacent tiles when near corners
    if (Math.abs(x - Math.round(x)) < 0.01 && Math.abs(y - Math.round(y)) < 0.01) {
      // near a corner, check all 4 surrounding tiles
      const r2 = Math.round(y);
      const c2 = Math.round(x);
      for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
        const rr = r2 + dr;
        const cc = c2 + dc;
        if (rr === from.row && cc === from.col) continue;
        if (rr === to.row && cc === to.col) continue;
        if (blockedTiles.has(`${rr},${cc}`)) return false;
      }
    }
  }
  return true;
}

// Get reachable tiles for the adventurer given remaining speed points
export function getReachableTiles(
  from: Pos,
  speedLeft: number,
  config: DungeonConfig,
  monsters: Monster[]
): Map<string, number> {
  const { grid, rows, cols } = config;
  const monsterPosSet = new Set(monsters.map(m => `${m.pos.row},${m.pos.col}`));
  const dist = new Map<string, number>();
  dist.set(`${from.row},${from.col}`, 0);
  const queue: Array<{ pos: Pos; cost: number }> = [{ pos: from, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { pos, cost } = queue.shift()!;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = pos.row + dr;
        const nc = pos.col + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === 'wall') continue;
        if (monsterPosSet.has(`${nr},${nc}`)) continue;
        const c = cost + moveCost(pos, { row: nr, col: nc });
        const key = `${nr},${nc}`;
        if (c <= speedLeft && (!dist.has(key) || dist.get(key)! > c)) {
          dist.set(key, c);
          queue.push({ pos: { row: nr, col: nc }, cost: c });
        }
      }
    }
  }

  dist.delete(`${from.row},${from.col}`);
  return dist;
}

// Get monsters attackable from adventurer position
export function getAttackableMonsters(
  advPos: Pos,
  range: number,
  attackLeft: number,
  config: DungeonConfig,
  monsters: Monster[],
  monsterDefense: number
): number[] {
  if (attackLeft < monsterDefense) return [];
  return monsters
    .filter(m => {
      const r = rangeDistance(advPos, m.pos, config);
      return r <= range && hasLoS(advPos, m.pos, config, monsters, [m.id]);
    })
    .map(m => m.id);
}

// Monster AI: move each monster optimally
export function moveMonsters(
  monsters: Monster[],
  advPos: Pos,
  config: DungeonConfig,
  monsterSpeed: number,
  monsterRange: number
): Monster[] {
  const { grid, rows, cols } = config;
  const updated = monsters.map(m => ({ ...m }));

  // Sort by closest to adventurer first
  updated.sort((a, b) => {
    const da = Math.abs(a.pos.row - advPos.row) + Math.abs(a.pos.col - advPos.col);
    const db = Math.abs(b.pos.row - advPos.row) + Math.abs(b.pos.col - advPos.col);
    return da - db;
  });

  for (let i = 0; i < updated.length; i++) {
    const monster = updated[i];
    const othersAtEnd = updated.map((m, idx) => idx !== i ? m.pos : null).filter(Boolean) as Pos[];

    // Find best target tile: empty, at monster's range from adv, with LoS, closest to monster
    let bestPos: Pos | null = null;
    let bestScore = Infinity;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 'wall') continue;
        const candidate = { row: r, col: c };
        if (othersAtEnd.some(p => p.row === r && p.col === c)) continue;
        if (advPos.row === r && advPos.col === c) continue;

        const dist = rangeDistance(advPos, candidate, config);
        if (dist > monsterRange) continue;

        const losMons = updated.filter((_, idx) => idx !== i);
        if (!hasLoS(candidate, advPos, config, losMons)) continue;

        const moveDist = rangeDistance(monster.pos, candidate, config);
        const score = Math.abs(dist - monsterRange) * 1000 + moveDist;
        if (score < bestScore) {
          bestScore = score;
          bestPos = candidate;
        }
      }
    }

    if (!bestPos) {
      // fallback: move as close as possible to adventurer
      bestPos = advPos;
    }

    // Move monster toward bestPos using available speed points
    updated[i] = {
      ...monster,
      pos: moveToward(monster.pos, bestPos, monsterSpeed, config, advPos, othersAtEnd),
    };
  }

  return updated;
}

function moveToward(
  from: Pos,
  to: Pos,
  speedPoints: number,
  config: DungeonConfig,
  advPos: Pos,
  others: Pos[]
): Pos {
  let pos = { ...from };
  let remaining = speedPoints;

  while (remaining > 0) {
    const neighbors = getNeighbors(pos, config, advPos, []);
    // others can be passed through but not ended on
    if (neighbors.length === 0) break;

    // Pick neighbor that minimizes distance to target
    const best = neighbors
      .map(n => ({ pos: n, cost: moveCost(pos, n), dist: manDist(n, to) }))
      .filter(n => n.cost <= remaining)
      .sort((a, b) => a.dist - b.dist)[0];

    if (!best || best.dist >= manDist(pos, to)) break;

    // Check if we can actually stop there (not on another monster)
    const endOk = !others.some(o => o.row === best.pos.row && o.col === best.pos.col);
    if (!endOk) {
      // Try passing through
      pos = best.pos;
      remaining -= best.cost;
      continue;
    }

    pos = best.pos;
    remaining -= best.cost;
  }

  return pos;
}

function getNeighbors(pos: Pos, config: DungeonConfig, advPos: Pos, blockedExtra: Pos[]): Pos[] {
  const { grid, rows, cols } = config;
  const result: Pos[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = pos.row + dr;
      const nc = pos.col + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc] === 'wall') continue;
      if (advPos.row === nr && advPos.col === nc) continue;
      if (blockedExtra.some(b => b.row === nr && b.col === nc)) continue;
      result.push({ row: nr, col: nc });
    }
  }
  return result;
}

function manDist(a: Pos, b: Pos): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

// Calculate total monster attack damage to adventurer
export function calcMonsterDamage(
  monsters: Monster[],
  advPos: Pos,
  config: DungeonConfig,
  totalDefense: number,
  monsterAttack: number,
  monsterRange: number
): { damage: number; attackingIds: number[] } {
  const attackingIds: number[] = [];
  for (const m of monsters) {
    const r = rangeDistance(m.pos, advPos, config);
    if (r <= monsterRange && hasLoS(m.pos, advPos, config, monsters, [m.id])) {
      attackingIds.push(m.id);
    }
  }

  if (attackingIds.length === 0) return { damage: 0, attackingIds: [] };

  const totalAttack = attackingIds.length * monsterAttack;
  const damage = Math.floor(totalAttack / totalDefense);
  return { damage, attackingIds };
}

export function computeTotalStats(
  baseStats: BaseStats,
  assigned: { speed: number | null; attack: number | null; defense: number | null }
): BaseStats {
  return {
    speed: baseStats.speed + (assigned.speed ?? 0),
    attack: baseStats.attack + (assigned.attack ?? 0),
    defense: baseStats.defense + (assigned.defense ?? 0),
    range: baseStats.range,
  };
}
