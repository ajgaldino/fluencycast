import React, { useState, useEffect } from 'react';
import { phraseService, UpdatePhrasePayload } from '../../services/phrases';
import { aiService } from '../../services/ai';
import { speechService } from '../../services/speech';
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
  Plus,
  RefreshCw,
  Film
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { videoService } from '../../services/videos';
import { Video } from '../../types/video';

export const Phrases: React.FC = () => {
  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  // Main view tab: 'SENTENCE' (Frases) vs 'WORD' (Palavras)
  const [activeTab, setActiveTab] = useState<'SENTENCE' | 'WORD'>('SENTENCE');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedVideoId, setSelectedVideoId] = useState<string>('ALL');
  const [videosList, setVideosList] = useState<Video[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [extractingWords, setExtractingWords] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const [visibleTranslations, setVisibleTranslations] = useState<Record<string, boolean>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});

  // Manual Create Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<'SENTENCE' | 'WORD'>('SENTENCE');
  const [createText, setCreateText] = useState('');
  const [createTranslation, setCreateTranslation] = useState('');
  const [createContext, setCreateContext] = useState('');
  const [createDifficulty, setCreateDifficulty] = useState<string>('NORMAL');
  const [savingCreate, setSavingCreate] = useState(false);
  const [aiTranslatingCreate, setAiTranslatingCreate] = useState(false);
  const [aiGeneratingExampleCreate, setAiGeneratingExampleCreate] = useState(false);

  // Editing state
  const [editingPhrase, setEditingPhrase] = useState<SavedPhrase | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editDifficulty, setEditDifficulty] = useState<string>('NORMAL');
  const [editStatus, setEditStatus] = useState<string>('NEW');
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiTranslatingEdit, setAiTranslatingEdit] = useState(false);
  const [aiGeneratingExampleEdit, setAiGeneratingExampleEdit] = useState(false);

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const vList = await videoService.getVideos();
        setVideosList(vList);
      } catch (e) {
        console.error('Failed to load videos:', e);
      }
    };
    fetchVideos();
  }, []);

  useEffect(() => {
    loadPhrases();
  }, [statusFilter, selectedVideoId]);

  const loadPhrases = async () => {
    setLoading(true);
    try {
      // Load all phrases filtered by video if selected
      const vId = selectedVideoId !== 'ALL' ? selectedVideoId : undefined;
      const data = await phraseService.getPhrases(statusFilter === 'ALL' ? undefined : statusFilter, undefined, vId);
      setPhrases(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Extract vocabulary words from saved phrases or directly from video transcript
  const handleExtractWords = async () => {
    try {
      setExtractingWords(true);
      setExtractionMessage(null);
      const vId = selectedVideoId !== 'ALL' ? selectedVideoId : undefined;
      const newWords = await phraseService.extractWords(vId);
      await loadPhrases();
      if (newWords.length > 0) {
        setExtractionMessage(`🎉 ${newWords.length} novas palavras-chave extraídas para o seu vocabulário!`);
        setActiveTab('WORD');
      } else {
        setExtractionMessage('Todas as palavras deste vídeo já foram extraídas para o seu vocabulário.');
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

  // Natural Native Audio Speech
  const handleSpeak = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    speechService.speak(text);
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

  // Open Manual Create Modal
  const handleOpenCreate = (type?: 'SENTENCE' | 'WORD') => {
    setCreateType(type || activeTab);
    setCreateText('');
    setCreateTranslation('');
    setCreateContext('');
    setCreateDifficulty('NORMAL');
    setIsCreateModalOpen(true);
  };

  // AI Translate inside Create Modal
  const handleAiTranslateCreate = async () => {
    const query = createText.trim();
    if (!query) return;
    try {
      setAiTranslatingCreate(true);
      const res = await aiService.translate(query);
      if (res.translation && res.translation.toLowerCase() !== query.toLowerCase()) {
        setCreateTranslation(res.translation);
      }
      // If it's a word and context is empty, also generate an example sentence for maximum convenience
      if (createType === 'WORD' && !createContext.trim()) {
        try {
          const exRes = await aiService.generateExample(query);
          if (exRes.example) {
            setCreateContext(exRes.example);
          }
        } catch {
          // ignore secondary example generation failure
        }
      }
    } catch (err) {
      alert('Não foi possível obter a tradução com IA no momento.');
    } finally {
      setAiTranslatingCreate(false);
    }
  };

  // AI Generate Example Sentence inside Create Modal
  const handleAiGenerateExampleCreate = async () => {
    const query = createText.trim();
    if (!query) {
      alert(`Por favor, digite primeiro a ${createType === 'WORD' ? 'palavra' : 'frase'} em inglês.`);
      return;
    }
    try {
      setAiGeneratingExampleCreate(true);
      const res = await aiService.generateExample(query);
      if (res.example) {
        setCreateContext(res.example);
      }
      // If translation is empty, also fill translation if returned
      if (!createTranslation.trim() && res.translation) {
        setCreateTranslation(res.translation);
      }
    } catch (err) {
      alert('Não foi possível gerar um exemplo com IA no momento.');
    } finally {
      setAiGeneratingExampleCreate(false);
    }
  };

  // Save New Manual Phrase or Word
  const handleSaveCreate = async () => {
    const cleanText = createText.trim();
    if (!cleanText) {
      alert(`O texto da ${createType === 'WORD' ? 'palavra' : 'frase'} em inglês não pode ficar vazio.`);
      return;
    }

    try {
      setSavingCreate(true);
      let translationToSave = createTranslation.trim();

      // If translation wasn't provided by user, auto-translate with AI
      if (!translationToSave) {
        try {
          const aiRes = await aiService.translate(cleanText);
          if (aiRes.translation && aiRes.translation.toLowerCase() !== cleanText.toLowerCase()) {
            translationToSave = aiRes.translation;
          }
        } catch {
          // Proceed without translation if offline or AI fails
        }
      }

      let contextToSave = createContext.trim();
      // If user added a word and left context empty, auto-generate authentic example sentence
      if (!contextToSave && createType === 'WORD') {
        try {
          const exRes = await aiService.generateExample(cleanText);
          if (exRes.example) {
            contextToSave = exRes.example;
          }
        } catch {
          // Ignore
        }
      }

      const created = await phraseService.savePhrase({
        text: cleanText,
        translation: translationToSave || null,
        context_sentence: contextToSave || null,
        phrase_type: createType,
        difficulty: createDifficulty,
        status: 'NEW',
      });

      // Update local phrases list
      setPhrases((prev) => {
        const idx = prev.findIndex((p) => p.id === created.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = created;
          return updated;
        }
        return [created, ...prev];
      });

      // Ensure translation is visible for this item
      setVisibleTranslations((prev) => ({ ...prev, [created.id]: true }));

      // Switch to the relevant tab so the user sees it immediately
      setActiveTab(createType);

      // Show success feedback
      setActionFeedback(`🎉 ${createType === 'WORD' ? 'Palavra' : 'Frase'} "${cleanText}" adicionada com sucesso!`);
      setTimeout(() => setActionFeedback(null), 5000);

      setIsCreateModalOpen(false);
    } catch (err: any) {
      alert(err.message || 'Falha ao salvar item.');
    } finally {
      setSavingCreate(false);
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

  // AI Generate Example Sentence inside Edit Modal
  const handleAiGenerateExampleEdit = async () => {
    const query = editText.trim();
    if (!query) {
      alert('Por favor, digite primeiro o texto em inglês.');
      return;
    }
    try {
      setAiGeneratingExampleEdit(true);
      const res = await aiService.generateExample(query);
      if (res.example) {
        setEditContext(res.example);
      }
    } catch (err) {
      alert('Não foi possível gerar um exemplo com IA no momento.');
    } finally {
      setAiGeneratingExampleEdit(false);
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

        {/* Header Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleOpenCreate()}
            className="btn btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.55rem 1.15rem',
              fontSize: '0.88rem',
              fontWeight: 600,
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)'
            }}
            title="Adicionar manualmente uma nova frase ou palavra para estudar"
          >
            <Plus size={17} />
            <span>Adicionar {activeTab === 'WORD' ? 'Palavra' : 'Frase'}</span>
          </button>

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
              padding: '0.55rem 0.95rem',
              fontSize: '0.85rem'
            }}
            title="Extrair palavras-chave das frases salvas para criar cards de vocabulário"
          >
            {extractingWords ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            <span>{extractingWords ? 'Extraindo...' : '⚡ Extrair Palavras'}</span>
          </button>
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--accent-emerald)',
          fontSize: '0.88rem',
          animation: 'modalSlideUp 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle size={17} />
            <span>{actionFeedback}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>
      )}

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

      {/* Video Filter & Status Filter Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        flexWrap: 'wrap',
        marginBottom: '1.25rem'
      }}>
        {/* Filter Status Tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.2rem' }}>
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
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Video Selector Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '220px', flex: '1', maxWidth: '380px' }}>
          <Film size={14} color="var(--primary)" style={{ flexShrink: 0 }} />
          <select
            value={selectedVideoId}
            onChange={(e) => setSelectedVideoId(e.target.value)}
            className="form-input"
            style={{ padding: '0.35rem 0.6rem', fontSize: '0.82rem', height: 'auto', cursor: 'pointer' }}
          >
            <option value="ALL">🌐 Todos os vídeos (sem distinção)</option>
            {videosList.map((v) => (
              <option key={v.id} value={v.id}>
                🎬 {v.title.length > 42 ? v.title.slice(0, 42) + '...' : v.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active Video Shortcut Banner in Library */}
      {selectedVideoId !== 'ALL' && (() => {
        const activeVideo = videosList.find((v) => v.id === selectedVideoId);
        if (!activeVideo) return null;
        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(6, 182, 212, 0.1) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '0.6rem 0.85rem',
            marginBottom: '1.25rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
              {activeVideo.thumbnail_url && (
                <img
                  src={activeVideo.thumbnail_url}
                  alt={activeVideo.title}
                  style={{ width: '48px', height: '30px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeVideo.title}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Visualizando vocabulário filtrado deste vídeo ({filteredItems.length} itens)
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <Link
                to={`/reviews?video_id=${activeVideo.id}&mode=WORD`}
                className="btn btn-primary"
                style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem' }}
                title="Estudar flashcards deste vídeo"
              >
                <span>🃏 Estudar Flashcards</span>
              </Link>
              <button
                onClick={handleExtractWords}
                disabled={extractingWords}
                className="btn btn-secondary"
                style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem' }}
                title="Extrair palavras-chave da transcrição"
              >
                {extractingWords ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} color="var(--accent-cyan)" />}
                <span>+ Extrair Mais Palavras</span>
              </button>
            </div>
          </div>
        );
      })()}

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
                  : 'Ao assistir a qualquer vídeo ou música, clique sobre qualquer frase da transcrição para salvá-la, ou adicione manualmente abaixo.'}
              </p>
              <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
                <button
                  onClick={() => handleOpenCreate('SENTENCE')}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                >
                  <Plus size={16} />
                  <span>Adicionar Frase Manualmente</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <Layers size={36} color="var(--accent-cyan)" style={{ margin: '0 auto 1rem auto' }} />
              <h3 style={{ fontSize: '1.15rem', marginBottom: '0.4rem' }}>
                {searchQuery ? 'Nenhuma palavra encontrada' : 'Nenhuma palavra adicionada ainda'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '460px', margin: '0 auto 1.25rem auto' }}>
                {searchQuery
                  ? `Nenhuma palavra corresponde a "${searchQuery}".`
                  : 'Adicione palavras manualmente para expandir seu vocabulário ou extraia automaticamente das frases que você já salvou.'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleOpenCreate('WORD')}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                >
                  <Plus size={16} />
                  <span>Adicionar Palavra Manualmente</span>
                </button>
                {!searchQuery && sentenceItems.length > 0 && (
                  <button
                    onClick={handleExtractWords}
                    disabled={extractingWords}
                    className="btn btn-secondary"
                    style={{ borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                  >
                    {extractingWords ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    <span>Extrair das Frases</span>
                  </button>
                )}
              </div>
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
              <div className="flex-between" style={{ marginBottom: '0.35rem' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>
                  {editingPhrase.phrase_type === 'WORD' ? 'Frase de Exemplo ou Contexto (opcional):' : 'Contexto / Exemplo adicional (opcional):'}
                </label>
                <button
                  type="button"
                  onClick={handleAiGenerateExampleEdit}
                  disabled={aiGeneratingExampleEdit || !editText.trim()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: editText.trim() ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    cursor: editText.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontWeight: 600
                  }}
                  title="Gerar automaticamente uma frase de exemplo contextual com IA"
                >
                  {aiGeneratingExampleEdit ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  <span>⚡ Gerar Exemplo com IA</span>
                </button>
              </div>
              <input
                type="text"
                className="form-input"
                value={editContext}
                onChange={(e) => setEditContext(e.target.value)}
                placeholder={editingPhrase.phrase_type === 'WORD' ? 'Ex: She is resilient in the face of challenges.' : 'Ex: Frase de contexto...'}
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

      {/* MANUAL CREATE MODAL */}
      {isCreateModalOpen && (
        <div className="ai-modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 700, fontSize: '1.15rem' }}>
                <div style={{
                  background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)'
                }}>
                  <Plus size={18} color="#fff" />
                </div>
                <span>Adicionar {createType === 'WORD' ? 'Palavra' : 'Frase'} Manualmente</span>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Switcher Tab between Sentence and Word inside Modal */}
            <div style={{
              display: 'flex',
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 'var(--radius-md)',
              padding: '0.25rem',
              marginBottom: '1.25rem',
              gap: '0.25rem'
            }}>
              <button
                type="button"
                onClick={() => setCreateType('SENTENCE')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: createType === 'SENTENCE' ? 700 : 500,
                  fontSize: '0.88rem',
                  background: createType === 'SENTENCE' ? 'var(--primary)' : 'transparent',
                  color: createType === 'SENTENCE' ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease'
                }}
              >
                <Bookmark size={15} />
                <span>💬 Frase Completa</span>
              </button>

              <button
                type="button"
                onClick={() => setCreateType('WORD')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: createType === 'WORD' ? 700 : 500,
                  fontSize: '0.88rem',
                  background: createType === 'WORD' ? 'var(--accent-cyan)' : 'transparent',
                  color: createType === 'WORD' ? '#000' : 'var(--text-secondary)',
                  transition: 'all 0.2s ease'
                }}
              >
                <Layers size={15} />
                <span>🔤 Palavra / Vocabulário</span>
              </button>
            </div>

            {/* English Text Field */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                {createType === 'WORD' ? 'Palavra em Inglês:' : 'Frase em Inglês:'} <span style={{ color: 'var(--accent-coral)' }}>*</span>
              </label>
              {createType === 'WORD' ? (
                <input
                  type="text"
                  className="form-input"
                  autoFocus
                  placeholder="Ex: resilient, breakthrough, fathom..."
                  value={createText}
                  onChange={(e) => setCreateText(e.target.value)}
                  style={{ fontSize: '1rem', fontWeight: 500 }}
                />
              ) : (
                <textarea
                  className="form-input"
                  autoFocus
                  rows={3}
                  placeholder="Ex: I've been looking forward to meeting you for a long time."
                  value={createText}
                  onChange={(e) => setCreateText(e.target.value)}
                  style={{ fontSize: '0.95rem' }}
                />
              )}
            </div>

            {/* Portuguese Translation + AI Auto Translate */}
            <div className="form-group">
              <div className="flex-between" style={{ marginBottom: '0.3rem' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>
                  Tradução em Português:
                </label>
                <button
                  type="button"
                  onClick={handleAiTranslateCreate}
                  disabled={aiTranslatingCreate || !createText.trim()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: createText.trim() ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    cursor: createText.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontWeight: 600
                  }}
                  title="Traduzir o texto em inglês automaticamente usando IA"
                >
                  {aiTranslatingCreate ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  <span>⚡ Traduzir com IA</span>
                </button>
              </div>
              <textarea
                className="form-input"
                rows={createType === 'WORD' ? 2 : 2}
                placeholder={createType === 'WORD' ? 'Ex: resiliente, resistente...' : 'Ex: Estou ansioso para conhecê-lo há muito tempo.'}
                value={createTranslation}
                onChange={(e) => setCreateTranslation(e.target.value)}
                style={{ fontSize: '0.95rem' }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                Dica: Você pode deixar em branco e o sistema traduzirá com IA automaticamente ao salvar.
              </span>
            </div>

            {/* Context / Example Sentence */}
            <div className="form-group">
              <div className="flex-between" style={{ marginBottom: '0.35rem' }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '0.85rem', margin: 0 }}>
                  {createType === 'WORD' ? 'Frase de Exemplo ou Contexto (opcional):' : 'Notas ou Contexto Adicional (opcional):'}
                </label>
                <button
                  type="button"
                  onClick={handleAiGenerateExampleCreate}
                  disabled={aiGeneratingExampleCreate || !createText.trim()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: createText.trim() ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    cursor: createText.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontWeight: 600
                  }}
                  title="Gerar automaticamente uma frase de exemplo real em inglês usando IA"
                >
                  {aiGeneratingExampleCreate ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  <span>⚡ Gerar Exemplo com IA</span>
                </button>
              </div>
              <input
                type="text"
                className="form-input"
                value={createContext}
                onChange={(e) => setCreateContext(e.target.value)}
                placeholder={createType === 'WORD' ? 'Ex: She is resilient in the face of challenges.' : 'Ex: Ouvido em uma conversa informal...'}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                {createType === 'WORD'
                  ? 'Dica: Clique em "⚡ Gerar Exemplo com IA" para a IA criar uma frase real em inglês com esta palavra.'
                  : 'Dica: Opcional, use para anotar onde você ouviu a frase.'}
              </span>
            </div>

            {/* Initial Difficulty Selector */}
            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                Dificuldade Inicial para Repetição Espaçada:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem' }}>
                {[
                  { value: 'EASY', label: 'Fácil', color: 'var(--accent-emerald)', bg: 'rgba(16, 185, 129, 0.15)' },
                  { value: 'NORMAL', label: 'Normal', color: 'var(--primary)', bg: 'rgba(99, 102, 241, 0.15)' },
                  { value: 'HARD', label: 'Difícil', color: 'var(--accent-amber)', bg: 'rgba(245, 158, 11, 0.15)' },
                  { value: 'STRUGGLE', label: 'Muito Difícil', color: 'var(--accent-coral)', bg: 'rgba(244, 63, 94, 0.15)' },
                ].map((d) => {
                  const isSelected = createDifficulty === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setCreateDifficulty(d.value)}
                      style={{
                        padding: '0.45rem 0.2rem',
                        fontSize: '0.8rem',
                        borderRadius: 'var(--radius-sm)',
                        border: isSelected ? `1.5px solid ${d.color}` : '1px solid var(--border-subtle)',
                        background: isSelected ? d.bg : 'transparent',
                        color: isSelected ? d.color : 'var(--text-secondary)',
                        fontWeight: isSelected ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="btn btn-secondary"
                disabled={savingCreate}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveCreate}
                className="btn btn-primary"
                disabled={savingCreate || !createText.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.6rem 1.4rem',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
                }}
              >
                {savingCreate ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                <span>Salvar {createType === 'WORD' ? 'Palavra' : 'Frase'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
