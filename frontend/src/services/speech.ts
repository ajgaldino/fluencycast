import { API_BASE_URL } from './api';

export interface SpeakOptions {
  voice?: 'male' | 'female' | 'guy' | 'ava' | 'british_male' | 'british_female' | string;
  rate?: '+0%' | '-15%' | '+10%' | string;
  speed?: 'normal' | 'slow';
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

class SpeechService {
  private currentAudio: HTMLAudioElement | null = null;
  private audioCache = new Map<string, string>();
  private preferredVoice: string = 'male'; // 'male' (Christopher) or 'female' (Jenny)

  /**
   * Set preferred voice globally (male or female natural voice)
   */
  setPreferredVoice(voice: 'male' | 'female' | 'guy' | 'ava' | 'british_male' | 'british_female') {
    this.preferredVoice = voice;
  }

  getPreferredVoice(): string {
    return this.preferredVoice;
  }

  /**
   * Stop any ongoing speech playback immediately
   */
  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Play authentic native English audio using Microsoft Neural TTS,
   * falling back automatically to the best Natural browser voice if offline.
   */
  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const cleanText = text.trim();
    if (!cleanText) return;

    this.stop();

    const voice = options.voice || this.preferredVoice;
    const rate = options.rate || (options.speed === 'slow' ? '-15%' : '+0%');
    const cacheKey = `${voice}_${rate}_${cleanText.toLowerCase()}`;

    // 1. Try Backend Neural TTS for human-grade studio quality
    try {
      options.onStart?.();

      let audioUrl = this.audioCache.get(cacheKey);
      if (!audioUrl) {
        audioUrl = `${API_BASE_URL}/ai/tts?text=${encodeURIComponent(cleanText)}&voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate)}`;
      }

      const audio = new Audio(audioUrl);
      this.currentAudio = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          this.currentAudio = null;
          options.onEnd?.();
          resolve();
        };
        audio.onerror = (e) => {
          this.currentAudio = null;
          reject(e);
        };
        audio.play().catch(reject);
      });

      this.audioCache.set(cacheKey, audioUrl);
      return;
    } catch (err) {
      // 2. Graceful fallback: Smart browser SpeechSynthesis using Natural voices
      this.speakWithBrowserFallback(cleanText, options);
    }
  }

  /**
   * Fallback using Web Speech API with intelligent Natural/Neural voice detection
   */
  private speakWithBrowserFallback(text: string, options: SpeakOptions = {}) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = options.speed === 'slow' ? 0.8 : 0.95;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const bestVoice = this.pickBestBrowserVoice(voices, options.voice || this.preferredVoice);
      if (bestVoice) {
        utterance.voice = bestVoice;
      }
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        const loadedVoices = window.speechSynthesis.getVoices();
        const bestVoice = this.pickBestBrowserVoice(loadedVoices, options.voice || this.preferredVoice);
        if (bestVoice) utterance.voice = bestVoice;
      };
    }

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = (e) => options.onError?.(e);

    window.speechSynthesis.speak(utterance);
  }

  /**
   * Intelligently selects the highest quality Natural / Neural English voice
   */
  private pickBestBrowserVoice(voices: SpeechSynthesisVoice[], preference: string): SpeechSynthesisVoice | null {
    const isFemale = preference.includes('female') || preference.includes('jenny') || preference.includes('ava');

    const englishVoices = voices.filter((v) => v.lang.startsWith('en'));
    if (englishVoices.length === 0) return null;

    // 1. Natural / Online Neural voices (Edge / Windows 11 / Chrome)
    const naturalVoices = englishVoices.filter((v) =>
      v.name.includes('Natural') || v.name.includes('Online') || v.name.includes('Neural')
    );
    if (naturalVoices.length > 0) {
      if (isFemale) {
        const female = naturalVoices.find((v) => v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Female'));
        if (female) return female;
      } else {
        const male = naturalVoices.find((v) => v.name.includes('Guy') || v.name.includes('Christopher') || v.name.includes('Male'));
        if (male) return male;
      }
      return naturalVoices[0];
    }

    // 2. Google High Quality US/UK voices (Chrome)
    const googleVoices = englishVoices.filter((v) => v.name.includes('Google'));
    if (googleVoices.length > 0) {
      if (isFemale) {
        const female = googleVoices.find((v) => v.name.includes('Female') || v.name.includes('UK English Female'));
        if (female) return female;
      }
      return googleVoices[0];
    }

    // 3. Apple Enhanced / Premium voices (Safari / iOS / macOS)
    const appleVoices = englishVoices.filter((v) =>
      v.name.includes('Enhanced') || v.name.includes('Premium') || v.name.includes('Samantha')
    );
    if (appleVoices.length > 0) return appleVoices[0];

    // 4. Best en-US voice
    const usVoice = englishVoices.find((v) => v.lang === 'en-US');
    return usVoice || englishVoices[0];
  }
}

export const speechService = new SpeechService();
