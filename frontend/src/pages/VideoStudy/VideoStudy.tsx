import React, { useEffect, useState, useRef } from 'react';
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
  ExternalLink
} from 'lucide-react';
import { videoService } from '../../services/videos';
import { phraseService } from '../../services/phrases';
import { aiService, ExplainResponse } from '../../services/ai';
import { Video, TranscriptSegment } from '../../types/video';
import './VideoStudy.css';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
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
  const [autoScroll, setAutoScroll] = useState(true);

  // Synchronized Transcript State
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});
  const [savedSegmentIds, setSavedSegmentIds] = useState<Set<string>>(new Set());
  const [savingSegmentIds, setSavingSegmentIds] = useState<Record<string, boolean>>({});

  // AI Explain Modal
  const [explainingSegment, setExplainingSegment] = useState<TranscriptSegment | null>(null);
  const [explainData, setExplainData] = useState<ExplainResponse | null>(null);
  const [loadingExplain, setLoadingExplain] = useState(false);

  const transcriptListRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<any>(null);

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
          const savedIds = new Set(
            savedPhrases
              .filter((p) => p.video_id === id && p.transcript_segment_id)
              .map((p) => p.transcript_segment_id as string)
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

      // Recreate fresh mount target to avoid orphaned iframes
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
              // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0
              if (event.data === 1) {
                setIsPlaying(true);
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

  // 3. Playback Synchronization Polling
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

          if (video && video.segments && video.segments.length > 0) {
            // Find current active segment
            const seg = video.segments.find(
              (s) => time >= s.start_time && time < s.end_time
            );

            if (seg) {
              setActiveSegmentId(seg.id);

              // If loop mode is activated on this segment:
              if (isLoopingSegment && time >= seg.end_time - 0.25) {
                playerRef.current.seekTo(seg.start_time, true);
              }
            }
          }
        }
      } catch (e) {
        // Player not ready or iframe cross-origin check
      }
    }, 150);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [video, isLoopingSegment]);

  // 4. Auto-Scroll to Active Segment
  useEffect(() => {
    if (!autoScroll || !activeSegmentId) return;

    if (activeCardRef.current && transcriptListRef.current) {
      const container = transcriptListRef.current;
      const element = activeCardRef.current;

      const elementTop = element.offsetTop;
      const elementHeight = element.offsetHeight;
      const containerHeight = container.clientHeight;

      container.scrollTo({
        top: elementTop - containerHeight / 2 + elementHeight / 2,
        behavior: 'smooth',
      });
    }
  }, [activeSegmentId, autoScroll]);

  // Player controls
  const handleTogglePlay = () => {
    if (!playerRef.current) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const handleSeekDelta = (deltaSeconds: number) => {
    if (!playerRef.current) return;
    const target = Math.max(0, currentTime + deltaSeconds);
    playerRef.current.seekTo(target, true);
  };

  const handleSeekToSegment = (seg: TranscriptSegment) => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(seg.start_time, true);
    playerRef.current.playVideo();
  };

  const handleRepeatCurrent = () => {
    if (!video?.segments || !playerRef.current) return;
    const activeSeg = video.segments.find((s) => s.id === activeSegmentId);
    if (activeSeg) {
      playerRef.current.seekTo(activeSeg.start_time, true);
      playerRef.current.playVideo();
    } else {
      handleSeekDelta(-5);
    }
  };

  const handleChangePlaybackRate = (rate: number) => {
    if (!playerRef.current) return;
    playerRef.current.setPlaybackRate(rate);
    setPlaybackRate(rate);
  };

  // Save Phrase Action
  const handleSavePhrase = async (seg: TranscriptSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!video) return;

    if (savedSegmentIds.has(seg.id)) return; // Already saved

    try {
      setSavingSegmentIds((prev) => ({ ...prev, [seg.id]: true }));
      await phraseService.savePhrase({
        video_id: video.id,
        transcript_segment_id: seg.id,
        text: seg.text,
        translation: translations[seg.id] || null,
        context_sentence: seg.text,
        timestamp: seg.start_time,
        phrase_type: 'SENTENCE',
        difficulty: 'NORMAL',
      });

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
      // Toggle off
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
  const filteredSegments = (video?.segments || []).filter((seg) =>
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
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {video.category === 'music' ? '🎵 Estudo de Canção' : '🎬 Estudo com Vídeo'}
          </div>
        </div>

        {/* Video Player Box */}
        <div className="video-player-wrapper" ref={containerRef}>
          <div id="yt-study-player" />
        </div>

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
            <span>{video.segments?.length || 0} frases sincronizadas</span>
          </div>
        </div>
      </div>

      {/* RIGHT: Synchronized Interactive Transcript */}
      <div className="transcript-column">
        {/* Transcript Header & Search */}
        <div className="transcript-header">
          <div className="flex-between">
            <span style={{ fontSize: '0.9rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sparkles size={15} color="var(--primary)" />
              Transcrição Sincronizada
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`control-btn ${autoScroll ? 'active' : ''}`}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                title="Rolar lista automaticamente acompanhando a fala"
              >
                Auto-scroll {autoScroll ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div className="transcript-search-box">
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              className="transcript-search-input"
              placeholder="Buscar palavras ou expressões na transcrição..."
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
              const isSaved = savedSegmentIds.has(seg.id);
              const isSaving = !!savingSegmentIds[seg.id];
              const isTranslating = !!translatingIds[seg.id];
              const translation = translations[seg.id];

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
                      {/* Ouvir trecho */}
                      <button
                        className="action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSeekToSegment(seg);
                        }}
                        title="Tocar este trecho"
                      >
                        <Volume2 size={15} />
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

                  {/* English Sentence Text */}
                  <div className="segment-text">{seg.text}</div>

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
