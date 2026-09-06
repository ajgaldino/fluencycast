import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { request } from '../../services/api';
import {
  Flame,
  Award,
  Target,
  BookOpen,
  CheckCircle,
  Zap,
  Calendar,
  Sparkles,
  TrendingUp
} from 'lucide-react';

interface DailyActivity {
  date: string;
  reviews: number;
  phrases_saved: number;
  xp: number;
}

interface ProgressData {
  total_videos: number;
  total_phrases: number;
  mastered_phrases: number;
  learning_phrases: number;
  total_reviews: number;
  current_streak: number;
  level: string;
  total_xp: number;
  xp_level: number;
  xp_next_level: number;
  xp_in_current_level: number;
  weekly_activity: DailyActivity[];
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

  const xpProgressPercent = stats?.xp_next_level
    ? Math.min(100, Math.round((stats.xp_in_current_level / stats.xp_next_level) * 100))
    : 0;

  // Format short weekday (Seg, Ter, Qua, etc.)
  const formatWeekday = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T12:00:00Z');
      return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
    } catch {
      return dateStr.slice(5);
    }
  };

  const maxWeeklyXp = stats?.weekly_activity
    ? Math.max(...stats.weekly_activity.map((a) => a.xp), 40)
    : 40;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.6rem' }}>Seu Progresso & Nível</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Acompanhe seus pontos de experiência, consistência e evolução no inglês
        </p>
      </div>

      {/* GAMIFIED XP & LEVEL CARD */}
      <div className="card" style={{
        marginBottom: '1.5rem',
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%)',
        border: '1px solid rgba(168, 85, 247, 0.35)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div className="flex-between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent-purple) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(168, 85, 247, 0.4)'
            }}>
              <Zap size={24} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>
                Nível {stats?.xp_level || 1} • Fluência Ativa
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {stats?.total_xp || 0} XP acumulados no total
              </div>
            </div>
          </div>

          <div className="badge badge-amber" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}>
            <Flame size={15} />
            <span>{stats?.current_streak || 1} dias seguidos</span>
          </div>
        </div>

        {/* Level Progress Bar */}
        <div>
          <div className="flex-between" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
            <span>Progresso para o Nível {(stats?.xp_level || 1) + 1}</span>
            <span style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>
              {stats?.xp_in_current_level || 0} / {stats?.xp_next_level || 100} XP ({xpProgressPercent}%)
            </span>
          </div>
          <div style={{
            width: '100%',
            height: '10px',
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: '999px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${xpProgressPercent}%`,
              height: '100%',
              background: 'linear-gradient(90deg, var(--primary) 0%, var(--accent-purple) 100%)',
              borderRadius: '999px',
              boxShadow: '0 0 12px rgba(168, 85, 247, 0.5)',
              transition: 'width 0.5s ease'
            }} />
          </div>
        </div>
      </div>

      {/* WEEKLY ACTIVITY CHART (LAST 7 DAYS) */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.98rem' }}>
            <TrendingUp size={18} color="var(--accent-cyan)" />
            <span>Atividade nos Últimos 7 Dias</span>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Revisões e XP diários
          </span>
        </div>

        {stats?.weekly_activity && stats.weekly_activity.length > 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '0.5rem',
            height: '130px',
            paddingTop: '1rem',
            paddingBottom: '0.5rem'
          }}>
            {stats.weekly_activity.map((day, i) => {
              const heightPercent = Math.max(12, Math.round((day.xp / maxWeeklyXp) * 100));
              const hasActivity = day.xp > 0 || day.reviews > 0;
              const isToday = i === stats.weekly_activity.length - 1;

              return (
                <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
                  <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div
                      title={`${day.date}: ${day.reviews} revisões, +${day.xp} XP`}
                      style={{
                        width: '75%',
                        maxWidth: '38px',
                        height: `${heightPercent}%`,
                        background: isToday
                          ? 'linear-gradient(180deg, var(--accent-cyan) 0%, var(--primary) 100%)'
                          : hasActivity
                          ? 'linear-gradient(180deg, rgba(99, 102, 241, 0.8) 0%, rgba(99, 102, 241, 0.4) 100%)'
                          : 'rgba(255, 255, 255, 0.05)',
                        borderRadius: '6px 6px 2px 2px',
                        transition: 'all 0.3s ease',
                        border: isToday ? '1px solid var(--accent-cyan)' : 'none',
                        boxShadow: isToday ? '0 0 10px rgba(6, 182, 212, 0.4)' : 'none',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'center',
                        paddingTop: '4px'
                      }}
                    >
                      {hasActivity && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#fff' }}>
                          {day.reviews}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    color: isToday ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    fontWeight: isToday ? 800 : 500,
                    marginTop: '0.4rem'
                  }}>
                    {isToday ? 'HOJE' : formatWeekday(day.date)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Comece a revisar cards para ver seu gráfico de atividade semanal aqui!
          </div>
        )}
      </div>

      {/* STATS CARDS GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <BookOpen size={16} color="var(--primary)" />
            <span>Total de Frases & Palavras</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{stats?.total_phrases || 0}</div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <CheckCircle size={16} color="var(--accent-emerald)" />
            <span>Dominadas na Memória</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>
            {stats?.mastered_phrases || 0}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <Award size={16} color="var(--accent-cyan)" />
            <span>Revisões Concluídas</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
            {stats?.total_reviews || 0}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <Target size={16} color="var(--accent-purple)" />
            <span>Vídeos no Catálogo</span>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-purple)' }}>
            {stats?.total_videos || 0}
          </div>
        </div>
      </div>

      {/* LEARNING PROFILE INFORMATION */}
      <div className="card">
        <h3 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>Perfil & Preferências</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="flex-between">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Nível de Fluência Atual:</span>
            <span className="badge badge-primary">{user?.profile?.english_level || 'B1 (Intermediário)'}</span>
          </div>
          <div className="flex-between">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Foco de Estudo:</span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{user?.profile?.goal || 'General English'}</span>
          </div>
          <div className="flex-between">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Meta Diária Recomendada:</span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{user?.profile?.daily_goal_minutes || 30} minutos/dia</span>
          </div>
        </div>
      </div>
    </div>
  );
};
