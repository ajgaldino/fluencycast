import React, { useState, useEffect } from 'react';
import { reviewService } from '../../services/reviews';
import { SavedPhrase } from '../../types/phrase';
import { BrainCircuit, CheckCircle2, Eye, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export const Reviews: React.FC = () => {
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const loadReviews = async () => {
      try {
        const data = await reviewService.getTodayReviews();
        setPhrases(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadReviews();
  }, []);

  const handleGrade = async (quality: number) => {
    const current = phrases[currentIndex];
    if (!current) return;

    try {
      await reviewService.submitReview(current.id, quality);
    } catch (err) {
      console.error(err);
    }

    if (currentIndex + 1 < phrases.length) {
      setCurrentIndex(currentIndex + 1);
      setShowTranslation(false);
    } else {
      setFinished(true);
    }
  };

  if (loading) {
    return <p style={{ color: 'var(--text-muted)' }}>Carregando sessão de revisão...</p>;
  }

  if (phrases.length === 0 || finished) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', maxWidth: '500px', margin: '2rem auto' }}>
        <div style={{ display: 'inline-flex', padding: '1rem', background: 'rgba(16, 185, 129, 0.15)', borderRadius: '50%', marginBottom: '1.25rem' }}>
          <CheckCircle2 size={42} color="var(--accent-emerald)" />
        </div>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Tudo em dia!</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
          Você concluiu todas as suas revisões programadas para hoje. Continue assistindo a vídeos para expandir seu vocabulário.
        </p>
        <Link to="/videos" className="btn btn-primary">
          <Sparkles size={16} />
          <span>Explorar Mais Vídeos</span>
        </Link>
      </div>
    );
  }

  const currentPhrase = phrases[currentIndex];

  return (
    <div style={{ maxWidth: '540px', margin: '0 auto' }}>
      <div className="flex-between" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-link)', fontSize: '0.9rem', fontWeight: 600 }}>
          <BrainCircuit size={18} />
          <span>Sessão de Revisão</span>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {currentIndex + 1} de {phrases.length}
        </span>
      </div>

      {/* Flashcard */}
      <div className="card" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '2rem 1.5rem', marginBottom: '1.5rem' }}>
        <div>
          <div className="badge badge-primary" style={{ marginBottom: '1rem' }}>
            {currentPhrase.phrase_type}
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.4, color: '#fff' }}>
            "{currentPhrase.text}"
          </div>
        </div>

        <div>
          {showTranslation ? (
            <div style={{ padding: '1rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', color: 'var(--accent-emerald)', marginTop: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>TRADUÇÃO</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{currentPhrase.translation || 'Sem tradução cadastrada'}</div>
            </div>
          ) : (
            <button
              onClick={() => setShowTranslation(true)}
              className="btn btn-secondary btn-block"
              style={{ marginTop: '1.5rem' }}
            >
              <Eye size={16} />
              <span>Mostrar Tradução</span>
            </button>
          )}
        </div>
      </div>

      {/* Grade Actions */}
      <div>
        <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Quão difícil foi lembrar esta frase?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          <button
            onClick={() => handleGrade(1)}
            className="btn btn-secondary"
            style={{ borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--accent-rose)', flexDirection: 'column', padding: '0.8rem 0.5rem' }}
          >
            <span style={{ fontSize: '1.3rem' }}>😵</span>
            <span style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Difícil</span>
          </button>

          <button
            onClick={() => handleGrade(2)}
            className="btn btn-secondary"
            style={{ borderColor: 'rgba(245, 158, 11, 0.4)', color: 'var(--accent-amber)', flexDirection: 'column', padding: '0.8rem 0.5rem' }}
          >
            <span style={{ fontSize: '1.3rem' }}>😐</span>
            <span style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Bom</span>
          </button>

          <button
            onClick={() => handleGrade(3)}
            className="btn btn-secondary"
            style={{ borderColor: 'rgba(16, 185, 129, 0.4)', color: 'var(--accent-emerald)', flexDirection: 'column', padding: '0.8rem 0.5rem' }}
          >
            <span style={{ fontSize: '1.3rem' }}>😎</span>
            <span style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>Fácil</span>
          </button>
        </div>
      </div>
    </div>
  );
};
