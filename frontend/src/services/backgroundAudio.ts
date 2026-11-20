import { API_BASE_URL } from './api';
import { aiService } from './ai';
import { TranscriptSegment } from '../types/video';

export type BackgroundAudioMode = 'off' | 'podcast' | 'local';
export type PodcastSubMode = 'continuous' | 'shadowing' | 'bilingual';
export type PodcastVoice = 'male' | 'female';

export interface BackgroundAudioSnapshot {
  mode: BackgroundAudioMode;
  isPlaying: boolean;
  isLoading: boolean;
  subMode: PodcastSubMode;
  voice: PodcastVoice;
  playbackRate: number;
  podcastIndex: number;
  podcastTotal: number;
  phaseLabel: string;
  currentText: string;
  localFileName: string | null;
  localCurrentTime: number;
  localDuration: number;
  error: string | null;
}

type SnapshotListener = (snapshot: BackgroundAudioSnapshot) => void;
type SegmentChangeListener = (segment: TranscriptSegment, index: number) => void;
type LocalTimeListener = (currentTime: number, duration: number) => void;

const silentWavCache = new Map<number, string>();

/**
 * Generates an in-memory silent PCM WAV Blob URL so background pauses keep the
 * mobile OS HTML5 audio & MediaSession alive while the screen is locked.
 */
export function generateSilentWavUrl(durationSeconds: number): string {
  const cached = silentWavCache.get(durationSeconds);
  if (cached) return cached;

  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  silentWavCache.set(durationSeconds, url);
  return url;
}

class BackgroundAudioController {
  private audio: HTMLAudioElement | null = null;
  private mode: BackgroundAudioMode = 'off';
  private isPlayingState = false;
  private isLoadingState = false;
  private subMode: PodcastSubMode = 'continuous';
  private voice: PodcastVoice = 'male';
  private playbackRate = 1.0;

  private segments: TranscriptSegment[] = [];
  private podcastIndex = 0;
  private videoTitle = 'FluencyCast Audio';
  private videoChannel = 'English Immersion';
  private phaseLabel = '';
  private error: string | null = null;

  private localFileName: string | null = null;
  private localObjectUrl: string | null = null;
  private localDuration = 0;
  private localCurrentTime = 0;

  private playSessionToken = 0;
  private blobCache = new Map<string, string>();
  private translationCache = new Map<string, string>();

  private snapshotListeners = new Set<SnapshotListener>();
  private segmentChangeListeners = new Set<SegmentChangeListener>();
  private localTimeListeners = new Set<LocalTimeListener>();

