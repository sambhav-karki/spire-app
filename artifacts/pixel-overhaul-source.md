# WebSlayer Spire pixel overhaul: complete sources

Includes all five requested files plus the Google Font entry point and shared pixel stylesheet required by the implementation.

## src/app/game-logic.ts

```typescript
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

export type GameState = 'MAP' | 'BATTLE' | 'EVENT' | 'GAME_OVER' | 'VICTORY';
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
```

## src/app/app.ts

```typescript
import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import {
  BattleState,
  Card,
  GameState,
  Room,
  battleOutcome,
  canMoveToRoom,
  canPlayCard,
  completeRoom,
  createBattle,
  createPlayer,
  createStarterDeck,
  endTurn,
  generateMap,
  isBattleRoom,
  playCard,
  upgradeDeck,
  visitRoom,
} from './game-logic';

interface Connection {
  id: string;
  from: Room;
  to: Room;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  animate: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '[class.battle-active]': "gameState === 'BATTLE'" },
})
export class App implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private revealTimer?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private frame?: number;
  private destroyed = false;
  private readonly traversed = new Set<string>();
  private readonly revealedConnections = new Set<string>();
  private mapContainer?: ElementRef<HTMLElement>;
  @ViewChild('mapContainer')
  private set mapView(element: ElementRef<HTMLElement> | undefined) {
    this.resizeObserver?.disconnect();
    this.mapContainer = element;
    if (!element) {
      for (const connection of this.connections) connection.animate = false;
    }
    if (!this.browser || !element) return;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleMeasurement());
      this.resizeObserver.observe(element.nativeElement);
    }
    this.scheduleMeasurement();
  }
  map = generateMap();
  allRooms = this.map.flat();
  currentRoom = this.map[0][0];
  connections: Connection[] = [];
  mapWidth = 1;
  mapHeight = 1;
  gameState: GameState = 'MAP';
  player = createPlayer();
  playerDeck = createStarterDeck();
  battle: BattleState | null = null;
  gold = 0;
  rewardGold = 0;
  battleMessage = '';
  bossDefeated = false;

  get eventTitle(): string {
    switch (this.currentRoom.type) {
      case 'REST':
        return 'Rest Site';
      case 'TREASURE':
        return 'Ancient Chest';
      case 'SHOP':
      case 'MERCHANT':
        return 'Wandering Merchant';
      default:
        return 'Welcome to the Spire';
    }
  }

  ngOnInit(): void {
    if (!this.browser) return;
    window.addEventListener('resize', this.scheduleMeasurement);
    this.scheduleInitialReveal();
  }

  private scheduleInitialReveal(): void {
    clearTimeout(this.revealTimer);
    if (!this.browser) return;
    this.revealTimer = setTimeout(() => {
      if (this.destroyed) return;
      visitRoom(this.currentRoom, this.allRooms);
      this.cdr.detectChanges();
      this.scheduleMeasurement();
    }, 150);
  }

  canSelectRoom(room: Room): boolean {
    return (
      this.gameState === 'MAP' &&
      !room.isFog &&
      canMoveToRoom(this.currentRoom, room, this.allRooms)
    );
  }

  selectRoom(room: Room): void {
    if (!this.canSelectRoom(room)) return;
    if (this.currentRoom.nextRoomIds.includes(room.id)) {
      this.traversed.add(this.connectionId(this.currentRoom, room));
    } else if (room.nextRoomIds.includes(this.currentRoom.id)) {
      this.traversed.add(this.connectionId(room, this.currentRoom));
    }
    this.currentRoom = room;
    visitRoom(room, this.allRooms);
    if (!room.isCompleted) {
      if (isBattleRoom(room.type)) {
        this.battle = createBattle(room.type, this.player, this.playerDeck);
        this.battleMessage = 'Your turn. Play cards or end your turn.';
        this.gameState = 'BATTLE';
      } else {
        this.gameState = 'EVENT';
      }
    }
    this.cdr.markForCheck();
  }

  canPlay(card: Card): boolean {
    return this.gameState === 'BATTLE' && this.battle !== null && canPlayCard(this.battle, card.id);
  }

  play(card: Card): void {
    if (!this.battle || !this.canPlay(card)) return;
    this.battle = playCard(this.battle, card.id);
    this.battleMessage = `Played ${card.name}.`;
    this.resolveBattle();
  }

  finishTurn(): void {
    if (this.gameState !== 'BATTLE' || !this.battle) return;
    const hp = this.battle.player.hp;
    const { name, intent } = this.battle.enemy;
    this.battle = endTurn(this.battle);
    switch (intent.type) {
      case 'ATTACK':
        this.battleMessage = `${name}: ${hp - this.battle.player.hp} damage taken.`;
        break;
      case 'DEFEND':
        this.battleMessage = `${name} gained ${intent.value} block.`;
        break;
      case 'BUFF':
        this.battleMessage = `${name} gained ${intent.value} attack power.`;
        break;
    }
    this.resolveBattle();
  }

  private resolveBattle(): void {
    if (!this.battle) return;
    this.player = { ...this.battle.player, block: 0 };
    const outcome = battleOutcome(this.battle);
    if (outcome === 'GAME_OVER') {
      this.gameState = 'GAME_OVER';
    } else if (outcome === 'VICTORY') {
      completeRoom(this.currentRoom);
      this.rewardGold =
        this.currentRoom.type === 'BOSS' ? 100 : this.currentRoom.type === 'ELITE' ? 35 : 20;
      this.gold += this.rewardGold;
      this.bossDefeated ||= this.currentRoom.type === 'BOSS';
      this.gameState = 'VICTORY';
    }
    this.cdr.markForCheck();
  }

  resolveEvent(choice: 'HEAL' | 'UPGRADE' | 'CLAIM' | 'BUY' | 'LEAVE' | 'CONTINUE'): void {
    if (this.gameState !== 'EVENT' || this.currentRoom.isCompleted) return;
    const type = this.currentRoom.type;
    if (type === 'REST' && choice === 'HEAL') {
      this.healPlayer();
    } else if (type === 'REST' && choice === 'UPGRADE') {
      this.playerDeck = upgradeDeck(this.playerDeck);
    } else if (type === 'TREASURE' && choice === 'CLAIM') {
      this.gold += 50;
    } else if ((type === 'SHOP' || type === 'MERCHANT') && choice === 'BUY') {
      if (this.gold < 30 || this.player.hp >= this.player.maxHp) return;
      this.gold -= 30;
      this.healPlayer();
    } else if (
      !((type === 'SHOP' || type === 'MERCHANT') && choice === 'LEAVE') &&
      !(type === 'INTRO' && choice === 'CONTINUE')
    ) {
      return;
    }
    completeRoom(this.currentRoom);
    this.returnToMap();
  }

  private healPlayer(): void {
    this.player = {
      ...this.player,
      hp: Math.min(this.player.maxHp, this.player.hp + Math.ceil(this.player.maxHp * 0.3)),
      block: 0,
    };
  }

  returnToMap(): void {
    if (
      this.gameState !== 'VICTORY' &&
      !(this.gameState === 'EVENT' && this.currentRoom.isCompleted)
    )
      return;
    this.battle = null;
    this.gameState = 'MAP';
    this.cdr.markForCheck();
  }

  restart(): void {
    if (this.gameState !== 'GAME_OVER' && this.gameState !== 'VICTORY') return;
    this.map = generateMap();
    this.allRooms = this.map.flat();
    this.currentRoom = this.map[0][0];
    this.player = createPlayer();
    this.playerDeck = createStarterDeck();
    this.battle = null;
    this.gold = this.rewardGold = 0;
    this.bossDefeated = false;
    this.battleMessage = '';
    this.traversed.clear();
    this.revealedConnections.clear();
    this.connections = [];
    this.gameState = 'MAP';
    this.scheduleInitialReveal();
    this.cdr.markForCheck();
  }

  connectionState(connection: Connection): 'hidden' | 'available' | 'traversed' | 'revealed' {
    if (connection.from.isFog || connection.to.isFog) return 'hidden';
    if (this.traversed.has(connection.id)) return 'traversed';
    if (connection.from.id === this.currentRoom.id && this.canSelectRoom(connection.to))
      return 'available';
    return 'revealed';
  }

  private connectionId(from: Room, to: Room): string {
    return `${from.id}->${to.id}`;
  }

  lineDrawn(connection: Connection): void {
    connection.animate = false;
  }

  private readonly scheduleMeasurement = (): void => {
    if (this.destroyed || !this.mapContainer || this.frame !== undefined) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = undefined;
      if (!this.mapContainer || this.destroyed) return;
      this.zone.run(() => {
        this.measureConnections();
        this.cdr.detectChanges();
      });
    });
  };

  private measureConnections(): void {
    const container = this.mapContainer?.nativeElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const centers = new Map<string, { x: number; y: number }>();
    container.querySelectorAll<HTMLButtonElement>('[data-room-id]').forEach((button) => {
      const rect = button.getBoundingClientRect();
      centers.set(button.dataset['roomId']!, {
        x: rect.left - bounds.left + rect.width / 2,
        y: rect.top - bounds.top + rect.height / 2,
      });
    });
    this.mapWidth = bounds.width || 1;
    this.mapHeight = bounds.height || 1;
    const roomsById = new Map(this.allRooms.map((room) => [room.id, room]));
    const connections: Connection[] = [];
    for (const from of this.allRooms) {
      const origin = centers.get(from.id);
      if (!origin) continue;
      for (const id of from.nextRoomIds) {
        const to = roomsById.get(id);
        const destination = centers.get(id);
        if (!to || !destination) continue;
        const connectionId = this.connectionId(from, to);
        const revealed = !from.isFog && !to.isFog;
        const animate =
          revealed &&
          (!this.revealedConnections.has(connectionId) ||
            this.connections.some(
              (connection) => connection.id === connectionId && connection.animate,
            ));
        if (revealed) this.revealedConnections.add(connectionId);
        connections.push({
          id: connectionId,
          animate,
          from,
          to,
          x1: origin.x,
          y1: origin.y,
          x2: destination.x,
          y2: destination.y,
        });
      }
    }
    this.connections = connections;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.revealTimer);
    this.resizeObserver?.disconnect();
    if (this.browser) {
      window.removeEventListener('resize', this.scheduleMeasurement);
      if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    }
  }
}
```

