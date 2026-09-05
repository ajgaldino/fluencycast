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
  Check,
  BookOpen,
  Type,
  PlusCircle,
  RefreshCw
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const Reviews: React.FC = () => {
  const [reviewMode, setReviewMode] = useState<'SENTENCE' | 'WORD'>('SENTENCE');
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [extractingWords, setExtractingWords] = useState(false);

  // Edit Modal State during review
  const [editingPhrase, setEditingPhrase] = useState<SavedPhrase | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editContext, setEditContext] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiTranslatingEdit, setAiTranslatingEdit] = useState(false);

  useEffect(() => {
    loadReviews(reviewMode);
  }, [reviewMode]);

  const loadReviews = async (mode: 'SENTENCE' | 'WORD') => {
    setLoading(true);
    setCurrentIndex(0);
    setShowTranslation(false);
    setFinished(false);
    try {
      const data = await reviewService.getTodayReviews(mode);
      setPhrases(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
          setPhrases((prev) =>
            prev.map((p, idx) => (idx === currentIndex ? { ...p, translation: res.translation } : p))
          );
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
      utterance.rate = 0.88;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Extract words from saved phrases to create the word deck
  const handleExtractWords = async () => {
    try {
      setExtractingWords(true);
      const newWords = await phraseService.extractWords();
      if (newWords.length > 0) {
        setPhrases(newWords);
        setCurrentIndex(0);
        setShowTranslation(false);
        setFinished(false);
        alert(`🎉 ${newWords.length} palavras-chave foram extraídas das suas frases e adicionadas ao seu Deck de Vocabulário!`);
      } else {
        alert('Nenhuma nova palavra pôde ser extraída no momento. Salve mais frases em vídeos para alimentar seu vocabulário!');
      }
    } catch (err: any) {
      alert(err.message || 'Falha ao extrair palavras.');
    } finally {
      setExtractingWords(false);
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

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto' }}>
      {/* Header & Mode Switcher */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div className="flex-between" style={{ marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-link)', fontSize: '0.95rem', fontWeight: 700 }}>
            <BrainCircuit size={20} />
            <span>Sessão de Revisão Espaçada (SRS)</span>
          </div>
          {phrases.length > 0 && !finished && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {currentIndex + 1} de {phrases.length}
            </span>
          )}
        </div>

        {/* Deck Mode Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'var(--bg-card)', padding: '0.35rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => setReviewMode('SENTENCE')}
            className={`btn ${reviewMode === 'SENTENCE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.5rem', fontSize: '0.84rem', border: 'none' }}
          >
            <BookOpen size={15} />
            <span>📖 Frases em Contexto</span>
          </button>
          <button
            onClick={() => setReviewMode('WORD')}
            className={`btn ${reviewMode === 'WORD' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.5rem', fontSize: '0.84rem', border: 'none' }}
          >
            <Type size={15} />
            <span>🔤 Lembrete de Palavras</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <Loader2 size={32} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 1rem auto' }} />
          <p style={{ color: 'var(--text-muted)' }}>Preparando sessão...</p>
        </div>
      ) : phrases.length === 0 || finished ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem', margin: '1rem auto' }}>
          <div style={{ display: 'inline-flex', padding: '1rem', background: 'rgba(16, 185, 129, 0.15)', borderRadius: '50%', marginBottom: '1.25rem' }}>
            <CheckCircle2 size={40} color="var(--accent-emerald)" />
          </div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            {finished ? 'Sessão concluída!' : 'Nenhum item para revisar'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.92rem', lineHeight: 1.6 }}>
            {finished
              ? `Você revisou todos os cards de ${reviewMode === 'WORD' ? 'palavras' : 'frases'} programados para agora!`
              : reviewMode === 'WORD'
              ? 'Você ainda não possui palavras no seu Deck de Vocabulário. Você pode extrair palavras automaticamente das frases que você salvou!'
              : 'Você não tem frases pendentes de revisão hoje. Continue assistindo aos vídeos para salvar novas frases!'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '360px', margin: '0 auto' }}>
            {reviewMode === 'WORD' && (
              <button
                onClick={handleExtractWords}
                className="btn btn-primary"
                disabled={extractingWords}
              >
                {extractingWords ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} color="var(--accent-amber)" />
                )}
                <span>⚡ Extrair Palavras das Frases Salvas</span>
              </button>
            )}

            <Link to="/videos" className="btn btn-secondary">
              <BookOpen size={16} />
              <span>Estudar Mais Vídeos</span>
            </Link>
          </div>
        </div>
      ) : (
        <div>
          {/* Flashcard */}
          <div className="card" style={{
            minHeight: '280px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '1.75rem 1.5rem',
            marginBottom: '1.25rem',
            position: 'relative',
            background: reviewMode === 'WORD' ? 'linear-gradient(180deg, rgba(168, 85, 247, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%)' : undefined
          }}>
            <div>
              <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
                <span className="badge" style={{
                  background: reviewMode === 'WORD' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                  color: reviewMode === 'WORD' ? 'var(--accent-purple)' : 'var(--primary-light)',
                  border: '1px solid currentColor'
                }}>
                  {reviewMode === 'WORD' ? '🔤 PALAVRA-CHAVE' : '📖 FRASE EM CONTEXTO'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {/* Pronunciation Audio Button */}
                  <button
                    onClick={() => handleSpeak(currentPhrase.text)}
                    className="action-btn"
                    title="Ouvir pronúncia nativa"
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
                    title="Editar item ou tradução"
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

              {/* Main English Text / Word */}
              {reviewMode === 'WORD' ? (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#fff', letterSpacing: '0.02em' }}>
                    {currentPhrase.text}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    Tente lembrar o significado desta palavra
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.4, color: '#fff', marginBottom: '0.75rem' }}>
                  "{currentPhrase.text}"
                </div>
              )}

              {/* Real Context Sentence (for WORD cards) */}
              {reviewMode === 'WORD' && currentPhrase.context_sentence && showTranslation && (
                <div style={{
                  fontSize: '0.88rem',
                  color: 'var(--text-secondary)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  marginTop: '0.75rem',
                  borderLeft: '3px solid var(--accent-purple)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem'
                }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontWeight: 700 }}>
                      CONTEXTO NO VÍDEO:
                    </span>
                    <span>"{currentPhrase.context_sentence}"</span>
                  </div>
                  <button
                    onClick={() => handleSpeak(currentPhrase.context_sentence!)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
                    title="Ouvir frase inteira"
                  >
                    <Volume2 size={15} />
                  </button>
                </div>
              )}
            </div>

            {/* Translation Display */}
            <div>
              {showTranslation ? (
                <div style={{
                  padding: '1rem',
                  background: 'rgba(6, 182, 212, 0.08)',
                  border: '1px solid rgba(6, 182, 212, 0.25)',
                  borderRadius: 'var(--radius-md)',
                  marginTop: '1.25rem'
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
                    <div style={{ fontSize: reviewMode === 'WORD' ? '1.35rem' : '1.1rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
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
                  <span>Mostrar Tradução & Significado</span>
                </button>
              )}
            </div>
          </div>

          {/* Grade Actions (SM-2 Algorithm) */}
          <div>
            <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Quão fácil foi lembrar este item?
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
      )}

      {/* EDIT MODAL DURING REVIEW */}
      {editingPhrase && (
        <div className="ai-modal-overlay" onClick={() => setEditingPhrase(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>
                <Edit3 size={18} color="var(--primary)" />
                <span>Editar {reviewMode === 'WORD' ? 'Palavra' : 'Frase'}</span>
              </div>
              <button
                onClick={() => setEditingPhrase(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Texto em Inglês:
              </label>
              <textarea
                className="form-input"
                rows={2}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                style={{ fontSize: '0.95rem' }}
              />
            </div>

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
                  {aiTranslatingEdit ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
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

            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Contexto / Frase de Exemplo:
              </label>
              <input
                type="text"
                className="form-input"
                value={editContext}
                onChange={(e) => setEditContext(e.target.value)}
                placeholder="Ex: Frase de exemplo onde a palavra foi usada..."
              />
            </div>

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
                {savingEdit ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
