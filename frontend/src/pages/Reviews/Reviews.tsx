import React, { useState, useEffect, useRef, useMemo } from 'react';
import { reviewService } from '../../services/reviews';
import { phraseService, UpdatePhrasePayload } from '../../services/phrases';
import { aiService } from '../../services/ai';
import { SavedPhrase } from '../../types/phrase';
import { sfx } from '../../utils/audioEffects';
import './Reviews.css';
import {
  BrainCircuit,
  CheckCircle2,
  Eye,
  Sparkles,
  Edit3,
  Volume2,
  VolumeX,
  Loader2,
  X,
  Check,
  BookOpen,
  Type,
  RotateCcw,
  Keyboard,
  Flame,
  Trophy,
  Zap,
  ArrowRight,
  RefreshCw,
  Layers,
  HelpCircle
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const Reviews: React.FC = () => {
  // Deck Type: Sentences vs Words vs Reverse
  const [reviewMode, setReviewMode] = useState<'SENTENCE' | 'WORD' | 'REVERSE'>('SENTENCE');
  // Study Method: Classic Flashcard vs Type-to-Answer vs Speed Recall (Multiple Choice)
  const [studyMethod, setStudyMethod] = useState<'FLASHCARD' | 'TYPE' | 'CHOICE'>('FLASHCARD');

  const [phrases, setPhrases] = useState<SavedPhrase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [autoTranslating, setAutoTranslating] = useState(false);
  const [extractingWords, setExtractingWords] = useState(false);

  // Gamification & Audio
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [floatingXp, setFloatingXp] = useState<{ text: string; id: number } | null>(null);
  const [sessionStats, setSessionStats] = useState({ graded: 0, correct: 0, totalXp: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoPronounce, setAutoPronounce] = useState(true);

  // Type-to-Answer state
  const [typedAnswer, setTypedAnswer] = useState('');
  const [typeResult, setTypeResult] = useState<'correct' | 'close' | 'wrong' | null>(null);
  const typeInputRef = useRef<HTMLInputElement>(null);

  // Multiple Choice (Speed Recall) state
  const [choiceOptions, setChoiceOptions] = useState<string[]>([]);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [choiceResult, setChoiceResult] = useState<'correct' | 'wrong' | null>(null);

  // Edit Modal State during review
  const [editingPhrase, setEditingPhrase] = useState<SavedPhrase | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editContext, setEditContext] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiTranslatingEdit, setAiTranslatingEdit] = useState(false);

  const isReverse = reviewMode === 'REVERSE';
  const effectiveMode = isReverse ? 'SENTENCE' : reviewMode;
  const currentPhrase = phrases[currentIndex];

  useEffect(() => {
    sfx.enabled = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    loadReviews(reviewMode === 'REVERSE' ? 'SENTENCE' : reviewMode);
  }, [reviewMode]);

  const loadReviews = async (mode: 'SENTENCE' | 'WORD') => {
    setLoading(true);
    setCurrentIndex(0);
    setShowTranslation(false);
    setFinished(false);
    setCombo(0);
    setMaxCombo(0);
    setSessionStats({ graded: 0, correct: 0, totalXp: 0 });
    setTypedAnswer('');
    setTypeResult(null);
    setSelectedChoice(null);
    setChoiceResult(null);
    try {
      const data = await reviewService.getTodayReviews(mode);
      setPhrases(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Generate Multiple Choice Options whenever current card changes
  useEffect(() => {
    if (!currentPhrase || studyMethod !== 'CHOICE') return;

    const targetAnswer = isReverse
      ? currentPhrase.text
      : currentPhrase.translation || 'Sem tradução cadastrada';

    // Collect candidate pool from other phrases
    const pool = phrases
      .filter((p) => p.id !== currentPhrase.id)
      .map((p) => (isReverse ? p.text : p.translation))
      .filter((t): t is string => Boolean(t && t.trim() && t !== targetAnswer));

    const fallbackPool = [
      'pensar, acreditar, achar',
      'entender, conseguir, ficar',
      'deixar, permitir',
      'perguntar, pedir',
      'importante, relevante',
      'tempo, hora, vez',
      'trabalhar, funcionar',
      'cuidadosamente, com atenção',
      'lidar com, aguentar',
      'amigo, parceiro',
      'ouvir, escutar atentamente',
      'vida real, cotidiano'
    ];

    const distractors: string[] = [];
    const combinedPool = [...pool, ...fallbackPool];

    for (const item of combinedPool) {
      if (item && item !== targetAnswer && !distractors.includes(item)) {
        distractors.push(item);
        if (distractors.length >= 3) break;
      }
    }

    // Shuffle options
    const shuffled = [targetAnswer, ...distractors].sort(() => Math.random() - 0.5);
    setChoiceOptions(shuffled);
    setSelectedChoice(null);
    setChoiceResult(null);
  }, [currentIndex, currentPhrase?.id, studyMethod, isReverse, phrases]);

  // Auto-pronounce native audio
  useEffect(() => {
    if (!currentPhrase || !autoPronounce) return;
    if (isReverse && !showTranslation) return; // In reverse mode, don't spoil answer before reveal!
    const timer = setTimeout(() => handleSpeak(currentPhrase.text), 280);
    return () => clearTimeout(timer);
  }, [currentIndex, currentPhrase?.id, autoPronounce, isReverse, showTranslation]);

  // Focus type input in type mode
  useEffect(() => {
    if (studyMethod === 'TYPE' && typeInputRef.current) {
      typeInputRef.current.focus();
    }
  }, [currentIndex, studyMethod]);

  // Pre-fetch automatic translation if empty
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

  // Trigger floating XP effect
  const triggerFloatingXp = (text: string) => {
    setFloatingXp({ text, id: Date.now() });
    setTimeout(() => setFloatingXp(null), 1000);
  };

  // SM-2 Interval Calculation Display (Anki style)
  const sm2Intervals = useMemo(() => {
    if (!currentPhrase) return { again: '< 10m', hard: '1d', good: '3d', easy: '7d' };
    const current = currentPhrase.interval_days || 0;
    const ease = currentPhrase.ease_factor || 2.5;

    const goodDays = current === 0 ? 3 : Math.max(1, Math.round(current * ease * 0.85));
    const easyDays = current === 0 ? 7 : Math.max(4, Math.round(current * ease * 1.35));

    return {
      again: '< 10m',
      hard: '1d',
      good: `${goodDays}d`,
      easy: `${easyDays}d`,
    };
  }, [currentPhrase]);

  // Grade Card (1 to 4)
  const handleGrade = async (quality: number) => {
    if (!currentPhrase) return;

    // XP calculation: 1 -> +5 XP, 2 -> +10 XP, 3 -> +15 XP, 4 -> +25 XP
    const earnedXp = quality === 4 ? 25 : quality === 3 ? 15 : quality === 2 ? 10 : 5;
    triggerFloatingXp(`+${earnedXp} XP`);

    // Sound and Combo Updates
    if (quality >= 3) {
      sfx.playSuccess();
      setCombo((prev) => {
        const next = prev + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
      setSessionStats((prev) => ({
        graded: prev.graded + 1,
        correct: prev.correct + 1,
        totalXp: prev.totalXp + earnedXp,
      }));
    } else {
      sfx.playError();
      setCombo(0);
      setSessionStats((prev) => ({
        graded: prev.graded + 1,
        correct: prev.correct,
        totalXp: prev.totalXp + earnedXp,
      }));
    }

    try {
      await reviewService.submitReview(currentPhrase.id, quality);
    } catch (err) {
      console.error(err);
    }

    if (currentIndex + 1 < phrases.length) {
      setCurrentIndex(currentIndex + 1);
      setShowTranslation(false);
      setTypedAnswer('');
      setTypeResult(null);
      setSelectedChoice(null);
      setChoiceResult(null);
    } else {
      setFinished(true);
      sfx.playFanfare();
    }
  };

  // Keyboard Shortcuts (Anki style: Space, 1, 2, 3, 4, R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcut keys if user is typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (editingPhrase) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!showTranslation) {
          setShowTranslation(true);
          sfx.playFlip();
        } else {
          // If translation is already visible, pressing space evaluates as "Bom" (Grade 3)
          handleGrade(3);
        }
      } else if (e.key === '1') {
        e.preventDefault();
        handleGrade(1);
      } else if (e.key === '2') {
        e.preventDefault();
        handleGrade(2);
      } else if (e.key === '3') {
        e.preventDefault();
        handleGrade(3);
      } else if (e.key === '4') {
        e.preventDefault();
        handleGrade(4);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (currentPhrase) handleSpeak(currentPhrase.text);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTranslation, currentPhrase, editingPhrase, phrases.length, currentIndex]);

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.88;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Fuzzy comparison for Type-to-Answer
  const normalizeAnswer = (s: string) =>
    s.trim().toLowerCase()
      .replace(/[áàãâä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòõôö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ');

  const handleTypeSubmit = () => {
    if (!currentPhrase || !typedAnswer.trim()) return;

    const expected = isReverse
      ? normalizeAnswer(currentPhrase.text)
      : normalizeAnswer(currentPhrase.translation || '');
    const given = normalizeAnswer(typedAnswer);

    if (given === expected) {
      setTypeResult('correct');
      sfx.playSuccess();
    } else {
      const expWords = expected.split(' ');
      const givenWords = given.split(' ');
      let matches = 0;
      for (const w of givenWords) {
        if (expWords.includes(w)) matches++;
      }
      const similarity = matches / Math.max(expWords.length, 1);
      if (similarity >= 0.6) {
        setTypeResult('close');
        sfx.playSuccess();
      } else {
        setTypeResult('wrong');
        sfx.playError();
      }
    }
    setShowTranslation(true);
  };

  // Speed Recall Choice Selection
  const handleSelectChoice = (opt: string) => {
    if (selectedChoice || !currentPhrase) return;
    setSelectedChoice(opt);

    const targetAnswer = isReverse
      ? currentPhrase.text
      : currentPhrase.translation || 'Sem tradução cadastrada';

    if (opt === targetAnswer) {
      setChoiceResult('correct');
      sfx.playSuccess();
      setCombo((prev) => {
        const next = prev + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
      triggerFloatingXp('+15 XP');
      setShowTranslation(true);
    } else {
      setChoiceResult('wrong');
      sfx.playError();
      setCombo(0);
      setShowTranslation(true);
    }
  };

  // Extract words from saved phrases
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
        alert('Todas as palavras das suas frases já foram extraídas.');
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
      alert(err.message || 'Falha ao atualizar o card.');
    } finally {
      setSavingEdit(false);
    }
  };

  const progressPercent = phrases.length > 0 ? Math.round(((currentIndex + 1) / phrases.length) * 100) : 0;

  return (
    <div className="reviews-container">
      {/* Floating XP Visual Effect */}
      {floatingXp && (
        <div key={floatingXp.id} className="floating-xp">
          <Zap size={28} />
          <span>{floatingXp.text}</span>
        </div>
      )}

      {/* Header & Mode Switchers */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div className="flex-between" style={{ marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-link)', fontSize: '0.95rem', fontWeight: 700 }}>
            <BrainCircuit size={20} />
            <span>Sessão de Revisão Espaçada</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Combo Badge */}
            {combo >= 2 && (
              <div className="combo-badge">
                <Flame size={14} />
                <span>{combo} seguidas!</span>
              </div>
            )}

            {/* Sound FX Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Sons ativados' : 'Sons desativados'}
              style={{
                background: 'none',
                border: 'none',
                color: soundEnabled ? 'var(--accent-amber)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>
        </div>

        {/* Deck Mode Tabs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '0.4rem',
          background: 'var(--bg-card)',
          padding: '0.3rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '0.75rem'
        }}>
          <button
            onClick={() => setReviewMode('SENTENCE')}
            className={`btn ${reviewMode === 'SENTENCE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.45rem 0.3rem', fontSize: '0.78rem', border: 'none' }}
          >
            <BookOpen size={14} />
            <span>📖 Frases</span>
          </button>
          <button
            onClick={() => setReviewMode('WORD')}
            className={`btn ${reviewMode === 'WORD' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.45rem 0.3rem', fontSize: '0.78rem', border: 'none' }}
          >
            <Type size={14} />
            <span>🔤 Palavras</span>
          </button>
          <button
            onClick={() => setReviewMode('REVERSE')}
            className={`btn ${reviewMode === 'REVERSE' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.45rem 0.3rem', fontSize: '0.78rem', border: 'none' }}
          >
            <RotateCcw size={14} />
            <span>🔄 PT → EN</span>
          </button>
        </div>

        {/* Study Method Switcher (Flashcard vs Type vs Speed Recall) */}
        <div style={{
          display: 'flex',
          gap: '0.4rem',
          background: 'rgba(255, 255, 255, 0.03)',
          padding: '0.25rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '0.75rem',
          overflowX: 'auto'
        }}>
          <button
            onClick={() => setStudyMethod('FLASHCARD')}
            style={{
              flex: 1,
              padding: '0.35rem 0.6rem',
              borderRadius: '4px',
              border: 'none',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: studyMethod === 'FLASHCARD' ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
              color: studyMethod === 'FLASHCARD' ? '#fff' : 'var(--text-muted)'
            }}
          >
            🃏 Flashcard 3D
          </button>
          <button
            onClick={() => setStudyMethod('CHOICE')}
            style={{
              flex: 1,
              padding: '0.35rem 0.6rem',
              borderRadius: '4px',
              border: 'none',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: studyMethod === 'CHOICE' ? 'rgba(6, 182, 212, 0.25)' : 'transparent',
              color: studyMethod === 'CHOICE' ? '#fff' : 'var(--text-muted)'
            }}
          >
            ⚡ Escolha Rápida (4)
          </button>
          <button
            onClick={() => setStudyMethod('TYPE')}
            style={{
              flex: 1,
              padding: '0.35rem 0.6rem',
              borderRadius: '4px',
              border: 'none',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: studyMethod === 'TYPE' ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
              color: studyMethod === 'TYPE' ? '#fff' : 'var(--text-muted)'
            }}
          >
            ✍️ Digitação
          </button>
        </div>

        {/* Progress Bar with card counter */}
        {phrases.length > 0 && !finished && (
          <div>
            <div className="flex-between" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
              <span>Card {currentIndex + 1} de {phrases.length}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="srs-progress-bar-bg">
              <div className="srs-progress-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
          <Loader2 size={36} className="animate-spin" color="var(--primary)" style={{ margin: '0 auto 1rem auto' }} />
          <p style={{ color: 'var(--text-muted)' }}>Carregando seus cards de revisão...</p>
        </div>
      ) : phrases.length === 0 ? (
        /* Empty Deck State */
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', margin: '1rem auto' }}>
          <div style={{ display: 'inline-flex', padding: '1rem', background: 'rgba(16, 185, 129, 0.15)', borderRadius: '50%', marginBottom: '1.25rem' }}>
            <CheckCircle2 size={42} color="var(--accent-emerald)" />
          </div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Tudo em dia!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: '420px', margin: '0 auto 1.5rem auto' }}>
            {effectiveMode === 'WORD'
              ? 'Você não possui palavras pendentes no seu Deck de Vocabulário. Extraia palavras das suas frases salvas para estudar!'
              : 'Você não tem frases pendentes de revisão hoje. Continue assistindo aos vídeos para capturar novas expressões!'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxWidth: '360px', margin: '0 auto' }}>
            {effectiveMode === 'WORD' && (
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
      ) : finished ? (
        /* CELEBRATION / SESSION COMPLETE SCREEN (Duolingo & Anki Style) */
        <div className="card celebration-pop" style={{ textAlign: 'center', padding: '3rem 1.5rem', margin: '1rem auto' }}>
          <div style={{
            display: 'inline-flex',
            padding: '1.25rem',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(239, 68, 68, 0.2) 100%)',
            border: '2px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '50%',
            marginBottom: '1.25rem'
          }}>
            <Trophy size={48} color="var(--accent-amber)" />
          </div>

          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.4rem', color: '#fff' }}>
            Sessão Concluída! 🎉
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.75rem' }}>
            Excelente trabalho! Suas conexões de memória de longo prazo foram fortalecidas.
          </p>

          {/* Session Metrics Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '0.75rem',
            marginBottom: '2rem'
          }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '0.85rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.2rem' }}>
                CARDS REVISADOS
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>
                {sessionStats.graded || phrases.length}
              </div>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '0.85rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.2rem' }}>
                PRECISÃO
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>
                {sessionStats.graded > 0 ? Math.round((sessionStats.correct / sessionStats.graded) * 100) : 100}%
              </div>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '0.85rem 0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '0.2rem' }}>
                XP GANHO
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-amber)' }}>
                +{sessionStats.totalXp || phrases.length * 15}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '380px', margin: '0 auto' }}>
            <button
              onClick={() => loadReviews(effectiveMode)}
              className="btn btn-primary"
            >
              <RefreshCw size={16} />
              <span>Revisar Mais Cards</span>
            </button>

            <Link to="/phrases" className="btn btn-secondary">
              <Layers size={16} />
              <span>Ver Minhas Frases & Vocabulário</span>
            </Link>

            <Link to="/dashboard" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Voltar ao Dashboard
            </Link>
          </div>
        </div>
      ) : (
        /* ACTIVE FLASHCARD REVIEW */
        <div>
          <div
            className="card srs-flashcard"
            style={{
              background: isReverse
                ? 'linear-gradient(180deg, rgba(6, 182, 212, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)'
                : effectiveMode === 'WORD'
                ? 'linear-gradient(180deg, rgba(168, 85, 247, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)'
                : 'linear-gradient(180deg, rgba(99, 102, 241, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)'
            }}
          >
            <div>
              {/* Card Header */}
              <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
                <span className="badge" style={{
                  background: isReverse
                    ? 'rgba(6, 182, 212, 0.2)'
                    : effectiveMode === 'WORD'
                    ? 'rgba(168, 85, 247, 0.2)'
                    : 'rgba(99, 102, 241, 0.2)',
                  color: isReverse
                    ? 'var(--accent-cyan)'
                    : effectiveMode === 'WORD'
                    ? 'var(--accent-purple)'
                    : 'var(--primary-light)',
                  border: '1px solid currentColor'
                }}>
                  {isReverse ? '🔄 PORTUGUÊS → INGLÊS' : effectiveMode === 'WORD' ? '🔤 PALAVRA-CHAVE' : '📖 FRASE EM CONTEXTO'}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {/* Pronunciation Audio Button */}
                  <button
                    onClick={() => handleSpeak(currentPhrase.text)}
                    className="action-btn"
                    title="Ouvir pronúncia nativa (Atalho: R)"
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

              {/* CARD PROMPT DISPLAY */}
              {isReverse ? (
                <div style={{ textAlign: 'center', padding: '1.25rem 0' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 700 }}>
                    🇧🇷 COMO SE DIZ EM INGLÊS:
                  </div>
                  <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--accent-cyan)', lineHeight: 1.4 }}>
                    {currentPhrase.translation || '(tradução pendente)'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Tente lembrar ou falar a frase em inglês
                  </div>
                </div>
              ) : effectiveMode === 'WORD' ? (
                <div style={{ textAlign: 'center', padding: '1.25rem 0' }}>
                  <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff', letterSpacing: '0.02em', marginBottom: '0.2rem' }}>
                    {currentPhrase.text}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Qual o significado desta palavra?
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '1.45rem', fontWeight: 700, lineHeight: 1.45, color: '#fff', marginBottom: '0.75rem', textAlign: 'center', padding: '0.75rem 0' }}>
                  "{currentPhrase.text}"
                </div>
              )}

              {/* Real Context Sentence (for WORD cards) */}
              {effectiveMode === 'WORD' && currentPhrase.context_sentence && showTranslation && (
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

            {/* METHOD 1: SPEED RECALL (MULTIPLE CHOICE) */}
            {studyMethod === 'CHOICE' && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                  ⚡ Escolha a tradução correta:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.55rem' }}>
                  {choiceOptions.map((opt, idx) => {
                    const isTarget = isReverse
                      ? opt === currentPhrase.text
                      : opt === currentPhrase.translation;
                    const isPicked = selectedChoice === opt;

                    let btnClass = 'quiz-choice-btn';
                    if (selectedChoice) {
                      if (isTarget) btnClass += ' correct';
                      else if (isPicked) btnClass += ' wrong';
                    }

                    return (
                      <button
                        key={idx}
                        className={btnClass}
                        onClick={() => handleSelectChoice(opt)}
                        disabled={!!selectedChoice}
                      >
                        <span>{opt}</span>
                        {selectedChoice && isTarget && <Check size={18} color="var(--accent-emerald)" />}
                        {selectedChoice && isPicked && !isTarget && <X size={18} color="var(--accent-rose)" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* METHOD 2: TYPE-TO-ANSWER INPUT */}
            {studyMethod === 'TYPE' && !showTranslation && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>
                  ✍️ {isReverse ? 'Digite a frase em inglês:' : 'Digite a tradução em português:'}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    ref={typeInputRef}
                    type="text"
                    className="form-input"
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleTypeSubmit()}
                    placeholder={isReverse ? 'Type in English...' : 'Digite em português...'}
                    style={{ flex: 1, fontSize: '1rem', padding: '0.6rem 0.8rem' }}
                  />
                  <button
                    onClick={handleTypeSubmit}
                    className="btn btn-primary"
                    style={{ padding: '0.6rem 1rem' }}
                    disabled={!typedAnswer.trim()}
                  >
                    <Check size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* TYPE RESULT FEEDBACK */}
            {studyMethod === 'TYPE' && typeResult && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.6rem 0.85rem',
                borderRadius: 'var(--radius-md)',
                background: typeResult === 'correct'
                  ? 'rgba(16, 185, 129, 0.12)'
                  : typeResult === 'close'
                  ? 'rgba(245, 158, 11, 0.12)'
                  : 'rgba(244, 63, 94, 0.12)',
                border: `1px solid ${
                  typeResult === 'correct'
                    ? 'rgba(16, 185, 129, 0.3)'
                    : typeResult === 'close'
                    ? 'rgba(245, 158, 11, 0.3)'
                    : 'rgba(244, 63, 94, 0.3)'
                }`
              }}>
                <div style={{
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  color: typeResult === 'correct'
                    ? 'var(--accent-emerald)'
                    : typeResult === 'close'
                    ? 'var(--accent-amber)'
                    : 'var(--accent-rose)',
                  marginBottom: '0.2rem'
                }}>
                  {typeResult === 'correct' ? '✅ Perfeito!' : typeResult === 'close' ? '🟡 Quase lá!' : '❌ Incorreto'}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {isReverse ? (
                    <>Correto: <strong style={{ color: '#fff' }}>"{currentPhrase.text}"</strong></>
                  ) : (
                    <>Correto: <strong style={{ color: 'var(--accent-cyan)' }}>"{currentPhrase.translation}"</strong></>
                  )}
                </div>
              </div>
            )}

            {/* METHOD 3: CLASSIC FLASHCARD REVEAL DISPLAY */}
            {studyMethod === 'FLASHCARD' && (
              <div>
                {showTranslation ? (
                  <div style={{
                    padding: '1rem',
                    background: isReverse ? 'rgba(99, 102, 241, 0.08)' : 'rgba(6, 182, 212, 0.08)',
                    border: isReverse ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid rgba(6, 182, 212, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    marginTop: '1.25rem',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                      <Sparkles size={13} color={isReverse ? 'var(--primary-light)' : 'var(--accent-cyan)'} />
                      {isReverse ? 'EM INGLÊS:' : 'TRADUÇÃO EM PORTUGUÊS:'}
                    </div>

                    {isReverse ? (
                      <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#fff' }}>
                        "{currentPhrase.text}"
                      </div>
                    ) : (
                      <>
                        {autoTranslating && !currentPhrase.translation ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--accent-cyan)', fontSize: '0.95rem' }}>
                            <Loader2 size={16} className="animate-spin" />
                            <span>Traduzindo com IA...</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: effectiveMode === 'WORD' ? '1.5rem' : '1.2rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                            {currentPhrase.translation || '(Sem tradução)'}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setShowTranslation(true);
                      sfx.playFlip();
                    }}
                    className="btn btn-secondary btn-block"
                    style={{ marginTop: '1.5rem', padding: '0.75rem' }}
                  >
                    <Eye size={16} />
                    <span>{isReverse ? 'Mostrar em Inglês (Espaço)' : 'Mostrar Tradução (Espaço)'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SM-2 ANKI-STYLE 4-BUTTON GRADING GRID */}
          <div style={{ marginTop: '1rem' }}>
            <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
              Avalie sua lembrança para calcular o próximo intervalo:
            </div>

            <div className="anki-grade-grid">
              {/* 1. Errei / Again */}
              <button
                onClick={() => handleGrade(1)}
                className="anki-grade-btn"
                style={{ borderColor: 'rgba(244, 63, 94, 0.4)', color: 'var(--accent-rose)' }}
              >
                <span className="grade-shortcut">1</span>
                <span className="grade-emoji">❌</span>
                <span className="grade-name">Errei</span>
                <span className="grade-interval">{sm2Intervals.again}</span>
              </button>

              {/* 2. Difícil / Hard */}
              <button
                onClick={() => handleGrade(2)}
                className="anki-grade-btn"
                style={{ borderColor: 'rgba(245, 158, 11, 0.4)', color: 'var(--accent-amber)' }}
              >
                <span className="grade-shortcut">2</span>
                <span className="grade-emoji">😓</span>
                <span className="grade-name">Difícil</span>
                <span className="grade-interval">{sm2Intervals.hard}</span>
              </button>

              {/* 3. Bom / Good */}
              <button
                onClick={() => handleGrade(3)}
                className="anki-grade-btn"
                style={{ borderColor: 'rgba(99, 102, 241, 0.4)', color: 'var(--primary-light)' }}
              >
                <span className="grade-shortcut">3</span>
                <span className="grade-emoji">👍</span>
                <span className="grade-name">Bom</span>
                <span className="grade-interval">{sm2Intervals.good}</span>
              </button>

              {/* 4. Fácil / Easy */}
              <button
                onClick={() => handleGrade(4)}
                className="anki-grade-btn"
                style={{ borderColor: 'rgba(16, 185, 129, 0.4)', color: 'var(--accent-emerald)' }}
              >
                <span className="grade-shortcut">4</span>
                <span className="grade-emoji">⚡</span>
                <span className="grade-name">Fácil</span>
                <span className="grade-interval">{sm2Intervals.easy}</span>
              </button>
            </div>
          </div>

          {/* KEYBOARD SHORTCUTS HINT RIBBON */}
          <div className="keyboard-shortcuts-ribbon">
            <span><span className="kbd-badge">Espaço</span> Virar</span>
            <span><span className="kbd-badge">1</span> Errei</span>
            <span><span className="kbd-badge">2</span> Difícil</span>
            <span><span className="kbd-badge">3</span> Bom</span>
            <span><span className="kbd-badge">4</span> Fácil</span>
            <span><span className="kbd-badge">R</span> Áudio</span>
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
                <span>Editar {effectiveMode === 'WORD' ? 'Palavra' : 'Frase'}</span>
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
                placeholder="Ex: Frase onde a palavra foi usada..."
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