## src/app/app.html

```html
@if (gameState !== 'BATTLE') {
  <h1 class="center-text">WebSlayer Spire</h1>
  <p class="center-text" aria-live="polite">
    Currently standing in: <strong>Room {{ currentRoom.id }} ({{ currentRoom.type }})</strong>
  </p>
}
@if (gameState === 'MAP') {
  <p class="center-text map-help">
    Choose a glowing room to continue. Explore your floor or return to cleared rooms.
  </p>
  <div class="map-scroll">
    <div #mapContainer class="map-container" aria-label="Dungeon map">
      <svg
        class="map-connections"
        [attr.viewBox]="'0 0 ' + mapWidth + ' ' + mapHeight"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        @for (connection of connections; track connection.id) {
          <line
            class="connection"
            pathLength="1"
            [attr.x1]="connection.x1"
            [attr.y1]="connection.y1"
            [attr.x2]="connection.x2"
            [attr.y2]="connection.y2"
            [class.line-hidden]="connectionState(connection) === 'hidden'"
            [class.line-revealed]="connectionState(connection) !== 'hidden'"
            [class.line-draw]="connection.animate"
            (animationend)="lineDrawn(connection)"
            [class.line-available]="connectionState(connection) === 'available'"
            [class.line-traversed]="connectionState(connection) === 'traversed'"
          />
        }
      </svg>
      @for (floor of map; track $index) {
        <div class="floor-row" role="group" [attr.aria-label]="'Floor ' + $index">
          @for (room of floor; track room.id) {
            <button
              type="button"
              class="room-btn"
              [attr.data-room-id]="room.id"
              [class.active-room]="currentRoom.id === room.id"
              [class.fog-room]="room.isFog"
              [class.available-room]="canSelectRoom(room)"
              [class.completed-room]="room.isCompleted && currentRoom.id !== room.id"
              [disabled]="!canSelectRoom(room)"
              [attr.aria-current]="currentRoom.id === room.id ? 'step' : null"
              (click)="selectRoom(room)"
            >
              <span class="room-id">{{ room.id }}</span>
              <span>{{ room.isFog ? '???' : room.type }}</span>
              @if (room.isCompleted) {
                <span class="completion-mark" aria-label="Completed">&#10003;</span>
              }
            </button>
          }
        </div>
      }
    </div>
  </div>
}

@if (gameState !== 'BATTLE') {
  <p class="center-text run-status">
    HP {{ player.hp }} / {{ player.maxHp }} &middot; Gold {{ gold }}
  </p>
}

@if (gameState === 'BATTLE') {
  @if (battle; as combat) {
    <section class="battle-screen" aria-labelledby="battle-title">
      <header class="battle-header">
        <h1 id="battle-title">WebSlayer Spire</h1>
        <span>F{{ currentRoom.floor }} / TURN {{ combat.turn }}</span>
        <span class="gold">{{ gold }} GOLD</span>
      </header>
      <div class="arena">
        <article class="combatant hero-stage" aria-label="Player status">
          <h2>{{ combat.player.name }}</h2>
          <div
            class="sprite-frame hero-sprite"
            role="img"
            aria-label="Hero pixel sprite placeholder"
          >
            <span class="pixel-silhouette hero-art" aria-hidden="true"></span>
            <span class="sprite-caption">HERO</span>
          </div>
          <div
            class="hp-track"
            role="progressbar"
            aria-label="Player HP"
            [attr.aria-valuenow]="combat.player.hp"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="combat.player.maxHp"
          >
            <span [style.width.%]="(combat.player.hp / combat.player.maxHp) * 100"></span>
          </div>
          <span class="hp-label">{{ combat.player.hp }} / {{ combat.player.maxHp }} HP</span>
          <span class="status-badge shield">&#9670; BLOCK {{ combat.player.block }}</span>
          <span class="status-effects">{{
            combat.player.block > 0 ? 'GUARDED' : 'NO EFFECTS'
          }}</span>
        </article>
        <span class="arena-vs" aria-hidden="true">VS</span>
        <article class="combatant enemy-stage" aria-label="Enemy status">
          <div
            class="intent"
            role="status"
            aria-live="polite"
            [attr.data-intent]="combat.enemy.intent.type"
          >
            @switch (combat.enemy.intent.type) {
              @case ('ATTACK') {
                <span aria-hidden="true">&#9876;</span> ATTACK
                <strong>{{ combat.enemy.intent.value }}</strong> DMG
              }
              @case ('DEFEND') {
                <span aria-hidden="true">&#9670;</span> DEFEND
                <strong>{{ combat.enemy.intent.value }}</strong> BLOCK
              }
              @case ('BUFF') {
                <span aria-hidden="true">&#10022;</span> BUFF +<strong>{{
                  combat.enemy.intent.value
                }}</strong>
                ATK
              }
            }
          </div>
          <h2>{{ combat.enemy.name }}</h2>
          <div
            class="sprite-frame enemy-sprite"
            [class.elite-sprite]="combat.enemy.type === 'ELITE'"
            [class.boss-sprite]="combat.enemy.type === 'BOSS'"
            role="img"
            [attr.aria-label]="combat.enemy.name + ' pixel sprite placeholder'"
          >
            <span class="pixel-silhouette enemy-art" aria-hidden="true"></span>
            <span class="sprite-caption">{{ combat.enemy.type }}</span>
          </div>
          <div
            class="hp-track"
            role="progressbar"
            aria-label="Enemy HP"
            [attr.aria-valuenow]="combat.enemy.hp"
            [attr.aria-valuemin]="0"
            [attr.aria-valuemax]="combat.enemy.maxHp"
          >
            <span [style.width.%]="(combat.enemy.hp / combat.enemy.maxHp) * 100"></span>
          </div>
          <span class="hp-label">{{ combat.enemy.hp }} / {{ combat.enemy.maxHp }} HP</span>
          <span class="status-badge shield">&#9670; BLOCK {{ combat.enemy.block }}</span>
          <span class="status-effects">ATK {{ combat.enemyDamage }}</span>
        </article>
      </div>
      <p class="battle-message" role="status">{{ battleMessage }}</p>
      <div class="hand" role="group" aria-label="Your cards, scroll sideways to see all cards">
        @for (card of combat.hand; track card.id) {
          <button
            class="card"
            type="button"
            [class.attack-card]="card.damage !== undefined"
            [class.defend-card]="card.block !== undefined"
            [disabled]="!canPlay(card)"
            (click)="play(card)"
            [attr.aria-label]="card.name + ', costs ' + card.cost + ' energy. ' + card.description"
          >
            <span class="card-top"
              ><span class="card-cost" [attr.aria-label]="card.cost + ' energy'">{{
                card.cost
              }}</span>
              <span class="card-type">{{
                card.damage !== undefined ? 'ATTACK' : card.block !== undefined ? 'SKILL' : 'POWER'
              }}</span></span
            >
            <strong class="card-title">{{ card.name }}</strong>
            <span class="card-art" aria-hidden="true">{{
              card.damage !== undefined
                ? '&#9876;'
                : card.block !== undefined
                  ? '&#9670;'
                  : '&#10022;'
            }}</span>
            <span class="card-description">
              @if (card.damage !== undefined) {
                Deal <strong>{{ card.damage }}</strong> damage.
              }
              @if (card.block !== undefined) {
                Gain <strong>{{ card.block }}</strong> block.
              }
              @if (card.damage === undefined && card.block === undefined) {
                {{ card.description }}
              }
            </span>
          </button>
        } @empty {
          <p class="empty-hand">Hand empty. End turn to draw.</p>
        }
      </div>
      <footer class="battle-actions">
        <div class="energy-orb" aria-label="Energy" role="status">
          <strong>{{ combat.energy }}/{{ combat.maxEnergy }}</strong
          ><span>ENERGY</span>
        </div>
        <div class="pile-counts">
          <span>DRAW {{ combat.deck.length }}</span
          ><span>DISCARD {{ combat.discard.length }}</span>
        </div>
        <button type="button" class="action-btn end-turn" (click)="finishTurn()">
          END TURN &#9654;
        </button>
      </footer>
    </section>
  }
}
@if (gameState === 'EVENT') {
  <section class="event-screen" aria-labelledby="event-title">
    <h2 id="event-title">{{ eventTitle }}</h2>
    @switch (currentRoom.type) {
      @case ('REST') {
        <p>Recover 30% of your maximum HP, or increase every attack card's damage by 3.</p>
        <button type="button" class="action-btn" (click)="resolveEvent('HEAL')">
          Rest and heal
        </button>
        <button type="button" class="action-btn" (click)="resolveEvent('UPGRADE')">
          Upgrade attacks
        </button>
      }
      @case ('TREASURE') {
        <p>A forgotten chest holds 50 gold.</p>
        <button type="button" class="action-btn" (click)="resolveEvent('CLAIM')">
          Claim 50 gold
        </button>
      }
      @case ('SHOP') {
        <p>Buy a healing tonic to restore 30% of your maximum HP. Costs 30 gold.</p>
        <button
          type="button"
          class="action-btn"
          [disabled]="gold < 30 || player.hp >= player.maxHp"
          (click)="resolveEvent('BUY')"
        >
          Buy tonic &middot; 30 gold
        </button>
        <button type="button" class="action-btn" (click)="resolveEvent('LEAVE')">Leave shop</button>
      }
      @case ('MERCHANT') {
        <p>Buy a healing tonic to restore 30% of your maximum HP. Costs 30 gold.</p>
        <button
          type="button"
          class="action-btn"
          [disabled]="gold < 30 || player.hp >= player.maxHp"
          (click)="resolveEvent('BUY')"
        >
          Buy tonic &middot; 30 gold
        </button>
        <button type="button" class="action-btn" (click)="resolveEvent('LEAVE')">Leave shop</button>
      }
      @default {
        <p>
          The Spire awaits. Play attacks to defeat enemies and defend to absorb their next attack.
        </p>
        <button type="button" class="action-btn" (click)="resolveEvent('CONTINUE')">
          Begin the climb
        </button>
      }
    }
  </section>
}

@if (gameState === 'VICTORY' || gameState === 'GAME_OVER') {
  <section class="result-overlay" aria-labelledby="result-title">
    <div class="result-panel" role="status">
      @if (gameState === 'VICTORY') {
        <h2 id="result-title">
          {{ currentRoom.type === 'BOSS' ? 'Spire conquered!' : 'Battle won!' }}
        </h2>
        <p>{{ battle?.enemy?.name }} defeated. You earned {{ rewardGold }} gold.</p>
        <button type="button" class="action-btn" (click)="returnToMap()">Return to map</button>
        <button type="button" class="action-btn" (click)="restart()">Start a new run</button>
      } @else {
        <h2 id="result-title">Game over</h2>
        <p>
          The Spire claimed another challenger. Your run ended on floor {{ currentRoom.floor }}.
        </p>
        <button type="button" class="action-btn" (click)="restart()">Try again</button>
      }
    </div>
  </section>
}
@if (gameState === 'MAP' && bossDefeated) {
  <p class="center-text" role="status">The Guardian is defeated. The Spire is yours.</p>
}
```

