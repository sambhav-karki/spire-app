import { TestBed } from '@angular/core/testing';
import { SoundService } from './sound.service';

class FakeParam {
  value = 1;
  setValueAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = '';
  buffer: unknown;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode();
  gains: FakeNode[] = [];
  oscillators: FakeNode[] = [];
  sources: FakeNode[] = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createGain(): FakeNode {
    const node = new FakeNode();
    this.gains.push(node);
    return node;
  }
  createOscillator(): FakeNode {
    const node = new FakeNode();
    this.oscillators.push(node);
    return node;
  }
  createBufferSource(): FakeNode {
    const node = new FakeNode();
    this.sources.push(node);
    return node;
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
}

describe('SoundService', () => {
  let originalContext: PropertyDescriptor | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    originalContext = Object.getOwnPropertyDescriptor(window, 'AudioContext');
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    FakeAudioContext.instances = [];
    TestBed.configureTestingModule({});
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    if (originalContext) Object.defineProperty(window, 'AudioContext', originalContext);
    else Reflect.deleteProperty(window, 'AudioContext');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates audio only on unlock and uses a single context', async () => {
    const sound = TestBed.inject(SoundService);
    sound.startMusic();
    sound.click();
    expect(FakeAudioContext.instances).toHaveLength(0);
    await sound.unlock();
    await sound.unlock();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(sound.audioState).toBe('running');
    expect(sound.isMusicPlaying).toBe(true);
    expect(FakeAudioContext.instances[0]!.oscillators.map((node) => node.type)).toEqual([
      'triangle',
      'sine',
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('synthesizes distinct SFX and does not create voices when muted', async () => {
    const sound = TestBed.inject(SoundService);
    await sound.unlock();
    const context = FakeAudioContext.instances[0]!;
    sound.click();
    sound.card();
    sound.hit();
    expect(context.oscillators.map((node) => node.type)).toEqual([
      'square',
      'triangle',
      'triangle',
      'sawtooth',
    ]);
    expect(context.sources).toHaveLength(1);
    const voices = context.oscillators.length;
    sound.setMuted(true);
    sound.click();
    sound.card();
    sound.hit();
    expect(context.oscillators.length).toBe(voices);
    expect(context.sources).toHaveLength(1);
    expect(context.gains[0]!.gain.value).toBe(0);
  });

  it('switches themes with a fade and does not restart the active track', async () => {
    const sound = TestBed.inject(SoundService);
    sound.playMusic('MAP');
    await sound.unlock();
    const context = FakeAudioContext.instances[0]!;
    const oldVoices = [...context.oscillators];
    sound.playMusic('MAP');
    expect(context.oscillators).toHaveLength(2);
    sound.playMusic('BATTLE');
    expect(sound.activeTrack).toBe('BATTLE');
    expect(context.oscillators.slice(2).map((node) => node.type)).toEqual(['square', 'square']);
    expect(oldVoices.every((node) => node.stop.mock.calls.some((call) => call[0] === 0.02))).toBe(
      true,
    );
    expect(context.gains[3]!.gain.cancelScheduledValues).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(1);
    sound.setMuted(true);
    sound.playMusic('MAP');
    expect(sound.activeTrack).toBe('MAP');
    expect(sound.isMusicPlaying).toBe(false);
    sound.setMuted(false);
    expect(sound.isMusicPlaying).toBe(true);
    sound.stopMusic();
    expect(sound.activeTrack).toBeNull();
  });

  it('clamps independent volumes and restarts music only when enabled', async () => {
    const sound = TestBed.inject(SoundService);
    sound.setSfxVolume(2);
    sound.setMusicVolume(-1);
    expect(sound.sfxVolume).toBe(1);
    expect(sound.musicVolume).toBe(0);
    sound.startMusic();
    await sound.unlock();
    expect(sound.isMusicPlaying).toBe(false);
    sound.setMusicVolume(0.4);
    expect(sound.isMusicPlaying).toBe(true);
    sound.setMuted(true);
    expect(sound.isMusicPlaying).toBe(false);
    sound.setMuted(false);
    expect(sound.isMusicPlaying).toBe(true);
    sound.setSfxVolume(Number.NaN);
    expect(sound.sfxVolume).toBe(0);
    expect(sound.musicVolume).toBe(0.4);
  });

  it('pauses music while keeping settings SFX available and cleans up idempotently', async () => {
    const sound = TestBed.inject(SoundService);
    sound.startMusic();
    await sound.unlock();
    sound.setPaused(true);
    expect(sound.isMusicPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const context = FakeAudioContext.instances[0]!;
    const count = context.oscillators.length;
    sound.click();
    expect(context.oscillators.length).toBe(count + 1);
    sound.setPaused(false);
    expect(sound.isMusicPlaying).toBe(true);
    sound.ngOnDestroy();
    sound.ngOnDestroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(sound.isMusicPlaying).toBe(false);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('stops background scheduling in a hidden tab and resumes only when visible', async () => {
    const sound = TestBed.inject(SoundService);
    sound.startMusic();
    await sound.unlock();
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sound.isMusicPlaying).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    visibility.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sound.isMusicPlaying).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps the game silent and functional without Web Audio support', async () => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    const sound = TestBed.inject(SoundService);
    sound.startMusic();
    await sound.unlock();
    expect(sound.isAvailable).toBe(false);
    expect(sound.isMusicPlaying).toBe(false);
    expect(() => {
      sound.click();
      sound.card();
      sound.hit();
    }).not.toThrow();
  });
});
