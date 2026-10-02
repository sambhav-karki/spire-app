---
name: webslayer-spire
description: Develop WebSlayer Spire fighter selection, map traversal, elemental card battles, shops, help dialogs, responsive pixel UI and synthesized audio.
---

# WebSlayer Spire project context

Verified against the working tree on 2026-10-02. Read this file first, then only relevant source/tests. Source is authoritative; update affected notes after feature changes instead of appending session transcripts.

## File map

- Angular 22 standalone app, TypeScript 6, Vitest; modern @if/@for templates.
- src/app/game-logic.ts: map generation/navigation and immutable combat rules. app.ts: run state, dialogs, UI actions, canvas and map measurement. app.html: views.
- App loads app.css, victory.css, guide.css, combat-layout.css in that order. Final combat grid overrides belong in combat-layout.css; guide.css owns traversal help; victory.css owns the certificate. src/styles.css owns shared pixel theme, sprites, cards, intent/HP skins and reduced motion.
- sound.service.ts: procedural Web Audio. src/index.html loads Press Start 2P with fallback and display=swap.
- Tests: app.spec.ts includes app/map/combat behavior; game-logic.spec.ts covers shop attacks/chains/upgrades; sound.service.spec.ts covers audio.
- Keep production component stylesheet budgets: warning 4kB, error 8kB.
- Only when explicitly requested, worker ownership/order is sound service, domain rules, template/styles, then app state/documentation. Ordinary changes do not require workers.

## Run and map

GameState: START | SELECT_FIGHTER | MAP | BATTLE | REST | TREASURE | SHOP | VICTORY | GAME_OVER. Initial state is START. Start Run unlocks gesture audio and enters fighter selection; selecting FIRE (Ember Slayer) or WATER (Tide Guard) resets the run and enters MAP with MAP music. Restart retains the fighter; returning to title allows a fresh choice. Sound preferences survive resets.

Starter deck: five 1-energy Strikes (12 damage), four 1-energy Defends (8 block), one 2-energy Heavy Strike (28 damage). FIRE adds 3 damage to starter attacks; WATER adds 4 block to starter defense. Shop cards use their own values.

Floor 0 is cleared REST and initially the only unfogged room. Reveal floor 1 after 150ms so initial fog paints; guard destruction/pause/title and reschedule interrupted reveal on resume. Floor 1 INTRO is a Sam Jr battle. Floors 2 and 3 have 3-5 rooms each; floor 4 holds Sam the Dev. Some branches have no upward exit.

Only unpaused MAP allows movement; reject current/fogged targets. Allow direct exits, uncompleted lateral rooms, completed lower rooms and parents. A revealed next-floor exit unlocked by any completed room on the current floor stays selectable after exploring siblings: pass allRooms to canMoveToRoom and record its actual parent connection. visitRoom reveals room/exits; completion waits for encounter resolution. Cleared rooms never repeat rewards.

Conditional map ViewChild reconnects ResizeObserver and schedules requestAnimationFrame measurement of button centers relative to container. Preserve traversed/revealed connections across encounters; clear on reset. SVG normalized dash paths animate only on first reveal. Cancel timers/observers/frames/listeners on destruction; guard browser APIs with isPlatformBrowser.

Victory persists player HP and completes/rewards once: INTRO/CREEP 20 gold, ELITE 35, BOSS 100. REST heals 30% max HP or compounds attack damageMultiplier by 1.2; TREASURE gives 50 gold once. SHOP/MERCHANT heals 30% HP for 30 gold if injured; purchases leave shop open. Only Leave completes shop and returns to MAP.

## Cards and combat

Combat functions return new objects without mutating inputs; separate persistent playerDeck from battle piles. Copy/shuffle with optional RNG, draw five, start each turn with three energy. Reject stale, unaffordable, paused and terminal actions. Damage consumes block; HP never goes negative. EndTurn executes the displayed intent, discards hand, then if alive resets player block, energy and discard allowance, increments turn and draws five. Expire previous enemy block before its action; new enemy block survives the following player turn. Recycle discard only when draw is empty.

Cards have unique IDs, cost, optional damage/block/effect/damageMultiplier and description. cardDamage and describeCard share effect calculations. Rest upgrades multiply attack scaling by 1.2 each time; round resolved damage, including chain bonuses; shield is unchanged.

Discard mode supports click or drag-to-discard: three replacements per turn, zero energy cost; unaffordable cards can be discarded. Battle tracks discardsRemaining, fireChainUses and fireChainLastTurn.

Shop skill costs 20 gold; repeated purchases append unique IDs to the persistent deck. WATER Tidal Strike: 1 energy, 15 damage +15 shield. FIRE Kindle: 1 energy, 15 initial damage, FIRE_CHAIN adds 15 base damage per previous use across copies within the same or consecutive turns. Skipping a turn resets the chain; upgrade multipliers scale both base and bonus.

Enemies (HP/base attack): Sam Jr 45/6; Cultist 60/8; Gremlin Nob 120/14; Sam the Dev 300/18. Elite buffs +2 every third turn; boss defends for 12 when turn modulo 3 equals 2. Every fourth turn takes precedence: elite SPECIAL Nob Smash deals 20 plus attack growth and grants 20 shield; boss SPECIAL Sam-BHAV KARKI deals round(40 * enemyDamage / 18) and grants 30 shield. Execute exactly the advertised ATTACK/DEFEND/BUFF/SPECIAL intent.