## src/app/app.css

```css
:host {
  display: block;
  min-height: 100vh;
  padding: 20px 12px;
}
.center-text {
  text-align: center;
}
h1 {
  font-size: 16px;
  color: var(--gold);
}
.map-help,
.room-id,
.status-effects {
  color: #aebfcc;
}
.map-scroll {
  overflow: auto;
  padding: 12px 4px;
  touch-action: pan-x pan-y pinch-zoom;
}
.map-container {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column-reverse;
  gap: 64px;
  padding: 32px 16px;
  margin: auto;
  width: max-content;
  background: var(--slate);
}
.floor-row {
  display: flex;
  justify-content: center;
  gap: 24px;
  position: relative;
  z-index: 1;
}
.map-connections {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
:host.battle-active {
  position: fixed;
  inset: 0;
  padding: 0;
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
}
.battle-screen {
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
    max(8px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  background: repeating-linear-gradient(0deg, #0001 0 1px, transparent 1px 4px), #111c29;
}
.battle-header,
.battle-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.battle-header h1 {
  font-size: 12px;
  margin: 0;
}
.gold,
.card-description strong {
  color: var(--gold);
}
.arena {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 16px;
  border-bottom: 4px solid #344457;
}
.combatant {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.combatant h2 {
  font-size: 10px;
  margin: 0;
}
.hero-stage {
  align-self: flex-end;
  padding-bottom: 8px;
}
.elite-sprite {
  width: 120px;
  height: 120px;
}
.boss-sprite {
  width: 160px;
  height: 160px;
}
.boss-sprite .enemy-art {
  background: #9570c4;
}
.arena-vs {
  color: #5e7184;
  font-size: 20px;
}
.battle-message {
  flex-shrink: 0;
  margin: 0;
  height: 34px;
  overflow: auto;
  color: #ffe082;
  font-size: 9px;
}
.hand {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding: 16px 4px 8px;
  align-items: stretch;
  justify-content: safe center;
  touch-action: pan-x pinch-zoom;
}
.card:not(:disabled):active {
  transform: translateY(-12px);
}
@media (hover: hover) {
  .card:not(:disabled):hover {
    transform: translateY(-12px);
  }
}
.event-screen,
.result-panel {
  max-width: 650px;
  margin: 24px auto;
  padding: 20px;
  border: 3px solid var(--gold);
  background: var(--slate);
  text-align: center;
}
.event-screen .action-btn,
.result-panel .action-btn {
  margin: 8px;
}
.result-overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  overflow: auto;
  background: #080e17ed;
  padding: 16px;
}
@media (max-width: 768px) {
  .battle-header {
    font-size: 8px;
    flex-wrap: wrap;
    gap: 4px;
  }
  .battle-header h1 {
    font-size: 9px;
  }
  .arena {
    flex-direction: column;
    justify-content: space-evenly;
    gap: 6px;
  }
  .enemy-stage {
    order: -1;
  }
  .hero-stage {
    align-self: center;
    padding: 0;
  }
  .arena-vs,
  .status-effects {
    display: none;
  }
  .combatant {
    gap: 3px;
  }
  .combatant h2,
  .intent {
    font-size: 8px;
  }
  .sprite-frame {
    width: 64px;
    height: 64px;
  }
  .elite-sprite {
    width: 76px;
    height: 76px;
  }
  .boss-sprite {
    width: 88px;
    height: 88px;
  }
  .intent {
    padding: 3px;
  }
  .hand {
    justify-content: flex-start;
  }
  .card {
    flex-basis: 126px;
  }
}
@media (max-height: 700px) {
  .battle-screen {
    gap: 4px;
  }
  .combatant {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'name name' 'sprite health' 'sprite hp' 'sprite block';
    column-gap: 10px;
  }
  .enemy-stage {
    grid-template-areas: 'intent intent' 'name name' 'sprite health' 'sprite hp' 'sprite block';
  }
  .sprite-frame {
    grid-area: sprite;
    width: 64px;
    height: 64px;
  }
  .combatant h2 {
    grid-area: name;
  }
  .intent {
    grid-area: intent;
  }
  .hp-track {
    grid-area: health;
  }
  .hp-label {
    grid-area: hp;
  }
  .shield {
    grid-area: block;
  }
  .status-effects,
  .arena-vs {
    display: none;
  }
  .card-art {
    height: 28px;
  }
  .card-title {
    min-height: 0;
  }
  .energy-orb {
    height: 44px;
    width: 60px;
  }
}
@media (max-height: 450px) {
  .arena {
    flex-direction: row;
  }
  .hero-stage {
    align-self: center;
  }
  .combatant {
    gap: 2px;
  }
  .sprite-frame {
    width: 44px;
    height: 44px;
  }
  .hp-track {
    width: 120px;
  }
  .battle-message {
    height: 20px;
  }
  .card-art,
  .sprite-caption,
  .gold {
    display: none;
  }
  .card {
    flex-basis: 128px;
  }
  .hand {
    padding-top: 12px;
  }
}
```

