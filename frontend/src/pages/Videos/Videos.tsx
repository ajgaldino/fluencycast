import React, { useState, useEffect } from 'react';
import { videoService } from '../../services/videos';
import { Video } from '../../types/video';
import { Plus, Video as VideoIcon, Music, Trash2, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Videos: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState<'video' | 'music'>('video');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Tem certeza que deseja remover este vídeo?')) return;
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

      {showAddModal && (
        <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid var(--border-focus)' }}>
          <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Adicionar Link do YouTube</h2>
          {error && <p style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</p>}
          <div className="form-group">
            <input
              type="url"
              className="form-input"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="category"
                checked={category === 'video'}
                onChange={() => setCategory('video')}
              />
              <span>🎬 Vídeo (Podcast / Aula)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="category"
                checked={category === 'music'}
                onChange={() => setCategory('music')}
              />
              <span>🎵 Música / Lyric</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setShowAddModal(false); setError(null); }}
              className="btn btn-secondary"
            >
              Cancelar
            </button>
            <button
              onClick={() => alert('O motor de extração de legendas e sincronização será ativado na ETAPA 2!')}
              className="btn btn-primary"
            >
              Processar Vídeo
            </button>
          </div>
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
