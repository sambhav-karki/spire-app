import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  battleOutcome,
  canMoveToRoom,
  completeRoom,
  createBattle,
  createPlayer,
  createStarterDeck,
  endTurn,
  generateMap,
  playCard,
  roomGameState,
  Room,
  visitRoom,
} from './game-logic';

describe('App', () => {
  beforeEach(async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });
  afterEach(() => vi.restoreAllMocks());

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
    expect(app.gameState).toBe('START');
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('WEBSLAYER SPIRE');
  });

  it('rejects selecting foggy rooms, even when connected', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    app.selectRoom(app.map[1][0]);
    expect(app.currentRoom.id).toBe('0.0');
    fixture.destroy();
  });

  it('resolves an encounter once and restores measurable map nodes', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.startRun();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const app = fixture.componentInstance;
    app.map[1][0].type = 'REST';
    app.selectRoom(app.map[1][0]);
    expect(app.gameState).toBe('REST');
    expect(app.currentRoom.isCompleted).toBe(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.map-container')).toBeNull();
    app.resolveEvent('HEAL');
    fixture.detectChanges();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await fixture.whenStable();
    expect(app.gameState).toBe('MAP');
    expect(app.currentRoom.isCompleted).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[data-room-id]').length).toBe(
      app.allRooms.length,
    );
    expect(app.connections.length).toBeGreaterThan(0);
  });

  it('defers battle completion and awards victory only once', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    const target = app.map[1][0];
    target.type = 'CREEP';
    target.isFog = false;
    app.selectRoom(target);
    expect(app.gameState).toBe('BATTLE');
    expect(target.isCompleted).toBe(false);
    const card = { id: 'finisher', name: 'Finisher', cost: 0, damage: 500, description: 'Win.' };
    app.battle!.hand = [card];
    app.battle!.player.hp = 70;
    app.play(card);
    expect(app.gameState).toBe('VICTORY');
    expect(target.isCompleted).toBe(true);
    expect(app.gold).toBe(20);
    expect(app.player.hp).toBe(70);
    app.play(card);
    expect(app.gold).toBe(20);
    app.returnToMap();
    app.selectRoom(app.map[0][0]);
    app.selectRoom(target);
    expect(app.gameState).toBe('MAP');
    expect(app.battle).toBeNull();
    fixture.destroy();
  });

  it('guards event claims and merchant purchases, and caps healing', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    const target = app.map[1][0];
    target.type = 'TREASURE';
    target.isFog = false;
    app.selectRoom(target);
    app.resolveEvent('CLAIM');
    app.resolveEvent('CLAIM');
    expect(app.gold).toBe(50);
    app.selectRoom(app.map[0][0]);
    target.isCompleted = false;
    target.type = 'SHOP';
    app.player.hp = 90;
    app.gold = 10;
    app.selectRoom(target);
    app.resolveEvent('BUY');
    expect(app.gameState).toBe('SHOP');
    expect(target.isCompleted).toBe(false);
    app.gold = 30;
    app.resolveEvent('BUY');
    expect(app.player.hp).toBe(100);
    expect(app.gold).toBe(0);
    fixture.destroy();
  });

  it('moves to game over and resets the run on restart', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    const target = app.map[1][0];
    target.type = 'BOSS';
    target.isFog = false;
    app.selectRoom(target);
    app.battle!.player.hp = 1;
    app.finishTurn();
    expect(app.gameState).toBe('GAME_OVER');
    expect(target.isCompleted).toBe(false);
    app.returnToMap();
    expect(app.gameState).toBe('GAME_OVER');
    app.restart();
    expect(app.gameState).toBe('MAP');
    expect(app.player.hp).toBe(100);
    expect(app.currentRoom.floor).toBe(0);
    expect(app.map[1][0].isFog).toBe(true);
    expect(app.battle).toBeNull();
    fixture.destroy();
  });

  it('pauses combat actions and resumes the exact same battle', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    const target = app.map[1][0];
    target.type = 'CREEP';
    target.isFog = false;
    app.selectRoom(target);
    fixture.detectChanges();
    const battle = app.battle;
    const card = app.battle!.hand[0]!;
    app.openSettings();
    expect(app.isPaused).toBe(true);
    expect(app.canPlay(card)).toBe(false);
    app.play(card);
    app.finishTurn();
    app.selectRoom(app.map[0][0]);
    expect(app.battle).toBe(battle);
    expect(app.currentRoom).toBe(target);
    app.resumeGame();
    expect(app.isPaused).toBe(false);
    expect(app.gameState).toBe('BATTLE');
    expect(app.battle).toBe(battle);
    fixture.destroy();
  });

  it('returns to title without late reveal and retains sound preferences', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    fixture.detectChanges();
    app.sound.setMusicVolume(0.12);
    app.sound.setSfxVolume(0.7);
    app.sound.setMuted(true);
    app.openSettings();
    app.returnToTitle();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(app.gameState).toBe('START');
    expect(app.isPaused).toBe(false);
    expect(app.battle).toBeNull();
    expect(app.sound.musicVolume).toBe(0.12);
    expect(app.sound.sfxVolume).toBe(0.7);
    expect(app.sound.isMuted).toBe(true);
    app.startRun();
    expect(app.gameState).toBe('MAP');
    expect(app.currentRoom.floor).toBe(0);
    expect(app.player.hp).toBe(100);
    fixture.destroy();
  });

  it('defers the initial fog reveal until gameplay resumes', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    fixture.detectChanges();
    app.openSettings();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(app.map[1][0].isFog).toBe(true);
    app.resumeGame();
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(app.map[1][0].isFog).toBe(false);
    fixture.destroy();
  });
});