A surviving boss at or below half HP enrages once: max HP increases by 50, HP refills to new max, attack doubles and intent recalculates immediately. Every subsequent living endTurn grows attack by 1.5, rounded, including defense turns. Lethal damage does not trigger enrage. Aura contrasts fighter: red for WATER, blue for FIRE.

## Dialogs and result views

Pause is orthogonal isPaused, preserving battle identity/turn/cards/energy and rejecting gameplay actions. Native showModal traps focus; viewport is inert; Escape/close resumes and restores origin focus. Guard native dialog APIs for tests/unsupported browsers. Return to Title cancels reveal/layout callbacks, clears battle and stops music.

Deck launcher is available during a run. Group by name, cost, damage, block, effect, multiplier and description, excluding instance ID; show counts and four groups per page. Different upgrades remain separate. Deck and map-only traversal guide set isPaused, pause audio/background and close through resume/closeSettings. Fighter selection element help uses separate helpOpen and focus origin.

Traversal guide has seven pages: paths, deck, shops, elites, treasure, rest, boss. Keep within 70% viewport width/height. Five screenshots: public/help-{paths,deck,shop,treasure,rest}.png; elite/boss use text only. failedGuideImages supplies placeholders on load failure. Screenshot conventions: public/HELP-SCREENSHOTS.md.

Ordinary victory offers Continue, Start New Run and Exit to Title. Boss victory shows a certificate, 64 decorative confetti pieces, “Never Stop Gaming” -Sam, and Exit to Title. Keep certificate and action visible without scrolling across tested viewports.

## Responsive UI and background

Fixed #bg-canvas at z-index 0; viewport z-index 1. 240 pixel particles: title square rings, FIRE rising flames, WATER drifting droplets. Outside-Angular animation uses capped elapsed time and pauses for dialogs, hidden tabs and reduced motion. Resize backing canvas to window dimensions; disable smoothing; clean up frames/listeners. Translucent panels; revealed rooms opaque at z-index 2 above SVG; fogged rooms opacity 0.2.

Viewport prevents horizontal overflow; map rooms shrink to fit. Battle is fixed at 100dvh with safe-area padding. combat-layout.css provides shared grid rows so buffs, intent, names, sprites, HP and block stay above the arena divider during live resize. Hide fight-title/VS decoration. Show playerBuffs above hero, exact named enemy intent and base attack. Preserve final stylesheet ordering when editing older responsive rules.

Hand: centered shrinking flex cards, 6px gaps, bottom aligned; no horizontal scrolling. Hide artwork before semantic effects/HP/intent. Minimum 44px touch targets, touch-action:manipulation, browser zoom, accessible labels and focus outlines. Affordable cards lift; reduced motion disables decoration. CSS sprite placeholders keep HERO/CREEP/ELITE/BOSS labels and frame geometry. Pixel palette: slate/gold, red HP, blue block, amber energy.

## Audio

Public injected SoundService: unlock(): Promise<void> creates/resumes one AudioContext from gestures; unsupported/denied audio never blocks gameplay. click: 40ms descending square; card: ascending triangle; hit: descending sawtooth plus generated filtered noise. No external audio assets.

playMusic('MAP' | 'BATTLE'): MAP triangle melody/sine bass at 80 BPM; BATTLE square lead/bass at 144 BPM. Same track is idempotent; switches cancel scheduling and fade old voices over 15ms. startMusic resumes selection or MAP; stopMusic clears intent; activeTrack exposes selection. setPaused retains intent; visibility gates scheduling. setMuted/setSfxVolume/setMusicVolume use independent gains and finite values clamped to 0-1. State: isMuted, sfxVolume, musicVolume; diagnostics: audioState, isAvailable, isMusicPlaying.

Valid buttons/rooms click; cards chime and hit when HP decreases; enemy ATTACK/SPECIAL hits, DEFEND/BUFF do not. One outside-Angular look-ahead scheduler; finished nodes disconnect, mute stops voices, destruction clears timers/listeners and closes context.

## Validation and exports

Windows PowerShell: npm.cmd run build; npx.cmd tsc --noEmit -p tsconfig.app.json; npm.cmd test -- --watch=false. Run appropriate checks for implementation changes; documentation-only edits need skill validation, not gameplay rebuilds.

node scripts/ui-check.cjs requires development server at http://127.0.0.1:4200 and installed headless Chrome. Tests use Angular development debug APIs. Viewports: 1280x800, 390x844, 320x568, 844x390, 568x320. Covers bounds/tap targets/overflow/fonts, title/fighter selection/settings/audio, elemental themes, discard, deck pagination, shops, seven guide pages, certificate, map restoration and live resize with stacked buffs/full hand/enraged special. Screenshots go to artifacts; browser launch/font fetching may require sandbox escalation.

scripts/export-source.cjs writes the original core bundle to artifacts/donut-music-source.md, but currently omits combat-layout.css, guide.css and victory.css. Include these explicitly when a complete current export is requested. Older artifacts are not source of truth. Do not claim checks passed from existing screenshots alone.
