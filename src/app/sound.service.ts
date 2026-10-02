import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, NgZone, OnDestroy, PLATFORM_ID } from '@angular/core';

export type MusicTrack = 'MAP' | 'BATTLE';

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
  get activeTrack(): MusicTrack | null {
    return this.musicTrack;
  }

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly zone = inject(NgZone);
  private context?: AudioContext;
  private master?: GainNode;
  private sfxGain?: GainNode;
  private musicGain?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private readonly voices = new Map<AudioScheduledSourceNode, { music: boolean; gain: GainNode }>();
  private musicTrack: MusicTrack | null = null;
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
    this.track(noise, false, envelope, () => {
      filter.disconnect();
      envelope.disconnect();
    });
    noise.start();
    noise.stop(ctx.currentTime + 0.08);
  }

  startMusic(): void {
    this.playMusic(this.musicTrack ?? 'MAP');
  }
  playMusic(track: MusicTrack): void {
    if (this.destroyed || (this.musicWanted && this.musicTrack === track)) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.stopVoices(true, true);
    this.musicTrack = track;
    this.musicWanted = true;
    this.step = 0;
    this.syncMusic();
  }
  stopMusic(): void {
    this.musicWanted = false;
    this.musicTrack = null;
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
    this.track(oscillator, music, gain, () => gain.disconnect());
    oscillator.start(time);
    oscillator.stop(time + duration + 0.01);
  }

  private track(
    source: AudioScheduledSourceNode,
    music: boolean,
    gain: GainNode,
    cleanup: () => void,
  ): void {
    this.voices.set(source, { music, gain });
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      cleanup();
    };
  }

  private stopVoices(musicOnly: boolean, fade = false): void {
    for (const [voice, { music, gain }] of this.voices) {
      if (musicOnly && !music) continue;
      try {
        if (fade && this.context?.state === 'running') {
          const now = this.context.currentTime;
          const level = gain.gain.value;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(level, now);
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.015);
          voice.stop(now + 0.02);
        } else voice.stop();
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
    const battle = this.musicTrack === 'BATTLE';
    // MAP: gentle eighth notes at 80 BPM. BATTLE: sixteenths at 144 BPM.
    const interval = battle ? 60 / 144 / 4 : 60 / 80 / 2;
    const roots = [57, 53, 60, 55];
    while (this.nextBeat < ctx.currentTime + 0.1) {
      const beatChord = Math.floor(this.step / 16) % roots.length;
      const beatRoot = roots[beatChord];
      const third = beatChord === 0 ? 3 : 4;
      const offsets = [0, third, 7, 12];
      const midi = beatRoot + offsets[this.step % 4] + 12;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      const delay = this.nextBeat - ctx.currentTime;
      this.tone(
        battle ? 'square' : 'triangle',
        frequency,
        frequency,
        battle ? 0.075 : 0.3,
        battle ? 0.13 : 0.08,
        delay,
        true,
      );
      if (this.step % (battle ? 2 : 4) === 0) {
        const bass = 440 * 2 ** ((beatRoot - 12 - 69) / 12);
        this.tone(
          battle ? 'square' : 'sine',
          bass,
          bass,
          battle ? 0.16 : 1.2,
          battle ? 0.18 : 0.24,
          delay,
          true,
        );
      }
      this.step = (this.step + 1) % 64;
      this.nextBeat += interval;
    }
  }

  ngOnDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.musicWanted = false;
    this.musicTrack = null;
    if (this.browser) document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.stopVoices(false);
    void this.context?.close().catch(() => undefined);
  }
}
