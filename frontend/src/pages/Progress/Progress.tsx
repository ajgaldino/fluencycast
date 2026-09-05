import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { request } from '../../services/api';
import { BarChart2, Flame, Award, Target, Clock, BookOpen, CheckCircle } from 'lucide-react';

interface ProgressData {
  total_videos: number;
  total_phrases: number;
  mastered_phrases: number;
  learning_phrases: number;
  total_reviews: number;
  current_streak: number;
  level: string;
}

export const Progress: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await request<ProgressData>('/progress/');
        setStats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem' }}>Seu Progresso</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Estatísticas da sua jornada de aquisição da língua inglesa
        </p>
      </div>

      {/* Streak Hero Banner */}
      <div className="card" style={{
        marginBottom: '1.5rem',
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(239, 68, 68, 0.1) 100%)',
        border: '1px solid rgba(245, 158, 11, 0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ padding: '0.85rem', background: 'rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius-md)' }}>
            <Flame size={32} color="var(--accent-amber)" />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff' }}>
              {stats?.current_streak || 1} Dias Consecutivos
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              A consistência diária é o segredo da fluência natural por imersão.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <BookOpen size={16} color="var(--primary)" />
            <span>Total de Frases</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{stats?.total_phrases || 0}</div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <CheckCircle size={16} color="var(--accent-emerald)" />
            <span>Dominadas</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>
            {stats?.mastered_phrases || 0}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <Award size={16} color="var(--accent-cyan)" />
            <span>Revisões Feitas</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
            {stats?.total_reviews || 0}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <Target size={16} color="var(--accent-purple)" />
            <span>Vídeos na Lista</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-purple)' }}>
            {stats?.total_videos || 0}
          </div>
        </div>
      </div>

      {/* Learning Profile Information */}
      <div className="card">
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Perfil de Aprendizado</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="flex-between">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Nível de Fluência:</span>
            <span className="badge badge-primary">{user?.profile?.english_level || 'B1 (Intermediário)'}</span>
          </div>
          <div className="flex-between">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Foco de Aprendizado:</span>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user?.profile?.goal || 'General English'}</span>
          </div>
          <div className="flex-between">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Meta Diária:</span>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{user?.profile?.daily_goal_minutes || 30} minutos/dia</span>
          </div>
        </div>
      </div>
    </div>
  );
};
