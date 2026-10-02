# WebSlayer Spire responsive title, pause and audio: complete sources

Includes all six requested files plus the font entry point and shared pixel stylesheet required by the implementation.

## src/app/sound.service.ts

```typescript
import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';

/** Gesture-unlocked, asset-free audio. One context and one music scheduler per app. */
@Injectable({ providedIn: 'root' })
export class SoundService implements OnDestroy {
  isMuted = false;
  sfxVolume = 0.5;
  musicVolume = 0.25;

  get isAvailable(): boolean {
    return this.context !== undefined;
  }
  get audioState(): AudioContextState | 'unavailable' {
    return this.context?.state ?? 'unavailable';
  }
  get isMusicPlaying(): boolean {
    return this.timer !== undefined;
  }

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly zone = inject(NgZone);
  private context?: AudioContext;
  private master?: GainNode;
  private sfxGain?: GainNode;
  private musicGain?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private readonly voices = new Map<AudioScheduledSourceNode, boolean>();
  private musicWanted = false;
  private paused = false;
  private destroyed = false;
  private nextBeat = 0;
  private step = 0;

  constructor() {
    if (this.browser) document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  /** Call directly from a user gesture; unavailable browsers remain playable silently. */
  async unlock(): Promise<void> {
    if (!this.browser || this.destroyed) return;
    try {
      if (!this.context) {
        const Constructor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) return;
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.sfxGain = this.context.createGain();
        this.musicGain = this.context.createGain();
        this.sfxGain.connect(this.master);
        this.musicGain.connect(this.master);
        this.master.connect(this.context.destination);
        this.updateGains();
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this.syncMusic();
    } catch {
      // Audio is optional when device/browser policy denies an audio context.
    }
  }

  click(): void {
    this.tone('square', 740, 240, 0.04, 0.14);
  }

  card(): void {
    this.tone('triangle', 440, 660, 0.09, 0.45);
    this.tone('triangle', 660, 880, 0.12, 0.35, 0.08);
  }

  hit(): void {
    this.tone('sawtooth', 160, 35, 0.12, 0.32);
    const ctx = this.context;
    if (!this.canPlay() || !ctx || !this.sfxGain) return;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.08), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    const envelope = this.envelope(ctx.currentTime, 0.08, 0.22, this.sfxGain);
    noise.connect(filter);
    filter.connect(envelope);
    this.track(noise, false, () => {
      filter.disconnect();
      envelope.disconnect();
    });
    noise.start();
    noise.stop(ctx.currentTime + 0.08);
  }

  startMusic(): void {
    this.musicWanted = true;
    this.syncMusic();
  }
  stopMusic(): void {
    this.musicWanted = false;
    this.syncMusic();
  }
  setPaused(value: boolean): void {
    this.paused = value;
    this.syncMusic();
  }
  setMuted(value: boolean): void {
    this.isMuted = value;
    this.updateGains();
    if (value) this.stopVoices(false);
    this.syncMusic();
  }
  setSfxVolume(value: number): void {
    this.sfxVolume = this.clamp(value);
    this.updateGains();
  }
  setMusicVolume(value: number): void {
    this.musicVolume = this.clamp(value);
    this.updateGains();
    this.syncMusic();
  }

  private clamp(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  private canPlay(): boolean {
    return (
      !this.destroyed && !this.isMuted && this.context?.state === 'running' && !document.hidden
    );
  }

  private updateGains(): void {
    const ctx = this.context;
    if (!ctx) return;
    this.master?.gain.setValueAtTime(this.isMuted ? 0 : 1, ctx.currentTime);
    this.sfxGain?.gain.setTargetAtTime(this.sfxVolume, ctx.currentTime, 0.01);
    this.musicGain?.gain.setTargetAtTime(this.musicVolume, ctx.currentTime, 0.01);
  }

  private envelope(
    time: number,
    duration: number,
    volume: number,
    destination: GainNode,
  ): GainNode {
    const ctx = this.context!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    gain.connect(destination);
    return gain;
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    volume: number,
    delay = 0,
    music = false,
  ): void {
    const ctx = this.context;
    const destination = music ? this.musicGain : this.sfxGain;
    if (!this.canPlay() || !ctx || !destination) return;
    const time = ctx.currentTime + Math.max(0, delay);
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
    const gain = this.envelope(time, duration, volume, destination);
    oscillator.connect(gain);
    this.track(oscillator, music, () => gain.disconnect());
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
  }

  private track(source: AudioScheduledSourceNode, music: boolean, cleanup: () => void): void {
    this.voices.set(source, music);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      cleanup();
    };
  }

  private stopVoices(musicOnly: boolean): void {
    for (const [voice, music] of this.voices) {
      if (musicOnly && !music) continue;
      try {
        voice.stop();
      } catch {
        /* A voice may already have ended. */
      }
    }
  }

  private readonly visibilityChanged = (): void => {
    this.syncMusic();
  };

  private syncMusic(): void {
    if (!this.musicWanted || this.paused || !this.canPlay() || this.musicVolume === 0) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.stopVoices(true);
      return;
    }
    if (this.timer !== undefined) return;
    this.nextBeat = this.context!.currentTime + 0.02;
    this.zone.runOutsideAngular(() => {
      this.scheduleMusic();
      this.timer = setInterval(() => this.scheduleMusic(), 25);
    });
  }

  private scheduleMusic(): void {
    const ctx = this.context;
    if (!ctx || !this.canPlay()) {
      this.syncMusic();
      return;
    }
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.02;
    // A minor, F major, C major, G major; sixteen sixteenth-notes per chord.
    const roots = [57, 53, 60, 55];
    while (this.nextBeat < ctx.currentTime + 0.1) {
      const beatChord = Math.floor(this.step / 16) % roots.length;
      const beatRoot = roots[beatChord];
      const third = beatChord === 0 ? 3 : 4;
      const offsets = [0, third, 7, 12];
      const midi = beatRoot + offsets[this.step % 4] + 12;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const delay = this.nextBeat - ctx.currentTime;
      this.tone('square', frequency, frequency, 0.1, 0.11, delay, true);
      if (this.step % 4 === 0) {
        const bass = 440 * 2 ** ((beatRoot - 12 - 69) / 12);
        this.tone('triangle', bass, bass, 0.4, 0.34, delay, true);
      }
      this.step = (this.step + 1) % 64;
      this.nextBeat += 0.125;
    }
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.musicWanted = false;
    if (this.browser) document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.stopVoices(false);
    void this.context?.close().catch(() => undefined);
  }
}
```

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
  INITIAL_GAME_STATE,
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
  roomGameState,
  playCard,
  upgradeDeck,
  visitRoom,
} from './game-logic';
import { SoundService } from './sound.service';

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
  readonly sound = inject(SoundService);
  isPaused = false;
  @ViewChild('settingsDialog') private settingsDialog?: ElementRef<HTMLDialogElement>;
  private settingsOrigin?: HTMLElement;
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
  gameState: GameState = INITIAL_GAME_STATE;
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
  }

  private scheduleInitialReveal(): void {
    clearTimeout(this.revealTimer);
    if (!this.browser) return;
    this.revealTimer = setTimeout(() => {
      if (this.destroyed || this.isPaused || this.gameState !== 'MAP') return;
      visitRoom(this.currentRoom, this.allRooms);
      this.cdr.detectChanges();
      this.scheduleMeasurement();
    }, 150);
  }

  canSelectRoom(room: Room): boolean {
    return (
      this.gameState === 'MAP' &&
      !this.isPaused &&
      !room.isFog &&
      canMoveToRoom(this.currentRoom, room, this.allRooms)
    );
  }

  selectRoom(room: Room): void {
    if (!this.canSelectRoom(room)) return;
    this.sound.click();
    if (this.currentRoom.nextRoomIds.includes(room.id)) {
      this.traversed.add(this.connectionId(this.currentRoom, room));
    } else if (room.nextRoomIds.includes(this.currentRoom.id)) {
      this.traversed.add(this.connectionId(room, this.currentRoom));
    }
    this.currentRoom = room;
    visitRoom(room, this.allRooms);
    if (!room.isCompleted) {
      const state = roomGameState(room.type);
      if (state === 'BATTLE' && isBattleRoom(room.type)) {
        this.battle = createBattle(room.type, this.player, this.playerDeck);
        this.battleMessage = 'Your turn. Play cards or end your turn.';
        this.gameState = 'BATTLE';
      } else {
        this.gameState = state;
        if (state === 'MAP') completeRoom(room);
      }
    }
    this.cdr.markForCheck();
  }

  canPlay(card: Card): boolean {
    return (
      !this.isPaused &&
      this.gameState === 'BATTLE' &&
      this.battle !== null &&
      canPlayCard(this.battle, card.id)
    );
  }

  play(card: Card): void {
    if (!this.battle || !this.canPlay(card)) return;
    const enemyHp = this.battle.enemy.hp;
    this.sound.card();
    this.battle = playCard(this.battle, card.id);
    if (this.battle.enemy.hp < enemyHp) this.sound.hit();
    this.battleMessage = `Played ${card.name}.`;
    this.resolveBattle();
  }

  finishTurn(): void {
    if (this.isPaused || this.gameState !== 'BATTLE' || !this.battle) return;
    this.sound.click();
    const hp = this.battle.player.hp;
    const { name, intent } = this.battle.enemy;
    this.battle = endTurn(this.battle);
    if (intent.type === 'ATTACK') this.sound.hit();
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
    if (
      this.isPaused ||
      !['REST', 'TREASURE', 'SHOP'].includes(this.gameState) ||
      this.currentRoom.isCompleted
    )
      return;
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
      this.isPaused ||
      (this.gameState !== 'VICTORY' &&
        !(['REST', 'TREASURE', 'SHOP'].includes(this.gameState) && this.currentRoom.isCompleted))
    )
      return;
    this.sound.click();
    this.battle = null;
    this.gameState = 'MAP';
    this.cdr.markForCheck();
  }

  restart(): void {
    if (this.isPaused || (this.gameState !== 'GAME_OVER' && this.gameState !== 'VICTORY')) return;
    this.sound.click();
    this.resetRun();
  }

  private resetRun(): void {
    clearTimeout(this.revealTimer);
    if (this.browser && this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
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

  startRun(): void {
    if (this.isPaused || this.gameState !== 'START') return;
    this.sound.startMusic();
    void this.sound.unlock().then(() => {
      if (!this.destroyed) this.sound.click();
    });
    this.resetRun();
  }

  openSettings(): void {
    if (this.isPaused) return;
    if (this.browser && document.activeElement instanceof HTMLElement) {
      this.settingsOrigin = document.activeElement;
    }
    this.isPaused = true;
    this.sound.setPaused(true);
    void this.sound.unlock().then(() => {
      if (!this.destroyed) this.sound.click();
    });
    this.cdr.detectChanges();
    const dialog = this.settingsDialog?.nativeElement;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }

  resumeGame(): void {
    if (!this.isPaused) return;
    this.closeSettings();
    this.sound.click();
    if (this.gameState === 'MAP' && this.map[1][0].isFog) this.scheduleInitialReveal();
    this.cdr.markForCheck();
  }

  private closeSettings(): void {
    const dialog = this.settingsDialog?.nativeElement;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    this.isPaused = false;
    this.sound.setPaused(false);
    this.cdr.detectChanges();
    if (this.settingsOrigin?.isConnected) this.settingsOrigin.focus();
    this.settingsOrigin = undefined;
  }

  returnToTitle(): void {
    if (!this.isPaused) return;
    this.sound.stopMusic();
    clearTimeout(this.revealTimer);
    if (this.browser && this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.battle = null;
    this.gameState = 'START';
    this.closeSettings();
    this.sound.click();
    this.cdr.markForCheck();
  }

  onSettingsCancel(event: Event): void {
    event.preventDefault();
    this.resumeGame();
  }

  setMusicVolume(event: Event): void {
    const value = this.sliderValue(event);
    if (value !== null) this.sound.setMusicVolume(value);
  }

  setSfxVolume(event: Event): void {
    const value = this.sliderValue(event);
    if (value !== null) this.sound.setSfxVolume(value);
  }

  private sliderValue(event: Event): number | null {
    const input = (event.currentTarget ?? event.target) as HTMLInputElement | null;
    const value = Number(input?.value);
    return input && Number.isFinite(value) ? value : null;
  }

  toggleMute(): void {
    this.sound.setMuted(!this.sound.isMuted);
    this.sound.click();
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
    this.sound.stopMusic();
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
<button
  type="button"
  class="settings-launcher action-btn"
  aria-label="Pause and sound settings"
  aria-haspopup="dialog"
  [disabled]="isPaused"
  (click)="openSettings()"
>
  &#9881;
</button>
<main class="viewport-wrapper" [inert]="isPaused">
  @if (gameState === 'START') {
    <section class="title-screen" aria-labelledby="title-logo">
      <div class="title-crest" aria-hidden="true">&#9876;</div>
      <h1 id="title-logo">WEBSLAYER <br />SPIRE</h1>
      <p class="press-start">PRESS START</p>
      <button type="button" class="action-btn" (click)="startRun()">START RUN</button>
      <button type="button" class="action-btn" (click)="openSettings()">SETTINGS</button>
    </section>
  }
  @if (gameState !== 'BATTLE' && gameState !== 'START') {
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

  @if (gameState !== 'BATTLE' && gameState !== 'START') {
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
        <div class="hand" role="group" aria-label="Your cards">
          @for (card of combat.hand; track card.id) {
            <button
              class="card"
              type="button"
              [class.attack-card]="card.damage !== undefined"
              [class.defend-card]="card.block !== undefined"
              [disabled]="!canPlay(card)"
              (click)="play(card)"
              [attr.aria-label]="
                card.name + ', costs ' + card.cost + ' energy. ' + card.description
              "
            >
              <span class="card-top"
                ><span class="card-cost" [attr.aria-label]="card.cost + ' energy'">{{
                  card.cost
                }}</span>
                <span class="card-type">{{
                  card.damage !== undefined
                    ? 'ATTACK'
                    : card.block !== undefined
                      ? 'SKILL'
                      : 'POWER'
                }}</span></span
              >
              <strong class="card-title">{{ card.name }}</strong>
              <span class="card-art" aria-hidden="true">
                @if (card.damage !== undefined) {
                  &#9876;
                } @else if (card.block !== undefined) {
                  &#9670;
                } @else {
                  &#10022;
                }
              </span>
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
  @if (gameState === 'REST' || gameState === 'TREASURE' || gameState === 'SHOP') {
    <section class="event-screen" aria-labelledby="event-title">
      <h2 id="event-title">{{ eventTitle }}</h2>
      @switch (gameState) {
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
          <button type="button" class="action-btn" (click)="resolveEvent('LEAVE')">
            Leave shop
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
</main>
<dialog
  #settingsDialog
  class="settings-dialog"
  aria-labelledby="settings-title"
  (cancel)="onSettingsCancel($event)"
>
  <section class="settings-panel">
    <h2 id="settings-title">PAUSE &amp; SOUND</h2>
    <label for="music-volume"
      >Music <output>{{ (sound.musicVolume * 100).toFixed(0) }}%</output></label
    >
    <input
      id="music-volume"
      type="range"
      min="0"
      max="1"
      step="0.05"
      [value]="sound.musicVolume"
      (input)="setMusicVolume($event)"
      aria-label="Music volume"
    />
    <label for="sfx-volume"
      >Sound effects <output>{{ (sound.sfxVolume * 100).toFixed(0) }}%</output></label
    >
    <input
      id="sfx-volume"
      type="range"
      min="0"
      max="1"
      step="0.05"
      [value]="sound.sfxVolume"
      (input)="setSfxVolume($event)"
      aria-label="Sound effects volume"
    />
    <button
      type="button"
      class="action-btn"
      [attr.aria-pressed]="sound.isMuted"
      (click)="toggleMute()"
    >
      {{ sound.isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO' }}
    </button>
    <button type="button" class="action-btn" (click)="resumeGame()">Resume Game</button>
    <button type="button" class="action-btn" (click)="returnToTitle()">Return to Title</button>
  </section>
</dialog>
```

## src/app/app.css

```css
:host {
  display: block;
  min-height: 100dvh;
  overflow-x: hidden;
}
.viewport-wrapper {
  width: 100vw;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  padding: 20px 12px;
}

.viewport-wrapper > h1 {
  padding-right: 52px;
  font-size: clamp(10px, 3.5vw, 16px);
}
h1 {
  font-size: 16px;
  color: var(--gold);
}

.map-scroll {
  width: 100%;
  padding: 12px 0;
}
.map-container {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column-reverse;
  gap: 48px;
  padding: 24px 8px;
  margin: auto;
  width: 100%;
  max-width: 440px;
  background: var(--slate);
}
.floor-row {
  display: flex;
  justify-content: center;
  gap: clamp(6px, 3vw, 24px);
  position: relative;
  z-index: 1;
}
.room-btn {
  width: 112px;
  max-width: 112px;
  min-width: 44px;
  flex: 0 1 112px;
  padding: 2px;
  font-size: clamp(7px, 2vw, 8px);
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
  min-height: 0;
  overflow: hidden;
}
:host.battle-active .viewport-wrapper {
  padding: 0;
}
.battle-screen {
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right))
    max(8px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  background: #111c29;
}
.battle-header,
.battle-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}
.battle-header {
  padding-right: 60px;
  min-height: 48px;
}
.battle-header h1 {
  font-size: 12px;
  margin: 0;
}

.arena {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 12px;
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

.battle-message {
  flex-shrink: 0;
  margin: 0;
  height: 34px;
  overflow-y: auto;
  overflow-x: hidden;
  color: #ffe082;
  font-size: 9px;
}
.hand {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 14px 0 6px;
  align-items: flex-end;
  justify-content: center;
}
.card {
  flex: 0 1 146px;
  min-width: 44px;
  max-width: 146px;
  padding: clamp(2px, 1vw, 8px);
  overflow-wrap: anywhere;
}
.card:not(:disabled):active {
  transform: translateY(-8px);
}
@media (hover: hover) {
  .card:not(:disabled):hover {
    transform: translateY(-8px);
  }
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
  .card {
    font-size: 7px;
    gap: 3px;
  }
  .card-art,
  .card-type {
    display: none;
  }
  .card-title {
    min-height: 24px;
  }
  .card-cost {
    width: 20px;
    height: 20px;
  }
  .card-description {
    font-size: 7px;
  }
  .battle-actions {
    gap: 6px;
  }
  .end-turn {
    font-size: 8px;
    padding: 8px;
  }
  .pile-counts {
    font-size: 7px;
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
    column-gap: 8px;
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
  .hand {
    padding: 8px 0 2px;
  }
  .card {
    padding: 2px;
  }
  .settings-panel {
    padding: 10px;
    gap: 4px;
  }
  .title-screen {
    gap: 6px;
  }
  .title-crest {
    font-size: 44px;
  }
  .title-screen h1 {
    font-size: 20px;
  }
}
```

## SKILL.md

```markdown
---
name: webslayer-spire
description: Develop the Angular WebSlayer Spire map, encounters, card battles, title flow and synthesized audio.
---

# WebSlayer Spire architecture

Read relevant source and tests before editing. Use standalone Angular and modern @if/@for templates. Keep pure domain rules independent of DOM, audio and presentation.

## Worker boundaries and execution order

For upgrades explicitly requesting these workers, execute them in order: Worker 1 owns src/app/sound.service.ts; Worker 2 owns src/app/game-logic.ts; Worker 3 owns src/app/app.html and app.css; Worker 4 owns src/app/app.ts and this document. Shared pixel theme, title/pause/event/result skins, sprites, card/intent/HP skins and reduced motion live in src/styles.css; component CSS keeps viewport and responsive layout overrides. src/index.html loads Press Start 2P with fallback fonts and display=swap. Keep component styles within production size budgets.

## State and run lifecycle

GameState is START | MAP | BATTLE | REST | TREASURE | SHOP | VICTORY | GAME_OVER. INITIAL_GAME_STATE is START. Pure roomGameState routes CREEP/ELITE/BOSS to BATTLE, REST to REST, TREASURE to TREASURE, SHOP/MERCHANT to SHOP and INTRO to MAP.

START shows title without revealing rooms. Start Run resets map, player, persistent deck, gold, battle, completion and traversal history; enters MAP; unlocks gesture audio and starts music. Floor 0 is cleared REST and the only initially unfogged floor. Reveal floor 1 after 150ms so Angular paints the initial fog. Callback guards destruction, pause and title return; resume reschedules interrupted initial reveal.

Only unpaused MAP permits movement. Reject occupied room and fogged UI targets. Allow forward exits, uncompleted lateral rooms, completed lower rooms and direct parents. visitRoom reveals room and exits without completing encounters. INTRO completes immediately. Cleared rooms never repeat rewards.

Battle outcome becomes VICTORY or GAME_OVER. Victory persists HP, completes room and awards gold once: 20 creep, 35 elite, 100 boss. Boss victory records bossDefeated. Return to map preserves run; terminal restart creates a new run. REST heals 30% max HP or upgrades damage cards by 3; TREASURE grants 50 gold; SHOP/MERCHANT sells a 30%-HP heal for 30 gold or allows leaving. Buying requires missing HP and sufficient gold. Resolution completes once and returns to MAP.

Pause is an orthogonal isPaused flag, never a replacement gameState. All gameplay, navigation, restart and reward actions reject calls while paused. Preserve battle identity, turn, energy and cards. Native dialog.showModal traps browser focus; viewport becomes inert. Escape resumes. Close restores originating control focus. Return to Title cancels reveal/layout callbacks, clears battle and stops music; sound preferences survive. The next Start Run resets run data. Native dialog calls are guarded for browser/test compatibility.

## Audio engine API

Inject public readonly SoundService into App. unlock(): Promise<void> creates/resumes AudioContext from user gestures and tolerates unsupported or denied audio. Gameplay never depends on audio availability. click() emits a 40ms descending square blip; card() emits ascending triangle chimes; hit() combines descending sawtooth and generated filtered noise. No external audio assets are used.

startMusic()/stopMusic() manage a looping square arpeggio and triangle bass. setPaused(boolean) suspends music while retaining playback intent. Tab visibility gates scheduling. setMuted(boolean), setSfxVolume(number), setMusicVolume(number) update separate gains with finite values clamped to 0–1. Public local state: isMuted, sfxVolume, musicVolume. Diagnostics: audioState, isAvailable, isMusicPlaying. Preferences survive run resets in the same service instance.

Valid room/button actions play click. Cards play chime and impact when enemy HP decreases. Enemy ATTACK emits impact; DEFEND and BUFF do not. One context and one outside-Angular look-ahead scheduler serve the app. Finished nodes disconnect; mute stops voices; destruction clears timers/listeners and closes context.

## Combat invariants

Combatant owns name, current/max HP and block. Card owns unique instance ID, name, cost, optional damage/block and description. Enemy adds room type and advertised ATTACK/DEFEND/BUFF intent. BattleState owns snapshots, draw pile, hand, discard, energy, turn and enemyDamage. Persistent deck stays separate from battle piles.

Combat functions return new objects and never mutate inputs. Battles shuffle copies, draw five cards and start with three energy. Optional RNG injection supports deterministic tests. Reject missing, unaffordable and terminal card actions. Play spends energy, resolves damage through block, grants block and discards. End turn expires old enemy block, executes exactly displayed intent, discards hand and, if alive, resets player block, refills energy, advances turn, derives next intent and draws five. New enemy block persists through the following player turn. Shuffle discard only when draw is empty. HP never goes negative.

Cultist: 45 HP and 6 attack, always attacks. Gremlin Nob: 85 HP and 10 base attack, buffs +2 every third turn. Guardian: 240 HP and 14 attack, defends for 12 when turn modulo 3 equals 2. Display the exact intent executed by endTurn. Card numeric effects derive from damage/block fields so upgrades remain accurate.

## Map and responsive viewport lifecycle

MAP exists in a conditional view. ViewChild setter disconnects old ResizeObserver and schedules measurement whenever map reappears. requestAnimationFrame measures room-button centers relative to container; guard absent/destroyed views. Preserve traversed and revealed-connection sets across encounters; clear on restart. Newly revealed normalized SVG dash paths animate once; returning to map does not replay known paths. Destroy cleans timer, observer, frame and listener. Guard browser APIs with isPlatformBrowser.

Viewport wrapper uses overflow-x:hidden, width:100vw, max-width:100% and border-box sizing. Map rooms shrink inside available width. Battle uses fixed host, height:100dvh, max-height:100dvh, hidden overflow and safe-area padding. Header, message, hand and footer reserve space; arena consumes remainder. Desktop stages are side by side; mobile enemy appears above hero; short landscape screens use compact status grids and side-by-side stages.

Hand uses flex, 6px gaps, centered justification, bottom alignment, 100% width/max-width and shrinking cards. Never allow horizontal hand/map scrolling. Hide card artwork before semantic HP, intent or effects. Touch targets remain at least 44px with touch-action:manipulation; preserve browser zoom, accessible names and focus outlines. Affordable cards lift on hover/tap. Reduced motion disables decoration.

Settings launcher stays fixed top-right at 12px with z-index 1000. Dialog centers pixel-bordered panel over dark overlay, allows vertical overflow in short viewports, and contains music/SFX sliders, mute, resume and title actions. Title has WEBSLAYER SPIRE, animated crest, flickering PRESS START, Start Run and Settings.

Sprites remain CSS placeholders with HERO/CREEP/ELITE/BOSS badges. Preserve frame geometry and accessible labels when adding artwork. Use image-rendering:pixelated, dungeon slate/gold, red HP, blue block and amber energy.

## Validation

Use npm.cmd run build, npx.cmd tsc --noEmit -p tsconfig.app.json and npm.cmd test -- --watch=false in Windows PowerShell. Cover fog/navigation, deferred completion, immutable combat, costs/block/draw recycling, advertised intents, terminal/paused guards, reward idempotence, persistent HP, title/reset and conditional map restoration.

scripts/ui-check.cjs uses installed headless Chrome and dev server http://127.0.0.1:4200. Check viewport/control/stage bounds, tap targets, absent horizontal overflow, font loading, title/settings and map restoration at 1280x800, 390x844, 320x568, 844x390 and 568x320. Screenshots go to artifacts. Browser launch and production font fetching may require sandbox approval.

Audio tests cover gesture-only initialization, single-context/scheduler behavior, oscillator SFX, volume/mute controls, paused and hidden-tab scheduling, unsupported browsers, and idempotent cleanup. Browser checks use trusted mouse input to unlock native audio, then verify running music, paused combat identity, focus containment, sliders, oscillator types, and retained settings on title return. `scripts/export-source.cjs` writes complete implementation files and their shared-style dependencies to `artifacts/responsive-audio-source.md`.
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
  overflow-x: hidden;
  max-width: 100%;
}
body,
button {
  font-family: 'Press Start 2P', monospace, sans-serif;
  font-size: 10px;
  line-height: 1.7;
}
input[type='range'] {
  width: 100%;
  min-height: 44px;
  touch-action: manipulation;
  accent-color: var(--gold);
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

/* Shared title and pause panel pixel skin. */
.settings-launcher {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  width: 44px;
  height: 44px;
  padding: 0;
  font: 24px monospace;
}
.settings-dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  max-width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  padding: 12px;
  border: 0;
  background: #000d;
  overflow-y: auto;
}
.settings-dialog:not([open]) {
  display: none;
}
.settings-dialog[open] {
  display: flex;
  justify-content: center;
  align-items: center;
}
.settings-dialog::backdrop {
  background: #0009;
}
.settings-panel {
  display: grid;
  gap: 8px;
  width: 100%;
  max-width: 380px;
  max-height: 100%;
  overflow-y: auto;
  padding: 20px;
  border: 4px solid var(--gold);
  background: var(--slate);
  box-shadow: 6px 6px #000;
}
.settings-panel h2 {
  font-size: 12px;
}
.settings-panel label {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.settings-panel input {
  width: 100%;
  min-width: 0;
  accent-color: var(--gold);
}
.title-screen {
  min-height: calc(100dvh - 40px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
}
app-root .title-screen h1 {
  font-size: clamp(20px, 5vw, 40px);
  line-height: 1.7;
  text-shadow: 4px 4px #873a36;
  margin: 0;
}
.title-crest {
  font: 80px monospace;
  color: var(--gold);
  text-shadow: 4px 4px #000;
  animation: float 2s ease-in-out infinite;
}
.press-start {
  animation: flicker 1.4s steps(2, end) infinite;
}
.title-screen .action-btn {
  width: 220px;
  max-width: 100%;
}
@keyframes float {
  50% {
    transform: translateY(-10px);
  }
}
@keyframes flicker {
  50% {
    opacity: 0.35;
  }
}

/* Shared encounter and result panel skin. */
.event-screen,
.result-panel {
  max-width: 650px;
  margin: 24px auto;
  padding: 16px;
  border: 3px solid var(--gold);
  background: var(--slate);
  text-align: center;
}
.event-screen .action-btn,
.result-panel .action-btn {
  margin: 6px;
  max-width: 100%;
}
.result-overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  overflow-y: auto;
  background: #080e17ed;
  padding: 12px;
}

/* Shared pixel text colors and alignment. */
.center-text {
  text-align: center;
}
.map-help,
.room-id,
.status-effects {
  color: #aebfcc;
}
.gold,
.card-description strong {
  color: var(--gold);
}
.arena-vs {
  color: #5e7184;
}
```
