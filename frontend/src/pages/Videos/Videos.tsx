import React, { useState, useEffect } from 'react';
import { videoService } from '../../services/videos';
import { Video } from '../../types/video';
import { Plus, Video as VideoIcon, Music, Trash2, CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type ProcessingStep = 'idle' | 'fetching' | 'transcribing' | 'saving' | 'ready' | 'error';

export const Videos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<'video' | 'music'>('video');
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

  const handleProcessVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setErrorMessage(null);
    setStep('fetching');

    try {
      // Step simulation for rich feedback during server processing
      const fetchTimer = setTimeout(() => {
        setStep('transcribing');
      }, 1200);

      const savingTimer = setTimeout(() => {
        setStep('saving');
      }, 2400);

      const video = await videoService.createVideo({ url, category });

      clearTimeout(fetchTimer);
      clearTimeout(savingTimer);

      setCreatedVideo(video);
      setStep('ready');
      setVideos((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
    } catch (err: any) {
      setStep('error');
      setErrorMessage(
        err.message ||
        'Não foi possível obter uma transcrição para este vídeo. Certifique-se de que o vídeo possui legendas disponíveis no YouTube.'
      );
    }
  };

  const resetModal = () => {
    setShowAddModal(false);
    setUrl('');
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
            Cole o link de qualquer vídeo ou podcast em inglês do YouTube.
          </p>

          {step === 'idle' && (
            <form onSubmit={handleProcessVideo}>
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
                  <span>🎬 Vídeo (Podcast / Aula / Entrevista)</span>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--accent-emerald)', marginBottom: '1rem' }}>
                <CheckCircle2 size={24} />
                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>Lição pronta para estudo!</span>
              </div>

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

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button onClick={resetModal} className="btn btn-secondary">
                  Fechar
                </button>
                <button
                  onClick={() => navigate(`/videos/${createdVideo.id}`)}
                  className="btn btn-primary"
                >
                  <span>Começar a Estudar</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Error Step */}
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
                  <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>Não foi possível processar</div>
                  <div>{errorMessage}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.5rem' }}>
                    Dica: Escolha vídeos do YouTube que possuam legendas (CC / Closed Captions) ativadas pelo canal ou legendas automáticas em inglês.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button onClick={resetModal} className="btn btn-secondary">
                  Cancelar
                </button>
                <button onClick={() => setStep('idle')} className="btn btn-primary">
                  Tentar outro link
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