describe('Dungeon rules', () => {
  it('routes encounters to the dedicated game states', () => {
    expect(roomGameState('INTRO')).toBe('MAP');
    expect(roomGameState('CREEP')).toBe('BATTLE');
    expect(roomGameState('ELITE')).toBe('BATTLE');
    expect(roomGameState('BOSS')).toBe('BATTLE');
    expect(roomGameState('REST')).toBe('REST');
    expect(roomGameState('TREASURE')).toBe('TREASURE');
    expect(roomGameState('SHOP')).toBe('SHOP');
    expect(roomGameState('MERCHANT')).toBe('SHOP');
  });
  const room = (
    id: string,
    floor: number,
    isCompleted = false,
    nextRoomIds: string[] = [],
  ): Room => ({
    id,
    floor,
    isCompleted,
    nextRoomIds,
    type: 'CREEP',
    isFog: true,
  });

  it('generates foggy branches with valid links and a reachable boss', () => {
    for (let sample = 0; sample < 100; sample++) {
      const map = generateMap();
      const rooms = map.flat();
      expect(map[0][0].type).toBe('REST');
      expect(map[1][0].type).toBe('INTRO');
      expect(map[4][0].type).toBe('BOSS');
      expect(rooms.filter((r) => !r.isFog).map((r) => r.floor)).toEqual([0]);
      for (const floor of map.slice(2, -1)) {
        expect(floor.length).toBeGreaterThanOrEqual(1);
        expect(floor.length).toBeLessThanOrEqual(3);
      }
      const reached = new Set([rooms[0].id]);
      for (const current of rooms) {
        for (const id of current.nextRoomIds) {
          const target = rooms.find((r) => r.id === id);
          expect(target?.floor).toBe(current.floor + 1);
          if (reached.has(current.id)) reached.add(id);
        }
      }
      expect(reached.size).toBe(rooms.length);
    }
  });

  it('supports forward, lateral, completed retreat and parent moves', () => {
    const current = room('2.0', 2, true, ['3.0']);
    expect(canMoveToRoom(current, current)).toBe(false);
    expect(canMoveToRoom(current, room('3.0', 3))).toBe(true);
    expect(canMoveToRoom(current, room('2.1', 2))).toBe(true);
    expect(canMoveToRoom(current, room('2.1', 2, true))).toBe(false);
    expect(canMoveToRoom(current, room('0.0', 0, true))).toBe(true);
    expect(canMoveToRoom(current, room('1.0', 1, false, ['2.0']))).toBe(true);
    expect(canMoveToRoom(current, room('1.1', 1))).toBe(false);
    expect(canMoveToRoom(current, room('3.1', 3))).toBe(false);
  });

  it('reveals only the visited room and its exits, deferring completion', () => {
    const current = room('1.0', 1, false, ['2.0']);
    const next = room('2.0', 2);
    const unrelated = room('2.1', 2);
    visitRoom(current, [current, next, unrelated]);
    expect(current.isCompleted).toBe(false);
    expect(current.isFog).toBe(false);
    expect(next.isFog).toBe(false);
    expect(next.isCompleted).toBe(false);
    expect(unrelated.isFog).toBe(true);
    completeRoom(current);
    expect(current.isCompleted).toBe(true);
  });
});

