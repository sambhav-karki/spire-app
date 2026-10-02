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

playMusic('MAP' | 'BATTLE') selects a procedural theme. MAP uses triangle melody and sine bass at 80 BPM; BATTLE uses square lead and bass at 144 BPM. Repeating the active track does not restart scheduling. Switching cancels old scheduling and fades old music voices over 15ms before stopping them. startMusic() resumes the selected theme or MAP; stopMusic() clears track intent. activeTrack exposes selection. Start/restart and map returns select MAP; entering combat selects BATTLE; title return stops music. setPaused(boolean) suspends music while retaining playback intent. Tab visibility gates scheduling. setMuted(boolean), setSfxVolume(number), setMusicVolume(number) update separate gains with finite values clamped to 0â€“1. Public local state: isMuted, sfxVolume, musicVolume. Diagnostics: audioState, isAvailable, isMusicPlaying. Preferences survive run resets in the same service instance.

Valid room/button actions play click. Cards play chime and impact when enemy HP decreases. Enemy ATTACK emits impact; DEFEND and BUFF do not. One context and one outside-Angular look-ahead scheduler serve the app. Finished nodes disconnect; mute stops voices; destruction clears timers/listeners and closes context.

## Combat invariants

Combatant owns name, current/max HP and block. Card owns unique instance ID, name, cost, optional damage/block and description. Enemy adds room type and advertised ATTACK/DEFEND/BUFF intent. BattleState owns snapshots, draw pile, hand, discard, energy, turn and enemyDamage. Persistent deck stays separate from battle piles.

Combat functions return new objects and never mutate inputs. Battles shuffle copies, draw five cards and start with three energy. Optional RNG injection supports deterministic tests. Reject missing, unaffordable and terminal card actions. Play spends energy, resolves damage through block, grants block and discards. End turn expires old enemy block, executes exactly displayed intent, discards hand and, if alive, resets player block, refills energy, advances turn, derives next intent and draws five. New enemy block persists through the following player turn. Shuffle discard only when draw is empty. HP never goes negative.

Cultist: 45 HP and 6 attack, always attacks. Gremlin Nob: 85 HP and 10 base attack, buffs +2 every third turn. Guardian: 240 HP and 14 attack, defends for 12 when turn modulo 3 equals 2. Display the exact intent executed by endTurn. Card numeric effects derive from damage/block fields so upgrades remain accurate.

## Map and responsive viewport lifecycle

MAP exists in a conditional view. ViewChild setter disconnects old ResizeObserver and schedules measurement whenever map reappears. requestAnimationFrame measures room-button centers relative to container; guard absent/destroyed views. Preserve traversed and revealed-connection sets across encounters; clear on restart. Newly revealed normalized SVG dash paths animate once; returning to map does not replay known paths. Destroy cleans timer, observer, frame and listener. Guard browser APIs with isPlatformBrowser.

A single fixed #bg-canvas sits at z-index 0, below the z-index 1 viewport. AfterViewInit initializes 240 drifting square-ring particles; one shared angle synchronizes rotation. Canvas backing dimensions follow window.innerWidth/innerHeight on resize. Outside-Angular requestAnimationFrame uses capped elapsed time for consistent speed, and pauses for settings, hidden tabs and reduced motion. Destroy cancels frames and listeners. Disable canvas smoothing and use pixelated CSS rendering. Map/battle/event panels are translucent. Revealed room buttons remain opaque with solid backgrounds and z-index 2 above the z-index 1 SVG overlay; only fogged buttons use opacity 0.2.

Viewport wrapper uses overflow-x:hidden, width:100vw, max-width:100% and border-box sizing. Map rooms shrink inside available width. Battle uses fixed host, height:100dvh, max-height:100dvh, hidden overflow and safe-area padding. Header, message, hand and footer reserve space; arena consumes remainder. Desktop stages are side by side; mobile enemy appears above hero; short landscape screens use compact status grids and side-by-side stages.

Hand uses flex, 6px gaps, centered justification, bottom alignment, 100% width/max-width and shrinking cards. Never allow horizontal hand/map scrolling. Hide card artwork before semantic HP, intent or effects. Touch targets remain at least 44px with touch-action:manipulation; preserve browser zoom, accessible names and focus outlines. Affordable cards lift on hover/tap. Reduced motion disables decoration.

Settings launcher stays fixed top-right at 12px with z-index 1000. Dialog centers pixel-bordered panel over dark overlay, allows vertical overflow in short viewports, and contains music/SFX sliders, mute, resume and title actions. Title has WEBSLAYER SPIRE, animated crest, flickering PRESS START, Start Run and Settings.

Sprites remain CSS placeholders with HERO/CREEP/ELITE/BOSS badges. Preserve frame geometry and accessible labels when adding artwork. Use image-rendering:pixelated, dungeon slate/gold, red HP, blue block and amber energy.

## Validation

Use npm.cmd run build, npx.cmd tsc --noEmit -p tsconfig.app.json and npm.cmd test -- --watch=false in Windows PowerShell. Cover fog/navigation, deferred completion, immutable combat, costs/block/draw recycling, advertised intents, terminal/paused guards, reward idempotence, persistent HP, title/reset and conditional map restoration.

scripts/ui-check.cjs uses installed headless Chrome and dev server http://127.0.0.1:4200. Check viewport/control/stage bounds, tap targets, absent horizontal overflow, font loading, title/settings and map restoration at 1280x800, 390x844, 320x568, 844x390 and 568x320. Screenshots go to artifacts. Browser launch and production font fetching may require sandbox approval.

Audio tests cover gesture-only initialization, single-context/scheduler behavior, oscillator SFX, volume/mute controls, paused and hidden-tab scheduling, unsupported browsers, and idempotent cleanup. Browser checks use trusted mouse input to unlock native audio, then verify running music, paused combat identity, focus containment, sliders, oscillator types, and retained settings on title return. `scripts/export-source.cjs` writes complete implementation files and their shared-style dependencies to `artifacts/donut-music-source.md`.
