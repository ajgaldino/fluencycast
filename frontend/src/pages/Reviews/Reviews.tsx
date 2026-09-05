import React, { useState, useEffect } from 'react';
import { reviewService } from '../../services/reviews';
import { phraseService, UpdatePhrasePayload } from '../../services/phrases';
import { aiService } from '../../services/ai';
import { SavedPhrase } from '../../types/phrase';
import {
  BrainCircuit,
  CheckCircle2,
  Eye,
  EyeOff,
  Sparkles,
  Edit3,
  Volume2,
  Loader2,
  X,
  Check
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const Reviews: React.FC = () => {
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);

  // Edit Modal State during review
  const [editingPhrase, setEditingPhrase] = useState<SavedPhrase | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editContext, setEditContext] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiTranslatingEdit, setAiTranslatingEdit] = useState(false);

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

  const currentPhrase = phrases[currentIndex];

  // Pre-fetch automatic translation if the current phrase doesn't have one
  useEffect(() => {
    if (!currentPhrase) return;
    if (!currentPhrase.translation || currentPhrase.translation.trim() === '' || currentPhrase.translation === 'Sem tradução cadastrada') {
      let isMounted = true;
      setAutoTranslating(true);
      aiService.translate(currentPhrase.text).then(async (res) => {
        if (!isMounted) return;
        if (res.translation && res.translation.toLowerCase() !== currentPhrase.text.toLowerCase()) {
          // Update in state
          setPhrases((prev) =>
            prev.map((p, idx) => (idx === currentIndex ? { ...p, translation: res.translation } : p))
          );
          // Persist to backend database automatically
          try {
            await phraseService.updatePhrase(currentPhrase.id, { translation: res.translation });
          } catch (e) {
            console.warn('Auto-save translation error:', e);
          }
        }
      }).catch(() => {}).finally(() => {
        if (isMounted) setAutoTranslating(false);
      });

      return () => {
        isMounted = false;
      };
    }
  }, [currentIndex, currentPhrase?.id]);

  const handleGrade = async (quality: number) => {
    if (!currentPhrase) return;

    try {
      await reviewService.submitReview(currentPhrase.id, quality);
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

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = () => {
    if (!currentPhrase) return;
    setEditingPhrase(currentPhrase);
    setEditText(currentPhrase.text);
    setEditTranslation(currentPhrase.translation || '');
    setEditContext(currentPhrase.context_sentence || '');
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
      alert('Não foi possível obter a tradução automática no momento.');
    } finally {
      setAiTranslatingEdit(false);
    }
  };

  // Save Edit
  const handleSaveEdit = async () => {
    if (!editingPhrase) return;
    if (!editText.trim()) {
      alert('O texto em inglês não pode ficar vazio.');
      return;
    }

    try {
      setSavingEdit(true);
      const payload: UpdatePhrasePayload = {
        text: editText.trim(),
        translation: editTranslation.trim() || null,
        context_sentence: editContext.trim() || null,
      };

      const updated = await phraseService.updatePhrase(editingPhrase.id, payload);

      setPhrases((prev) =>
        prev.map((p) => (p.id === editingPhrase.id ? { ...p, ...updated } : p))
      );
      setEditingPhrase(null);
    } catch (err: any) {
      alert(err.message || 'Falha ao atualizar a frase.');
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <Loader2 size={32} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 1rem auto' }} />
        <p style={{ color: 'var(--text-muted)' }}>Carregando sessão de revisão...</p>
      </div>
    );
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
      <div className="card" style={{ minHeight: '270px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '1.75rem 1.5rem', marginBottom: '1.5rem', position: 'relative' }}>
        <div>
          <div className="flex-between" style={{ marginBottom: '1rem' }}>
            <span className="badge badge-primary">{currentPhrase.phrase_type}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {/* Pronunciation Audio Button */}
              <button
                onClick={() => handleSpeak(currentPhrase.text)}
                className="action-btn"
                title="Ouvir pronúncia"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.35rem 0.5rem',
                  color: 'var(--accent-cyan)',
                  cursor: 'pointer'
                }}
              >
                <Volume2 size={16} />
              </button>

              {/* Edit Phrase Button */}
              <button
                onClick={handleOpenEdit}
                className="action-btn"
                title="Editar frase ou tradução"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.35rem 0.55rem',
                  color: 'var(--primary-light)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.8rem'
                }}
              >
                <Edit3 size={14} />
                <span>Editar</span>
              </button>
            </div>
          </div>

          {/* English Phrase */}
          <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.4, color: '#fff', marginBottom: '0.75rem' }}>
            "{currentPhrase.text}"
          </div>

          {/* Context if available */}
          {currentPhrase.context_sentence && currentPhrase.context_sentence !== currentPhrase.text && (
            <div style={{
              fontSize: '0.84rem',
              color: 'var(--text-muted)',
              background: 'rgba(255, 255, 255, 0.03)',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              marginTop: '0.5rem'
            }}>
              Contexto: {currentPhrase.context_sentence}
            </div>
          )}
        </div>

        {/* Translation Area with Automatic Translation Support */}
        <div>
          {showTranslation ? (
            <div style={{
              padding: '1rem',
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: 'var(--radius-md)',
              marginTop: '1.5rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Sparkles size={13} color="var(--accent-cyan)" />
                TRADUÇÃO EM PORTUGUÊS:
              </div>
              {autoTranslating && !currentPhrase.translation ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-cyan)', fontSize: '0.95rem' }}>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Traduzindo automaticamente...</span>
                </div>
              ) : (
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                  {currentPhrase.translation || (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      (Tradução não disponível)
                    </span>
                  )}
                </div>
              )}
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

      {/* EDIT MODAL DURING REVIEW */}
      {editingPhrase && (
        <div className="ai-modal-overlay" onClick={() => setEditingPhrase(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>
                <Edit3 size={18} color="var(--primary)" />
                <span>Editar Frase de Revisão</span>
              </div>
              <button
                onClick={() => setEditingPhrase(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* English Text */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Frase em Inglês:
              </label>
              <textarea
                className="form-input"
                rows={3}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                style={{ fontSize: '0.95rem' }}
              />
            </div>

            {/* Portuguese Translation + AI Auto Translate */}
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
                  {aiTranslatingEdit ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
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

            {/* Context */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Contexto / Exemplo adicional:
              </label>
              <input
                type="text"
                className="form-input"
                value={editContext}
                onChange={(e) => setEditContext(e.target.value)}
                placeholder="Ex: Situação de conversa..."
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setEditingPhrase(null)}
                className="btn btn-secondary"
                disabled={savingEdit}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="btn btn-primary"
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
