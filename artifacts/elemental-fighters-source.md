# Elemental fighters and discard system

## src/app/app.ts

```ts
import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  HostListener,
  NgZone,
  OnDestroy,
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
  discardCard,
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

interface DonutParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pixel: number;
  color: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '[class.battle-active]': "gameState === 'BATTLE'",
    '[class.fire-theme]': "playerType === 'FIRE'",
    '[class.water-theme]': "playerType === 'WATER'",
  },
})
export class App implements AfterViewInit, OnDestroy {
  readonly sound = inject(SoundService);
  isPaused = false;
  playerType: 'FIRE' | 'WATER' | null = null;
  helpOpen = false;
  discardMode = false;
  draggingCardId: string | null = null;
  @ViewChild('helpDialog') private helpDialog?: ElementRef<HTMLDialogElement>;
  private helpOrigin?: HTMLElement;

  get discardsRemaining(): number {
    return this.battle?.discardsRemaining ?? 3;
  }
  @ViewChild('settingsDialog') private settingsDialog?: ElementRef<HTMLDialogElement>;
  private settingsOrigin?: HTMLElement;
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private revealTimer?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private frame?: number;
  private destroyed = false;
  @ViewChild('backgroundCanvas') private backgroundCanvas?: ElementRef<HTMLCanvasElement>;
  private backgroundContext: CanvasRenderingContext2D | null = null;
  private backgroundFrame?: number;
  private backgroundTimestamp?: number;
  private backgroundWidth = 0;
  private backgroundHeight = 0;
  private globalAngle = 0;
  private particles: DonutParticle[] = [];
  private reducedMotion?: MediaQueryList;
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

  ngAfterViewInit(): void {
    if (!this.browser) return;
    this.recalculateLines();
    this.zone.runOutsideAngular(() => {
      this.backgroundContext = this.backgroundCanvas?.nativeElement.getContext('2d') ?? null;
      if (!this.backgroundContext) return;
      this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.reducedMotion?.addEventListener('change', this.syncBackground);
      document.addEventListener('visibilitychange', this.syncBackground);
      this.resizeBackground();
      this.syncBackground();
    });
  }

  @HostListener('window:resize')
  onViewportResize(): void {
    if (!this.browser) return;
    this.resizeBackground();
    this.recalculateLines();
  }

  private resizeBackground(): void {
    const canvas = this.backgroundCanvas?.nativeElement;
    if (!canvas || !this.backgroundContext) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    for (const p of this.particles) {
      p.x *= width / this.backgroundWidth;
      p.y *= height / this.backgroundHeight;
    }
    canvas.width = this.backgroundWidth = width;
    canvas.height = this.backgroundHeight = height;
    this.backgroundContext.imageSmoothingEnabled = false;
    if (!this.particles.length) {
      const colors = ['rgba(95,64,160,.3)', 'rgba(35,160,177,.3)', 'rgba(98,122,151,.3)'];
      this.particles = Array.from({ length: 240 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 8,
        vy: 2 + Math.random() * 4,
        pixel: 2 + Math.floor(Math.random() * 3),
        color: colors[Math.floor(Math.random() * colors.length)]!,
      }));
    }
    this.drawBackground(0);
  }

  private readonly syncBackground = (): void => {
    if (!this.browser || !this.backgroundContext || this.destroyed) return;
    this.zone.runOutsideAngular(() => {
      if (this.backgroundFrame !== undefined) window.cancelAnimationFrame(this.backgroundFrame);
      this.backgroundFrame = undefined;
      this.backgroundTimestamp = undefined;
      if (document.hidden || this.isPaused || this.helpOpen || this.reducedMotion?.matches) {
        if (!document.hidden) this.drawBackground(0);
      } else this.backgroundFrame = window.requestAnimationFrame(this.renderBackground);
    });
  };

  private readonly renderBackground = (timestamp: number): void => {
    this.backgroundFrame = undefined;
    if (
      this.destroyed ||
      document.hidden ||
      this.isPaused ||
      this.helpOpen ||
      this.reducedMotion?.matches
    )
      return;
    const elapsed =
      this.backgroundTimestamp === undefined
        ? 0
        : Math.min(0.05, (timestamp - this.backgroundTimestamp) / 1000);
    this.backgroundTimestamp = timestamp;
    this.globalAngle = (this.globalAngle + elapsed * 0.3) % (Math.PI * 2);
    this.drawBackground(elapsed);
    this.backgroundFrame = window.requestAnimationFrame(this.renderBackground);
  };

  private drawBackground(elapsed: number): void {
    const ctx = this.backgroundContext;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.backgroundWidth, this.backgroundHeight);
    ctx.fillStyle =
      this.playerType === 'FIRE' ? '#1a0808' : this.playerType === 'WATER' ? '#08121a' : '#0c121c';
    ctx.fillRect(0, 0, this.backgroundWidth, this.backgroundHeight);
    for (const p of this.particles) {
      p.x += (this.playerType === 'FIRE' ? 8 : this.playerType === 'WATER' ? 4 : p.vx) * elapsed;
      p.y += (this.playerType === 'FIRE' ? -12 : this.playerType === 'WATER' ? -6 : p.vy) * elapsed;
      if (p.x < -16) p.x = this.backgroundWidth + 16;
      if (p.x > this.backgroundWidth + 16) p.x = -16;
      if (p.y > this.backgroundHeight + 16) p.y = -16;
      ctx.save();
      ctx.translate(
        Math.round(p.x + (this.playerType === 'WATER' ? Math.sin(this.globalAngle) * 4 : 0)),
        Math.round(p.y),
      );
      ctx.fillStyle =
        this.playerType === 'FIRE' ? '#bb4238' : this.playerType === 'WATER' ? '#278caa' : p.color;
      for (let row = -1; row <= 1; row++) {
        for (let column = -1; column <= 1; column++) {
          const fire = this.playerType === 'FIRE';
          if (
            fire
              ? row === -1
                ? column === 0
                : row === 0 || column === 0
              : row !== 0 || column !== 0
          )
            ctx.fillRect(column * p.pixel, row * p.pixel, p.pixel, p.pixel);
        }
      }
      ctx.restore();
    }
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
        this.discardMode = false;
        this.draggingCardId = null;
        this.battleMessage = 'Your turn. Play cards or end your turn.';
        this.gameState = 'BATTLE';
        this.sound.playMusic('BATTLE');
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

  canDiscard(card?: Card): boolean {
    return (
      !this.isPaused &&
      this.gameState === 'BATTLE' &&
      !!this.battle &&
      battleOutcome(this.battle) === 'ACTIVE' &&
      this.discardsRemaining > 0 &&
      (card ? this.battle.hand.some((held) => held.id === card.id) : this.battle.hand.length > 0)
    );
  }

  toggleDiscard(): void {
    if (!this.canDiscard()) return;
    this.discardMode = !this.discardMode;
    this.sound.click();
  }

  activateCard(card: Card): void {
    if (this.discardMode) this.discard(card);
    else this.play(card);
  }

  discard(card: Card): void {
    if (!this.battle || !this.canDiscard(card)) return;
    this.battle = discardCard(this.battle, card.id);
    this.battleMessage = `Discarded ${card.name}. ${this.discardsRemaining}/3 charges left.`;
    if (!this.discardsRemaining) this.discardMode = false;
    this.draggingCardId = null;
    this.sound.card();
    this.cdr.markForCheck();
  }

  startCardDrag(event: DragEvent, card: Card): void {
    if (!this.canDiscard(card)) {
      event.preventDefault();
      return;
    }
    this.draggingCardId = card.id;
    event.dataTransfer?.setData('text/plain', card.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  allowDiscardDrop(event: DragEvent): void {
    if (this.draggingCardId && this.canDiscard()) event.preventDefault();
  }

  dropCard(event: DragEvent): void {
    event.preventDefault();
    const card = this.battle?.hand.find((held) => held.id === this.draggingCardId);
    if (card) this.discard(card);
    this.draggingCardId = null;
  }

  finishTurn(): void {
    if (this.isPaused || this.gameState !== 'BATTLE' || !this.battle) return;
    this.sound.click();
    const hp = this.battle.player.hp;
    const { name, intent } = this.battle.enemy;
    this.battle = endTurn(this.battle);
    this.discardMode = false;
    this.draggingCardId = null;
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
    this.sound.playMusic('MAP');
    this.cdr.markForCheck();
    this.recalculateLines();
  }

  restart(): void {
    if (this.isPaused || (this.gameState !== 'GAME_OVER' && this.gameState !== 'VICTORY')) return;
    this.sound.click();
    this.playerType = null;
    this.gameState = 'SELECT_FIGHTER';
    this.sound.stopMusic();
    this.syncBackground();
    this.cdr.markForCheck();
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
    this.player.name = this.playerType === 'FIRE' ? 'Ember Slayer' : 'Tide Guard';
    this.playerDeck = this.playerDeck.map((card) => {
      const damage =
        card.damage === undefined ? undefined : card.damage + (this.playerType === 'FIRE' ? 3 : 0);
      const block =
        card.block === undefined ? undefined : card.block + (this.playerType === 'WATER' ? 4 : 0);
      return {
        ...card,
        damage,
        block,
        name:
          damage !== undefined
            ? (this.playerType === 'FIRE' ? 'Ember ' : 'Tide ') + card.name
            : this.playerType === 'WATER'
              ? 'Tidal Guard'
              : card.name,
        description: damage !== undefined ? `Deal ${damage} damage.` : `Gain ${block} block.`,
      };
    });
    this.discardMode = false;
    this.draggingCardId = null;
    this.battle = null;
    this.gold = this.rewardGold = 0;
    this.bossDefeated = false;
    this.battleMessage = '';
    this.traversed.clear();
    this.revealedConnections.clear();
    this.connections = [];
    this.gameState = 'MAP';
    this.sound.playMusic('MAP');
    this.scheduleInitialReveal();
    this.cdr.markForCheck();
  }

  startRun(): void {
    if (this.isPaused || this.gameState !== 'START') return;
    void this.sound.unlock().then(() => {
      if (!this.destroyed) this.sound.click();
    });
    this.playerType = null;
    this.gameState = 'SELECT_FIGHTER';
    this.syncBackground();
    this.cdr.markForCheck();
  }

  selectFighter(type: 'FIRE' | 'WATER'): void {
    if (this.isPaused || this.helpOpen || this.gameState !== 'SELECT_FIGHTER') return;
    this.playerType = type;
    this.sound.click();
    this.resetRun();
    this.syncBackground();
  }

  openHelp(): void {
    if (this.isPaused || this.helpOpen || this.gameState !== 'SELECT_FIGHTER') return;
    if (this.browser && document.activeElement instanceof HTMLElement)
      this.helpOrigin = document.activeElement;
    this.helpOpen = true;
    this.syncBackground();
    this.cdr.detectChanges();
    const dialog = this.helpDialog?.nativeElement;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    this.sound.click();
  }

  closeHelp(event?: Event): void {
    event?.preventDefault();
    const dialog = this.helpDialog?.nativeElement;
    if (dialog?.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    this.helpOpen = false;
    this.syncBackground();
    this.helpOrigin?.focus();
    this.helpOrigin = undefined;
  }

  openSettings(): void {
    if (this.isPaused || this.helpOpen) return;
    if (this.browser && document.activeElement instanceof HTMLElement) {
      this.settingsOrigin = document.activeElement;
    }
    this.isPaused = true;
    this.syncBackground();
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
    this.syncBackground();
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
    this.playerType = null;
    this.discardMode = false;
    this.draggingCardId = null;
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

  recalculateLines(): void {
    this.scheduleMeasurement();
  }

  private readonly scheduleMeasurement = (): void => {
    if (!this.browser || this.destroyed || !this.mapContainer || this.frame !== undefined) return;
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
      document.removeEventListener('visibilitychange', this.syncBackground);
      this.reducedMotion?.removeEventListener('change', this.syncBackground);
      if (this.backgroundFrame !== undefined) window.cancelAnimationFrame(this.backgroundFrame);
      if (this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    }
  }
}

```

