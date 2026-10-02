const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spire-ui-'));
const port = 10000 + Math.floor(Math.random() * 40000);
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let socket;
let id = 0;
const pending = new Map();
async function command(method, params = {}) {
  const request = ++id;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(request);
      reject(new Error(`Timed out: ${method}`));
    }, 15000);
    pending.set(request, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: request, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function tap(selector) {
  const position = await evaluate(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...position,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...position,
  });
  await delay(100);
}
(async () => {
  let targets;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      break;
    } catch {
      await delay(200);
    }
  }
  assert(targets, 'Headless Chrome did not start');
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const url = `http://127.0.0.1:4200/?uiCheck=${Date.now()}`;
  await command('Page.navigate', { url });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      await evaluate(
        `Boolean(location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && window.ng && document.querySelector('app-root') && ng.getComponent(document.querySelector('app-root')))`,
      )
    )
      break;
    await delay(200);
  }
  await evaluate(`document.fonts.ready.then(() => true)`);
  fs.mkdirSync('artifacts', { recursive: true });
  assert(
    await evaluate(`ng.getComponent(document.querySelector('app-root')).gameState === 'START'`),
    'App must begin on title',
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 568,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const titleScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('artifacts/title-320x568.png', Buffer.from(titleScreenshot.data, 'base64'));
  await evaluate(`(() => {
    window.audioOscillators = [];
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function(...args) {
      const oscillator = original.apply(this, args); window.audioOscillators.push(oscillator); return oscillator;
    };
  })()`);
  await tap('.title-screen .action-btn');
  assert(
    await evaluate(
      `ng.getComponent(document.querySelector('app-root')).gameState === 'SELECT_FIGHTER' && !document.querySelector('.map-container')`,
    ),
    'Start must require a fighter choice',
  );
  await tap('.help-button');
  assert(
    await evaluate(
      `document.querySelector('.help-dialog:not(.deck-dialog)').open && document.querySelector('.viewport-wrapper').inert`,
    ),
    'Help must trap focus and make selection inert',
  );
  await tap('.help-dialog:not(.deck-dialog) .help-close');
  await tap('.water-fighter');
  assert(
    await evaluate(
      `(() => { const app = ng.getComponent(document.querySelector('app-root')); return app.gameState === 'MAP' && app.sound.activeTrack === 'MAP' && app.sound.audioState === 'running' && app.sound.isMusicPlaying; })()`,
    ),
    'Start gesture must unlock synthesized music',
  );
  console.log('START -> MAP and trusted-gesture audio unlock passed.');
  await delay(1100);
  await evaluate(
    `(() => { const app = ng.getComponent(document.querySelector('app-root')); app.selectRoom(app.map[1][0]); ng.applyChanges(app); })()`,
  );
  await delay(1100);
  assert(
    await evaluate(
      `document.querySelectorAll('.sam-jr-cluster img').length === 4 && ng.getComponent(document.querySelector('app-root')).battle.enemy.name === 'Sam Jr'`,
    ),
    'Intro must fight four spinning Sam Jr avatars',
  );
  await evaluate(
    `(() => { const app = ng.getComponent(document.querySelector('app-root')); const card = { id: 'intro-win', name: 'Win', cost: 0, damage: 100, description: '' }; app.battle.hand = [card]; app.play(card); app.returnToMap(); ng.applyChanges(app); })()`,
  );
  assert(
    await evaluate(`(() => {
    const app = ng.getComponent(document.querySelector('app-root'));
    const cleared = getComputedStyle(document.querySelector('.completed-room'));
    const fog = getComputedStyle(document.querySelector('.fog-room'));
    return cleared.opacity === '1' && cleared.backgroundColor === 'rgb(22, 31, 43)' && cleared.zIndex === '2' && fog.opacity === '0.2' && getComputedStyle(document.querySelector('.map-overlay')).zIndex === '1' && app.particles.length === 240;
  })()`),
    'Completed room must be opaque above routes, with fog limited to undiscovered rooms',
  );
  const angle = await evaluate(`ng.getComponent(document.querySelector('app-root')).globalAngle`);
  await delay(100);
  assert(
    await evaluate(`ng.getComponent(document.querySelector('app-root')).globalAngle > ${angle}`),
    'Donut rotation must animate',
  );
  await command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await delay(50);
  assert(
    await evaluate(
      `ng.getComponent(document.querySelector('app-root')).backgroundFrame === undefined`,
    ),
    'Reduced motion must stop background animation',
  );
  await command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  console.log('Opaque room stacking, 240 synchronized donuts and reduced-motion behavior passed.');
  for (const [width, height] of [
    [1280, 800],
    [390, 844],
    [320, 568],
    [844, 390],
    [568, 320],
  ]) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 769,
    });
    await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      app.gameState = 'SELECT_FIGHTER'; ng.applyChanges(app);
    })()`);
    assert(
      await evaluate(`(() => {
      const elements = [...document.querySelectorAll('.fighter-card, .fighter-header')];
      return elements.every(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }) && document.scrollingElement.scrollHeight <= innerHeight && document.scrollingElement.scrollWidth <= innerWidth;
    })()`),
      width + 'x' + height + ': Fighter selection must fit',
    );
    await tap('.help-button');
    assert(
      await evaluate(`(() => {
      const panel = document.querySelector('.help-dialog:not(.deck-dialog) .help-panel'), r = panel.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && panel.scrollHeight <= panel.clientHeight && document.querySelector('.help-dialog:not(.deck-dialog)').contains(document.activeElement);
    })()`),
      'Help must fit and contain focus',
    );
    await tap('.help-dialog:not(.deck-dialog) .help-close');
    const selectionShot = await command('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      'artifacts/fighter-select-' + width + 'x' + height + '.png',
      Buffer.from(selectionShot.data, 'base64'),
    );
    const fire = width === 390 || width === 844;
    await tap(fire ? '.fire-fighter' : '.water-fighter');
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const canvas = document.querySelector('#bg-canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = ${fire ? '[26, 8, 8]' : '[8, 18, 26]'};
      return app.playerType === '${fire ? 'FIRE' : 'WATER'}' && pixels.some((value, index) => index % 4 === 0 && value === colors[0] && pixels[index + 1] === colors[1] && pixels[index + 2] === colors[2]);
    })()`),
      'Element selection must repaint the canvas palette',
    );
    await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      app.gameState = 'MAP'; app.currentRoom = app.map[0][0]; app.player.hp = 100;
      const room = app.map[1][0]; room.type = 'BOSS'; room.isFog = false; room.isCompleted = false;
      app.selectRoom(room); ng.applyChanges(app);
    })()`);
    await delay(200);
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const canvas = document.querySelector('#bg-canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return app.sound.activeTrack === 'BATTLE' && canvas.width === innerWidth && canvas.height === innerHeight && pixels.some((value, index) => index % 4 === 3 && value > 0);
    })()`),
      'Battle theme and correctly resized, painted canvas required',
    );
    const layout = await evaluate(`(() => {
      const bounds = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
      const hand = document.querySelector('.hand');
      return { viewport: [innerWidth, innerHeight], battle: bounds('.battle-screen'), arena: bounds('.arena'), hero: bounds('.hero-stage'), enemy: bounds('.enemy-stage'), hand: bounds('.hand'), button: bounds('.end-turn'), energy: bounds('.energy-orb'),
        bodyScroll: document.scrollingElement.scrollHeight, cards: [...document.querySelectorAll('.card')].map(card => { const r = card.getBoundingClientRect(); return [r.width,r.height,r.left,r.right] }),
        handOverflow: hand.scrollWidth > hand.clientWidth,
        loadedPixelFont: document.fonts.check('10px "Press Start 2P"') };
    })()`);
    await tap('.deck-launcher');
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const panel = document.querySelector('.deck-panel'); const r = panel.getBoundingClientRect();
      return app.isPaused && document.querySelector('.deck-dialog').open && panel.scrollHeight <= panel.clientHeight && r.top >= 0 && r.bottom <= innerHeight && document.querySelectorAll('.deck-entry').length === ng.getComponent(document.querySelector('app-root')).visibleDeck.length;
    })()`),
      'Deck viewer must pause gameplay and fit without scrolling',
    );
    await tap('.deck-pages button:last-child');
    assert(
      await evaluate(
        `ng.getComponent(document.querySelector('app-root')).deckPage === Math.min(1, ng.getComponent(document.querySelector('app-root')).deckPages - 1)`,
      ),
      'Deck pages must show the whole persistent deck',
    );
    await tap('.deck-dialog .help-close');
    assert(
      await evaluate(`!ng.getComponent(document.querySelector('app-root')).isPaused`),
      'Closing deck must resume gameplay',
    );
    for (const name of ['battle', 'arena', 'hand', 'button', 'energy']) {
      assert(
        layout[name].top >= -1 && layout[name].bottom <= layout.viewport[1] + 1,
        `${width}x${height}: ${name} clipped: ${JSON.stringify(layout)}`,
      );
    }
    assert(
      layout.button.width >= 44 && layout.button.height >= 44,
      'End-turn tap target too small',
    );
    for (const name of ['hero', 'enemy'])
      assert(
        layout[name].top >= layout.arena.top - 1 && layout[name].bottom <= layout.arena.bottom + 1,
        `${width}x${height}: ${name} overlaps arena boundary: ${JSON.stringify(layout)}`,
      );
    assert(
      layout.hero.right < layout.enemy.left,
      'Player must stay left of enemy at every viewport',
    );
    assert(
      layout.cards.every(([w, h]) => w >= 44 && h >= 44),
      'Card tap target too small',
    );
    assert(layout.bodyScroll <= layout.viewport[1] + 1, 'Battle causes page scrolling');
    assert(!layout.handOverflow, 'The entire hand must fit without horizontal scrolling');
    assert(
      layout.cards.every(([, , left, right]) => left >= -1 && right <= width + 1),
      'Cards overflow viewport',
    );
    await tap('.discard-button');
    await tap('.card');
    assert(
      await evaluate(
        `(() => { const app = ng.getComponent(document.querySelector('app-root')); return app.discardsRemaining === 2 && app.battle.energy === 3 && app.battle.hand.length === 5; })()`,
      ),
      'Click discard must draw a replacement for one charge',
    );
    await tap('.discard-button');
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const card = document.querySelector('.card'), zone = document.querySelector('.discard-button');
      const id = app.battle.hand[0].id;
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
      return app.discardsRemaining === 1 && app.battle.discard.some(card => card.id === id) && app.battle.hand.length === 5 && app.battle.energy === 3;
    })()`),
      'Drag drop must use the same guarded discard rules',
    );
    assert(
      await evaluate(`document.scrollingElement.scrollWidth <= innerWidth`),
      'Page scrolls horizontally',
    );
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      `artifacts/responsive-battle-${width}x${height}.png`,
      Buffer.from(screenshot.data, 'base64'),
    );
    const before = await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const button = document.querySelector('.card:not(:disabled)');
      const result = { energy: app.battle.energy, hand: app.battle.hand.length };
      button.click(); return result;
    })()`);
    await delay(50);
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      return app.battle.energy < ${before.energy} && app.battle.hand.length === ${before.hand - 1};
    })()`),
      'Card button did not spend energy and leave the hand',
    );
    await evaluate(`document.querySelector('.end-turn').click()`);
    await delay(50);
    assert(
      await evaluate(`ng.getComponent(document.querySelector('app-root')).discardsRemaining === 3`),
      'New turn must restore all discard charges',
    );
    assert(
      await evaluate(
        `document.querySelector('.intent').textContent.includes('DEFEND') && document.querySelector('.intent').textContent.includes('12')`,
      ),
      'Next intent did not render after End Turn',
    );
    await tap('.settings-launcher');
    const frozen = await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const before = JSON.stringify(app.battle);
      app.play(app.battle.hand[0]); app.finishTurn(); app.selectRoom(app.map[0][0]);
      return { paused: app.isPaused, music: app.sound.isMusicPlaying, unchanged: before === JSON.stringify(app.battle), dialog: document.querySelector('.settings-dialog').open, focus: document.querySelector('.settings-dialog').contains(document.activeElement) };
    })()`);
    assert(
      frozen.paused && !frozen.music && frozen.unchanged && frozen.dialog && frozen.focus,
      'Pause must trap focus, stop music and freeze gameplay',
    );
    const pausedAngle = await evaluate(
      `ng.getComponent(document.querySelector('app-root')).globalAngle`,
    );
    await delay(50);
    assert(
      await evaluate(
        `ng.getComponent(document.querySelector('app-root')).globalAngle === ${pausedAngle} && ng.getComponent(document.querySelector('app-root')).backgroundFrame === undefined`,
      ),
      'Pause must stop canvas scheduling',
    );
    await evaluate(`(() => {
      for (const [id, value] of [['music-volume', '0.4'], ['sfx-volume', '0.7']]) {
        const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    assert(
      await evaluate(
        `(() => { const sound = ng.getComponent(document.querySelector('app-root')).sound; return sound.musicVolume === 0.4 && sound.sfxVolume === 0.7; })()`,
      ),
      'Volume sliders do not control sound',
    );
    if (width === 320) {
      const settingsShot = await command('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('artifacts/settings-320x568.png', Buffer.from(settingsShot.data, 'base64'));
    }
    if (width === 320) {
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
    } else {
      await evaluate(`ng.getComponent(document.querySelector('app-root')).resumeGame()`);
    }
    await delay(50);
    assert(
      await evaluate(
        `(() => { const app = ng.getComponent(document.querySelector('app-root')); return !app.isPaused && app.gameState === 'BATTLE' && app.sound.isMusicPlaying; })()`,
      ),
      'Resume failed: ' +
        JSON.stringify(
          await evaluate(
            `(() => { const app = ng.getComponent(document.querySelector('app-root')); return { paused: app.isPaused, gameState: app.gameState, music: app.sound.isMusicPlaying, dialogOpen: document.querySelector('.settings-dialog').open }; })()`,
          ),
        ),
    );
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const art = document.querySelector('.enemy-art');
      const before = parseFloat(getComputedStyle(art).width);
      app.battle.enemy.hp = 151;
      const card = { id: 'phase-check', name: 'Phase Check', cost: 0, damage: 1, description: '' };
      app.battle.hand = [card, ...app.battle.hand]; app.play(card); ng.applyChanges(app);
      const frame = document.querySelector('.enemy-sprite');
      const arena = document.querySelector('.arena').getBoundingClientRect();
      const enemy = document.querySelector('.enemy-stage').getBoundingClientRect();
      const avatar = document.querySelector('.boss-avatar');
      const avatarValid = avatar && avatar.complete && avatar.naturalWidth > 0 && getComputedStyle(avatar).animationName === 'boss-spin';
      const aura = app.playerType === 'WATER' ? 'red-aura' : 'blue-aura';
      return avatarValid && app.battle.enemy.name === 'Sam the Dev' && app.battle.enemy.enraged && app.battle.enemyDamage === 36 && frame.classList.contains(aura) && parseFloat(getComputedStyle(art).width) > before && enemy.top >= arena.top - 1 && enemy.bottom <= arena.bottom + 1 && document.scrollingElement.scrollHeight <= innerHeight;
    })()`),
      'Enraged boss must grow, show the opposite aura, double attacks, and fit',
    );
    const phaseShot = await command('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      'artifacts/enraged-boss-' + width + 'x' + height + '.png',
      Buffer.from(phaseShot.data, 'base64'),
    );
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      app.battle.enemy.intent = { type: 'SPECIAL', name: 'Sam-BHAV KARKI', value: 80, shield: 30 };
      ng.applyChanges(app);
      const intent = document.querySelector('.intent'), stage = document.querySelector('.enemy-stage').getBoundingClientRect(), arena = document.querySelector('.arena').getBoundingClientRect();
      if (stage.top < arena.top - 1 || stage.bottom > arena.bottom + 1) throw new Error(JSON.stringify({ stage: stage.toJSON(), arena: arena.toJSON(), intent: intent.getBoundingClientRect().toJSON(), lineHeight: getComputedStyle(intent).lineHeight }));
      return intent.textContent.includes('Sam-BHAV KARKI') && intent.textContent.includes('80 DMG') && stage.top >= arena.top - 1 && stage.bottom <= arena.bottom + 1;
    })()`),
      'Named specials must remain visible with a full hand',
    );
    if (width === 1280) {
      const snapshot = await evaluate(`(() => {
        const app = ng.getComponent(document.querySelector('app-root'));
        const snapshot = { deck: app.playerDeck, block: app.battle.player.block, uses: app.battle.fireChainUses, last: app.battle.fireChainLastTurn };
        app.playerDeck = app.playerDeck.map(card => ({ ...card, damageMultiplier: 2 }));
        app.battle.player.block = 999;
        app.battle.fireChainUses = 9; app.battle.fireChainLastTurn = app.battle.turn;
        ng.applyChanges(app); return snapshot;
      })()`);
      for (const [stressWidth, stressHeight] of [
        [320, 568],
        [568, 320],
        [640, 360],
        [390, 844],
        [1024, 768],
        [1280, 800],
      ]) {
        await command('Emulation.setDeviceMetricsOverride', {
          width: stressWidth,
          height: stressHeight,
          deviceScaleFactor: 1,
          mobile: stressWidth < 769,
        });
        await delay(60);
        assert(
          await evaluate(`(() => {
          const arena = document.querySelector('.arena').getBoundingClientRect(), message = document.querySelector('.battle-message').getBoundingClientRect();
          const elements = document.querySelectorAll('.combatant h2, .player-buffs, .intent, .combatant .hp-track, .combatant .hp-label, .combatant .shield, .enemy-base-attack');
          return [...elements].every(element => { const r = element.getBoundingClientRect(); return r.top >= arena.top - 1 && r.bottom <= arena.bottom - 3 && r.bottom <= message.top && r.left >= 0 && r.right <= innerWidth; }) && arena.bottom <= message.top && document.scrollingElement.scrollHeight <= innerHeight;
        })()`),
          'Buffs, Block and boss intent must stay above the divider through live resize at ' +
            stressWidth +
            'x' +
            stressHeight,
        );
      }
      await evaluate(`(() => {
        const app = ng.getComponent(document.querySelector('app-root')); const snapshot = ${JSON.stringify(snapshot)};
        app.playerDeck = snapshot.deck; app.battle.player.block = snapshot.block; app.battle.fireChainUses = snapshot.uses; app.battle.fireChainLastTurn = snapshot.last; ng.applyChanges(app);
      })()`);
      console.log('Live resize with stacked buffs, a full hand and enraged boss special passed.');
    }
    await evaluate(
      `(() => { const app = ng.getComponent(document.querySelector('app-root')); app.battle.player.hp = 100; app.finishTurn(); ng.applyChanges(app); })()`,
    );
    assert(
      await evaluate(
        `ng.getComponent(document.querySelector('app-root')).battleMessage.includes('Sam used Sam-BHAV KARKI')`,
      ),
      'Battle log must name the special move',
    );
    await evaluate(
      `(() => { const app = ng.getComponent(document.querySelector('app-root')); app.currentRoom.type = 'CREEP'; app.gameState = 'VICTORY'; ng.applyChanges(app); })()`,
    );
    assert(
      await evaluate(`(() => {
      const panel = document.querySelector('.result-panel');
      const buttons = [...document.querySelectorAll('.victory-actions button')];
      const rects = buttons.map(button => button.getBoundingClientRect());
      return buttons.map(button => button.textContent.trim()).join('|') === 'Continue|Start New Run|Exit to Title' && rects[0].bottom <= rects[1].top && rects[1].bottom <= rects[2].top && rects[1].width < rects[0].width && rects.every(r => r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth) && panel.scrollHeight <= panel.clientHeight;
    })()`),
      'Victory actions must stack and fit the viewport',
    );
    await tap('.continue-run');
    assert(
      await evaluate(`ng.getComponent(document.querySelector('app-root')).gameState === 'MAP'`),
      'Continue must preserve the run and return to map',
    );
    console.log(
      `${width}x${height}: viewport, victory actions, controls, tap targets passed; pixel font ${layout.loadedPixelFont ? 'loaded' : 'fallback'}`,
    );
    await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root')); app.gameState = 'MAP'; app.battle = null;
      while (app.map[2].length < 5) { const index = app.map[2].length; app.map[2].push({ id: '2.' + index, floor: 2, type: 'CREEP', isFog: true, isCompleted: false, nextRoomIds: [] }); }
      app.allRooms = app.map.flat(); ng.applyChanges(app);
    })()`);
    await delay(50);
    assert(
      await evaluate(`(() => {
      const map = document.querySelector('.map-container');
      const bounds = map.getBoundingClientRect();
      const overlay = document.querySelector('.map-overlay').getBoundingClientRect();
      return map.scrollWidth <= map.clientWidth + 1 && map.scrollHeight <= map.clientHeight + 1 && document.scrollingElement.scrollWidth <= innerWidth && document.scrollingElement.scrollHeight <= innerHeight && Math.abs(bounds.width - overlay.width) < 1 && Math.abs(bounds.height - overlay.height) < 1 && [...document.querySelectorAll('.room-btn')].every(button => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= bounds.top && r.bottom <= bounds.bottom && r.bottom <= innerHeight && r.width >= 44; });
    })()`),
      'Five-room map does not fit viewport',
    );
    assert(
      await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root'));
      const map = document.querySelector('.map-container').getBoundingClientRect();
      return app.connections.every(line => {
        const center = room => { const r = document.querySelector('[data-room-id="' + room.id + '"]').getBoundingClientRect(); return [r.left - map.left + r.width / 2, r.top - map.top + r.height / 2]; };
        const from = center(line.from), to = center(line.to);
        return Math.abs(line.x1 - from[0]) < 1 && Math.abs(line.y1 - from[1]) < 1 && Math.abs(line.x2 - to[0]) < 1 && Math.abs(line.y2 - to[1]) < 1;
      });
    })()`),
      'Map lines must stay anchored after resize and restoration',
    );
    await tap('.guide-launcher');
    for (let page = 0; page < 7; page++) {
      assert(
        await evaluate(`(() => {
        const dialog = document.querySelector('.guide-dialog'), panel = document.querySelector('.guide-scroll');
        const r = dialog.getBoundingClientRect();
        const screenshot = document.querySelector('.guide-screenshot')?.getBoundingClientRect();
        return dialog.open && Math.abs(r.width - innerWidth * .7) < 1 && Math.abs(r.height - innerHeight * .7) < 1 && panel.scrollHeight <= panel.clientHeight && (!ng.getComponent(document.querySelector('app-root')).guideStep.image || screenshot?.height > 0) && ng.getComponent(document.querySelector('app-root')).guidePage === ${page};
      })()`),
        'All six guide pages must fit within 70% of the viewport',
      );
      if (page < 6) await tap('.guide-pages button:last-child');
    }
    await tap('.guide-close');
    await evaluate(
      `(() => { const app = ng.getComponent(document.querySelector('app-root')); app.currentRoom.type = 'BOSS'; app.gameState = 'VICTORY'; ng.applyChanges(app); })()`,
    );
    assert(
      await evaluate(`(() => {
      const certificate = document.querySelector('.victory-certificate');
      return certificate.scrollHeight <= certificate.clientHeight && [...document.querySelectorAll('.victory-certificate > *, .certificate-exit')].every(element => {
        const r = element.getBoundingClientRect(); return getComputedStyle(element).display === 'none' || r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      }) && document.scrollingElement.scrollHeight <= innerHeight;
    })()`),
      'Entire certificate and exit must fit without scrolling',
    );
    await tap('.certificate-exit');
    assert(
      await evaluate(`(() => {
      return document.scrollingElement.scrollWidth <= innerWidth && document.scrollingElement.scrollHeight <= innerHeight && [...document.querySelectorAll('.title-screen > *')].every(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; });
    })()`),
      'Title content must fit without scrolling',
    );
    console.log(
      width + 'x' + height + ': all map floors, SVG anchors and title fit without scrolling',
    );
  }
  await evaluate(
    `(() => { const app = ng.getComponent(document.querySelector('app-root')); app.gameState = 'MAP'; app.battle = null; ng.applyChanges(app); })()`,
  );
  await delay(200);
  assert(
    await evaluate(
      `document.querySelectorAll('[data-room-id]').length > 0 && document.querySelectorAll('.connection').length > 0`,
    ),
    'Map did not restore',
  );
  console.log('Conditional map restoration passed.');
  await evaluate(
    `(() => { const app = ng.getComponent(document.querySelector('app-root')); app.gameState = 'VICTORY'; app.returnToMap(); ng.applyChanges(app); })()`,
  );
  assert(
    await evaluate(
      `ng.getComponent(document.querySelector('app-root')).sound.activeTrack === 'MAP'`,
    ),
    'Map return must restore the map theme',
  );
  const renderCost = await evaluate(`(() => {
    const app = ng.getComponent(document.querySelector('app-root'));
    const start = performance.now(); for (let i = 0; i < 60; i++) app.drawBackground(0);
    return (performance.now() - start) / 60;
  })()`);
  console.log(
    '240-donut render CPU time: ' + renderCost.toFixed(2) + ' ms/frame (headless Chrome).',
  );
  assert(
    await evaluate(
      `['square', 'triangle', 'sawtooth'].every(type => window.audioOscillators.some(oscillator => oscillator.type === type))`,
    ),
    'Expected synthesized oscillator types were not played',
  );
  await tap('.settings-launcher');
  await evaluate(`ng.getComponent(document.querySelector('app-root')).toggleMute()`);
  await delay(50);
  assert(
    await evaluate(
      `(() => { const sound = ng.getComponent(document.querySelector('app-root')).sound; return sound.isMuted && sound.master.gain.value === 0; })()`,
    ),
    'Mute did not zero the master gain',
  );
  await evaluate(`ng.getComponent(document.querySelector('app-root')).returnToTitle()`);
  assert(
    await evaluate(
      `(() => { const app = ng.getComponent(document.querySelector('app-root')); return app.gameState === 'START' && !app.isPaused && app.battle === null && app.sound.isMuted; })()`,
    ),
    'Return to title must retain settings',
  );
  console.log('Pause, sound settings, synthesized SFX and return to title passed.');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        await command('Browser.close');
      } catch {}
    }
    socket?.close();
    browser.kill();
  });
