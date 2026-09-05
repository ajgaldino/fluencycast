import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { Flame, BookOpen, PlayCircle, PlusCircle, ArrowRight, BrainCircuit, CheckCircle2 } from 'lucide-react';
import { reviewService } from '../../services/reviews';
import { videoService } from '../../services/videos';
import { ReviewSummary } from '../../types/phrase';
import { Video } from '../../types/video';

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ReviewSummary>({
    due_phrases_count: 0,
    mastered_count: 0,
    learning_count: 0,
    streak_days: 1,
  });
  const [recentVideos, setRecentVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        const [sum, vids] = await Promise.all([
          reviewService.getSummary().catch(() => ({
            due_phrases_count: 0,
            mastered_count: 0,
            learning_count: 0,
            streak_days: user?.profile?.current_streak || 1,
          })),
          videoService.getVideos().catch(() => []),
        ]);
        setSummary(sum);
        setRecentVideos(vids);
      } finally {
        setLoading(false);
      }
    };
    loadDashboardData();
  }, [user]);

  const firstName = user?.full_name ? user.full_name.split(' ')[0] : 'Estudante';
  const lastVideo = recentVideos[0];

  return (
    <div>
      {/* Welcome Banner */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
          <h1 style={{ fontSize: '1.75rem' }}>Good day, {firstName}</h1>
          <div className="badge badge-amber">
            <Flame size={14} />
            <span>{summary.streak_days} dias seguidos</span>
          </div>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Pronto para expandir seu vocabulário e compreensão hoje?
        </p>
      </div>

      {/* Review Call-to-Action Card */}
      <div className="card" style={{
        marginBottom: '1.5rem',
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.1) 100%)',
        border: '1px solid rgba(99, 102, 241, 0.3)'
      }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-link)', fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem' }}>
              <BrainCircuit size={18} />
              <span>TODAY'S REVIEW</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>
              {summary.due_phrases_count} {summary.due_phrases_count === 1 ? 'frase' : 'frases'} para revisar
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
              Fortaleça suas conexões neurais com Repetição Espaçada
            </p>
          </div>

          <Link
            to="/reviews"
            className="btn btn-primary"
            style={{ padding: '0.7rem 1.4rem' }}
          >
            <span>Iniciar Revisão</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {/* Continue Studying Section */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div className="flex-between" style={{ marginBottom: '0.85rem' }}>
          <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <PlayCircle size={20} color="var(--primary)" />
            <span>Continue Estudando</span>
          </h2>
          <Link to="/videos" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Ver todos ({recentVideos.length})</Link>
        </div>

        {lastVideo ? (
          <div className="card card-interactive" onClick={() => navigate(`/videos/${lastVideo.id}`)}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              {lastVideo.thumbnail_url ? (
                <img
                  src={lastVideo.thumbnail_url}
                  alt={lastVideo.title}
                  style={{ width: '100px', height: '62px', objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                />
              ) : (
                <div style={{ width: '100px', height: '62px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PlayCircle size={24} color="var(--text-muted)" />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.98rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {lastVideo.title}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {lastVideo.channel || 'YouTube'} • {lastVideo.category === 'music' ? '🎵 Música' : '🎬 Vídeo'}
                </div>
              </div>
              <Link to={`/videos/${lastVideo.id}`} className="btn btn-secondary" style={{ padding: '0.5rem 0.9rem', fontSize: '0.85rem' }}>
                Estudar
              </Link>
            </div>
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Você ainda não adicionou nenhum vídeo ou música.
            </p>
            <Link to="/videos" className="btn btn-secondary">
              <PlusCircle size={18} />
              <span>Adicionar Primeiro Conteúdo</span>
            </Link>
          </div>
        )}
      </div>

      {/* Overview Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
        <div className="card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>EM APRENDIZADO</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.3rem', color: '#818cf8' }}>
            {summary.learning_count}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Frases ativas</div>
        </div>

        <div className="card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>DOMINADAS</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.3rem', color: 'var(--accent-emerald)' }}>
            {summary.mastered_count}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Frases memorizadas</div>
        </div>

        <div className="card">
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>NÍVEL ATUAL</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.3rem', color: 'var(--accent-amber)' }}>
            {user?.profile?.english_level || 'B1'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Intermediário</div>
        </div>
      </div>
    </div>
  );
};