  private ensureAudioElement(): HTMLAudioElement {
    if (!this.audio) {
      const el = new Audio();
      el.preload = 'auto';
      el.setAttribute('playsinline', 'true');
      (el as any).playsInline = true;
      this.audio = el;
    }
    return this.audio;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  onSegmentChange(listener: SegmentChangeListener): () => void {
    this.segmentChangeListeners.add(listener);
    return () => {
      this.segmentChangeListeners.delete(listener);
    };
  }

  onLocalTimeUpdate(listener: LocalTimeListener): () => void {
    this.localTimeListeners.add(listener);
    return () => {
      this.localTimeListeners.delete(listener);
    };
  }

  getSnapshot(): BackgroundAudioSnapshot {
    const curSeg = this.segments[this.podcastIndex];
    return {
      mode: this.mode,
      isPlaying: this.isPlayingState,
      isLoading: this.isLoadingState,
      subMode: this.subMode,
      voice: this.voice,
      playbackRate: this.playbackRate,
      podcastIndex: this.podcastIndex,
      podcastTotal: this.segments.length,
      phaseLabel: this.phaseLabel,
      currentText: curSeg?.text || '',
      localFileName: this.localFileName,
      localCurrentTime: this.localCurrentTime,
      localDuration: this.localDuration,
      error: this.error,
    };
  }

  private notify() {
    const snap = this.getSnapshot();
    this.snapshotListeners.forEach((cb) => cb(snap));
  }

  private rateParam(): string {
    if (this.playbackRate <= 0.9) return '-15%';
    if (this.playbackRate >= 1.1) return '+15%';
    return '+0%';
  }

  private buildTtsUrl(text: string, voiceOverride?: string, lang?: 'en' | 'pt'): string {
    const v = voiceOverride || this.voice;
    const rate = lang === 'pt' ? '+0%' : this.rateParam();
    const langParam = lang ? `&lang=${lang}` : '';
    return `${API_BASE_URL}/ai/tts?text=${encodeURIComponent(text.trim())}&voice=${encodeURIComponent(v)}&rate=${encodeURIComponent(rate)}${langParam}`;
  }

  private async resolveAudioSrc(url: string): Promise<string> {
    const cached = this.blobCache.get(url);
    if (cached) return cached;

    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
          const objUrl = URL.createObjectURL(blob);
          if (this.blobCache.size >= 20) {
            const oldestKey = this.blobCache.keys().next().value;
            if (oldestKey) {
              const oldBlob = this.blobCache.get(oldestKey);
              if (oldBlob) URL.revokeObjectURL(oldBlob);
              this.blobCache.delete(oldestKey);
            }
          }
          this.blobCache.set(url, objUrl);
          return objUrl;
        }
      }
    } catch {
      // Fallback directly to URL if fetch/CORS prevents blob preloading
    }

    return url;
  }

  private prefetchSegmentAudio(index: number) {
    const nextSeg = this.segments[index];
    if (!nextSeg?.text?.trim()) return;
    const url = this.buildTtsUrl(nextSeg.text, this.voice, 'en');
    if (!this.blobCache.has(url)) {
      this.resolveAudioSrc(url).catch(() => {});
    }
  }

  private updateMediaSessionMetadata(subtitle?: string) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;

    try {
      if (typeof MediaMetadata !== 'undefined') {
        mediaSession.metadata = new MediaMetadata({
          title: subtitle || this.videoTitle,
          artist: this.videoChannel || 'FluencyCast',
          album: this.mode === 'podcast'
            ? `Frase ${this.podcastIndex + 1}/${Math.max(this.segments.length, 1)} • ${this.videoTitle}`
            : 'Áudio Local Sincronizado',
        });
      }
      mediaSession.playbackState = this.isPlayingState ? 'playing' : 'paused';
    } catch {
      // Some browsers restrict MediaMetadata updates
    }

    const bind = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action handler on current browser
      }
    };

    bind('play', () => this.resume());
    bind('pause', () => this.pause());
    bind('stop', () => this.stop());
    bind('previoustrack', () => {
      if (this.mode === 'podcast') {
        this.jumpToPodcastSegment(Math.max(0, this.podcastIndex - 1));
      } else if (this.mode === 'local') {
        this.seekLocalDelta(-10);
      }
    });
    bind('nexttrack', () => {
      if (this.mode === 'podcast') {
        this.jumpToPodcastSegment(Math.min(this.segments.length - 1, this.podcastIndex + 1));
      } else if (this.mode === 'local') {
        this.seekLocalDelta(10);
      }
    });
    bind('seekbackward', () => {
      if (this.mode === 'local') this.seekLocalDelta(-5);
      else if (this.mode === 'podcast') this.jumpToPodcastSegment(this.podcastIndex);
    });
    bind('seekforward', () => {
      if (this.mode === 'local') this.seekLocalDelta(5);
      else if (this.mode === 'podcast') {
        this.jumpToPodcastSegment(Math.min(this.segments.length - 1, this.podcastIndex + 1));
      }
    });
  }

  async startPodcast(
    segments: TranscriptSegment[],
    startIndex: number,
    options: { title: string; channel?: string; subMode?: PodcastSubMode; voice?: PodcastVoice; playbackRate?: number }
  ) {
    if (!segments.length) return;
    this.releaseLocalAudioUrl();

    this.segments = segments;
    this.videoTitle = options.title || 'FluencyCast Audio';
    this.videoChannel = options.channel || 'English Immersion';
    if (options.subMode) this.subMode = options.subMode;
    if (options.voice) this.voice = options.voice;
    if (options.playbackRate) this.playbackRate = options.playbackRate;

    this.mode = 'podcast';
    this.error = null;
    await this.playPodcastSegmentAt(Math.max(0, Math.min(startIndex, segments.length - 1)));
  }

  setPodcastConfig(config: { subMode?: PodcastSubMode; voice?: PodcastVoice; playbackRate?: number }) {
    const voiceOrRateChanged =
      (config.voice && config.voice !== this.voice) ||
      (config.playbackRate && config.playbackRate !== this.playbackRate);

    if (config.subMode) this.subMode = config.subMode;
    if (config.voice) this.voice = config.voice;
    if (config.playbackRate) this.playbackRate = config.playbackRate;

    if (this.mode === 'local' && this.audio && config.playbackRate) {
      this.audio.playbackRate = config.playbackRate;
    } else if (this.mode === 'podcast' && this.isPlayingState && voiceOrRateChanged) {
      this.playPodcastSegmentAt(this.podcastIndex);
      return;
    }

    this.notify();
  }

  async jumpToPodcastSegment(index: number) {
    if (!this.segments.length) return;
    const clamped = Math.max(0, Math.min(index, this.segments.length - 1));
    if (this.mode !== 'podcast') {
      this.mode = 'podcast';
    }
    await this.playPodcastSegmentAt(clamped);
  }

  private async playPodcastSegmentAt(index: number) {
    if (index < 0 || index >= this.segments.length) {
      this.isPlayingState = false;
      this.isLoadingState = false;
      this.phaseLabel = 'Lição concluída!';
      this.updateMediaSessionMetadata('Lição concluída');
      this.notify();
      return;
    }

    const token = ++this.playSessionToken;
    const seg = this.segments[index];
    this.podcastIndex = index;
    this.isLoadingState = true;
    this.isPlayingState = true;
    this.error = null;
    this.phaseLabel = `Ouvindo frase ${index + 1} de ${this.segments.length} (Inglês)`;
    this.segmentChangeListeners.forEach((cb) => cb(seg, index));
    this.updateMediaSessionMetadata(seg.text);
    this.notify();

    // Prefetch next English line while playing current line
    this.prefetchSegmentAudio(index + 1);

    const audio = this.ensureAudioElement();
    audio.onended = null;
    audio.onerror = null;
    audio.ontimeupdate = null;
    audio.playbackRate = 1.0;

    const ttsUrl = this.buildTtsUrl(seg.text, this.voice, 'en');
    const resolvedSrc = await this.resolveAudioSrc(ttsUrl);
    if (token !== this.playSessionToken || this.mode !== 'podcast') return;

    audio.src = resolvedSrc;

    audio.onended = async () => {
      if (token !== this.playSessionToken || this.mode !== 'podcast') return;

      if (this.subMode === 'shadowing') {
        await this.playShadowingPauseThenNext(token, index);
        return;
      }

      if (this.subMode === 'bilingual') {
        await this.playPortugueseTranslationThenNext(token, seg, index);
        return;
      }

      await this.playPodcastSegmentAt(index + 1);
    };

    audio.onerror = () => {
      if (token !== this.playSessionToken) return;
      this.isPlayingState = false;
      this.isLoadingState = false;
      this.error = 'Não foi possível carregar o áudio desta frase.';
      this.notify();
    };

    try {
      await audio.play();
      if (token !== this.playSessionToken) return;
      this.isLoadingState = false;
      this.isPlayingState = true;
      this.updateMediaSessionMetadata(seg.text);
      this.notify();
    } catch (err: any) {
      if (token !== this.playSessionToken) return;
      this.isLoadingState = false;
      this.isPlayingState = false;
      this.error = 'Toque em Play para iniciar o áudio em segundo plano no celular.';
      this.notify();
    }
  }

  private async playShadowingPauseThenNext(token: number, index: number) {
    const audio = this.ensureAudioElement();
    this.phaseLabel = 'Pausa ativa para você repetir em voz alta (3.5s)...';
    this.notify();

    audio.onended = null;
    audio.onerror = null;
    audio.src = generateSilentWavUrl(3.5);
    audio.onended = () => {
      if (token !== this.playSessionToken || this.mode !== 'podcast') return;
      this.playPodcastSegmentAt(index + 1);
    };

    try {
      await audio.play();
    } catch {
      if (token === this.playSessionToken) {
        this.isPlayingState = false;
        this.notify();
      }
    }
  }

  private async playPortugueseTranslationThenNext(token: number, seg: TranscriptSegment, index: number) {
    this.phaseLabel = 'Traduzindo e reproduzindo em português...';
    this.isLoadingState = true;
    this.notify();

    let ptText = this.translationCache.get(seg.text.trim().toLowerCase()) || '';
    if (!ptText) {
      try {
        const res = await aiService.translate(seg.text);
        if (res.translation && res.translation.trim().toLowerCase() !== seg.text.trim().toLowerCase()) {
          ptText = res.translation.trim();
          this.translationCache.set(seg.text.trim().toLowerCase(), ptText);
        }
      } catch {
        ptText = '';
      }
    }

    if (token !== this.playSessionToken || this.mode !== 'podcast') return;

    if (!ptText) {
      await this.playPodcastSegmentAt(index + 1);
      return;
    }

    const ptUrl = this.buildTtsUrl(ptText, 'pt_female', 'pt');
    const resolvedPt = await this.resolveAudioSrc(ptUrl);
    if (token !== this.playSessionToken || this.mode !== 'podcast') return;

    const audio = this.ensureAudioElement();
    audio.onended = null;
    audio.onerror = null;
    audio.src = resolvedPt;
    this.phaseLabel = `PT-BR: "${ptText}"`;
    this.isLoadingState = false;
    this.notify();

    audio.onended = () => {
      if (token !== this.playSessionToken || this.mode !== 'podcast') return;
      this.playPodcastSegmentAt(index + 1);
    };
    audio.onerror = () => {
      if (token !== this.playSessionToken || this.mode !== 'podcast') return;
      this.playPodcastSegmentAt(index + 1);
    };

    try {
      await audio.play();
    } catch {
      if (token === this.playSessionToken) {
        this.isPlayingState = false;
        this.notify();
      }
    }
  }

  async loadLocalAudio(file: File, meta: { title: string; channel?: string; startTime?: number }) {
    this.playSessionToken++;
    this.releaseLocalAudioUrl();

    const url = URL.createObjectURL(file);
    this.localObjectUrl = url;
    this.localFileName = file.name;
    this.videoTitle = meta.title || file.name;
    this.videoChannel = meta.channel || 'Arquivo Local';
    this.mode = 'local';
    this.error = null;
    this.phaseLabel = `Áudio local: ${file.name}`;
    this.localCurrentTime = meta.startTime || 0;

    const audio = this.ensureAudioElement();
    audio.onended = null;
    audio.onerror = null;
    audio.ontimeupdate = null;
    audio.src = url;
    audio.playbackRate = this.playbackRate;

    audio.onloadedmetadata = () => {
      this.localDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (meta.startTime && meta.startTime > 0) {
        try {
          audio.currentTime = meta.startTime;
        } catch {}
      }
      this.notify();
    };

    audio.ontimeupdate = () => {
      this.localCurrentTime = audio.currentTime || 0;
      this.localDuration = Number.isFinite(audio.duration) ? audio.duration : this.localDuration;
      this.localTimeListeners.forEach((cb) => cb(this.localCurrentTime, this.localDuration));
      this.notify();
    };

    audio.onended = () => {
      this.isPlayingState = false;
      this.updateMediaSessionMetadata();
      this.notify();
    };

    audio.onerror = () => {
      this.isPlayingState = false;
      this.error = 'Formato de áudio não suportado pelo navegador.';
      this.notify();
    };

    this.updateMediaSessionMetadata(file.name);
    await this.resume();
  }

  seekLocalTo(seconds: number) {
    if (this.mode !== 'local' || !this.audio) return;
    const clamped = Math.max(0, seconds);
    try {
      this.audio.currentTime = clamped;
      this.localCurrentTime = clamped;
      this.localTimeListeners.forEach((cb) => cb(clamped, this.localDuration));
      this.notify();
    } catch {}
  }

  seekLocalDelta(deltaSeconds: number) {
    if (this.mode !== 'local' || !this.audio) return;
    this.seekLocalTo((this.audio.currentTime || 0) + deltaSeconds);
  }

  pause() {
    this.playSessionToken++;
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
    this.isPlayingState = false;
    this.isLoadingState = false;
    this.updateMediaSessionMetadata();
    this.notify();
  }

  async resume() {
    if (this.mode === 'off') return;
    const audio = this.ensureAudioElement();
    if (!audio.src && this.mode === 'podcast' && this.segments.length > 0) {
      await this.playPodcastSegmentAt(this.podcastIndex);
      return;
    }

    try {
      await audio.play();
      this.isPlayingState = true;
      this.error = null;
      this.updateMediaSessionMetadata();
      this.notify();
    } catch {
      this.isPlayingState = false;
      this.notify();
    }
  }

  stop() {
    this.playSessionToken++;
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.ontimeupdate = null;
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.releaseLocalAudioUrl();
    this.mode = 'off';
    this.isPlayingState = false;
    this.isLoadingState = false;
    this.phaseLabel = '';
    this.error = null;

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch {}
    }
    this.notify();
  }

  private releaseLocalAudioUrl() {
    if (this.localObjectUrl) {
      URL.revokeObjectURL(this.localObjectUrl);
      this.localObjectUrl = null;
    }
    this.localFileName = null;
    this.localCurrentTime = 0;
    this.localDuration = 0;
  }
}

export const backgroundAudioService = new BackgroundAudioController();

// ==========================================================================
// Screen Wake Lock Helper (keeps screen awake during hands-free mobile study)
// ==========================================================================
let activeWakeLock: any = null;
let wakeLockDesired = false;
let visibilityBound = false;

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquireWakeLockInternal(): Promise<boolean> {
  if (!isWakeLockSupported()) return false;
  try {
    activeWakeLock = await (navigator as any).wakeLock.request('screen');
    activeWakeLock.addEventListener?.('release', () => {
      activeWakeLock = null;
    });
    return true;
  } catch {
    activeWakeLock = null;
    return false;
  }
}

export async function setScreenWakeLock(enabled: boolean): Promise<boolean> {
  wakeLockDesired = enabled;

  if (!enabled) {
    if (activeWakeLock) {
      try {
        await activeWakeLock.release();
      } catch {}
      activeWakeLock = null;
    }
    return false;
  }

  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (wakeLockDesired && document.visibilityState === 'visible' && !activeWakeLock) {
        acquireWakeLockInternal().catch(() => {});
      }
    });
  }

  return acquireWakeLockInternal();
}
