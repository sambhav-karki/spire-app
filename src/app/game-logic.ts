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
  const rooms: number = randomNumGenerator(1, 3);

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

export function canMoveToRoom(
  currentRoom: Room,
  targetRoom: Room,
  _allRooms: Room[] = [],
): boolean {
  //Cannot click the room you are already standing in
  if (currentRoom.id === targetRoom.id) {
    return false;
  }

  // Forward Step: Direct exit defined in nextRoomIds
  const isForwardExit = currentRoom.nextRoomIds.includes(targetRoom.id);
  if (isForwardExit) {
    return true;
  }

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
  'START' | 'MAP' | 'BATTLE' | 'REST' | 'TREASURE' | 'SHOP' | 'VICTORY' | 'GAME_OVER';

export const INITIAL_GAME_STATE: GameState = 'START';

export function roomGameState(type: RoomType): GameState {
  switch (type) {
    case 'CREEP':
    case 'ELITE':
    case 'BOSS':
      return 'BATTLE';
    case 'REST':
      return 'REST';
    case 'TREASURE':
      return 'TREASURE';
    case 'SHOP':
    case 'MERCHANT':
      return 'SHOP';
    case 'INTRO':
      return 'MAP';
  }
}

export type BattleRoomType = 'CREEP' | 'ELITE' | 'BOSS';

export interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  block: number;
}

export interface EnemyIntent {
  type: 'ATTACK' | 'DEFEND' | 'BUFF';
  value: number;
}

export interface Enemy extends Combatant {
  type: BattleRoomType;
  intent: EnemyIntent;
}

export interface Card {
  id: string;
  name: string;
  cost: number;
  damage?: number;
  block?: number;
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
}

export function isBattleRoom(type: RoomType): type is BattleRoomType {
  return type === 'CREEP' || type === 'ELITE' || type === 'BOSS';
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
          damage: card.damage + 3,
          description: `Deal ${card.damage + 3} damage.`,
        },
  );
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
    CREEP: { name: 'Cultist', hp: 45, damage: 6 },
    ELITE: { name: 'Gremlin Nob', hp: 85, damage: 10 },
    BOSS: { name: 'The Guardian', hp: 240, damage: 14 },
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
  };
  drawHand(state, random);
  return state;
}

export function calculateEnemyIntent(
  type: BattleRoomType,
  turn: number,
  damage: number,
): EnemyIntent {
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

export function playCard(state: BattleState, cardId: string): BattleState {
  if (!canPlayCard(state, cardId)) return state;
  const next = copyBattle(state);
  const index = next.hand.findIndex((card) => card.id === cardId);
  const card = next.hand.splice(index, 1)[0]!;
  next.energy -= card.cost;
  applyDamage(next.enemy, card.damage ?? 0);
  next.player.block += card.block ?? 0;
  next.discard.push(card);
  return next;
}

export function endTurn(state: BattleState, random: () => number = Math.random): BattleState {
  if (battleOutcome(state) !== 'ACTIVE') return state;
  const next = copyBattle(state);
  // Old enemy block expires before its action; newly gained block survives
  // into the next player turn so the displayed defense is meaningful.
  next.enemy.block = 0;
  switch (next.enemy.intent.type) {
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
  next.enemy.intent = calculateEnemyIntent(next.enemy.type, next.turn, next.enemyDamage);
  drawHand(next, random);
  return next;
}
