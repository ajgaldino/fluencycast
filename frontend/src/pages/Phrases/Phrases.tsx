import React, { useState, useEffect } from 'react';
import { phraseService, UpdatePhrasePayload } from '../../services/phrases';
import { aiService } from '../../services/ai';
import { SavedPhrase } from '../../types/phrase';
import {
  Bookmark,
  Trash2,
  Eye,
  EyeOff,
  Edit3,
  Sparkles,
  Search,
  X,
  Check,
  Loader2,
  Volume2,
  BookOpen,
  Layers,
  CheckCircle,
  PlusCircle,
  RefreshCw
} from 'lucide-react';

export const Phrases: React.FC = () => {
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  // Main view tab: 'SENTENCE' (Frases) vs 'WORD' (Palavras)
  const [activeTab, setActiveTab] = useState<'SENTENCE' | 'WORD'>('SENTENCE');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [extractingWords, setExtractingWords] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);

  const [visibleTranslations, setVisibleTranslations] = useState<Record<string, boolean>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});

  // Editing state
  const [editingPhrase, setEditingPhrase] = useState<SavedPhrase | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editDifficulty, setEditDifficulty] = useState<string>('NORMAL');
  const [editStatus, setEditStatus] = useState<string>('NEW');
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiTranslatingEdit, setAiTranslatingEdit] = useState(false);

  useEffect(() => {
    loadPhrases();
  }, [statusFilter]);

  const loadPhrases = async () => {
    setLoading(true);
    try {
      // Load all phrases (both sentences and words) so tab counts are immediately known
      const data = await phraseService.getPhrases(statusFilter === 'ALL' ? undefined : statusFilter);
      setPhrases(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Extract vocabulary words from saved phrases
  const handleExtractWords = async () => {
    try {
      setExtractingWords(true);
      setExtractionMessage(null);
      const newWords = await phraseService.extractWords();
      await loadPhrases();
      if (newWords.length > 0) {
        setExtractionMessage(`🎉 ${newWords.length} novas palavras-chave extraídas das suas frases!`);
        setActiveTab('WORD');
      } else {
        setExtractionMessage('Todas as palavras das suas frases já foram extraídas para o seu vocabulário.');
      }
    } catch (err: any) {
      alert(err.message || 'Falha ao extrair palavras.');
    } finally {
      setExtractingWords(false);
    }
  };

  const toggleTranslation = (id: string) => {
    setVisibleTranslations((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Native Speech Synthesis audio
  const handleSpeak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  // Quick 1-click Auto Translate on Card
  const handleAutoTranslateCard = async (phrase: SavedPhrase) => {
    try {
      setTranslatingIds((prev) => ({ ...prev, [phrase.id]: true }));
      const res = await aiService.translate(phrase.text);
      if (res.translation && res.translation.toLowerCase() !== phrase.text.toLowerCase()) {
        const updated = await phraseService.updatePhrase(phrase.id, {
          translation: res.translation,
        });
        setPhrases((prev) => prev.map((p) => (p.id === phrase.id ? updated : p)));
        setVisibleTranslations((prev) => ({ ...prev, [phrase.id]: true }));
      }
    } catch (err: any) {
      alert(err.message || 'Falha na tradução automática.');
    } finally {
      setTranslatingIds((prev) => ({ ...prev, [phrase.id]: false }));
    }
  };

  // Open Edit Modal
  const handleStartEdit = (phrase: SavedPhrase) => {
    setEditingPhrase(phrase);
    setEditText(phrase.text);
    setEditTranslation(phrase.translation || '');
    setEditContext(phrase.context_sentence || '');
    setEditDifficulty(phrase.difficulty || 'NORMAL');
    setEditStatus(phrase.status || 'NEW');
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
      alert('Não foi possível obter a tradução no momento.');
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
        difficulty: editDifficulty,
        status: editStatus,
      };

      const updated = await phraseService.updatePhrase(editingPhrase.id, payload);
      setPhrases((prev) => prev.map((p) => (p.id === editingPhrase.id ? updated : p)));
      setEditingPhrase(null);
    } catch (err: any) {
      alert(err.message || 'Falha ao atualizar o item.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string) => {
    const item = phrases.find(p => p.id === id);
    const label = item?.phrase_type?.toUpperCase() === 'WORD' ? 'palavra' : 'frase';
    if (!window.confirm(`Deseja excluir esta ${label} da sua biblioteca?`)) return;
    try {
      await phraseService.deletePhrase(id);
      setPhrases((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      alert(err.message || 'Erro ao remover item');
    }
  };

  // Counts for tabs
  const sentenceItems = phrases.filter((p) => p.phrase_type?.toUpperCase() !== 'WORD');
  const wordItems = phrases.filter((p) => p.phrase_type?.toUpperCase() === 'WORD');

  // Active items based on selected tab
  const activeItems = activeTab === 'SENTENCE' ? sentenceItems : wordItems;

  // Filter by search query
  const filteredItems = activeItems.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.text.toLowerCase().includes(q) ||
      (p.translation && p.translation.toLowerCase().includes(q)) ||
      (p.context_sentence && p.context_sentence.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex-between" style={{ marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem' }}>Minhas Frases & Palavras</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Vocabulário e expressões extraídos de vídeos com repetição espaçada
          </p>
        </div>

        {/* Quick Extract Action Button in Header */}
        <button
          onClick={handleExtractWords}
          disabled={extractingWords}
          className="btn btn-secondary"
          style={{
            borderColor: 'var(--accent-cyan)',
            color: 'var(--accent-cyan)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            fontSize: '0.85rem'
          }}
          title="Extrair palavras-chave das frases salvas para criar cards de vocabulário"
        >
          {extractingWords ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          <span>{extractingWords ? 'Extraindo...' : '⚡ Extrair Palavras das Frases'}</span>
        </button>
      </div>

      {/* Extraction Feedback Banner */}
      {extractionMessage && (
        <div style={{
          background: 'rgba(6, 182, 212, 0.12)',
          border: '1px solid rgba(6, 182, 212, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--accent-cyan)',
          fontSize: '0.88rem'
        }}>
          <span>{extractionMessage}</span>
          <button
            onClick={() => setExtractionMessage(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* PRIMARY TAB SWITCHER: Frases vs Palavras */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        background: 'var(--bg-card)',
        padding: '0.35rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        marginBottom: '1.25rem'
      }}>
        <button
          onClick={() => setActiveTab('SENTENCE')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'SENTENCE' ? 700 : 500,
            fontSize: '0.92rem',
            background: activeTab === 'SENTENCE' ? 'var(--primary)' : 'transparent',
            color: activeTab === 'SENTENCE' ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.2s ease'
          }}
        >
          <BookOpen size={17} />
          <span>Frases Salvas</span>
          <span style={{
            background: activeTab === 'SENTENCE' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)',
            padding: '0.1rem 0.45rem',
            borderRadius: '12px',
            fontSize: '0.75rem'
          }}>
            {sentenceItems.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('WORD')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'WORD' ? 700 : 500,
            fontSize: '0.92rem',
            background: activeTab === 'WORD' ? 'var(--accent-cyan)' : 'transparent',
            color: activeTab === 'WORD' ? '#000' : 'var(--text-secondary)',
            transition: 'all 0.2s ease'
          }}
        >
          <Layers size={17} />
          <span>Palavras & Vocabulário</span>
          <span style={{
            background: activeTab === 'WORD' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.08)',
            padding: '0.1rem 0.45rem',
            borderRadius: '12px',
            fontSize: '0.75rem',
            color: activeTab === 'WORD' ? '#000' : 'inherit'
          }}>
            {wordItems.length}
          </span>
        </button>
      </div>

      {/* Search Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'var(--bg-input)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '0.6rem 0.9rem',
        marginBottom: '1rem'
      }}>
        <Search size={16} color="var(--text-muted)" />
        <input
          type="text"
          placeholder={activeTab === 'SENTENCE' ? 'Pesquisar frase em inglês ou tradução...' : 'Pesquisar palavra ou tradução...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            width: '100%',
            outline: 'none'
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Filter Status Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1.25rem' }}>
        {[
          { label: 'Todas', value: 'ALL' },
          { label: 'Novas', value: 'NEW' },
          { label: 'Em Revisão', value: 'REVIEW' },
          { label: 'Dominadas', value: 'MASTERED' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`btn ${statusFilter === tab.value ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Rendering */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <Loader2 size={32} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 1rem auto' }} />
          <p style={{ color: 'var(--text-muted)' }}>Carregando itens...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          {activeTab === 'SENTENCE' ? (
            <>
              <Bookmark size={36} color="var(--text-muted)" style={{ margin: '0 auto 1rem auto' }} />
              <h3 style={{ fontSize: '1.15rem', marginBottom: '0.4rem' }}>
                {searchQuery ? 'Nenhuma frase encontrada' : 'Nenhuma frase salva ainda'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto' }}>
                {searchQuery
                  ? `Nenhuma frase corresponde a "${searchQuery}".`
                  : 'Ao assistir a qualquer vídeo ou música, clique sobre qualquer frase da transcrição para salvá-la aqui.'}
              </p>
            </>
          ) : (
            <>
              <Layers size={36} color="var(--accent-cyan)" style={{ margin: '0 auto 1rem auto' }} />
              <h3 style={{ fontSize: '1.15rem', marginBottom: '0.4rem' }}>
                {searchQuery ? 'Nenhuma palavra encontrada' : 'Nenhuma palavra extraída ainda'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto 1.25rem auto' }}>
                {searchQuery
                  ? `Nenhuma palavra corresponde a "${searchQuery}".`
                  : 'Extraia palavras-chave automaticamente das frases que você já salvou para criar cards individuais de vocabulário.'}
              </p>
              {!searchQuery && sentenceItems.length > 0 && (
                <button
                  onClick={handleExtractWords}
                  disabled={extractingWords}
                  className="btn btn-primary"
                  style={{ margin: '0 auto' }}
                >
                  {extractingWords ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  <span>Extrair Palavras Agora</span>
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="card"
              style={{
                position: 'relative',
                borderLeft: activeTab === 'WORD' ? '3px solid var(--accent-cyan)' : '3px solid var(--primary)'
              }}
            >
              <div className="flex-between" style={{ marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`badge ${activeTab === 'WORD' ? 'badge-amber' : 'badge-primary'}`}>
                    {item.phrase_type || (activeTab === 'WORD' ? 'WORD' : 'SENTENCE')}
                  </span>
                  <span className="badge badge-success">{item.status}</span>
                  <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
                    {item.difficulty}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Repetições: {item.repetitions}
                  </span>
                  {/* Edit Button */}
                  <button
                    onClick={() => handleStartEdit(item)}
                    className="action-btn"
                    title="Editar frase ou tradução"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.35rem 0.55rem',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.78rem'
                    }}
                  >
                    <Edit3 size={13} color="var(--primary-light)" />
                    <span>Editar</span>
                  </button>
                </div>
              </div>

              {/* Text Display + Native Audio Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <div style={{
                  fontSize: activeTab === 'WORD' ? '1.35rem' : '1.15rem',
                  fontWeight: 700,
                  color: '#fff',
                  letterSpacing: activeTab === 'WORD' ? '0.02em' : 'normal'
                }}>
                  {activeTab === 'WORD' ? item.text : `"${item.text}"`}
                </div>
                <button
                  onClick={(e) => handleSpeak(item.text, e)}
                  title="Ouvir pronúncia nativa"
                  style={{
                    background: 'rgba(99, 102, 241, 0.15)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '50%',
                    width: '30px',
                    height: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--primary-light)',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                >
                  <Volume2 size={15} />
                </button>
              </div>

              {/* Translation Display or Auto-Translate Button */}
              <div style={{ marginBottom: '0.75rem' }}>
                {item.translation ? (
                  visibleTranslations[item.id] ? (
                    <div style={{ color: 'var(--accent-cyan)', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🇧🇷 {item.translation}</span>
                      <button
                        onClick={() => toggleTranslation(item.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        title="Ocultar tradução"
                      >
                        <EyeOff size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => toggleTranslation(item.id)}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}
                    >
                      <Eye size={13} />
                      <span>Ver tradução em português</span>
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleAutoTranslateCard(item)}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      borderColor: 'var(--accent-cyan)',
                      color: 'var(--accent-cyan)'
                    }}
                    disabled={translatingIds[item.id]}
                  >
                    {translatingIds[item.id] ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    <span>⚡ Traduzir Automaticamente</span>
                  </button>
                )}
              </div>

              {/* Context / Origin Sentence */}
              {item.context_sentence && item.context_sentence !== item.text && (
                <div style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.45rem 0.7rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '0.5rem'
                }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>
                    {activeTab === 'WORD' ? 'Frase de Origem: ' : 'Contexto: '}
                  </strong>
                  "{item.context_sentence}"
                </div>
              )}

              {/* Card Footer */}
              <div className="flex-between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Intervalo SRS: {item.interval_days} {item.interval_days === 1 ? 'dia' : 'dias'}
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.3rem' }}
                  title="Excluir"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* EDIT MODAL */}
      {editingPhrase && (
        <div className="ai-modal-overlay" onClick={() => setEditingPhrase(null)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>
                <Edit3 size={18} color="var(--primary)" />
                <span>Editar {editingPhrase.phrase_type === 'WORD' ? 'Palavra' : 'Frase'} & Tradução</span>
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
                {editingPhrase.phrase_type === 'WORD' ? 'Palavra em Inglês:' : 'Frase em Inglês:'}
              </label>
              <textarea
                className="form-input"
                rows={editingPhrase.phrase_type === 'WORD' ? 1 : 3}
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
                placeholder="Tradução..."
                value={editTranslation}
                onChange={(e) => setEditTranslation(e.target.value)}
                style={{ fontSize: '0.95rem' }}
              />
            </div>

            {/* Context */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                Contexto / Exemplo adicional (opcional):
              </label>
              <input
                type="text"
                className="form-input"
                value={editContext}
                onChange={(e) => setEditContext(e.target.value)}
                placeholder="Ex: Frase de contexto..."
              />
            </div>

            {/* Difficulty & Status selection */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Dificuldade:</label>
                <select
                  className="form-input"
                  value={editDifficulty}
                  onChange={(e) => setEditDifficulty(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="EASY">Fácil (EASY)</option>
                  <option value="NORMAL">Normal (NORMAL)</option>
                  <option value="HARD">Difícil (HARD)</option>
                  <option value="STRUGGLE">Muito Difícil (STRUGGLE)</option>
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Status:</label>
                <select
                  className="form-input"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                >
                  <option value="NEW">Nova (NEW)</option>
                  <option value="LEARNING">Aprendendo (LEARNING)</option>
                  <option value="REVIEW">Revisão (REVIEW)</option>
                  <option value="MASTERED">Dominada (MASTERED)</option>
                </select>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
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
