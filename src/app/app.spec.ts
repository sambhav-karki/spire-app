import { TestBed } from '@angular/core/testing';
import { App } from './app';
import {
  battleOutcome,
  canMoveToRoom,
  completeRoom,
  createBattle,
  createPlayer,
  createStarterDeck,
  discardCard,
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

  it('requires a fighter choice and builds distinct elemental decks', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.selectFighter('FIRE');
    expect(app.gameState).toBe('START');
    app.startRun();
    expect(app.gameState).toBe('SELECT_FIGHTER');
    expect(app.playerType).toBeNull();
    app.selectFighter('FIRE');
    expect(app.gameState).toBe('MAP');
    expect(app.player.name).toBe('Ember Slayer');
    expect(app.playerDeck[0]!.damage).toBe(15);
    expect(app.playerDeck[5]!.block).toBe(8);
    app.gameState = 'VICTORY';
    app.restart();
    app.selectFighter('WATER');
    expect(app.player.name).toBe('Tide Guard');
    expect(app.playerDeck[0]!.damage).toBe(12);
    expect(app.playerDeck[5]!.block).toBe(12);
    fixture.destroy();
  });

  it('allows victory exit to title and preserves sound preferences', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    app.selectFighter('FIRE');
    app.returnToTitle();
    expect(app.gameState).toBe('MAP');
    app.sound.setMusicVolume(0.12);
    app.gameState = 'VICTORY';
    app.returnToTitle();
    expect(app.gameState).toBe('START');
    expect(app.battle).toBeNull();
    expect(app.playerType).toBeNull();
    expect(app.sound.activeTrack).toBeNull();
    expect(app.sound.musicVolume).toBe(0.12);
    fixture.destroy();
  });

  it('selects an unlocked sibling exit directly and records its actual map connection', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    app.selectFighter('FIRE');
    const cleared: Room = {
      id: '2.1',
      floor: 2,
      type: 'CREEP',
      isFog: false,
      isCompleted: true,
      nextRoomIds: ['3.1', '3.3'],
    };
    const current: Room = { ...cleared, id: '2.2', nextRoomIds: [] };
    const target: Room = { ...cleared, id: '3.3', floor: 3, isCompleted: false, nextRoomIds: [] };
    app.allRooms = [cleared, current, target];
    app.currentRoom = current;
    const connection = {
      id: '2.1->3.3',
      from: cleared,
      to: target,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      animate: false,
    };
    expect(app.canSelectRoom(target)).toBe(true);
    expect(app.connectionState(connection)).toBe('available');
    app.selectRoom(target);
    expect(app.currentRoom).toBe(target);
    expect(app.gameState).toBe('BATTLE');
    expect(app.connectionState(connection)).toBe('traversed');
    fixture.destroy();
  });

  it('guards discard actions while paused and lets unaffordable cards cycle', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    app.selectFighter('FIRE');
    const target = app.map[1][0];
    target.type = 'CREEP';
    target.isFog = false;
    app.selectRoom(target);
    app.battle!.energy = 0;
    const card = app.battle!.hand[0]!;
    expect(app.canPlay(card)).toBe(false);
    expect(app.canDiscard(card)).toBe(true);
    app.toggleDiscard();
    app.activateCard(card);
    expect(app.discardsRemaining).toBe(2);
    expect(app.battle!.energy).toBe(0);
    expect(app.battle!.discard).toContain(card);
    app.isPaused = true;
    const before = app.battle;
    app.discard(app.battle!.hand[0]!);
    expect(app.battle).toBe(before);
    app.isPaused = false;
    app.finishTurn();
    expect(app.discardsRemaining).toBe(3);
    expect(app.discardMode).toBe(false);
    fixture.destroy();
  });

  it('rejects selecting foggy rooms, even when connected', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    app.selectFighter('WATER');
    app.selectRoom(app.map[1][0]);
    expect(app.currentRoom.id).toBe('0.0');
    fixture.destroy();
  });

  it('resolves an encounter once and restores measurable map nodes', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.startRun();
    fixture.componentInstance.selectFighter('WATER');
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
    app.selectFighter('WATER');
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
    app.selectFighter('WATER');
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
    app.selectFighter('WATER');
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
    expect(app.gameState).toBe('SELECT_FIGHTER');
    app.selectFighter('WATER');
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
    app.selectFighter('WATER');
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
    app.selectFighter('WATER');
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
    app.selectFighter('WATER');
    expect(app.gameState).toBe('MAP');
    expect(app.currentRoom.floor).toBe(0);
    expect(app.player.hp).toBe(100);
    fixture.destroy();
  });

  it('defers the initial fog reveal until gameplay resumes', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.startRun();
    app.selectFighter('WATER');
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

  it('keeps cleared sibling exits available without allowing fogged rooms or skipped floors', () => {
    const cleared = room('2.1', 2, true, ['3.1', '3.3']);
    const current = room('2.2', 2, true);
    const first = { ...room('3.1', 3), isFog: false };
    const second = { ...room('3.3', 3), isFog: false };
    const rooms = [cleared, current, first, second];
    expect(canMoveToRoom(current, first, rooms)).toBe(true);
    expect(canMoveToRoom(current, second, rooms)).toBe(true);
    expect(canMoveToRoom(current, { ...first, isFog: true }, rooms)).toBe(false);
    expect(canMoveToRoom(current, { ...room('3.2', 3), isFog: false }, rooms)).toBe(false);
    expect(canMoveToRoom(current, { ...first, floor: 4 }, rooms)).toBe(false);
    cleared.isCompleted = false;
    expect(canMoveToRoom(current, first, rooms)).toBe(false);
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

  it('cycles only three cards per turn without spending energy or mutating input', () => {
    const initial = battle();
    let state = initial;
    for (let charge = 0; charge < 3; charge++) {
      const removed = state.hand[0]!;
      const before = state;
      state = discardCard(state, removed.id, () => 0.5);
      expect(state.hand).not.toContain(removed);
      expect(before.hand).toContain(removed);
      expect(state.hand.length).toBe(5);
      expect(state.energy).toBe(3);
      const ids = [...state.hand, ...state.deck, ...state.discard].map((card) => card.id);
      expect(new Set(ids).size).toBe(10);
      expect(ids.length).toBe(10);
    }
    expect(initial.discardsRemaining).toBe(3);
    expect(state.discardsRemaining).toBe(0);
    expect(discardCard(state, state.hand[0]!.id)).toBe(state);
    expect(endTurn(state).discardsRemaining).toBe(3);
  });

  it('recycles the old discard pile, handles empty piles, and rejects stale or terminal discards', () => {
    const state = battle();
    state.discard = state.deck;
    state.deck = [];
    const card = state.hand[0]!;
    const next = discardCard(state, card.id, () => 0.5);
    expect(next.hand.length).toBe(5);
    expect(next.discard).toEqual([card]);
    expect(next.deck.length).toBe(4);
    expect(discardCard(next, 'missing')).toBe(next);
    const empty = { ...state, deck: [], discard: [] };
    const cycled = discardCard(empty, card.id);
    expect(cycled.hand.length).toBe(4);
    expect(cycled.discard).toEqual([card]);
    state.enemy.hp = 0;
    expect(discardCard(state, card.id)).toBe(state);
  });

  it('creates scaled enemies and copies the persistent player and deck', () => {
    const player = createPlayer();
    const deck = createStarterDeck();
    const state = createBattle('BOSS', player, deck, () => 0.5);
    expect(state.enemy.hp).toBe(300);
    expect(state.enemyDamage).toBe(18);
    expect(state.enemy.intent).toEqual({ type: 'ATTACK', value: 18 });
    expect(createBattle('ELITE', player, deck).enemy.hp).toBe(100);
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
    expect(third.enemy.intent).toEqual({ type: 'ATTACK', value: 18 });
    third.hand = [{ id: 'hit', name: 'Hit', cost: 0, damage: 15, description: '' }];
    const hit = playCard(third, 'hit');
    expect(hit.enemy.hp).toBe(297);
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
    expect(next.enemyDamage).toBe(14);
    expect(next.enemy.intent).toEqual({ type: 'ATTACK', value: 14 });
    expect(state.enemyDamage).toBe(12);
    expect(endTurn(next, () => 0.5).player.hp).toBe(next.player.hp - 14);
  });

  it('enrages the boss exactly at half HP and doubles its displayed attack only once', () => {
    const state = createBattle('BOSS', createPlayer(), createStarterDeck());
    state.enemy.hp = 151;
    state.hand = [{ id: 'threshold', name: 'Hit', cost: 0, damage: 1, description: '' }];
    const enraged = playCard(state, 'threshold');
    expect(enraged.enemy.hp).toBe(150);
    expect(enraged.enemy.enraged).toBe(true);
    expect(enraged.enemyDamage).toBe(36);
    expect(enraged.enemy.intent).toEqual({ type: 'ATTACK', value: 36 });
    expect(state.enemy.enraged).toBe(false);
    expect(state.enemyDamage).toBe(18);
    const attacked = endTurn(enraged);
    expect(attacked.player.hp).toBe(64);
    expect(attacked.enemy.intent).toEqual({ type: 'DEFEND', value: 12 });
    attacked.hand = [{ id: 'again', name: 'Hit', cost: 0, damage: 1, description: '' }];
    const again = playCard(attacked, 'again');
    expect(again.enemyDamage).toBe(36);
    expect(again.enemy.intent).toEqual({ type: 'DEFEND', value: 12 });
    expect(endTurn(again).enemy.intent).toEqual({ type: 'ATTACK', value: 36 });
  });

  it('does not enrage above half HP, on lethal damage, or for other enemy types', () => {
    for (const type of ['BOSS', 'CREEP', 'ELITE'] as const) {
      const state = createBattle(type, createPlayer(), createStarterDeck());
      state.hand = [{ id: 'hit', name: 'Hit', cost: 0, damage: 1, description: '' }];
      state.enemy.hp = type === 'BOSS' ? 152 : 2;
      expect(playCard(state, 'hit').enemy.enraged).toBe(false);
      state.enemy.hp = 1;
      expect(playCard(state, 'hit').enemy.enraged).toBe(false);
    }
  });

  it('punishes rushing an enraged boss while guarding against its intent preserves HP', () => {
    const state = createBattle('BOSS', createPlayer(), createStarterDeck());
    state.enemy.hp = 150;
    state.player.hp = 33;
    const strike = { id: 'strike', name: 'Strike', cost: 1, damage: 12, description: '' };
    const guard = { id: 'guard', name: 'Guard', cost: 1, block: 12, description: '' };
    state.hand = [strike, guard];
    const rushed = playCard(state, strike.id);
    expect(battleOutcome(endTurn(rushed))).toBe('GAME_OVER');
    const guarded = playCard(rushed, guard.id);
    expect(endTurn(guarded).player.hp).toBe(9);
    expect(battleOutcome(endTurn(guarded))).toBe('ACTIVE');
  });
});
