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
    } else if (room.floor === this.currentRoom.floor + 1) {
      const parent = this.allRooms.find(
        (candidate) =>
          candidate.floor === this.currentRoom.floor &&
          candidate.isCompleted &&
          candidate.nextRoomIds.includes(room.id),
      );
      if (parent) this.traversed.add(this.connectionId(parent, room));
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
    if (!this.isPaused && this.gameState !== 'VICTORY') return;
    this.sound.stopMusic();
    clearTimeout(this.revealTimer);
    if (this.browser && this.frame !== undefined) window.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.battle = null;
    this.gameState = 'START';
    this.playerType = null;
    this.discardMode = false;
    this.draggingCardId = null;
    if (this.isPaused) this.closeSettings();
    else this.syncBackground();
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
    if (
      (connection.from.id === this.currentRoom.id ||
        (connection.from.floor === this.currentRoom.floor &&
          connection.from.isCompleted &&
          connection.to.floor === this.currentRoom.floor + 1)) &&
      this.canSelectRoom(connection.to)
    )
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