describe('Combat rules', () => {
  const battle = () => createBattle('CREEP', createPlayer(), createStarterDeck(), () => 0.5);

  it('creates scaled enemies and copies the persistent player and deck', () => {
    const player = createPlayer();
    const deck = createStarterDeck();
    const state = createBattle('BOSS', player, deck, () => 0.5);
    expect(state.enemy.hp).toBe(240);
    expect(state.enemyDamage).toBe(14);
    expect(state.enemy.intent).toEqual({ type: 'ATTACK', value: 14 });
    expect(createBattle('ELITE', player, deck).enemy.hp).toBe(85);
    expect(state.hand.length).toBe(5);
    expect(state.deck.length).toBe(5);
    expect(state.energy).toBe(3);
    state.player.hp = 1;
    state.hand[0]!.damage = 999;
    expect(player.hp).toBe(100);
    expect(deck.some((card) => card.damage === 999)).toBe(false);
  });

  it('spends energy, consumes enemy block and rejects repeated or unaffordable cards', () => {
    const state = battle();
    state.hand = [{ id: 'attack', name: 'Attack', cost: 1, damage: 12, description: '' }];
    state.enemy.block = 5;
    const next = playCard(state, 'attack');
    expect(next.enemy.hp).toBe(38);
    expect(next.enemy.block).toBe(0);
    expect(next.energy).toBe(2);
    expect(next.discard[0]!.id).toBe('attack');
    expect(next.hand).toEqual([]);
    expect(state.enemy.hp).toBe(45);
    expect(state.hand.length).toBe(1);
    expect(playCard(next, 'attack')).toBe(next);
    state.energy = 0;
    expect(playCard(state, 'attack')).toBe(state);
  });

  it('applies defense before enemy damage, then resets block and refills the hand', () => {
    const state = battle();
    state.hand = [{ id: 'guard', name: 'Guard', cost: 1, block: 8, description: '' }];
    const defended = playCard(state, 'guard');
    expect(defended.player.block).toBe(8);
    const next = endTurn(defended, () => 0.5);
    expect(next.player.hp).toBe(100);
    expect(next.player.block).toBe(0);
    expect(next.energy).toBe(3);
    expect(next.turn).toBe(2);
    expect(next.hand.length).toBe(5);
    expect(defended.player.block).toBe(8);
  });

  it('recycles discard without losing or duplicating card instances', () => {
    let state = battle();
    for (let turn = 0; turn < 6; turn++) {
      state.player.block = 100;
      state = endTurn(state, () => 0.5);
      const ids = [...state.deck, ...state.hand, ...state.discard].map((card) => card.id);
      expect(ids.length).toBe(10);
      expect(new Set(ids).size).toBe(10);
      expect(state.hand.length).toBe(5);
    }
  });

  it('clamps lethal damage and prevents actions after victory or defeat', () => {
    const state = battle();
    state.enemy.hp = 1;
    state.hand = [{ id: 'attack', name: 'Attack', cost: 1, damage: 12, description: '' }];
    const won = playCard(state, 'attack');
    expect(won.enemy.hp).toBe(0);
    expect(battleOutcome(won)).toBe('VICTORY');
    expect(endTurn(won)).toBe(won);
    state.player.hp = 1;
    const lost = endTurn(state);
    expect(lost.player.hp).toBe(0);
    expect(battleOutcome(lost)).toBe('GAME_OVER');
    expect(endTurn(lost)).toBe(lost);
    expect(playCard(lost, 'attack')).toBe(lost);
  });

  it('executes the advertised boss defense and keeps block for the player turn', () => {
    const state = createBattle('BOSS', createPlayer(), createStarterDeck(), () => 0.5);
    const second = endTurn(state, () => 0.5);
    expect(second.enemy.intent).toEqual({ type: 'DEFEND', value: 12 });
    const third = endTurn(second, () => 0.5);
    expect(third.player.hp).toBe(second.player.hp);
    expect(third.enemy.block).toBe(12);
    expect(third.enemy.intent).toEqual({ type: 'ATTACK', value: 14 });
    third.hand = [{ id: 'hit', name: 'Hit', cost: 0, damage: 15, description: '' }];
    const hit = playCard(third, 'hit');
    expect(hit.enemy.hp).toBe(237);
    expect(hit.enemy.block).toBe(0);
    expect(third.enemy.block).toBe(12);
  });

  it('buffs elite attack power and advertises the increased attack', () => {
    let state = createBattle('ELITE', createPlayer(), createStarterDeck(), () => 0.5);
    state = endTurn(
      endTurn(state, () => 0.5),
      () => 0.5,
    );
    expect(state.enemy.intent).toEqual({ type: 'BUFF', value: 2 });
    const next = endTurn(state, () => 0.5);
    expect(next.player.hp).toBe(state.player.hp);
    expect(next.enemyDamage).toBe(12);
    expect(next.enemy.intent).toEqual({ type: 'ATTACK', value: 12 });
    expect(state.enemyDamage).toBe(10);
    expect(endTurn(next, () => 0.5).player.hp).toBe(next.player.hp - 12);
  });
});