## SKILL.md

```markdown
---
name: webslayer-spire
description: Develop the Angular WebSlayer Spire dungeon map, room encounters, and card battle system in this repository.
---

# WebSlayer Spire architecture

Read the relevant source and tests before editing. Use standalone Angular components and `@if`/`@for` templates.

## Ownership and contracts

- `src/app/game-logic.ts` owns DOM-free map generation, navigation, discovery, completion, and combat rules.
- `src/app/app.ts` owns the run (player, persistent deck, gold, map), guarded view transitions, encounter rewards, and browser layout measurement.
- `src/app/app.html` renders map, battle, event, victory and defeat views; `app.css` owns view layout and responsive breakpoints. `src/styles.css` owns the shared pixel theme, sprite silhouettes, card/intent/HP skins, and reduced-motion behavior. `src/index.html` loads the Google pixel font.
- `Combatant`: name, current/max HP, block. `Card`: unique instance ID, name, cost, optional damage/block, description.
- `Enemy` extends `Combatant` with room `type` and `intent: { type: 'ATTACK' | 'DEFEND' | 'BUFF'; value: number }`. `BattleState`: player/enemy snapshots, deck (draw pile), hand, discard, current/max energy, turn, and enemyDamage (base attack strength, increased by buffs). The persistent playerDeck is separate from battle piles.

## Encounter state machine

`gameState: 'MAP' | 'BATTLE' | 'EVENT' | 'GAME_OVER' | 'VICTORY'`.

Only MAP accepts navigation. Entering an uncleared room calls visitRoom to reveal it and its exits, then routes CREEP/ELITE/BOSS to BATTLE and INTRO/REST/TREASURE/SHOP/MERCHANT to EVENT. Discovery does not complete a room. completeRoom is called only after victory or event resolution. Floor 0 is an already-cleared starting rest site; initialization reveals floor 1 after 150ms without opening an encounter.

Cleared rooms can be revisited using the existing movement rules, but do not repeat encounters or rewards. Map movement and traversal tracking remain independent of combat.

BATTLE transitions to VICTORY when enemy HP reaches zero, or GAME_OVER when player HP reaches zero. Victory persists HP, completes the room, and awards gold once (20 creep, 35 elite, 100 boss). Return to map preserves the run; boss victory also records bossDefeated. GAME_OVER requires restart. Restart replaces map/player/deck, clears rewards and traversal/reveal history, and repeats initial fog reveal.

EVENT resolves exactly once: INTRO continues; REST heals 30% max HP or upgrades all damage cards by 3; TREASURE grants 50 gold; SHOP/MERCHANT sells a 30%-HP heal for 30 gold or lets the player leave. Event resolution clears the room and returns to MAP. Merchant purchase requires enough gold and missing HP.

## Turn rules

Combat functions return new BattleState objects and leave input states unchanged. Each battle shuffles copies of the persistent deck, draws five cards, and starts with three energy. Inject an optional RNG into createBattle/endTurn for deterministic tests. Card IDs must be unique across the deck; UI actions resolve them against the current hand, reject unaffordable/missing cards, and reject terminal battles.

Playing a card spends energy, applies damage through enemy block, grants player block, and moves that card to discard. End turn expires old enemy block, executes the displayed enemy intent, discards remaining hand, then (if alive) resets player block, refills energy, increments turn, calculates the next intent, and draws five. Newly gained enemy block persists through the next player turn. Shuffle discard into the draw pile only when the draw pile is empty. HP never drops below zero.

`calculateEnemyIntent` is the domain source of upcoming actions: Cultist (45 HP, 6 attack) always attacks; Gremlin Nob (85 HP, 10 initial attack) gains +2 attack on every third turn and attacks otherwise; Guardian (240 HP, 14 attack) defends for 12 on turns where `turn % 3 === 2` and attacks otherwise. `endTurn` executes `enemy.intent` exactly as advertised. UI messages distinguish damage taken, block gained, and buffs. Never derive an intent solely from CSS or independently randomize it in the controller.

## Map lifecycle

The map exists only inside `@if (gameState === 'MAP')`. A ViewChild setter disconnects the old ResizeObserver and reconnects measurement whenever this conditional view is recreated. requestAnimationFrame measures button centers relative to the container after rendering; callbacks guard against a missing/destroyed map. Preserve traversal and revealed-connection sets across encounter views; clear them on restart. Newly revealed lines animate once, while returning to the map does not replay already-seen paths. Fixed button dimensions keep fog reveal from shifting centers. Clean up timers, observer, frame and window listener on destruction; guard browser APIs with isPlatformBrowser.

## Validation

Use `npm.cmd run build` and `npm.cmd test -- --watch=false` on this Windows workspace (PowerShell blocks npm.ps1). Cover navigation and fog invariants, deferred completion, combat costs/block/draw recycling, terminal action guards, event reward idempotence, persistent HP, and conditional map restoration. Keep component CSS within the production 4 kB warning / 8 kB error budgets.

## Pixel visual and mobile constraints

Use `Press Start 2P` from Google Fonts with monospace/sans-serif fallbacks and `display=swap`. The production build fetches font CSS for inlining, so network access is required unless cached. Use 8-14px text, comfortable line heights, square 3px borders, hard shadows and dungeon slate/gold panels; HP is red `#e53935`, block blue `#1e88e5`, and energy amber `#fbc02d`. Numeric card effects must come from damage/block fields so upgraded values remain correct. Preserve accessible names, keyboard focus outlines and reduced-motion overrides.

