export type RoomType =
  'INTRO' | 'CREEP' | 'ELITE' | 'REST' | 'TREASURE' | 'SHOP' | 'MERCHANT' | 'BOSS';

export interface Room {
  id: string;
  floor: number;
  type: RoomType;
  nextRoomIds: string[];
  isFog: boolean;
  isCompleted: boolean;
}

export function getRandomRoomType(): RoomType {
  const pool: RoomType[] = ['CREEP', 'ELITE', 'SHOP', 'REST', 'TREASURE'];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function randomNumGenerator(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateFloor(floorNum: number): Room[] {
  const floor: Room[] = [];
  const rooms: number = randomNumGenerator(3, 5);

  for (let i = 0; i < rooms; i++) {
    floor.push({
      id: `${floorNum}.${i}`,
      floor: floorNum,
      type: getRandomRoomType(),
      nextRoomIds: [],
      isFog: true,
      isCompleted: false,
    });
  }
  return floor;
}

export function generateMap(): Room[][] {
  const map: Room[][] = [];

  const startRoom: Room = {
    id: '0.0',
    floor: 0,
    type: 'REST',
    nextRoomIds: ['1.0'],
    isFog: false,
    isCompleted: true,
  };
  map.push([startRoom]);

  const introRoom: Room = {
    id: '1.0',
    floor: 1,
    type: 'INTRO',
    nextRoomIds: [],
    isFog: true,
    isCompleted: false,
  };
  map.push([introRoom]);

  const floor2 = generateFloor(2);
  map.push(floor2);
  for (const room of floor2) {
    introRoom.nextRoomIds.push(room.id);
  }

  const floor3 = generateFloor(3);
  map.push(floor3);
  for (const room of floor3) {
    const parent = floor2[Math.floor(Math.random() * floor2.length)];
    parent.nextRoomIds.push(room.id);
  }

  const finalRoom: Room = {
    id: '4.0',
    floor: 4,
    type: 'BOSS',
    nextRoomIds: [],
    isFog: true,
    isCompleted: false,
  };
  map.push([finalRoom]);

  const bossExit = floor3[Math.floor(Math.random() * floor3.length)];
  bossExit.nextRoomIds.push(finalRoom.id);

  return map;
}

export function canMoveToRoom(currentRoom: Room, targetRoom: Room, allRooms: Room[] = []): boolean {
  //Cannot click the room you are already standing in
  if (currentRoom.id === targetRoom.id) {
    return false;
  }

  // Forward Step: Direct exit defined in nextRoomIds
  const isForwardExit = currentRoom.nextRoomIds.includes(targetRoom.id);
  if (isForwardExit) {
    return true;
  }

  // Cleared branches on this floor remain usable after exploring a sibling room.
  const isUnlockedFloorExit =
    targetRoom.floor === currentRoom.floor + 1 &&
    !targetRoom.isFog &&
    allRooms.some(
      (room) =>
        room.floor === currentRoom.floor &&
        room.isCompleted &&
        room.nextRoomIds.includes(targetRoom.id),
    );
  if (isUnlockedFloorExit) return true;

  //Lateral Step: Moving between non-completed rooms on the same floor
  const isSameFloorExploration = targetRoom.floor === currentRoom.floor && !targetRoom.isCompleted;
  if (isSameFloorExploration) {
    return true;
  }

  //Backtracking: You can retreat to an already visited room on a lower floor
  const isBacktracking = targetRoom.floor < currentRoom.floor && targetRoom.isCompleted;
  if (isBacktracking) {
    return true;
  }

  //  Parent Step: Returning to a room that points into your current room
  const isParentRoom = targetRoom.nextRoomIds.includes(currentRoom.id);
  if (isParentRoom) {
    return true;
  }

  return false;
}

export function visitRoom(targetRoom: Room, allRooms: Room[]): void {
  targetRoom.isFog = false;

  // Reveal all forward paths from this room
  for (const nextId of targetRoom.nextRoomIds) {
    const roomAhead = allRooms.find((r) => r.id === nextId);
    if (roomAhead) {
      roomAhead.isFog = false;
    }
  }
}

export function completeRoom(room: Room): void {
  room.isCompleted = true;
}

export type GameState =
  | 'START'
  | 'SELECT_FIGHTER'
  | 'MAP'
  | 'BATTLE'
  | 'REST'
  | 'TREASURE'
  | 'SHOP'
  | 'VICTORY'
  | 'GAME_OVER';

export const INITIAL_GAME_STATE: GameState = 'START';

export function roomGameState(type: RoomType): GameState {
  switch (type) {
    case 'CREEP':
    case 'ELITE':
    case 'BOSS':
    case 'INTRO':
      return 'BATTLE';
    case 'REST':
      return 'REST';
    case 'TREASURE':
      return 'TREASURE';
    case 'SHOP':
    case 'MERCHANT':
      return 'SHOP';
  }
}

export type BattleRoomType = 'INTRO' | 'CREEP' | 'ELITE' | 'BOSS';

export interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  block: number;
}

export interface EnemyIntent {
  type: 'ATTACK' | 'DEFEND' | 'BUFF' | 'SPECIAL';
  value: number;
  name?: string;
  shield?: number;
}

export interface Enemy extends Combatant {
  type: BattleRoomType;
  intent: EnemyIntent;
  enraged?: boolean;
}

export interface Card {
  id: string;
  name: string;
  cost: number;
  damage?: number;
  block?: number;
  effect?: 'FIRE_CHAIN';
  damageMultiplier?: number;
  description: string;
}

export interface BattleState {
  player: Combatant;
  enemy: Enemy;
  deck: Card[];
  hand: Card[];
  discard: Card[];
  energy: number;
  maxEnergy: number;
  turn: number;
  enemyDamage: number;
  discardsRemaining: number;
  fireChainUses: number;
  fireChainLastTurn: number;
}

export function isBattleRoom(type: RoomType): type is BattleRoomType {
  return type === 'INTRO' || type === 'CREEP' || type === 'ELITE' || type === 'BOSS';
}

export function createPlayer(): Combatant {
  return { name: 'WebSlayer', hp: 100, maxHp: 100, block: 0 };
}

export function createStarterDeck(): Card[] {
  return Array.from({ length: 10 }, (_, index): Card => {
    if (index < 5) {
      return {
        id: `strike-${index}`,
        name: 'Strike',
        cost: 1,
        damage: 12,
        description: 'Deal 12 damage.',
      };
    }
    if (index < 9) {
      return {
        id: `defend-${index}`,
        name: 'Defend',
        cost: 1,
        block: 8,
        description: 'Gain 8 block.',
      };
    }
    return {
      id: 'heavy-strike',
      name: 'Heavy Strike',
      cost: 2,
      damage: 28,
      description: 'Deal 28 damage.',
    };
  });
}

export function upgradeDeck(cards: Card[]): Card[] {
  return cards.map((card) =>
    card.damage === undefined
      ? { ...card }
      : {
          ...card,
          damageMultiplier: (card.damageMultiplier ?? 1) * 1.2,
          description: describeCard({
            ...card,
            damageMultiplier: (card.damageMultiplier ?? 1) * 1.2,
          }),
        },
  );
}

export function createShopCard(element: 'FIRE' | 'WATER', id: string): Card {
  const card: Card =
    element === 'WATER'
      ? { id, name: 'Tidal Strike', cost: 1, damage: 15, block: 15, description: '' }
      : { id, name: 'Kindle', cost: 1, damage: 15, effect: 'FIRE_CHAIN', description: '' };
  return { ...card, description: describeCard(card) };
}

export function cardDamage(card: Card, state?: BattleState): number {
  const uses =
    card.effect === 'FIRE_CHAIN' && state && state.fireChainLastTurn >= state.turn - 1
      ? state.fireChainUses
      : 0;
  return Math.round(((card.damage ?? 0) + uses * 15) * (card.damageMultiplier ?? 1));
}

export function describeCard(card: Card, state?: BattleState): string {
  const damage = card.damage === undefined ? '' : `Deal ${cardDamage(card, state)} damage.`;
  const block = card.block === undefined ? '' : `Gain ${card.block} shield.`;
  const chain =
    card.effect === 'FIRE_CHAIN'
      ? ` Each use adds ${Math.round(15 * (card.damageMultiplier ?? 1))} damage. Chain within a turn or across consecutive turns; skip a turn to reset.`
      : '';
  return [damage, block].filter(Boolean).join(' ') + chain;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function drawHand(state: BattleState, random: () => number): void {
  while (state.hand.length < 5) {
    if (!state.deck.length) {
      if (!state.discard.length) break;
      state.deck = shuffle(state.discard, random);
      state.discard = [];
    }
    state.hand.push(state.deck.pop()!);
  }
}

export function createBattle(
  type: BattleRoomType,
  player: Combatant,
  cards: readonly Card[],
  random: () => number = Math.random,
): BattleState {
  const enemies: Record<BattleRoomType, { name: string; hp: number; damage: number }> = {
    INTRO: { name: 'Sam Jr', hp: 45, damage: 6 },
    CREEP: { name: 'Cultist', hp: 60, damage: 8 },
    ELITE: { name: 'Gremlin Nob', hp: 120, damage: 14 },
    BOSS: { name: 'Sam the Dev', hp: 300, damage: 18 },
  };
  const enemy = enemies[type];
  const state: BattleState = {
    player: { ...player, block: 0 },
    enemy: {
      name: enemy.name,
      hp: enemy.hp,
      maxHp: enemy.hp,
      block: 0,
      type,
      enraged: false,
      intent: calculateEnemyIntent(type, 1, enemy.damage),
    },
    deck: shuffle(
      cards.map((card) => ({ ...card })),
      random,
    ),
    hand: [],
    discard: [],
    energy: 3,
    maxEnergy: 3,
    turn: 1,
    enemyDamage: enemy.damage,
    discardsRemaining: 3,
    fireChainUses: 0,
    fireChainLastTurn: 0,
  };
  drawHand(state, random);
  return state;
}

export function calculateEnemyIntent(
  type: BattleRoomType,
  turn: number,
  damage: number,
): EnemyIntent {
  if (turn % 4 === 0 && type === 'ELITE')
    return { type: 'SPECIAL', name: 'Nob Smash', value: 20 + Math.max(0, damage - 14), shield: 20 };
  if (turn % 4 === 0 && type === 'BOSS')
    return {
      type: 'SPECIAL',
      name: 'Sam-BHAV KARKI',
      value: Math.round((40 * damage) / 18),
      shield: 30,
    };
  if (type === 'BOSS' && turn % 3 === 2) return { type: 'DEFEND', value: 12 };
  if (type === 'ELITE' && turn % 3 === 0) return { type: 'BUFF', value: 2 };
  return { type: 'ATTACK', value: damage };
}

export function battleOutcome(state: BattleState): 'ACTIVE' | 'VICTORY' | 'GAME_OVER' {
  if (state.player.hp <= 0) return 'GAME_OVER';
  if (state.enemy.hp <= 0) return 'VICTORY';
  return 'ACTIVE';
}

export function canPlayCard(state: BattleState, cardId: string): boolean {
  const card = state.hand.find((card) => card.id === cardId);
  return battleOutcome(state) === 'ACTIVE' && card !== undefined && card.cost <= state.energy;
}

function copyBattle(state: BattleState): BattleState {
  return {
    ...state,
    player: { ...state.player },
    enemy: { ...state.enemy, intent: { ...state.enemy.intent } },
    deck: [...state.deck],
    hand: [...state.hand],
    discard: [...state.discard],
  };
}

function applyDamage(target: Combatant, damage: number): void {
  const absorbed = Math.min(target.block, Math.max(0, damage));
  target.block -= absorbed;
  target.hp = Math.max(0, target.hp - Math.max(0, damage - absorbed));
}

function awakenBoss(state: BattleState): void {
  if (
    state.enemy.type !== 'BOSS' ||
    state.enemy.enraged ||
    state.enemy.hp <= 0 ||
    state.enemy.hp > state.enemy.maxHp / 2
  )
    return;
  state.enemy.enraged = true;
  state.enemy.maxHp += 50;
  state.enemy.hp = state.enemy.maxHp;
  state.enemyDamage *= 2;
  state.enemy.intent = calculateEnemyIntent(state.enemy.type, state.turn, state.enemyDamage);
}

export function playCard(state: BattleState, cardId: string): BattleState {
  if (!canPlayCard(state, cardId)) return state;
  const next = copyBattle(state);
  const index = next.hand.findIndex((card) => card.id === cardId);
  const card = next.hand.splice(index, 1)[0]!;
  next.energy -= card.cost;
  applyDamage(next.enemy, cardDamage(card, next));
  if (card.effect === 'FIRE_CHAIN') {
    next.fireChainUses = next.fireChainLastTurn >= next.turn - 1 ? next.fireChainUses + 1 : 1;
    next.fireChainLastTurn = next.turn;
  }
  awakenBoss(next);
  next.player.block += card.block ?? 0;
  next.discard.push(card);
  return next;
}

/** Cycle one card for free, preserving every instance and the input snapshot. */
export function discardCard(
  state: BattleState,
  cardId: string,
  random: () => number = Math.random,
): BattleState {
  const index = state.hand.findIndex((card) => card.id === cardId);
  if (battleOutcome(state) !== 'ACTIVE' || state.discardsRemaining <= 0 || index < 0) return state;
  const next = copyBattle(state);
  const card = next.hand.splice(index, 1)[0]!;
  // Draw before adding this card so it cannot immediately replace itself.
  if (!next.deck.length && next.discard.length) {
    next.deck = shuffle(next.discard, random);
    next.discard = [];
  }
  const replacement = next.deck.pop();
  if (replacement) next.hand.push(replacement);
  next.discard.push(card);
  next.discardsRemaining--;
  return next;
}

export function endTurn(state: BattleState, random: () => number = Math.random): BattleState {
  if (battleOutcome(state) !== 'ACTIVE') return state;
  const next = copyBattle(state);
  // Old enemy block expires before its action; newly gained block survives
  // into the next player turn so the displayed defense is meaningful.
  next.enemy.block = 0;
  switch (next.enemy.intent.type) {
    case 'SPECIAL':
      applyDamage(next.player, next.enemy.intent.value);
      next.enemy.block += next.enemy.intent.shield ?? 0;
      break;
    case 'ATTACK':
      applyDamage(next.player, next.enemy.intent.value);
      break;
    case 'DEFEND':
      next.enemy.block += next.enemy.intent.value;
      break;
    case 'BUFF':
      next.enemyDamage += next.enemy.intent.value;
      break;
  }
  next.discard.push(...next.hand);
  next.hand = [];
  if (next.player.hp <= 0) return next;
  next.player.block = 0;
  next.energy = next.maxEnergy;
  next.turn++;
  if (next.enemy.type === 'BOSS' && next.enemy.enraged) {
    next.enemyDamage = Math.round(next.enemyDamage * 1.5);
  }
  next.discardsRemaining = 3;
  next.enemy.intent = calculateEnemyIntent(next.enemy.type, next.turn, next.enemyDamage);
  drawHand(next, random);
  return next;
}
