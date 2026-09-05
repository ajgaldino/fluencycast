import React, { useState, useEffect } from 'react';
import { phraseService } from '../../services/phrases';
import { SavedPhrase } from '../../types/phrase';
import { Bookmark, Play, Trash2, Eye, EyeOff, CheckCircle } from 'lucide-react';

export const Phrases: React.FC = () => {
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [visibleTranslations, setVisibleTranslations] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadPhrases = async () => {
      setLoading(true);
      try {
        const data = await phraseService.getPhrases(filter === 'ALL' ? undefined : filter);
        setPhrases(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadPhrases();
  }, [filter]);

  const toggleTranslation = (id: string) => {
    setVisibleTranslations((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Deseja excluir esta frase da sua biblioteca?')) return;
    try {
      await phraseService.deletePhrase(id);
      setPhrases(phrases.filter((p) => p.id !== id));
    } catch (err: any) {
      alert(err.message || 'Erro ao remover frase');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.6rem' }}>Minhas Frases</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Vocabulário extraído de contextos reais com repetição espaçada
        </p>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Todas', value: 'ALL' },
          { label: 'Novas', value: 'NEW' },
          { label: 'Em Revisão', value: 'REVIEW' },
          { label: 'Dominadas', value: 'MASTERED' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`btn ${filter === tab.value ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Carregando frases...</p>
      ) : phrases.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <Bookmark size={36} color="var(--text-muted)" style={{ margin: '0 auto 1rem auto' }} />
          <h3 style={{ fontSize: '1.15rem', marginBottom: '0.4rem' }}>Nenhuma frase encontrada</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Durante o estudo de qualquer vídeo ou música, clique sobre qualquer frase da transcrição para salvá-la aqui.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {phrases.map((phrase) => (
            <div key={phrase.id} className="card">
              <div className="flex-between" style={{ marginBottom: '0.6rem' }}>
                <span className="badge badge-primary">{phrase.phrase_type}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Repetições: {phrase.repetitions}
                </span>
              </div>

              <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>
                "{phrase.text}"
              </div>

              {phrase.translation && (
                <div style={{ marginBottom: '0.75rem' }}>
                  {visibleTranslations[phrase.id] ? (
                    <div style={{ color: 'var(--accent-emerald)', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🇧🇷 {phrase.translation}</span>
                      <button
                        onClick={() => toggleTranslation(phrase.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        <EyeOff size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => toggleTranslation(phrase.id)}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
                    >
                      <Eye size={13} />
                      <span>Ver tradução</span>
                    </button>
                  )}
                </div>
              )}

              <div className="flex-between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Intervalo: {phrase.interval_days} dias
                </div>
                <button
                  onClick={() => handleDelete(phrase.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  title="Excluir frase"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
