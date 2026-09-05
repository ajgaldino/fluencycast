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
  HelpCircle
} from 'lucide-react';

export const Phrases: React.FC = () => {
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
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
  }, [filter]);

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

  const toggleTranslation = (id: string) => {
    setVisibleTranslations((prev) => ({ ...prev, [id]: !prev[id] }));
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
      alert(err.message || 'Falha ao atualizar a frase.');
    } finally {
      setSavingEdit(false);
    }
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

  // Filter phrases by search query
  const filteredPhrases = phrases.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.text.toLowerCase().includes(q) ||
      (p.translation && p.translation.toLowerCase().includes(q)) ||
      (p.context_sentence && p.context_sentence.toLowerCase().includes(q))
    );
  });

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem' }}>Minhas Frases</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Vocabulário extraído de contextos reais com repetição espaçada
          </p>
        </div>
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
          placeholder="Pesquisar frase em inglês ou tradução..."
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
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <Loader2 size={32} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 1rem auto' }} />
          <p style={{ color: 'var(--text-muted)' }}>Carregando frases...</p>
        </div>
      ) : filteredPhrases.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <Bookmark size={36} color="var(--text-muted)" style={{ margin: '0 auto 1rem auto' }} />
          <h3 style={{ fontSize: '1.15rem', marginBottom: '0.4rem' }}>
            {searchQuery ? 'Nenhuma frase encontrada' : 'Nenhuma frase salva ainda'}
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {searchQuery
              ? `Nenhuma frase corresponde a "${searchQuery}".`
              : 'Durante o estudo de qualquer vídeo ou música, clique sobre qualquer frase da transcrição para salvá-la aqui.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {filteredPhrases.map((phrase) => (
            <div key={phrase.id} className="card" style={{ position: 'relative' }}>
              <div className="flex-between" style={{ marginBottom: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="badge badge-primary">{phrase.phrase_type}</span>
                  <span className="badge badge-success">{phrase.status}</span>
                  <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
                    {phrase.difficulty}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Repetições: {phrase.repetitions}
                  </span>
                  {/* Edit Button */}
                  <button
                    onClick={() => handleStartEdit(phrase)}
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

              {/* English text */}
              <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>
                "{phrase.text}"
              </div>

              {/* Translation Display or Auto-Translate Button */}
              <div style={{ marginBottom: '0.75rem' }}>
                {phrase.translation ? (
                  visibleTranslations[phrase.id] ? (
                    <div style={{ color: 'var(--accent-cyan)', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>🇧🇷 {phrase.translation}</span>
                      <button
                        onClick={() => toggleTranslation(phrase.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        title="Ocultar tradução"
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
                      <span>Ver tradução em português</span>
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleAutoTranslateCard(phrase)}
                    className="btn btn-secondary"
                    style={{
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      borderColor: 'var(--accent-cyan)',
                      color: 'var(--accent-cyan)'
                    }}
                    disabled={translatingIds[phrase.id]}
                  >
                    {translatingIds[phrase.id] ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    <span>⚡ Traduzir Automaticamente</span>
                  </button>
                )}
              </div>

              {/* Context if exists */}
              {phrase.context_sentence && phrase.context_sentence !== phrase.text && (
                <div style={{
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '0.5rem'
                }}>
                  Contexto: {phrase.context_sentence}
                </div>
              )}

              {/* Card Footer */}
              <div className="flex-between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Intervalo SRS: {phrase.interval_days} dias
                </div>
                <button
                  onClick={() => handleDelete(phrase.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.3rem' }}
                  title="Excluir frase"
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
                <span>Editar Frase & Tradução</span>
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
                Frase / Palavra em Inglês:
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
                placeholder="Ex: David, você está falando de mim?..."
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
                placeholder="Ex: Situação de conversa no escritório..."
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
