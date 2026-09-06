import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Repeat,
  Sparkles,
  Star,
  Languages,
  Search,
  Check,
  Loader2,
  Volume2,
  Info,
  X,
  ExternalLink,
  Edit3,
  Scissors,
  Eye,
  EyeOff,
  Mic,
  MicOff,
  MessageSquare,
  Puzzle,
  Send,
  HelpCircle
} from 'lucide-react';
import { videoService } from '../../services/videos';
import { phraseService } from '../../services/phrases';
import { aiService, ExplainResponse, WordInfoResponse } from '../../services/ai';
import { Video, TranscriptSegment } from '../../types/video';
import './VideoStudy.css';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

/**
 * Intelligent sentence fragmenter:
 * Breaks long paragraphs into concise, bite-sized phrases (8-12 words max)
 * with precisely calculated proportional timestamps.
 */
function fragmentSegments(rawSegments: TranscriptSegment[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];

  for (const seg of rawSegments) {
    const text = seg.text.trim();
    if (!text) continue;

    // Split on sentence terminators (. ! ?)
    const rawSentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const pieces: string[] = [];
    for (const s of rawSentences) {
      const words = s.split(/\s+/);
      if (words.length > 12) {
        // Split by comma, semicolon, dash if still long
        const sub = s.split(/(?<=[,;—])\s+/).map((p) => p.trim()).filter(Boolean);
        if (sub.length > 1 && sub.every((p) => p.split(/\s+/).length <= 14)) {
          pieces.push(...sub);
        } else {
          pieces.push(s);
        }
      } else {
        pieces.push(s);
      }
    }

    if (pieces.length <= 1) {
      result.push(seg);
      continue;
    }

    const totalLen = pieces.reduce((sum, p) => sum + p.length, 0) || 1;
    const totalDur = Math.max(0.6, seg.end_time - seg.start_time);

    let currStart = seg.start_time;
    pieces.forEach((p, idx) => {
      const pDur = (p.length / totalLen) * totalDur;
      const pEnd = currStart + pDur;
      result.push({
        id: `${seg.id}_p${idx + 1}`,
        video_id: seg.video_id,
        sequence: result.length + 1,
        text: p,
        start_time: Math.round(currStart * 100) / 100,
        end_time: Math.round(pEnd * 100) / 100,
      });
      currStart = pEnd;
    });
  }

  return result;
}

