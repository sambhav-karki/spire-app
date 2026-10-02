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
  await command('Page.enable');
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
      layout.cards.every(([w, h]) => w >= 44 && h >= 44),
      'Card tap target too small',
    );
    assert(layout.bodyScroll <= layout.viewport[1] + 1, 'Battle causes page scrolling');
    assert(!layout.handOverflow, 'The entire hand must fit without horizontal scrolling');
    assert(
      layout.cards.every(([, , left, right]) => left >= -1 && right <= width + 1),
      'Cards overflow viewport',
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
      return { paused: app.isPaused, music: app.sound.isMusicPlaying, unchanged: before === JSON.stringify(app.battle), dialog: document.querySelector('dialog').open, focus: document.querySelector('dialog').contains(document.activeElement) };
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
            `(() => { const app = ng.getComponent(document.querySelector('app-root')); return { paused: app.isPaused, gameState: app.gameState, music: app.sound.isMusicPlaying, dialogOpen: document.querySelector('dialog').open }; })()`,
          ),
        ),
    );
    console.log(
      `${width}x${height}: viewport, controls, tap targets passed; pixel font ${layout.loadedPixelFont ? 'loaded' : 'fallback'}`,
    );
    await evaluate(`(() => {
      const app = ng.getComponent(document.querySelector('app-root')); app.gameState = 'MAP'; app.battle = null;
      while (app.map[2].length < 3) { const index = app.map[2].length; app.map[2].push({ id: '2.' + index, floor: 2, type: 'CREEP', isFog: true, isCompleted: false, nextRoomIds: [] }); }
      app.allRooms = app.map.flat(); ng.applyChanges(app);
    })()`);
    await delay(50);
    assert(
      await evaluate(`(() => {
      const map = document.querySelector('.map-container');
      return map.scrollWidth <= map.clientWidth + 1 && document.scrollingElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.room-btn')].every(button => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width >= 44; });
    })()`),
      'Three-room map does not fit viewport',
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