Sprites are intentional CSS placeholders, not loaded assets: checkerboard frames with pixel silhouettes and an explicit HERO/CREEP/ELITE/BOSS badge. Desktop hero/creep frames are 96px, elite 120px, boss 160px. `image-rendering: pixelated` applies to sprite, artwork, image and canvas containers. Replace the silhouette inside its existing frame when adding real artwork, preserving stage dimensions and accessible labels.

Battle uses a fixed host and a flex screen sized to `100vh` with `100dvh` override, safe-area padding and no page scrolling. Header, log, hand and footer reserve space; the arena consumes the remainder. Desktop places hero left/bottom and enemy right. Under 768px, enemy appears above the hero and the five-card hand scrolls horizontally. Under 700px height, compact named grid areas place sprite beside HP/block; under 450px height, stages return to a side-by-side layout and card artwork is hidden so touch controls still fit. Do not remove semantic intent/HP information when compacting.

Cards include top-left cost, card type, title, framed artwork and highlighted numeric description. Affordable cards lift 12px on hover-capable pointers and active taps. Energy and End Turn stay in the footer. All interactive targets are at least 44px; buttons use `touch-action: manipulation`, map uses two-axis panning and hand uses horizontal panning. Root overscroll containment prevents rubber-banding without disabling horizontal hand/map scrolling or browser zoom.