export const VideoStudy: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Player state
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLoopingSegment, setIsLoopingSegment] = useState(false);

  // Learning Modes
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [shortSentencesMode, setShortSentencesMode] = useState(true);
  const [listeningBlur, setListeningBlur] = useState(false);
  const [autoPauseMode, setAutoPauseMode] = useState(false);
  const [isPausedForShadowing, setIsPausedForShadowing] = useState(false);
  const lastPausedSegRef = useRef<string | null>(null);

  // Synchronized Transcript State
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});
  const [savedSegmentIds, setSavedSegmentIds] = useState<Set<string>>(new Set());
  const [savedPhrasesList, setSavedPhrasesList] = useState<any[]>([]);
  const [savingSegmentIds, setSavingSegmentIds] = useState<Record<string, boolean>>({});

  // Word Click Lookup Modal
  const [wordModalData, setWordModalData] = useState<WordInfoResponse | null>(null);
  const [loadingWord, setLoadingWord] = useState(false);
  const [savingWord, setSavingWord] = useState(false);
  const [wordSavedSuccess, setWordSavedSuccess] = useState(false);

  // Voice Recording
  const [recordingSegId, setRecordingSegId] = useState<string | null>(null);
  const [userAudioUrls, setUserAudioUrls] = useState<Record<string, string>>({});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Cloze / Dictation Quiz Modal
  const [quizSeg, setQuizSeg] = useState<TranscriptSegment | null>(null);
  const [quizBlankWord, setQuizBlankWord] = useState('');
  const [quizOptions, setQuizOptions] = useState<string[]>([]);
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<'correct' | 'wrong' | null>(null);

  // AI Tutor Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'tutor'; text: string }>>([
    {
      role: 'tutor',
      text: 'Olá! Sou seu Tutor IA. Pode me fazer qualquer pergunta sobre as frases, expressões, gírias ou pronúncia deste vídeo!'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  // Segment Edit Modal State
  const [editingSeg, setEditingSeg] = useState<TranscriptSegment | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiTranslatingEdit, setAiTranslatingEdit] = useState(false);

  // AI Explain Modal State
  const [explainingSegment, setExplainingSegment] = useState<TranscriptSegment | null>(null);
  const [explainData, setExplainData] = useState<ExplainResponse | null>(null);
  const [loadingExplain, setLoadingExplain] = useState(false);

  const transcriptListRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);
  const pauseAtTimeRef = useRef<number | null>(null);

  // 1. Fetch Video & Saved Phrases
  useEffect(() => {
    if (!id) return;
    let isMounted = true;

    async function loadData() {
      try {
        setLoading(true);
        const [videoData, savedPhrases] = await Promise.all([
          videoService.getVideoById(id!),
          phraseService.getPhrases().catch(() => []),
        ]);

        if (isMounted) {
          setVideo(videoData);
          const videoPhrases = savedPhrases.filter((p: any) => p.video_id === id);
          setSavedPhrasesList(videoPhrases);
          const savedIds = new Set<string>(
            videoPhrases
              .filter((p: any) => p.transcript_segment_id)
              .map((p: any) => p.transcript_segment_id as string)
          );
          setSavedSegmentIds(savedIds);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Erro ao carregar conteúdo do vídeo.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [id]);

  // Displayed Segments (Full or Fragmented into short sentences)
  const displayedSegments = useMemo(() => {
    if (!video?.segments) return [];
    if (!shortSentencesMode) return video.segments;
    return fragmentSegments(video.segments);
  }, [video?.segments, shortSentencesMode]);

  // 2. Initialize YouTube IFrame Player
  useEffect(() => {
    if (!video || !video.youtube_id) return;

    let destroyed = false;

    const initPlayer = () => {
      if (destroyed || !window.YT || !window.YT.Player) return;
      if (!containerRef.current) return;

      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch (e) {
          // ignore
        }
      }

      containerRef.current.innerHTML = '<div id="yt-study-player"></div>';

      try {
        playerRef.current = new window.YT.Player('yt-study-player', {
          videoId: video.youtube_id,
          host: 'https://www.youtube.com',
          playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            widget_referrer: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              if (destroyed) return;
              setIsPlayerReady(true);
              try {
                setPlaybackRate(event.target.getPlaybackRate() || 1);
              } catch (e) {
                // ignore
              }
            },
            onStateChange: (event: any) => {
              if (destroyed) return;
              if (event.data === 1) {
                setIsPlaying(true);
                setIsPausedForShadowing(false);
              } else {
                setIsPlaying(false);
              }
            },
          },
        });
      } catch (err) {
        console.warn('Error creating YT.Player:', err);
      }
    };

    if (!window.YT || !window.YT.Player) {
      if (!document.getElementById('yt-iframe-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-iframe-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') {
          try {
            prevCallback();
          } catch (e) {}
        }
        initPlayer();
      };
    } else {
      initPlayer();
    }

    return () => {
      destroyed = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [video?.youtube_id]);

  // 3. Playback Synchronization Polling & Auto-Pause
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      if (!playerRef.current || typeof playerRef.current.getCurrentTime !== 'function') {
        return;
      }

      try {
        const time = playerRef.current.getCurrentTime();
        if (typeof time === 'number' && !isNaN(time)) {
          setCurrentTime(time);

          // Pause video automatically when snippet ends (for dictation quiz or speaker button)
          if (pauseAtTimeRef.current !== null && time >= pauseAtTimeRef.current - 0.2) {
            pauseAtTimeRef.current = null;
            playerRef.current.pauseVideo();
            setIsPlaying(false);
            return;
          }

          if (displayedSegments.length > 0) {
            const seg = displayedSegments.find(
              (s) => time >= s.start_time && time < s.end_time
            );

            if (seg) {
              setActiveSegmentId(seg.id);

              // Auto-Pause (Shadowing): Pause when reaching segment end
              if (
                autoPauseMode &&
                time >= seg.end_time - 0.3 &&
                lastPausedSegRef.current !== seg.id
              ) {
                lastPausedSegRef.current = seg.id;
                playerRef.current.pauseVideo();
                setIsPausedForShadowing(true);
                return;
              }

              // Loop mode: repeat active sentence
              if (isLoopingSegment && time >= seg.end_time - 0.2) {
                playerRef.current.seekTo(seg.start_time, true);
              }
            }
          }
        }
      } catch (e) {
        // Player not ready
      }
    }, 150);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [displayedSegments, isLoopingSegment, autoPauseMode]);

  // Auto-translate active segment if live autoTranslate is enabled
  useEffect(() => {
    if (!autoTranslate || !activeSegmentId || displayedSegments.length === 0) return;
    const seg = displayedSegments.find((s) => s.id === activeSegmentId);
    if (!seg || translations[seg.id] || translatingIds[seg.id]) return;

    aiService.translate(seg.text).then((res) => {
      if (res.translation && res.translation.toLowerCase() !== seg.text.toLowerCase()) {
        setTranslations((prev) => ({ ...prev, [seg.id]: res.translation }));
      }
    }).catch(() => {});
  }, [activeSegmentId, autoTranslate, displayedSegments]);

  // 4. Auto-Scroll to Active Segment (Smoothly and precisely centered in viewport)
  useEffect(() => {
    if (!autoScroll || !activeSegmentId) return;

    // Use requestAnimationFrame so that layout and DOM styles have rendered
    const frameId = requestAnimationFrame(() => {
      const container = transcriptListRef.current;
      const element = activeCardRef.current;
      if (!container || !element) return;

      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      // Absolute distance from center of element to center of scroll container
      const elementCenter = elementRect.top + elementRect.height / 2;
      const containerCenter = containerRect.top + containerRect.height / 2;
      const diff = elementCenter - containerCenter;

      // Only scroll if there is a noticeable misalignment (> 5px)
      if (Math.abs(diff) > 5) {
        container.scrollTo({
          top: container.scrollTop + diff,
          behavior: 'smooth',
        });
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [activeSegmentId, autoScroll]);

  // Player controls
  const handleTogglePlay = () => {
    if (!playerRef.current || typeof playerRef.current.playVideo !== 'function') return;
    try {
      pauseAtTimeRef.current = null;
      if (isPlaying) {
        playerRef.current.pauseVideo();
      } else {
        playerRef.current.playVideo();
        setIsPausedForShadowing(false);
      }
    } catch (e) {}
  };

  const handleResumeFromAutoPause = () => {
    if (!playerRef.current) return;
    pauseAtTimeRef.current = null;
    setIsPausedForShadowing(false);
    playerRef.current.playVideo();
  };

  const handleSeekDelta = (deltaSeconds: number) => {
    if (!playerRef.current || typeof playerRef.current.seekTo !== 'function') return;
    try {
      pauseAtTimeRef.current = null;
      const target = Math.max(0, currentTime + deltaSeconds);
      playerRef.current.seekTo(target, true);
    } catch (e) {}
  };

  const handleSeekToSegment = (seg: TranscriptSegment) => {
    if (!playerRef.current || typeof playerRef.current.seekTo !== 'function') return;
    try {
      pauseAtTimeRef.current = null;
      lastPausedSegRef.current = null;
      setIsPausedForShadowing(false);
      playerRef.current.seekTo(seg.start_time, true);
      playerRef.current.playVideo();
    } catch (e) {}
  };

  // Play ONLY this specific segment and pause when it ends
  const handlePlaySegmentOnly = (seg: TranscriptSegment) => {
    if (!playerRef.current || typeof playerRef.current.seekTo !== 'function') return;
    try {
      lastPausedSegRef.current = null;
      setIsPausedForShadowing(false);
      pauseAtTimeRef.current = seg.end_time;
      playerRef.current.seekTo(seg.start_time, true);
      playerRef.current.playVideo();
    } catch (e) {}
  };

  const handleRepeatCurrent = () => {
    if (!displayedSegments.length || !playerRef.current || typeof playerRef.current.seekTo !== 'function') return;
    const activeSeg = displayedSegments.find((s) => s.id === activeSegmentId);
    try {
      lastPausedSegRef.current = null;
      setIsPausedForShadowing(false);
      if (activeSeg) {
        playerRef.current.seekTo(activeSeg.start_time, true);
        playerRef.current.playVideo();
      } else {
        handleSeekDelta(-5);
      }
    } catch (e) {}
  };

  const handleChangePlaybackRate = (rate: number) => {
    if (!playerRef.current || typeof playerRef.current.setPlaybackRate !== 'function') return;
    try {
      playerRef.current.setPlaybackRate(rate);
      setPlaybackRate(rate);
    } catch (e) {}
  };

  const handleSpeakWord = (word: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(word);
      utt.lang = 'en-US';
      utt.rate = 0.88;
      window.speechSynthesis.speak(utt);
    }
  };

  // Click on a single word for Instant Dictionary Lookup
  const handleWordClick = async (cleanWord: string, contextSentence: string) => {
    setWordSavedSuccess(false);
    setLoadingWord(true);
    setWordModalData({
      word: cleanWord,
      translation: 'Buscando...',
      part_of_speech: 'palavra',
      definition: 'Carregando significado...',
      example: contextSentence
    });

    try {
      const info = await aiService.getWordInfo(cleanWord, contextSentence);
      setWordModalData(info);
    } catch (e) {
      setWordModalData({
        word: cleanWord,
        translation: cleanWord,
        part_of_speech: 'palavra',
        definition: `Palavra em inglês no contexto: "${contextSentence}"`,
        example: contextSentence
      });
    } finally {
      setLoadingWord(false);
    }
  };

  // Save Single Word into Word Deck
  const handleSaveWordToDeck = async () => {
    if (!wordModalData || !video) return;
    try {
      setSavingWord(true);
      await phraseService.savePhrase({
        video_id: video.id,
        text: wordModalData.word,
        translation: wordModalData.translation,
        context_sentence: wordModalData.example,
        timestamp: currentTime,
        phrase_type: 'WORD',
        difficulty: 'NORMAL'
      });
      setWordSavedSuccess(true);
    } catch (err: any) {
      alert(err.message || 'Falha ao salvar palavra no deck.');
    } finally {
      setSavingWord(false);
    }
  };

  // Save Phrase Action - Saves exact fragment text and supports toggle unsave!
  const handleSavePhrase = async (seg: TranscriptSegment, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!video) return;

    const cleanSegText = seg.text.trim().toLowerCase();
    const existingPhrase = savedPhrasesList.find(
      (p) => p.text.trim().toLowerCase() === cleanSegText
    );

    // If already saved, clicking star toggles off (deletes)
    if (existingPhrase) {
      try {
        setSavingSegmentIds((prev) => ({ ...prev, [seg.id]: true }));
        await phraseService.deletePhrase(existingPhrase.id);
        setSavedPhrasesList((prev) => prev.filter((p) => p.id !== existingPhrase.id));
        setSavedSegmentIds((prev) => {
          const next = new Set(prev);
          next.delete(seg.id);
          return next;
        });
      } catch (err: any) {
        alert(err.message || 'Falha ao remover frase salva.');
      } finally {
        setSavingSegmentIds((prev) => ({ ...prev, [seg.id]: false }));
      }
      return;
    }

    // Save this exact short fragment
    try {
      setSavingSegmentIds((prev) => ({ ...prev, [seg.id]: true }));

      let translationToSave = translations[seg.id];
      if (!translationToSave) {
        try {
          const res = await aiService.translate(seg.text.trim());
          if (res.translation && res.translation.toLowerCase() !== seg.text.trim().toLowerCase()) {
            translationToSave = res.translation;
            setTranslations((prev) => ({ ...prev, [seg.id]: res.translation }));
          }
        } catch (e) {}
      }

      const baseSegmentId = seg.id.includes('_p') ? seg.id.split('_p')[0] : seg.id;

      const created = await phraseService.savePhrase({
        video_id: video.id,
        transcript_segment_id: baseSegmentId,
        text: seg.text.trim(),
        translation: translationToSave || null,
        context_sentence: seg.text.trim(),
        timestamp: seg.start_time,
        phrase_type: 'SENTENCE',
        difficulty: 'NORMAL',
      });

      setSavedPhrasesList((prev) => [created, ...prev]);
      setSavedSegmentIds((prev) => new Set([...prev, seg.id]));
    } catch (err: any) {
      alert(err.message || 'Falha ao salvar frase.');
    } finally {
      setSavingSegmentIds((prev) => ({ ...prev, [seg.id]: false }));
    }
  };

  // Translate Segment Action
  const handleToggleTranslate = async (seg: TranscriptSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (translations[seg.id]) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[seg.id];
        return next;
      });
      return;
    }

    try {
      setTranslatingIds((prev) => ({ ...prev, [seg.id]: true }));
      const res = await aiService.translate(seg.text);
      setTranslations((prev) => ({ ...prev, [seg.id]: res.translation }));
    } catch (err: any) {
      alert('Não foi possível traduzir a frase neste momento.');
    } finally {
      setTranslatingIds((prev) => ({ ...prev, [seg.id]: false }));
    }
  };

  // Voice Recording Toggle for Segment
  const handleToggleRecord = async (seg: TranscriptSegment, e: React.MouseEvent) => {
    e.stopPropagation();

    if (recordingSegId === seg.id) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setRecordingSegId(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setUserAudioUrls((prev) => ({ ...prev, [seg.id]: audioUrl }));
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setRecordingSegId(seg.id);
    } catch (err) {
      alert('Permissão de microfone não concedida ou dispositivo não disponível.');
    }
  };

  const handlePlayUserVoice = (segId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = userAudioUrls[segId];
    if (url) {
      const audio = new Audio(url);
      audio.play();
    }
  };

  // Open Cloze / Dictation Quiz for Segment
  const handleOpenQuiz = (seg: TranscriptSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    const words = seg.text.split(/\s+/).map((w) => w.replace(/[^a-zA-Z]/g, '')).filter((w) => w.length >= 4);
    if (words.length === 0) return;

    // Pick a candidate word to blank out
    const target = words[Math.floor(Math.random() * words.length)];

    // Generate contextual distractors from the entire video transcript
    const allVideoWords = new Set<string>();
    displayedSegments.forEach((s) => {
      s.text.split(/\s+/).forEach((w) => {
        const clean = w.replace(/[^a-zA-Z]/g, '');
        if (clean.length >= 3 && clean.toLowerCase() !== target.toLowerCase()) {
          allVideoWords.add(clean.toLowerCase());
        }
      });
    });

    // Prefer words with similar length to the target for better distractors
    const targetLen = target.length;
    const candidates = Array.from(allVideoWords)
      .sort((a, b) => Math.abs(a.length - targetLen) - Math.abs(b.length - targetLen));

    // Pick 3 distractors (prioritize similar-length words)
    const distractors = candidates.slice(0, 3);
    // Fallback if not enough words from transcript
    const fallbackPool = ['difficult', 'energy', 'people', 'always', 'listen', 'important', 'friend', 'together'];
    while (distractors.length < 3) {
      const fallback = fallbackPool.find((f) => !distractors.includes(f) && f.toLowerCase() !== target.toLowerCase());
      if (fallback) distractors.push(fallback);
      else break;
    }

    const shuffled = [target, ...distractors].sort(() => Math.random() - 0.5);

    setQuizSeg(seg);
    setQuizBlankWord(target);
    setQuizOptions(shuffled);
    setQuizAnswer(null);
    setQuizResult(null);

    // Play ONLY this audio segment and pause automatically when it finishes
    handlePlaySegmentOnly(seg);
  };

  const handleSelectQuizOption = (option: string) => {
    setQuizAnswer(option);
    if (option.toLowerCase() === quizBlankWord.toLowerCase()) {
      setQuizResult('correct');
    } else {
      setQuizResult('wrong');
    }
  };

  // AI Tutor Chat handler
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || sendingChat) return;

    const userText = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setChatInput('');
    setSendingChat(true);

    const activeSeg = displayedSegments.find((s) => s.id === activeSegmentId);
    const contextText = activeSeg ? activeSeg.text : (video?.title || '');

    try {
      const res = await aiService.chatWithTutor(userText, contextText);
      setChatMessages((prev) => [...prev, { role: 'tutor', text: res.reply }]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'tutor', text: 'Essa estrutura é super comum no inglês diário! Pratique repetindo o trecho em voz alta.' }
      ]);
    } finally {
      setSendingChat(false);
    }
  };

  // Open Edit Segment Modal
  const handleOpenEditModal = (seg: TranscriptSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSeg(seg);
    setEditText(seg.text);
    if (translations[seg.id]) {
      setEditTranslation(translations[seg.id]);
    } else {
      setEditTranslation('');
      aiService.translate(seg.text).then((res) => {
        if (res.translation && res.translation.toLowerCase() !== seg.text.toLowerCase()) {
          setEditTranslation(res.translation);
          setTranslations((prev) => ({ ...prev, [seg.id]: res.translation }));
        }
      }).catch(() => {});
    }
  };

  // AI Translate inside Edit Modal
  const handleAiTranslateModal = async () => {
    if (!editText.trim()) return;
    try {
      setAiTranslatingEdit(true);
      const res = await aiService.translate(editText);
      if (res.translation) {
        setEditTranslation(res.translation);
      }
    } catch (err) {
      // ignore
    } finally {
      setAiTranslatingEdit(false);
    }
  };

  // Save Custom Edited Phrase
  const handleSaveCustomPhrase = async () => {
    if (!editingSeg || !video) return;
    if (!editText.trim()) {
      alert('O texto não pode ficar vazio.');
      return;
    }

    try {
      setSavingEdit(true);
      const baseSegmentId = editingSeg.id.includes('_p') ? editingSeg.id.split('_p')[0] : editingSeg.id;

      await phraseService.savePhrase({
        video_id: video.id,
        transcript_segment_id: baseSegmentId,
        text: editText.trim(),
        translation: editTranslation.trim() || null,
        context_sentence: editingSeg.text,
        timestamp: editingSeg.start_time,
        phrase_type: 'SENTENCE',
        difficulty: 'NORMAL',
      });

      if (editTranslation.trim()) {
        setTranslations((prev) => ({ ...prev, [editingSeg.id]: editTranslation.trim() }));
      }
      setSavedSegmentIds((prev) => new Set([...prev, editingSeg.id, baseSegmentId]));
      setEditingSeg(null);
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar frase personalizada.');
    } finally {
      setSavingEdit(false);
    }
  };

  // AI Explain Action
  const handleOpenExplain = async (seg: TranscriptSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    setExplainingSegment(seg);
    setExplainData(null);
    setLoadingExplain(true);

    try {
      const res = await aiService.explain(seg.text);
      setExplainData(res);
    } catch (err: any) {
      setExplainData({
        sentence: seg.text,
        explanation: 'Esta frase é uma expressão natural em inglês comum no cotidiano.',
        examples: [seg.text],
      });
    } finally {
      setLoadingExplain(false);
    }
  };

  const formatTimestamp = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Filtered segments
  const filteredSegments = displayedSegments.filter((seg) =>
    seg.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <Loader2 size={36} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 1rem auto' }} />
        <p style={{ color: 'var(--text-secondary)' }}>Carregando lição e sincronizando player...</p>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="card" style={{ maxWidth: '500px', margin: '3rem auto', textAlign: 'center' }}>
        <h3 style={{ color: 'var(--accent-rose)', marginBottom: '0.5rem' }}>Lição não encontrada</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          {error || 'Não foi possível carregar este vídeo ou transcrição.'}
        </p>
        <button onClick={() => navigate('/videos')} className="btn btn-secondary">
          <ArrowLeft size={16} />
          <span>Voltar para Meus Vídeos</span>
        </button>
      </div>
    );
  }

  return (
    <div className="study-container">
      {/* LEFT: Video Player + Controls */}
      <div className="player-column">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <button
            onClick={() => navigate('/videos')}
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
          >
            <ArrowLeft size={15} />
            <span>Voltar aos Vídeos</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Open AI Tutor Chat Button */}
            <button
              onClick={() => setChatOpen(true)}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem', borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}
              title="Tirar dúvidas com o Tutor IA sobre o vídeo"
            >
              <MessageSquare size={14} />
              <span>Tutor IA</span>
            </button>
          </div>
        </div>

        {/* Video Player Box */}
        <div className="video-player-wrapper" ref={containerRef}>
          <div id="yt-study-player" />
        </div>

        {/* Auto-Pause (Shadowing) Banner */}
        {isPausedForShadowing && (
          <div className="auto-pause-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.86rem', color: '#fff', fontWeight: 600 }}>
              <span>⏸️ Frase pausada para você repetir em voz alta!</span>
            </div>
            <button
              onClick={handleResumeFromAutoPause}
              className="btn btn-primary"
              style={{ padding: '0.35rem 0.85rem', fontSize: '0.82rem' }}
            >
              <Play size={14} />
              <span>Continuar</span>
            </button>
          </div>
        )}

        {/* Study Playback Toolbar */}
        <div className="study-controls-bar">
          {/* Seek -5s, Play/Pause, Seek +5s */}
          <div className="controls-group">
            <button
              onClick={() => handleSeekDelta(-5)}
              className="control-btn"
              title="Voltar 5 segundos"
            >
              <RotateCcw size={15} />
              <span style={{ fontSize: '0.75rem', marginLeft: '2px' }}>-5s</span>
            </button>
            <button
              onClick={handleTogglePlay}
              className={`control-btn ${isPlaying ? 'active' : ''}`}
              title={isPlaying ? 'Pausar vídeo' : 'Reproduzir vídeo'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => handleSeekDelta(5)}
              className="control-btn"
              title="Avançar 5 segundos"
            >
              <span style={{ fontSize: '0.75rem', marginRight: '2px' }}>+5s</span>
              <RotateCw size={15} />
            </button>
          </div>

          {/* Repeat Current Sentence & Loop Mode */}
          <div className="controls-group">
            <button
              onClick={handleRepeatCurrent}
              className="control-btn"
              title="Repetir frase atual desde o início"
            >
              <Volume2 size={15} color="var(--accent-cyan)" />
              <span>Repetir Frase</span>
            </button>
            <button
              onClick={() => setIsLoopingSegment(!isLoopingSegment)}
              className={`control-btn ${isLoopingSegment ? 'active' : ''}`}
              title="Repetir a frase ativa continuamente (Shadowing)"
            >
              <Repeat size={15} />
              <span>Loop {isLoopingSegment ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          {/* Speed Selector */}
          <div className="controls-group">
            {[0.75, 1.0, 1.25, 1.5].map((rate) => (
              <button
                key={rate}
                onClick={() => handleChangePlaybackRate(rate)}
                className={`control-btn ${playbackRate === rate ? 'active' : ''}`}
                style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        {/* Video Info Summary */}
        <div style={{ padding: '0.25rem 0.5rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.2rem' }}>
            {video.title}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <span>{video.channel || 'YouTube'}</span>
            <span>•</span>
            <span>{displayedSegments.length} frases {shortSentencesMode ? '(curtas)' : ''}</span>
          </div>
        </div>
      </div>

      {/* RIGHT: Synchronized Interactive Transcript */}
      <div className="transcript-column">
        {/* Transcript Header & Search */}
        <div className="transcript-header">
          {/* Row 1: Title & Total counter */}
          <div className="transcript-title-row">
            <span style={{ fontSize: '0.92rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Sparkles size={16} color="var(--primary)" />
              Transcrição Interativa
            </span>
            <span className="transcript-badge-counter">
              {displayedSegments.length} {shortSentencesMode ? 'frases curtas' : 'frases'}
            </span>
          </div>

          {/* Row 2: Elegant Horizontal Tool Ribbon */}
          <div className="transcript-toolbar-row">
            {/* Auto-Scroll Toggle */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`tool-pill ${autoScroll ? 'active' : ''}`}
              title="Rolar automaticamente para manter a frase falada centralizada"
            >
              <span className="tool-pill-dot" />
              <span>Auto-scroll</span>
            </button>

            {/* Auto-Pause Mode Toggle */}
            <button
              onClick={() => setAutoPauseMode(!autoPauseMode)}
              className={`tool-pill ${autoPauseMode ? 'active' : ''}`}
              title="Pausar automaticamente ao fim de cada frase para você repetir em voz alta"
            >
              <Pause size={12} />
              <span>Auto-Pausa</span>
            </button>

            {/* Listening Blur Toggle */}
            <button
              onClick={() => setListeningBlur(!listeningBlur)}
              className={`tool-pill ${listeningBlur ? 'active' : ''}`}
              title="Desfocar legendas para treinar o ouvido primeiro"
            >
              {listeningBlur ? <EyeOff size={12} /> : <Eye size={12} />}
              <span>Ouvido</span>
            </button>

            {/* Short Sentences Mode Toggle */}
            <button
              onClick={() => setShortSentencesMode(!shortSentencesMode)}
              className={`tool-pill ${shortSentencesMode ? 'active' : ''}`}
              title="Dividir frases longas em trechos curtos para facilitar o estudo"
            >
              <Scissors size={12} />
              <span>Frases Curtas</span>
            </button>

            {/* Live Auto-Translate Toggle */}
            <button
              onClick={() => setAutoTranslate(!autoTranslate)}
              className={`tool-pill ${autoTranslate ? 'active' : ''}`}
              title="Traduzir legendas automaticamente ao vivo"
            >
              <Languages size={12} />
              <span>Traduzir</span>
            </button>
          </div>

          {/* Row 3: Search Box */}
          <div className="transcript-search-box">
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              className="transcript-search-input"
              placeholder="Buscar frase ou clique em qualquer palavra..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Transcript List */}
        <div className="transcript-list" ref={transcriptListRef}>
          {filteredSegments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              Nenhuma frase encontrada para "{searchQuery}".
            </div>
          ) : (
            filteredSegments.map((seg) => {
              const isActive = seg.id === activeSegmentId;
              const cleanText = seg.text.trim().toLowerCase();
              const isSaved =
                savedSegmentIds.has(seg.id) ||
                savedPhrasesList.some((p) => p.text.trim().toLowerCase() === cleanText);
              const isSaving = !!savingSegmentIds[seg.id];
              const isTranslating = !!translatingIds[seg.id];
              const translation = translations[seg.id];
              const isRecording = recordingSegId === seg.id;
              const userVoiceUrl = userAudioUrls[seg.id];

              return (
                <div
                  key={seg.id}
                  ref={isActive ? activeCardRef : null}
                  className={`segment-card ${isActive ? 'active' : ''}`}
                  onClick={() => handleSeekToSegment(seg)}
                >
                  <div className="segment-meta">
                    <span className="timestamp-badge">
                      {isActive && <Play size={10} fill="currentColor" />}
                      {formatTimestamp(seg.start_time)}
                    </span>

                    <div className="segment-actions">
                      {/* Ouvir trecho nativo (toca e pausa) */}
                      <button
                        className="action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlaySegmentOnly(seg);
                        }}
                        title="Tocar somente este trecho do vídeo"
                      >
                        <Volume2 size={15} />
                      </button>

                      {/* Gravar Minha Voz (Shadowing Practice) */}
                      <button
                        className="action-btn"
                        onClick={(e) => handleToggleRecord(seg, e)}
                        title={isRecording ? 'Parar gravação' : 'Gravar sua voz para comparar pronúncia'}
                        style={{ color: isRecording ? 'var(--accent-rose)' : undefined }}
                      >
                        {isRecording ? <MicOff size={15} className="recording-badge" /> : <Mic size={15} />}
                      </button>

                      {/* Ouvir Minha Voz Gravada */}
                      {userVoiceUrl && (
                        <button
                          className="action-btn"
                          onClick={(e) => handlePlayUserVoice(seg.id, e)}
                          title="Ouvir sua gravação"
                          style={{ color: 'var(--accent-emerald)' }}
                        >
                          <Play size={14} />
                        </button>
                      )}

                      {/* Ditado / Desafio Quiz */}
                      <button
                        className="action-btn"
                        onClick={(e) => handleOpenQuiz(seg, e)}
                        title="Desafio de Escuta / Ditado"
                      >
                        <Puzzle size={15} color="var(--accent-amber)" />
                      </button>

                      {/* Traduzir para Português */}
                      <button
                        className="action-btn"
                        onClick={(e) => handleToggleTranslate(seg, e)}
                        title="Ver tradução em português"
                        disabled={isTranslating}
                      >
                        {isTranslating ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Languages size={15} color={translation ? 'var(--accent-cyan)' : 'currentColor'} />
                        )}
                      </button>

                      {/* Editar texto ou tradução */}
                      <button
                        className="action-btn"
                        onClick={(e) => handleOpenEditModal(seg, e)}
                        title="Editar frase ou tradução"
                      >
                        <Edit3 size={14} color="var(--primary-light)" />
                      </button>

                      {/* Explicar com IA */}
                      <button
                        className="action-btn"
                        onClick={(e) => handleOpenExplain(seg, e)}
                        title="Explicar gramática e contexto com IA"
                      >
                        <Sparkles size={15} color="var(--accent-purple)" />
                      </button>

                      {/* Salvar Frase no Deck */}
                      <button
                        className={`action-btn ${isSaved ? 'saved' : ''}`}
                        onClick={(e) => handleSavePhrase(seg, e)}
                        title={isSaved ? 'Frase já salva nos seus estudos' : 'Salvar frase para repetição espaçada'}
                        disabled={isSaving || isSaved}
                      >
                        {isSaving ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : isSaved ? (
                          <Star size={15} fill="var(--accent-amber)" color="var(--accent-amber)" />
                        ) : (
                          <Star size={15} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* English Sentence with Clickable Words & Blur Mode */}
                  <div className={`segment-text ${listeningBlur ? 'blurred-text' : ''}`}>
                    {seg.text.split(/\s+/).map((w, wIdx) => {
                      const clean = w.replace(/[^a-zA-Z]/g, '');
                      return (
                        <span
                          key={wIdx}
                          className="word-token"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (clean) handleWordClick(clean, seg.text);
                          }}
                          title="Clique para ver o significado e salvar no vocabulário"
                        >
                          {w}{' '}
                        </span>
                      );
                    })}
                  </div>

                  {/* Inline Translation if active */}
                  {translation && (
                    <div className="segment-translation">
                      🇧🇷 {translation}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* WORD LOOKUP MODAL (When clicking any single word) */}
      {wordModalData && (
        <div className="ai-modal-overlay" onClick={() => setWordModalData(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="badge badge-primary">DICIONÁRIO CONTEXTUAL</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{wordModalData.part_of_speech}</span>
              </div>
              <button
                onClick={() => setWordModalData(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
                {wordModalData.word}
              </h3>
              <button
                onClick={() => handleSpeakWord(wordModalData.word)}
                className="btn btn-secondary"
                style={{ padding: '0.35rem 0.65rem' }}
                title="Ouvir pronúncia"
              >
                <Volume2 size={16} color="var(--accent-cyan)" />
              </button>
            </div>

            <div style={{
              padding: '0.85rem',
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.2rem' }}>
                TRADUÇÃO EM PORTUGUÊS:
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                {wordModalData.translation}
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--bg-glass)', padding: '0.65rem', borderRadius: 'var(--radius-sm)', marginBottom: wordModalData.tip ? '0.75rem' : '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.2rem' }}>
                EXEMPLO NA FALA:
              </div>
              "{wordModalData.example}"
            </div>

            {wordModalData.tip && (
              <div style={{
                fontSize: '0.84rem',
                color: 'var(--accent-amber)',
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.45rem'
              }}>
                <Sparkles size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong style={{ display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                    Dica Prática de Uso:
                  </strong>
                  <span>{wordModalData.tip}</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setWordModalData(null)}
                className="btn btn-secondary"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleSaveWordToDeck}
                className="btn btn-primary"
                disabled={savingWord || wordSavedSuccess}
              >
                {savingWord ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : wordSavedSuccess ? (
                  <Check size={15} color="var(--accent-emerald)" />
                ) : (
                  <Star size={15} />
                )}
                <span>{wordSavedSuccess ? 'Palavra Salva!' : 'Salvar no Deck de Palavras'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLOZE / DICTATION QUIZ MODAL */}
      {quizSeg && (
        <div className="ai-modal-overlay" onClick={() => setQuizSeg(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.05rem', color: 'var(--accent-amber)' }}>
                <Puzzle size={18} />
                <span>Desafio de Escuta (Preencha a Lacuna)</span>
              </div>
              <button
                onClick={() => setQuizSeg(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Ouça o trecho e escolha a palavra correta que completa a frase:
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <button
                onClick={() => handlePlaySegmentOnly(quizSeg)}
                className="btn btn-secondary"
                style={{ padding: '0.5rem 1rem' }}
              >
                <Play size={16} color="var(--accent-cyan)" />
                <span>Ouvir Trecho Novamente</span>
              </button>
            </div>

            {/* Sentence with blank */}
            <div style={{
              fontSize: '1.2rem',
              fontWeight: 600,
              textAlign: 'center',
              lineHeight: 1.6,
              background: 'var(--bg-glass)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem'
            }}>
              {quizSeg.text.split(/\s+/).map((w, i) => {
                const clean = w.replace(/[^a-zA-Z]/g, '');
                if (clean.toLowerCase() === quizBlankWord.toLowerCase()) {
                  return (
                    <span
                      key={i}
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderBottom: '3px solid var(--accent-amber)',
                        color: quizAnswer ? (quizResult === 'correct' ? 'var(--accent-emerald)' : 'var(--accent-rose)') : 'var(--accent-amber)',
                        fontWeight: 800
                      }}
                    >
                      {quizAnswer || '_____'}
                    </span>
                  );
                }
                return <span key={i}> {w} </span>;
              })}
            </div>

            {/* Word choices */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '1.25rem' }}>
              {quizOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectQuizOption(opt)}
                  className={`word-tile-chip ${quizAnswer === opt ? 'selected' : ''}`}
                  style={{ justifyContent: 'center' }}
                  disabled={!!quizAnswer}
                >
                  {opt}
                </button>
              ))}
            </div>

            {/* Feedback */}
            {quizResult && (
              <div style={{
                textAlign: 'center',
                padding: '0.75rem',
                borderRadius: 'var(--radius-sm)',
                background: quizResult === 'correct' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                color: quizResult === 'correct' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                fontWeight: 700,
                fontSize: '0.95rem',
                marginBottom: '1rem'
              }}>
                {quizResult === 'correct' ? '🎉 Resposta Correta! Excelente audição.' : `❌ Quase! A palavra dita foi "${quizBlankWord}".`}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  pauseAtTimeRef.current = null;
                  setQuizSeg(null);
                }}
                className="btn btn-secondary"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI TUTOR CHAT DRAWER */}
      {chatOpen && (
        <div className="ai-modal-overlay" onClick={() => setChatOpen(false)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px', height: '600px', display: 'flex', flexDirection: 'column' }}>
            <div className="flex-between" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'var(--accent-purple)' }}>
                <MessageSquare size={18} />
                <span>Tutor IA Contextual</span>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Message history */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingRight: '0.25rem', marginBottom: '1rem' }}>
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-glass)',
                    color: '#fff',
                    padding: '0.65rem 0.95rem',
                    borderRadius: 'var(--radius-md)',
                    maxWidth: '85%',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                    border: msg.role === 'user' ? 'none' : '1px solid var(--border-subtle)'
                  }}
                >
                  {msg.text}
                </div>
              ))}
              {sendingChat && (
                <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Tutor está respondendo...</span>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Por que usaram essa palavra? Me dê exemplos..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()}
                style={{ flex: 1, fontSize: '0.9rem' }}
              />
              <button
                onClick={handleSendChatMessage}
                className="btn btn-primary"
                disabled={sendingChat || !chatInput.trim()}
                style={{ padding: '0.6rem 1rem' }}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEGMENT EDIT MODAL */}
      {editingSeg && (
        <div className="ai-modal-overlay" onClick={() => setEditingSeg(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>
                <Edit3 size={18} color="var(--primary)" />
                <span>Personalizar Frase</span>
              </div>
              <button
                onClick={() => setEditingSeg(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Frase em Inglês (você pode encurtar ou selecionar apenas uma palavra):
              </label>
              <textarea
                className="form-input"
                rows={2}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                style={{ fontSize: '0.95rem' }}
              />
            </div>

            <div className="form-group">
              <div className="flex-between" style={{ marginBottom: '0.3rem' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>
                  Tradução em Português:
                </label>
                <button
                  type="button"
                  onClick={handleAiTranslateModal}
                  disabled={aiTranslatingEdit}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-cyan)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                >
                  {aiTranslatingEdit ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  <span>Traduzir com IA</span>
                </button>
              </div>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Tradução em português..."
                value={editTranslation}
                onChange={(e) => setEditTranslation(e.target.value)}
                style={{ fontSize: '0.95rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setEditingSeg(null)}
                className="btn btn-secondary"
                disabled={savingEdit}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveCustomPhrase}
                className="btn btn-primary"
                disabled={savingEdit}
              >
                {savingEdit ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                <span>Salvar Frase no Deck</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Explanation Modal */}
      {explainingSegment && (
        <div className="ai-modal-overlay" onClick={() => setExplainingSegment(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                <Sparkles size={18} color="var(--accent-purple)" />
                <span>Explicação com Inteligência Artificial</span>
              </div>
              <button
                onClick={() => setExplainingSegment(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{
              background: 'var(--bg-glass)',
              padding: '0.85rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              borderLeft: '3px solid var(--primary)',
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                FRASE ANALISADA:
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.98rem' }}>"{explainingSegment.text}"</div>
            </div>

            {loadingExplain ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <Loader2 size={24} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 0.75rem auto' }} />
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Analisando estrutura gramatical e expressões...</p>
              </div>
            ) : explainData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                    💡 EXPLICAÇÃO PEDAGÓGICA:
                  </div>
                  <p style={{ fontSize: '0.92rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                    {explainData.explanation}
                  </p>
                </div>

                {explainData.examples && explainData.examples.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                      📝 EXEMPLOS DE USO:
                    </div>
                    <ul style={{ listStyle: 'none', paddingLeft: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {explainData.examples.map((ex, i) => (
                        <li key={i} style={{
                          padding: '0.45rem 0.65rem',
                          background: 'rgba(255, 255, 255, 0.04)',
                          borderRadius: '4px',
                          fontSize: '0.86rem',
                          color: 'var(--accent-cyan)'
                        }}>
                          • {ex}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button
                    onClick={() => {
                      handleSavePhrase(explainingSegment, { stopPropagation: () => {} } as any);
                      setExplainingSegment(null);
                    }}
                    className="btn btn-primary"
                    style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                  >
                    <Star size={15} />
                    <span>Salvar Esta Frase no Deck</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
