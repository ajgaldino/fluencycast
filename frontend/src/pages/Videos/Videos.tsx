import React, { useState, useEffect } from 'react';
import { videoService } from '../../services/videos';
import { Video } from '../../types/video';
import { Plus, Video as VideoIcon, Trash2, CheckCircle2, AlertCircle, Loader2, ArrowRight, FileText, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type ProcessingStep = 'idle' | 'fetching' | 'transcribing' | 'saving' | 'ready' | 'error';

import { SAMPLE_CONTENTS, SampleVideo } from '../../data/sampleVideos';

export const Videos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<'video' | 'music'>('video');
  const [manualTranscript, setManualTranscript] = useState('');
  const [step, setStep] = useState<ProcessingStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdVideo, setCreatedVideo] = useState<Video | null>(null);
  const navigate = useNavigate();

  const loadVideos = async () => {
    try {
      const data = await videoService.getVideos();
      setVideos(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVideos();
  }, []);

  const handleProcessVideo = async (e?: React.FormEvent, customPayload?: { url: string; category: 'video' | 'music'; raw_transcript?: string; forceAuto?: boolean }) => {
    if (e) e.preventDefault();
    const targetUrl = (customPayload?.url || url).trim();
    const targetCategory = customPayload?.category || category;
    const targetTranscript = customPayload?.raw_transcript !== undefined 
      ? customPayload.raw_transcript 
      : manualTranscript.trim();

    if (!targetUrl) return;

    // Na nuvem (Render), se o usuário não colou a transcrição e não forçou busca automática
    if (!targetTranscript && !customPayload?.forceAuto) {
      setErrorMessage('⚠️ Na nuvem (Render), o YouTube bloqueia o download automático de legendas. Por favor, cole a transcrição do vídeo abaixo (ou escolha um dos conteúdos verificados).');
      return;
    }

    setErrorMessage(null);
    setStep('fetching');

    try {
      const fetchTimer = setTimeout(() => setStep('transcribing'), 1000);
      const savingTimer = setTimeout(() => setStep('saving'), 2000);

      const video = await videoService.createVideo({
        url: targetUrl,
        category: targetCategory,
        raw_transcript: targetTranscript || undefined
      });

      clearTimeout(fetchTimer);
      clearTimeout(savingTimer);

      setCreatedVideo(video);
      setStep('ready');
      setVideos((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
    } catch (err: any) {
      setStep('error');
      const msg = err.message || 'Falha ao processar vídeo';
      setErrorMessage(msg);
    }
  };

  const handleSelectSample = (sample: SampleVideo) => {
    setUrl(sample.url);
    setCategory(sample.category);
    setManualTranscript(sample.transcript);
    handleProcessVideo(undefined, {
      url: sample.url,
      category: sample.category,
      raw_transcript: sample.transcript
    });
  };

  const resetModal = () => {
    setShowAddModal(false);
    setUrl('');
    setManualTranscript('');
    setStep('idle');
    setErrorMessage(null);
    setCreatedVideo(null);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Tem certeza que deseja remover este vídeo da sua biblioteca?')) return;
    try {
      await videoService.deleteVideo(id);
      setVideos(videos.filter((v) => v.id !== id));
    } catch (err: any) {
      alert(err.message || 'Erro ao deletar vídeo');
    }
  };

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem' }}>Biblioteca de Mídia</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Vídeos e músicas sincronizados para estudo
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary"
          style={{ padding: '0.6rem 1rem' }}
        >
          <Plus size={18} />
          <span>Adicionar</span>
        </button>
      </div>

      {/* Modal / Card para Adicionar Vídeo */}
      {showAddModal && (
        <div className="card" style={{ marginBottom: '1.75rem', border: '1px solid var(--border-focus)', background: 'var(--gradient-card)' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.4rem' }}>Adicionar Vídeo do YouTube</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
            Cole o link de qualquer vídeo ou música em inglês do YouTube.
          </p>

          {step === 'idle' && (
            <form onSubmit={(e) => handleProcessVideo(e)}>
              <div className="form-group">
                <input
                  type="url"
                  required
                  className="form-input"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="radio"
                    name="category"
                    checked={category === 'video'}
                    onChange={() => setCategory('video')}
                  />
                  <span>🎬 Vídeo (Podcast / Aula)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input
                    type="radio"
                    name="category"
                    checked={category === 'music'}
                    onChange={() => setCategory('music')}
                  />
                  <span>🎵 Música / Canção</span>
                </label>
              </div>

              {errorMessage && step === 'idle' && (
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  padding: '0.75rem 1rem',
                  background: 'rgba(244, 63, 94, 0.12)',
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--accent-rose)',
                  fontSize: '0.86rem',
                  marginBottom: '1rem'
                }}>
                  <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Transcrição Manual sempre visível */}
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label className="form-label" style={{ fontWeight: 600, margin: 0 }}>
                    Transcrição ou Letra do Vídeo:
                  </label>
                  <span style={{ fontSize: '0.76rem', color: 'var(--accent-amber)', fontWeight: 600 }}>
                    ⭐ Recomendado para o Render
                  </span>
                </div>
                <textarea
                  className="form-input"
                  rows={5}
                  placeholder="Cole aqui a transcrição do YouTube (ex: 0:12 Hello world) ou a letra da música..."
                  value={manualTranscript}
                  onChange={(e) => setManualTranscript(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    💡 No YouTube: clique em "... Mais" abaixo do vídeo &gt; "Mostrar transcrição", copie e cole aqui.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleProcessVideo(undefined, { url, category, forceAuto: true })}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                  >
                    Tentar buscar do YouTube automaticamente
                  </button>
                </div>
              </div>

              {/* Quick Samples */}
              <div style={{ padding: '0.85rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.6rem', fontWeight: 600 }}>
                  <Sparkles size={14} color="var(--accent-amber)" />
                  <span>OU ESCOLHA UM CONTEÚDO VERIFICADO PARA TESTAR AGORA:</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {SAMPLE_CONTENTS.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className="btn btn-secondary"
                      style={{ justifyContent: 'flex-start', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                    >
                      <span>{sample.category === 'music' ? '🎵' : '🎬'}</span>
                      <span style={{ fontWeight: 600 }}>{sample.title}</span>
                      {sample.badge && (
                        <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.2)', color: 'var(--accent-amber)', padding: '0.1rem 0.4rem', borderRadius: '4px', marginLeft: '0.4rem', fontWeight: 600 }}>
                          {sample.badge}
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 'auto' }}>{sample.channel}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={resetModal}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  <span>Processar Vídeo</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}

          {/* Progress Indicator */}
          {(step === 'fetching' || step === 'transcribing' || step === 'saving') && (
            <div style={{ padding: '1rem 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: step === 'fetching' ? 'var(--primary)' : 'var(--accent-emerald)' }}>
                  {step === 'fetching' ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                    {step === 'fetching' ? 'Buscando metadados do vídeo...' : '✓ Vídeo identificado no YouTube'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: step === 'transcribing' ? 'var(--primary)' : (step === 'saving' ? 'var(--accent-emerald)' : 'var(--text-muted)') }}>
                  {step === 'transcribing' ? <Loader2 size={18} className="animate-spin" /> : (step === 'saving' ? <CheckCircle2 size={18} /> : <div style={{ width: 18 }} />)}
                  <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                    {step === 'transcribing' ? 'Obtendo e dividindo transcrição em frases...' : (step === 'saving' ? '✓ Transcrição segmentada' : 'Processamento da transcrição')}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: step === 'saving' ? 'var(--primary)' : 'var(--text-muted)' }}>
                  {step === 'saving' ? <Loader2 size={18} className="animate-spin" /> : <div style={{ width: 18 }} />}
                  <span style={{ fontSize: '0.92rem', fontWeight: 500 }}>
                    {step === 'saving' ? 'Preparando lição e sincronização...' : 'Preparando lição'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Ready Step */}
          {step === 'ready' && createdVideo && (
            <div style={{ padding: '0.5rem 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--accent-emerald)', marginBottom: '0.4rem' }}>
                <CheckCircle2 size={24} />
                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>Lição e Flashcards prontos!</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: '1.1rem' }}>
                ✨ As palavras-chave deste vídeo foram extraídas e adicionadas automaticamente aos seus <strong>Flashcards</strong> para você aprender antes de ouvi-lo.
              </p>

              <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem', background: 'var(--bg-glass)' }}>
                {createdVideo.thumbnail_url && (
                  <img
                    src={createdVideo.thumbnail_url}
                    alt={createdVideo.title}
                    style={{ width: '90px', height: '54px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                )}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{createdVideo.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{createdVideo.channel}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={resetModal} className="btn btn-secondary">
                  Fechar
                </button>
                <button
                  onClick={() => navigate(`/reviews?video_id=${createdVideo.id}&mode=WORD`)}
                  className="btn btn-secondary"
                  style={{ borderColor: 'var(--primary)', color: 'var(--primary-light)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Sparkles size={15} />
                  <span>Estudar Palavras-chave</span>
                </button>
                <button
                  onClick={() => navigate(`/videos/${createdVideo.id}`)}
                  className="btn btn-primary"
                >
                  <span>Assistir Lição</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Error Step with direct Paste Fallback */}
          {step === 'error' && (
            <div style={{ padding: '0.5rem 0' }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '1rem',
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--accent-rose)',
                fontSize: '0.9rem',
                marginBottom: '1.25rem'
              }}>
                <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Aviso de Transcrição</div>
                  <div>{errorMessage}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: '0.5rem' }}>
                    Como os servidores em nuvem (Render/AWS) sofrem bloqueio de IP do YouTube, você pode colar a transcrição diretamente do vídeo abaixo:
                  </div>
                </div>
              </div>

              {/* Paste fallback box */}
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" style={{ color: '#fff', fontWeight: 600 }}>
                  📋 Cole a Transcrição do Vídeo aqui:
                </label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.5rem' }}>
                  No YouTube, clique em "... Mais" abaixo do vídeo &gt; "Mostrar transcrição", copie e cole aqui:
                </p>
                <textarea
                  className="form-input"
                  rows={6}
                  placeholder={`0:00 Hello everyone\n0:05 Today we learn English...`}
                  value={manualTranscript}
                  onChange={(e) => setManualTranscript(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button onClick={() => setStep('idle')} className="btn btn-secondary">
                  Voltar ao Formulário
                </button>
                <button onClick={resetModal} className="btn btn-secondary">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleProcessVideo(undefined, { url, category, raw_transcript: manualTranscript })}
                  className="btn btn-primary"
                  disabled={!manualTranscript.trim()}
                >
                  <span>Processar Transcrição Colada</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Carregando biblioteca...</p>
      ) : videos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <div style={{ display: 'inline-flex', padding: '1rem', background: 'var(--bg-glass)', borderRadius: '50%', marginBottom: '1rem' }}>
            <VideoIcon size={36} color="var(--text-muted)" />
          </div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '0.4rem' }}>Nenhum conteúdo adicionado</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto 1.5rem auto' }}>
            Cole o link de um vídeo do YouTube ou música para obter a transcrição sincronizada e começar a estudar.
          </p>
          <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
            <Plus size={18} />
            <span>Adicionar Agora</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {videos.map((video) => (
            <div
              key={video.id}
              className="card card-interactive"
              onClick={() => navigate(`/videos/${video.id}`)}
            >
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <img
                  src={video.thumbnail_url || 'https://via.placeholder.com/120x68'}
                  alt={video.title}
                  style={{ width: '100px', height: '62px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.98rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {video.title}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {video.channel || 'YouTube'} • {video.category === 'music' ? '🎵 Música' : '🎬 Vídeo'}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/reviews?video_id=${video.id}&mode=WORD`);
                  }}
                  className="btn btn-secondary"
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.35rem 0.65rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    flexShrink: 0
                  }}
                  title="Estudar vocabulário deste vídeo nos Flashcards"
                >
                  <Sparkles size={13} color="var(--primary)" />
                  <span>Flashcards</span>
                </button>

                <button
                  onClick={(e) => handleDelete(video.id, e)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.5rem' }}
                  title="Excluir vídeo"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