`scripts/ui-check.cjs` uses installed headless Chrome and the dev server at `http://127.0.0.1:4200` (start with `npm.cmd start -- --host 127.0.0.1 --port 4200`). It checks viewport/control/stage bounds, minimum tap targets, mobile hand overflow, pixel-font loading and conditional map restoration at 1280x800, 390x844, 320x568, 844x390 and 568x320, and writes screenshots to `artifacts/`. Browser launch and production font fetching may need sandbox approval. Unit tests verify advertised defense/buff execution and immutable intent snapshots.
```

## src/index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>SpireApp</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <link rel="icon" type="image/x-icon" href="favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
```

## src/styles.css

```css
/* Shared pixel theme and reusable sprite placeholders. */
:root {
  color-scheme: dark;
  --slate: #182532;
  --gold: #fbc02d;
  --health: #e53935;
  --shield: #1e88e5;
}
* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  min-height: 100%;
  background: #0c121c;
  color: #f4ecd8;
  overscroll-behavior: none;
}
body,
button {
  font-family: 'Press Start 2P', monospace, sans-serif;
  font-size: 10px;
  line-height: 1.7;
}
button {
  min-width: 44px;
  min-height: 44px;
  touch-action: manipulation;
  cursor: pointer;
  border-radius: 0;
  color: inherit;
}
button:disabled {
  cursor: default;
  opacity: 0.45;
}
button:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 3px;
}
h1,
h2,
p {
  overflow-wrap: anywhere;
}
img,
canvas,
.sprite-frame,
.card-art {
  image-rendering: pixelated;
}
.sprite-frame {
  display: grid;
  place-items: center;
  flex: 0 1 auto;
  position: relative;
  width: 96px;
  height: 96px;
  border: 3px solid #111;
  outline: 2px solid #697d8c;
  background: repeating-conic-gradient(#1c2935 0% 25%, #263646 0% 50%) 0 0 / 16px 16px;
}
.sprite-caption {
  position: absolute;
  bottom: 2px;
  font-size: 7px;
  color: #b8c8d0;
}
.pixel-silhouette {
  display: block;
  width: 64%;
  height: 70%;
  background: #88c6e8;
  clip-path: polygon(
    30% 0,
    70% 0,
    70% 20%,
    85% 20%,
    85% 35%,
    100% 35%,
    100% 65%,
    80% 65%,
    80% 100%,
    55% 100%,
    55% 75%,
    45% 75%,
    45% 100%,
    20% 100%,
    20% 65%,
    0 65%,
    0 35%,
    15% 35%,
    15% 20%,
    30% 20%
  );
}
.hero-art {
  background: linear-gradient(#edbf8d 0 25%, #2d82c3 25% 65%, #d4e6ee 65% 75%, #264565 75%);
}
.enemy-art {
  background: #c95c62;
  clip-path: polygon(
    10% 0,
    30% 15%,
    70% 15%,
    90% 0,
    90% 35%,
    100% 35%,
    100% 75%,
    80% 75%,
    80% 100%,
    60% 100%,
    60% 80%,
    40% 80%,
    40% 100%,
    20% 100%,
    20% 75%,
    0 75%,
    0 35%,
    10% 35%
  );
}
.enemy-art::after {
  content: '';
  display: block;
  width: 12%;
  height: 10%;
  margin: 40% 0 0 20%;
  background: #ffe082;
  box-shadow: 20px 0 #ffe082;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation: none !important;
    transition: none !important;
  }
}
/* Shared pixel card, health, intent, energy and button skin. */
.intent {
  padding: 6px;
  color: #ffb3a9;
  background: #361d25;
  border: 2px solid #e53935;
}
.intent[data-intent='DEFEND'] {
  border-color: var(--shield);
  color: #90caf9;
}
.intent[data-intent='BUFF'] {
  border-color: #ab74e5;
  color: #d2b3ff;
}
.hp-track {
  width: 180px;
  max-width: 100%;
  height: 12px;
  background: #391b24;
  border: 2px solid #111;
}
.hp-track span {
  display: block;
  height: 100%;
  background: repeating-linear-gradient(90deg, var(--health) 0 10px, #111 10px 12px);
  transition: width 0.2s;
}
.hp-label,
.status-effects {
  font-size: 8px;
}
.shield {
  color: #90caf9;
}
.card {
  display: flex;
  flex-direction: column;
  flex: 0 0 146px;
  gap: 5px;
  padding: 8px;
  background: #263545;
  border: 3px solid #111;
  box-shadow: 3px 3px #000;
  text-align: center;
  font-size: 8px;
  transition: transform 0.15s;
}
.attack-card {
  border-color: #cb625e;
}
.defend-card {
  border-color: var(--shield);
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-cost {
  display: grid;
  place-items: center;
  background: var(--gold);
  color: #111;
  width: 24px;
  height: 24px;
}
.card-type {
  font-size: 7px;
}
.card-title {
  min-height: 28px;
}
.card-art {
  display: grid;
  place-items: center;
  height: 48px;
  background: #131e2b;
  border: 2px dashed #64798d;
  font: 28px monospace;
}
.card-description {
  flex: 1;
}
.energy-orb {
  display: grid;
  place-content: center;
  text-align: center;
  width: 68px;
  height: 60px;
  color: #111;
  background: var(--gold);
  border: 4px solid #8b5c12;
  clip-path: polygon(15% 0, 85% 0, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0 85%, 0 15%);
}
.energy-orb span {
  font-size: 7px;
}
.pile-counts {
  display: grid;
  font-size: 8px;
}
.action-btn {
  border: 3px solid #111;
  background: #335674;
  box-shadow: 3px 3px #000;
  padding: 10px;
}
.end-turn {
  background: var(--gold);
  color: #111;
}
/* Shared map connection skin and reveal animation. */
.connection {
  stroke: #60738e;
  stroke-width: 3;
  stroke-dasharray: 1;
  transition: opacity 1s;
}
.line-hidden {
  opacity: 0.08;
  stroke-dashoffset: 1;
}
.line-revealed {
  opacity: 0.5;
}
.line-draw {
  animation: draw-path 1s ease-out both;
}
.line-available {
  stroke: var(--gold);
  opacity: 1;
}
.line-traversed {
  stroke: #81c784;
  opacity: 0.85;
}
@keyframes draw-path {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}
/* Shared fixed-size pixel map node skin. */
.room-btn {
  position: relative;
  display: grid;
  place-content: center;
  gap: 4px;
  width: 112px;
  height: 76px;
  background: #243042;
  border: 3px solid #111;
  box-shadow: 0 3px #000;
  transition: opacity 1s;
  font-size: 8px;
}
.available-room {
  border-color: var(--gold);
}
.active-room {
  border-color: #00e676;
  background: #1b382b;
}
.completed-room {
  color: #81c784;
}
.fog-room {
  opacity: 0.2;
}
.completion-mark {
  position: absolute;
  top: 0;
  right: 4px;
}
```