## src/app/app.html

```html
<canvas #backgroundCanvas id="bg-canvas" aria-hidden="true"></canvas>
<button
  type="button"
  class="settings-launcher action-btn"
  aria-label="Pause and sound settings"
  aria-haspopup="dialog"
  [disabled]="isPaused || helpOpen"
  (click)="openSettings()"
>
  <span class="pixel-settings" aria-hidden="true"></span>
</button>
<main class="viewport-wrapper" [inert]="isPaused || helpOpen">
  @if (gameState === 'START') {
    <section class="title-screen" aria-labelledby="title-logo">
      <div class="title-crest" aria-hidden="true">&#9876;</div>
      <h1 id="title-logo">WEBSLAYER <br />SPIRE</h1>
      <p class="press-start">PRESS START</p>
      <button type="button" class="action-btn" (click)="startRun()">START GAME</button>
      <button type="button" class="action-btn" (click)="openSettings()">SETTINGS</button>
    </section>
  }
  @if (gameState === 'SELECT_FIGHTER') {
    <section class="fighter-screen" aria-labelledby="fighter-title">
      <header class="fighter-header">
        <h1 id="fighter-title">CHOOSE YOUR FIGHTER</h1>
        <button
          type="button"
          class="action-btn help-button"
          aria-label="Help with fighter elements"
          aria-haspopup="dialog"
          (click)="openHelp()"
        >
          ?
        </button>
      </header>
      <div class="fighter-options">
        <button type="button" class="fighter-card fire-fighter" (click)="selectFighter('FIRE')">
          <span class="fighter-element">FIRE / OFFENSE</span>
          <span class="fighter-portrait" aria-hidden="true"
            ><span class="pixel-flame"></span><span>[FIRE SPRITE GIF]</span></span
          >
          <strong>EMBER SLAYER</strong>
          <span>STRIKE 15 / GUARD 8</span>
          <span>Fiery strikes. +3 attack damage.</span>
          <span class="fighter-pick">SELECT FIRE</span>
        </button>
        <button type="button" class="fighter-card water-fighter" (click)="selectFighter('WATER')">
          <span class="fighter-element">WATER / DEFENSE</span>
          <span class="fighter-portrait" aria-hidden="true"
            ><span class="pixel-droplet"></span><span>[WATER SPRITE GIF]</span></span
          >
          <strong>TIDE GUARD</strong>
          <span>STRIKE 12 / GUARD 12</span>
          <span>Sturdy shields. +4 guard block.</span>
          <span class="fighter-pick">SELECT WATER</span>
        </button>
      </div>
    </section>
  }
  @if (gameState !== 'BATTLE' && gameState !== 'START' && gameState !== 'SELECT_FIGHTER') {
    <h1 class="center-text">WebSlayer Spire</h1>
    <p class="center-text" aria-live="polite">
      Currently standing in: <strong>Room {{ currentRoom.id }} ({{ currentRoom.type }})</strong>
    </p>
  }
  @if (gameState === 'MAP') {
    <p class="center-text map-help">
      Choose a glowing room to continue. Explore your floor or return to cleared rooms.
    </p>
    <div class="map-space">
      <div #mapContainer class="map-container" aria-label="Dungeon map">
        <svg
          class="map-connections map-overlay"
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

  @if (gameState !== 'BATTLE' && gameState !== 'START' && gameState !== 'SELECT_FIGHTER') {
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
              <span class="sprite-caption">[PLAYER SPRITE]</span>
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
              <span class="sprite-caption">[ENEMY SPRITE]</span>
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
              [disabled]="discardMode ? !canDiscard(card) : !canPlay(card) && !canDiscard(card)"
              [class.discard-choice]="discardMode"
              [class.card-unaffordable]="!discardMode && !canPlay(card)"
              [attr.draggable]="canDiscard(card)"
              (dragstart)="startCardDrag($event, card)"
              (dragend)="draggingCardId = null"
              (click)="activateCard(card)"
              [attr.aria-label]="
                (discardMode ? 'Discard ' : 'Play ') +
                card.name +
                ', costs ' +
                card.cost +
                ' energy. ' +
                card.description
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
          <button
            type="button"
            class="action-btn discard-button"
            [class.discard-active]="discardMode"
            [class.drop-ready]="draggingCardId"
            [disabled]="!canDiscard()"
            [attr.aria-pressed]="discardMode"
            (click)="toggleDiscard()"
            (dragover)="allowDiscardDrop($event)"
            (drop)="dropCard($event)"
          >
            <span>{{ discardMode ? 'CANCEL' : 'DISCARD CARD' }}</span>
            <span aria-live="polite">{{ discardsRemaining }}/3</span>
          </button>
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
<dialog #helpDialog class="help-dialog" aria-labelledby="help-title" (cancel)="closeHelp($event)">
  <section class="help-panel">
    <button
      type="button"
      class="action-btn help-close"
      aria-label="Close element help"
      (click)="closeHelp()"
    >
      X
    </button>
    <h2 id="help-title">ELEMENT GUIDE</h2>
    <p class="fire-text"><strong>FIRE / EMBER SLAYER</strong></p>
    <p>
      Aggressive offense: fiery strikes deal +3 damage. Break through enemy shields with powerful
      attacks.
    </p>
    <p class="water-text"><strong>WATER / TIDE GUARD</strong></p>
    <p>
      Sturdy defense: guards grant +4 block. Sustain your HP by shielding against the displayed
      enemy intent, then counterattack.
    </p>
    <p>
      Both fighters can heal at rest sites. Discard up to 3 cards per turn to draw replacements
      without spending energy.
    </p>
  </section>
</dialog>
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
  position: fixed;
  inset: 0;
  display: block;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
}
#bg-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  pointer-events: none;
  z-index: 0;
  image-rendering: pixelated;
}
.viewport-wrapper {
  position: relative;
  z-index: 1;
  width: 100vw;
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  box-sizing: border-box;
  overflow: hidden;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.viewport-wrapper > .center-text {
  flex: 0 0 auto;
  margin: clamp(2px, 1dvh, 8px) 12px;
  font-size: clamp(8px, 1.5vw, 10px);
}

.viewport-wrapper > h1 {
  padding-right: 52px;
  font-size: clamp(10px, 3.5vw, 16px);
}

.map-space {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
.map-container {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column-reverse;
  justify-content: space-evenly;
  align-items: center;
  height: 100%;
  padding: clamp(8px, 2dvh, 16px) clamp(8px, 2vw, 16px);
  margin: 0 auto;
  width: 100%;
  max-width: 600px;
  box-sizing: border-box;
  overflow: hidden;
  container-type: size;
  background: #182532b3;
}
.floor-row {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  min-height: 0;
  gap: clamp(8px, 3vw, 24px);
  position: relative;
}
.room-btn {
  position: relative;
  z-index: 2;
  opacity: 1;
  background-color: #161f2b;
  width: auto;
  height: auto;
  max-height: 18cqh;
  min-height: min(44px, 18cqh);
  min-width: min(clamp(60px, 18vw, 110px), 28%);
  flex: 0 1 110px;
  gap: min(4px, 1cqh);
  padding: min(clamp(6px, 1.5dvh, 12px), 2cqh) clamp(10px, 2.5vw, 18px);
  font-size: clamp(8px, 1.8vw, 12px);
  line-height: 1.4;
  text-align: center;
  touch-action: manipulation;
}
.room-btn.completed-room {
  opacity: 1;
  background-color: #161f2b;
  border-color: #37474f;
  color: #78909c;
}
.room-btn.fog-room {
  opacity: 0.2;
}
.map-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.title-screen {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 12px;
  gap: clamp(4px, 2dvh, 16px);
}
.title-screen .title-crest {
  font-size: clamp(28px, 12dvh, 80px);
}
.title-screen h1 {
  font-size: clamp(16px, min(5vw, 7dvh), 40px);
}
.title-screen p {
  margin: 0;
}
.settings-dialog,
.settings-panel,
.result-overlay,
.result-panel,
.event-screen,
.battle-message {
  overflow: hidden;
}
.event-screen,
.result-panel {
  min-height: 0;
  max-height: 100%;
  margin: clamp(4px, 2dvh, 24px) auto;
  padding: clamp(4px, 2dvh, 16px);
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
  background: #111c2980;
}
.event-screen,
.result-panel {
  background: #182532e6;
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
  justify-content: space-between;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 12px 24px;
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
.hero-stage {
  align-self: center;
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
    flex-direction: row;
    padding: 4px;
    gap: 6px;
  }
  .enemy-stage {
    order: 0;
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
    gap: 3px;
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

:host.fire-theme {
  --element: #ff7054;
  --slate: #2d0f0f;
}
:host.water-theme {
  --element: #65d9f0;
  --slate: #0d1e2d;
}
:host.fire-theme .hero-art {
  background: #ef6844;
}
:host.water-theme .hero-art {
  background: #49bdd9;
}
.hero-stage h2 {
  color: var(--element, #fbc02d);
}
.combatant {
  width: 44%;
  text-align: center;
}
.combatant .sprite-frame {
  width: clamp(44px, 14vw, 120px);
  height: clamp(44px, 14vw, 120px);
}
.combatant .hp-track {
  width: 100%;
  max-width: 180px;
}
.sprite-caption {
  font-size: 6px;
}
.battle-actions > * {
  min-width: 0;
}
.discard-button {
  display: grid;
  gap: 2px;
  font-size: 8px;
  padding: 6px;
  min-width: 44px;
}
.discard-active,
.drop-ready,
.discard-choice {
  border-color: #fbc02d;
}
.drop-ready {
  background: #664820;
}

.fighter-screen {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(8px, 3dvh, 24px);
  padding: 68px 12px 12px;
}
.fighter-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.fighter-header h1 {
  margin: 0;
  font-size: clamp(10px, 2.6vw, 20px);
  text-align: center;
}
.help-button {
  flex: 0 0 44px;
  padding: 0;
}
.fighter-options {
  display: flex;
  justify-content: center;
  gap: clamp(8px, 3vw, 32px);
  min-height: 0;
}
.fighter-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(6px, 2dvh, 16px);
  flex: 0 1 280px;
  min-width: 0;
  border: 4px solid transparent;
  background: transparent;
  padding: clamp(6px, 2vw, 16px);
  font-size: clamp(7px, 1.2vw, 10px);
  transition: transform 0.12s steps(2);
}
.fire-fighter {
  --fighter: #ff7054;
}
.water-fighter {
  --fighter: #65d9f0;
}
.fighter-card:hover,
.fighter-card:focus-visible {
  border-color: var(--fighter);
  transform: translateY(-4px);
  background: #182532;
}
.fighter-element,
.fighter-pick {
  color: var(--fighter);
}
.fighter-portrait {
  width: min(140px, 26vw);
  height: min(140px, 26vw, 26dvh);
  display: grid;
  place-items: center;
  background: #161f2b;
  image-rendering: pixelated;
  font-size: 6px;
  padding: 6px;
}
.help-dialog {
  border: 0;
  padding: 12px;
  width: 100vw;
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  background: #080e17ed;
  overflow: hidden;
}
.help-dialog[open] {
  display: grid;
  place-items: center;
}
.help-dialog::backdrop {
  background: #0009;
}
.help-panel {
  position: relative;
  width: 100%;
  max-width: 520px;
  max-height: 100%;
  padding: 16px;
  border: 4px solid #fbc02d;
  background: #182532;
  font-size: clamp(8px, 1.4vw, 10px);
}
.help-panel h2 {
  padding-right: 48px;
  font-size: 12px;
  margin-top: 0;
}
.help-close {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 0;
  width: 44px;
}
.fire-text {
  color: #ff7054;
}
.water-text {
  color: #65d9f0;
}
@media (max-width: 400px) {
  .pile-counts {
    font-size: 6px;
  }
  .energy-orb {
    width: 44px;
  }
  .discard-button,
  .end-turn {
    font-size: 7px;
    padding: 4px;
  }
  .combatant h2,
  .intent {
    font-size: 7px;
  }
}
@media (max-height: 450px) {
  .combatant {
    display: grid;
    grid-template-columns: 44px 1fr;
    grid-template-areas: 'name name' 'sprite health' 'sprite hp' 'sprite block';
    column-gap: 6px;
  }
  .enemy-stage {
    grid-template-areas: 'intent intent' 'name name' 'sprite health' 'sprite hp' 'sprite block';
  }
  .combatant h2 {
    grid-area: name;
  }
  .combatant .sprite-frame {
    grid-area: sprite;
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
    font-size: 8px;
  }
  .arena {
    padding-block: 0;
  }
  .fighter-screen {
    padding-top: 60px;
    gap: 6px;
  }
  .fighter-card {
    gap: 4px;
    font-size: 7px;
    padding: 4px;
  }
  .fighter-portrait {
    height: 70px;
  }
  .pixel-flame,
  .pixel-droplet {
    width: 28px;
    height: 36px;
  }
  .combatant .sprite-frame {
    width: 44px;
    height: 44px;
  }
  .help-panel {
    font-size: 8px;
    padding: 8px;
  }
  .help-panel p {
    margin: 6px 0;
  }
  .card-art {
    display: none;
  }
}
@media (max-height: 450px) {
  .viewport-wrapper > .center-text {
    margin-block: 2px;
    line-height: 1.3;
  }
  .map-help {
    display: none;
  }
  .room-btn {
    font-size: 8px;
    padding-block: min(6px, 1cqh);
    gap: 0;
  }
  .settings-panel {
    grid-template-columns: 1fr 1fr;
    align-items: center;
  }
  .settings-panel h2 {
    grid-column: 1 / -1;
    margin: 0;
  }

  .combatant {
    gap: 2px;
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
    font-size: 6px;
  }
  .card-description {
    font-size: 6px;
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

## src/app/game-logic.ts

```ts
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
  discardsRemaining: number;
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
    discardsRemaining: 3,
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
  next.discardsRemaining = 3;
  next.enemy.intent = calculateEnemyIntent(next.enemy.type, next.turn, next.enemyDamage);
  drawHand(next, random);
  return next;
}

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
  height: 100dvh;
  max-height: 100dvh;
  background: #0c121c;
  color: #f4ecd8;
  overscroll-behavior: none;
  overflow: hidden;
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
.card-unaffordable {
  opacity: 0.45;
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

/* Shared combat skins; component CSS owns responsive layout overrides. */
app-root h1 {
  font-size: 16px;
  color: var(--gold);
}
app-root .combatant h2 {
  font-size: 10px;
  margin: 0;
}
app-root .elite-sprite {
  width: 120px;
  height: 120px;
}
app-root .boss-sprite {
  width: 160px;
  height: 160px;
}
app-root .battle-message {
  flex-shrink: 0;
  margin: 0;
  height: 34px;
  overflow-y: auto;
  overflow-x: hidden;
  color: #ffe082;
  font-size: 9px;
}
app-root .card:not(:disabled):active {
  transform: translateY(-8px);
}
@media (hover: hover) {
  app-root .card:not(:disabled):hover {
    transform: translateY(-8px);
  }
}

/* Pixel fighter portraits and settings icon. */
.pixel-flame,
.pixel-droplet {
  width: 44px;
  height: 52px;
  background: var(--fighter);
  clip-path: polygon(
    50% 0,
    65% 30%,
    80% 20%,
    100% 70%,
    80% 100%,
    20% 100%,
    0 70%,
    25% 40%,
    30% 65%
  );
}
.pixel-droplet {
  clip-path: polygon(
    45% 0,
    55% 0,
    55% 20%,
    70% 20%,
    70% 40%,
    85% 40%,
    85% 80%,
    70% 80%,
    70% 100%,
    30% 100%,
    30% 80%,
    15% 80%,
    15% 40%,
    30% 40%,
    30% 20%,
    45% 20%
  );
}
.pixel-settings {
  display: block;
  width: 20px;
  height: 20px;
  margin: auto;
  border: 6px solid #f4ecd8;
  box-shadow:
    0 -4px #f4ecd8,
    0 4px #f4ecd8,
    -4px 0 #f4ecd8,
    4px 0 #f4ecd8;
}

```

