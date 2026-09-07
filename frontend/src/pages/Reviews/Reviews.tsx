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
  HelpCircle,
  Lightbulb
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const Reviews: React.FC = () => {
  // Deck Type: Sentences vs Words vs Reverse
  const [reviewMode, setReviewMode] = useState<'SENTENCE' | 'WORD' | 'REVERSE'>('SENTENCE');
  // Study Method: Multiple Choice (Simpler/Memrise) as default vs Classic Flashcard vs Type-to-Answer
  const [studyMethod, setStudyMethod] = useState<'CHOICE' | 'FLASHCARD' | 'TYPE'>('CHOICE');
  // Review Scope: 'DUE' (somente agendadas/disponíveis) vs 'ALL' (todas as salvas/prática livre)
  const [reviewScope, setReviewScope] = useState<'DUE' | 'ALL'>('DUE');
  const [dueCount, setDueCount] = useState<number>(0);
  const [allCount, setAllCount] = useState<number>(0);

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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memrise Mem / Hint State
  const [showMemHint, setShowMemHint] = useState(false);
  const [memHint, setMemHint] = useState<string | null>(null);
  const [loadingMemHint, setLoadingMemHint] = useState(false);

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
    return () => {
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadReviews(reviewMode === 'REVERSE' ? 'SENTENCE' : reviewMode, reviewScope);
  }, [reviewMode, reviewScope]);

  const loadReviews = async (mode: 'SENTENCE' | 'WORD', scope: 'DUE' | 'ALL' = reviewScope) => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setLoading(true);
    setCurrentIndex(0);
    setShowTranslation(false);
    setShowMemHint(false);
    setMemHint(null);
    setFinished(false);
    setCombo(0);
    setMaxCombo(0);
    setSessionStats({ graded: 0, correct: 0, totalXp: 0 });
    setTypedAnswer('');
    setTypeResult(null);
    setSelectedChoice(null);
    setChoiceResult(null);
    try {
      const isAll = scope === 'ALL';
      const [data, dueData, allData] = await Promise.all([
        reviewService.getTodayReviews(mode, isAll),
        reviewService.getTodayReviews(mode, false),
        reviewService.getTodayReviews(mode, true),
      ]);
      setPhrases(data);
      setDueCount(dueData.length);
      setAllCount(allData.length);
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

    const fallbackPoolPt = [
      'pensar, acreditar, achar',
      'entender, conseguir, ficar',
      'deixar, permitir',
      'perguntar, pedir',
      'importante, relevante',
      'tempo, hora, momento',
      'trabalhar, funcionar',
      'cuidadosamente, com atenção',
      'amigo, parceiro',
      'ouvir, prestar atenção',
      'vida real, cotidiano',
      'decidir com certeza'
    ];

    const fallbackPoolEn = [
      'to believe or think',
      'to understand clearly',
      'to let or allow someone',
      'to ask for something',
      'important and relevant',
      'time and moment',
      'to work and succeed',
      'carefully with attention',
      'friend and companion',
      'listen carefully',
      'real life experience'
    ];

    const distractors: string[] = [];
    const combinedPool = [...pool, ...(isReverse ? fallbackPoolEn : fallbackPoolPt)];

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

  // Memrise Plant Growth Indicator (5 stages based on SRS intervals)
  const masteryInfo = useMemo(() => {
    if (!currentPhrase) return { level: 1, label: '🌱 Semente', desc: 'Iniciando aprendizado' };
    const days = currentPhrase.interval_days || 0;
    if (days >= 30) return { level: 5, label: '🌳 Dominado', desc: 'Memória permanente' };
    if (days >= 11) return { level: 4, label: '🌸 Flor', desc: 'Memória de longo prazo' };
    if (days >= 4) return { level: 3, label: '🪴 Crescendo', desc: 'Fixação intermediária' };
    if (days >= 1) return { level: 2, label: '🌿 Broto', desc: 'Primeiras repetições' };
    return { level: 1, label: '🌱 Semente', desc: 'Iniciando aprendizado' };
  }, [currentPhrase]);

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

  // Toggle Memrise-style "Mem" Mnemonic Tip
  const handleToggleMemHint = async () => {
    if (showMemHint) {
      setShowMemHint(false);
      return;
    }
    setShowMemHint(true);
    if (!memHint && currentPhrase) {
      if (currentPhrase.context_sentence) {
        setMemHint(`Frase no vídeo: "${currentPhrase.context_sentence}"`);
      } else {
        try {
          setLoadingMemHint(true);
          const res = await aiService.explain(currentPhrase.text);
          if (res && res.explanation) {
            setMemHint(res.explanation);
          }
        } catch {
          setMemHint('Associe esta palavra a uma cena ou som do seu cotidiano para fixar mais rápido.');
        } finally {
          setLoadingMemHint(false);
        }
      }
    }
  };

  // Advance to next card or finish session
  const handleNextCard = () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (currentIndex + 1 < phrases.length) {
      setCurrentIndex((prev) => prev + 1);
      setShowTranslation(false);
      setShowMemHint(false);
      setMemHint(null);
      setTypedAnswer('');
      setTypeResult(null);
      setSelectedChoice(null);
      setChoiceResult(null);
    } else {
      setFinished(true);
      sfx.playFanfare();
    }
  };

  // Grade Card (Used in manual Flashcard mode)
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

    handleNextCard();
  };

  // Multiple Choice Selection (Simpler & Memrise Style - Automatic Grading)
  const handleSelectChoice = async (opt: string) => {
    if (selectedChoice || !currentPhrase) return;
    setSelectedChoice(opt);

    const targetAnswer = isReverse
      ? currentPhrase.text
      : currentPhrase.translation || 'Sem tradução cadastrada';

    const isCorrect = opt.trim().toLowerCase() === targetAnswer.trim().toLowerCase();

    if (isCorrect) {
      setChoiceResult('correct');
      sfx.playSuccess();
      setCombo((prev) => {
        const next = prev + 1;
        setMaxCombo((m) => Math.max(m, next));
        return next;
      });
      triggerFloatingXp('+20 XP');
      setSessionStats((prev) => ({
        graded: prev.graded + 1,
        correct: prev.correct + 1,
        totalXp: prev.totalXp + 20,
      }));

      // Automatically submit SRS review as Good (3)
      try {
        await reviewService.submitReview(currentPhrase.id, 3);
      } catch (err) {
        console.error(err);
      }

      // Auto advance smoothly after 1.25s
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = setTimeout(() => {
        handleNextCard();
      }, 1250);
    } else {
      setChoiceResult('wrong');
      sfx.playError();
      setCombo(0);
      setSessionStats((prev) => ({
        graded: prev.graded + 1,
        correct: prev.correct,
        totalXp: prev.totalXp + 5,
      }));

      // Automatically submit SRS review as Again (1) to re-queue it
      try {
        await reviewService.submitReview(currentPhrase.id, 1);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Keyboard Shortcuts (Simpler & Memrise Style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcut keys if user is typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (editingPhrase) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (currentPhrase) handleSpeak(currentPhrase.text);
        return;
      }

      // 1. Multiple Choice mode shortcuts (Default)
      if (studyMethod === 'CHOICE') {
        if (!selectedChoice) {
          if (e.key === '1' && choiceOptions[0]) {
            e.preventDefault();
            handleSelectChoice(choiceOptions[0]);
          } else if (e.key === '2' && choiceOptions[1]) {
            e.preventDefault();
            handleSelectChoice(choiceOptions[1]);
          } else if (e.key === '3' && choiceOptions[2]) {
            e.preventDefault();
            handleSelectChoice(choiceOptions[2]);
          } else if (e.key === '4' && choiceOptions[3]) {
            e.preventDefault();
            handleSelectChoice(choiceOptions[3]);
          }
        } else {
          if (e.code === 'Space' || e.key === 'Enter') {
            e.preventDefault();
            handleNextCard();
          }
        }
        return;
      }

      // 2. Classic Flashcard mode shortcuts
      if (studyMethod === 'FLASHCARD') {
        if (e.code === 'Space') {
          e.preventDefault();
          if (!showTranslation) {
            setShowTranslation(true);
            sfx.playFlip();
          } else {
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
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTranslation, currentPhrase, editingPhrase, phrases.length, currentIndex, studyMethod, selectedChoice, choiceOptions]);

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.88;
      setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      // Safety timeout to reset wave animation
      setTimeout(() => setIsSpeaking(false), 2200);
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

        {/* Scope Selector: Somente Agendadas (Disponíveis Hoje) vs Prática Livre (Todas) */}
        <div className="simpler-scope-selector">
          <button
            onClick={() => setReviewScope('DUE')}
            className={`scope-pill-btn ${reviewScope === 'DUE' ? 'active' : ''}`}
          >
            <span>🎯 Disponíveis Hoje</span>
            <span className="scope-count-badge">{dueCount}</span>
          </button>
          <button
            onClick={() => setReviewScope('ALL')}
            className={`scope-pill-btn ${reviewScope === 'ALL' ? 'active' : ''}`}
          >
            <span>📚 Revisar Todas (Livre)</span>
            <span className="scope-count-badge">{allCount}</span>
          </button>
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

        {/* Study Method Switcher (Quiz de Tradução vs Flashcard vs Digitação) */}
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
            onClick={() => setStudyMethod('CHOICE')}
            style={{
              flex: 1.2,
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              background: studyMethod === 'CHOICE' ? 'rgba(6, 182, 212, 0.3)' : 'transparent',
              color: studyMethod === 'CHOICE' ? '#fff' : 'var(--text-muted)'
            }}
          >
            ⚡ Quiz de Tradução
          </button>
          <button
            onClick={() => setStudyMethod('FLASHCARD')}
            style={{
              flex: 1,
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              background: studyMethod === 'FLASHCARD' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
              color: studyMethod === 'FLASHCARD' ? '#fff' : 'var(--text-muted)'
            }}
          >
            🃏 Flashcard
          </button>
          <button
            onClick={() => setStudyMethod('TYPE')}
            style={{
              flex: 1,
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              background: studyMethod === 'TYPE' ? 'rgba(168, 85, 247, 0.3)' : 'transparent',
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
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            {reviewScope === 'DUE' ? 'Tudo em dia para hoje! 🎉' : 'Nenhum card cadastrado'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: '440px', margin: '0 auto 1.5rem auto' }}>
            {reviewScope === 'DUE'
              ? `Você concluiu todas as revisões agendadas para hoje! Para acelerar ainda mais sua retenção, pratique livremente com todas as ${allCount} palavras e frases salvas.`
              : effectiveMode === 'WORD'
              ? 'Você ainda não possui palavras salvas no vocabulário. Adicione manualmente na biblioteca ou extraia das suas frases salvas!'
              : 'Você ainda não salvou frases. Adicione manualmente na biblioteca ou assista a um vídeo para capturar novas expressões!'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '380px', margin: '0 auto' }}>
            {reviewScope === 'DUE' && allCount > 0 && (
              <button
                onClick={() => setReviewScope('ALL')}
                className="simpler-btn"
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  padding: '0.85rem 1rem',
                  boxShadow: '0 4px 0 #3730a3',
                  fontSize: '0.92rem'
                }}
              >
                <RefreshCw size={17} />
                <span>📚 Revisar Todas as {allCount} Palavras/Frases Agora</span>
              </button>
            )}

            {effectiveMode === 'WORD' && (
              <button
                onClick={handleExtractWords}
                className="btn btn-secondary"
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

            <Link to="/phrases" className="btn btn-secondary">
              <Layers size={16} />
              <span>Ver Minha Biblioteca</span>
            </Link>

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
              onClick={() => loadReviews(effectiveMode, reviewScope)}
              className="btn btn-primary"
            >
              <RefreshCw size={16} />
              <span>{reviewScope === 'DUE' ? 'Checar Novas Pendências' : 'Reiniciar Prática Livre'}</span>
            </button>

            {reviewScope === 'DUE' && allCount > 0 && (
              <button
                onClick={() => setReviewScope('ALL')}
                className="simpler-btn"
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#fff',
                  padding: '0.85rem',
                  boxShadow: '0 4px 0 #3730a3',
                  fontSize: '0.92rem'
                }}
              >
                <RefreshCw size={16} />
                <span>📚 Praticar Todas as Frases Salvas ({allCount})</span>
              </button>
            )}

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
        /* ACTIVE FLASHCARD REVIEW (Memrise + Simpler English Redesign) */
        <div>
          <div
            className="card memrise-card"
            style={{
              background: isReverse
                ? 'linear-gradient(180deg, rgba(6, 182, 212, 0.12) 0%, rgba(15, 23, 42, 0.98) 100%)'
                : effectiveMode === 'WORD'
                ? 'linear-gradient(180deg, rgba(168, 85, 247, 0.12) 0%, rgba(15, 23, 42, 0.98) 100%)'
                : 'linear-gradient(180deg, rgba(99, 102, 241, 0.12) 0%, rgba(15, 23, 42, 0.98) 100%)'
            }}
          >
            <div>
              {/* Card Header: Type Badge + Memrise Plant Growth Indicator + Edit */}
              <div className="flex-between" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
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
                  border: '1px solid currentColor',
                  fontWeight: 800,
                  fontSize: '0.74rem'
                }}>
                  {isReverse ? '🔄 PT → EN' : effectiveMode === 'WORD' ? '🔤 VOCABULÁRIO' : '📖 FRASE REAL'}
                </span>

                {/* Memrise Bloom / Plant Growth Tracker */}
                <div className="memrise-growth-tracker" title={`Nível de Domínio: ${masteryInfo.label} (${masteryInfo.desc})`}>
                  <span>{masteryInfo.label}</span>
                  <div className="growth-dots">
                    {[1, 2, 3, 4, 5].map((lvl) => (
                      <div
                        key={lvl}
                        className={`growth-dot ${lvl <= masteryInfo.level ? 'active' : ''}`}
                      />
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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
                      fontSize: '0.78rem',
                      fontWeight: 700
                    }}
                  >
                    <Edit3 size={13} />
                    <span>Editar</span>
                  </button>
                </div>
              </div>

              {/* Memrise Hero Audio Button */}
              <div style={{ textAlign: 'center', margin: '0.6rem 0 0.4rem 0' }}>
                <button
                  onClick={() => handleSpeak(currentPhrase.text)}
                  className={`hero-audio-btn ${isSpeaking ? 'speaking' : ''}`}
                  title="Ouvir pronúncia nativa em inglês (Atalho: R)"
                >
                  <Volume2 size={26} />
                </button>
              </div>

              {/* CARD PROMPT DISPLAY */}
              {isReverse ? (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    🇧🇷 Como se diz em inglês:
                  </div>
                  <div className="card-main-text" style={{ color: 'var(--accent-cyan)' }}>
                    {currentPhrase.translation || '(tradução pendente)'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Fale em voz alta ou pense na frase em inglês
                  </div>
                </div>
              ) : effectiveMode === 'WORD' ? (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div className="card-main-text">
                    {currentPhrase.text}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                    Qual é o significado desta palavra?
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div className="card-main-text sentence">
                    "{currentPhrase.text}"
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600 }}>
                    Entendeu o sentido da frase?
                  </div>
                </div>
              )}

              {/* Memrise "Mem" Mnemonic Tip Section */}
              <div style={{ marginTop: '0.5rem', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={handleToggleMemHint}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#fbbf24',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '8px'
                  }}
                >
                  <Lightbulb size={15} />
                  <span>{showMemHint ? 'Ocultar Dica (Mem)' : '💡 Ver Dica de Memorização'}</span>
                </button>

                {showMemHint && (
                  <div className="mem-hint-card">
                    <div className="mem-hint-header">
                      <span>💡 DICA DE ASSOCIAÇÃO (MEM)</span>
                      {loadingMemHint && <Loader2 size={13} className="animate-spin" />}
                    </div>
                    <div className="mem-hint-text">
                      {loadingMemHint ? 'Buscando melhor associação com IA...' : memHint || 'Associe o som ou escrita a uma cena da sua vida para fixar melhor.'}
                    </div>
                  </div>
                )}
              </div>

              {/* Real Context Sentence (for WORD cards) */}
              {effectiveMode === 'WORD' && currentPhrase.context_sentence && showTranslation && (
                <div className="context-quote-box">
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', fontWeight: 800, textTransform: 'uppercase' }}>
                      Contexto no Vídeo:
                    </span>
                    <span style={{ fontSize: '0.88rem', color: '#f1f5f9' }}>"{currentPhrase.context_sentence}"</span>
                  </div>
                  <button
                    onClick={() => handleSpeak(currentPhrase.context_sentence!)}
                    style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', flexShrink: 0 }}
                    title="Ouvir frase inteira"
                  >
                    <Volume2 size={18} />
                  </button>
                </div>
              )}
            </div>

            {/* METHOD 1: SPEED RECALL (MULTIPLE CHOICE SIMPLER STYLE - AUTO GRADING) */}
            {studyMethod === 'CHOICE' && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '0.65rem', fontWeight: 700 }}>
                  ⚡ Escolha a tradução correta:
                </div>
                <div className="simpler-choice-grid">
                  {choiceOptions.map((opt, idx) => {
                    const targetAnswer = isReverse
                      ? currentPhrase.text
                      : currentPhrase.translation || 'Sem tradução cadastrada';
                    const isTarget = opt.trim().toLowerCase() === targetAnswer.trim().toLowerCase();
                    const isPicked = selectedChoice === opt;

                    let btnClass = 'simpler-choice-card';
                    if (selectedChoice) {
                      if (isTarget) btnClass += ' correct';
                      else if (isPicked) btnClass += ' wrong';
                    }

                    const letters = ['A', 'B', 'C', 'D'];

                    return (
                      <button
                        key={idx}
                        className={btnClass}
                        onClick={() => handleSelectChoice(opt)}
                        disabled={!!selectedChoice}
                      >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span className="choice-letter-badge">{letters[idx] || idx + 1}</span>
                          <span>{opt}</span>
                        </div>
                        {selectedChoice && isTarget && <Check size={20} color="#10b981" />}
                        {selectedChoice && isPicked && !isTarget && <X size={20} color="#f43f5e" />}
                      </button>
                    );
                  })}
                </div>

                {/* Simpler / Memrise Bottom Feedback Bar with Action Button */}
                {selectedChoice && (
                  <div className={`simpler-bottom-feedback ${choiceResult === 'correct' ? 'correct' : 'wrong'}`}>
                    <div className="feedback-info">
                      {choiceResult === 'correct' ? (
                        <CheckCircle2 size={32} color="#10b981" />
                      ) : (
                        <X size={32} color="#f43f5e" />
                      )}
                      <div>
                        <div className="feedback-title">
                          {choiceResult === 'correct' ? '🎉 Mandou bem!' : '❌ Resposta correta:'}
                        </div>
                        <div className="feedback-subtitle">
                          {choiceResult === 'correct' ? (
                            <span>Você acertou a tradução! (+20 XP)</span>
                          ) : (
                            <strong style={{ color: '#ffffff', fontSize: '0.96rem' }}>
                              "{isReverse ? currentPhrase.text : currentPhrase.translation}"
                            </strong>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleNextCard}
                      className={`feedback-btn-next ${choiceResult === 'correct' ? 'correct' : 'wrong'}`}
                    >
                      <span>{choiceResult === 'correct' ? 'Continuar' : 'Entendi, Continuar'}</span>
                      <ArrowRight size={18} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* METHOD 2: TYPE-TO-ANSWER INPUT */}
            {studyMethod === 'TYPE' && !showTranslation && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.45rem', fontWeight: 700 }}>
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
                    style={{ flex: 1, fontSize: '1rem', padding: '0.75rem 1rem', borderRadius: '14px' }}
                  />
                  <button
                    onClick={handleTypeSubmit}
                    className="simpler-btn"
                    style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#fff',
                      padding: '0.75rem 1.25rem',
                      boxShadow: '0 4px 0 #065f46'
                    }}
                    disabled={!typedAnswer.trim()}
                  >
                    <Check size={18} />
                  </button>
                </div>
              </div>
            )}

            {/* TYPE RESULT FEEDBACK */}
            {studyMethod === 'TYPE' && typeResult && (
              <div style={{
                marginTop: '0.85rem',
                padding: '0.75rem 1rem',
                borderRadius: '16px',
                background: typeResult === 'correct'
                  ? 'rgba(16, 185, 129, 0.15)'
                  : typeResult === 'close'
                  ? 'rgba(245, 158, 11, 0.15)'
                  : 'rgba(244, 63, 94, 0.15)',
                border: `1.5px solid ${
                  typeResult === 'correct'
                    ? '#10b981'
                    : typeResult === 'close'
                    ? '#f59e0b'
                    : '#f43f5e'
                }`
              }}>
                <div style={{
                  fontWeight: 800,
                  fontSize: '0.92rem',
                  color: typeResult === 'correct'
                    ? 'var(--accent-emerald)'
                    : typeResult === 'close'
                    ? 'var(--accent-amber)'
                    : 'var(--accent-rose)',
                  marginBottom: '0.2rem'
                }}>
                  {typeResult === 'correct' ? '✅ Perfeito!' : typeResult === 'close' ? '🟡 Quase lá!' : '❌ Incorreto'}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {isReverse ? (
                    <>Correto: <strong style={{ color: '#fff' }}>"{currentPhrase.text}"</strong></>
                  ) : (
                    <>Correto: <strong style={{ color: 'var(--accent-cyan)' }}>"{currentPhrase.translation}"</strong></>
                  )}
                </div>
                <button
                  onClick={handleNextCard}
                  className="btn btn-primary"
                  style={{ marginTop: '0.75rem', width: '100%' }}
                >
                  Continuar
                </button>
              </div>
            )}

            {/* METHOD 3: CLASSIC FLASHCARD REVEAL DISPLAY */}
            {studyMethod === 'FLASHCARD' && (
              <div>
                {showTranslation ? (
                  <div className="revealed-answer-box">
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', textTransform: 'uppercase' }}>
                      <Sparkles size={14} color={isReverse ? 'var(--primary-light)' : 'var(--accent-cyan)'} />
                      {isReverse ? 'EM INGLÊS:' : 'TRADUÇÃO EM PORTUGUÊS:'}
                    </div>

                    {isReverse ? (
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>
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
                          <div style={{ fontSize: effectiveMode === 'WORD' ? '1.65rem' : '1.35rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
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
                    className="simpler-btn simpler-reveal-btn"
                    style={{ marginTop: '1.4rem' }}
                  >
                    <Eye size={18} />
                    <span>{isReverse ? 'Mostrar em Inglês (Espaço)' : 'Mostrar Tradução (Espaço)'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SIMPLER ENGLISH 4-BUTTON 3D TACTILE GRADING GRID (Shown ONLY in manual Flashcard mode) */}
          {studyMethod === 'FLASHCARD' && showTranslation && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ textAlign: 'center', fontSize: '0.82rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.65rem' }}>
                Como foi sua lembrança?
              </div>

              <div className="simpler-grade-grid">
                {/* 1. Errei / Again */}
                <button
                  onClick={() => handleGrade(1)}
                  className="simpler-grade-card grade-again"
                  title="Errei - Revisar novamente em breve"
                >
                  <span className="shortcut-pill">1</span>
                  <span className="grade-icon">❌</span>
                  <span className="grade-title">Errei</span>
                  <span className="grade-subtitle">{sm2Intervals.again}</span>
                </button>

                {/* 2. Difícil / Hard */}
                <button
                  onClick={() => handleGrade(2)}
                  className="simpler-grade-card grade-hard"
                  title="Difícil - Lembrou com esforço"
                >
                  <span className="shortcut-pill">2</span>
                  <span className="grade-icon">😓</span>
                  <span className="grade-title">Difícil</span>
                  <span className="grade-subtitle">{sm2Intervals.hard}</span>
                </button>

                {/* 3. Bom / Good */}
                <button
                  onClick={() => handleGrade(3)}
                  className="simpler-grade-card grade-good"
                  title="Bom - Lembrou corretamente"
                >
                  <span className="shortcut-pill">3</span>
                  <span className="grade-icon">👍</span>
                  <span className="grade-title">Acertei</span>
                  <span className="grade-subtitle">{sm2Intervals.good}</span>
                </button>

                {/* 4. Fácil / Easy */}
                <button
                  onClick={() => handleGrade(4)}
                  className="simpler-grade-card grade-easy"
                  title="Fácil - Dominado sem hesitar"
                >
                  <span className="shortcut-pill">4</span>
                  <span className="grade-icon">⚡</span>
                  <span className="grade-title">Dominado</span>
                  <span className="grade-subtitle">{sm2Intervals.easy}</span>
                </button>
              </div>
            </div>
          )}

          {/* KEYBOARD SHORTCUTS HINT RIBBON */}
          <div className="keyboard-shortcuts-ribbon">
            {studyMethod === 'CHOICE' ? (
              <>
                <span><span className="kbd-badge">1 - 4</span> Escolher Opção</span>
                <span><span className="kbd-badge">Espaço / Enter</span> Continuar</span>
                <span><span className="kbd-badge">R</span> Áudio</span>
              </>
            ) : studyMethod === 'FLASHCARD' ? (
              <>
                <span><span className="kbd-badge">Espaço</span> Virar</span>
                <span><span className="kbd-badge">1 - 4</span> Avaliar</span>
                <span><span className="kbd-badge">R</span> Áudio</span>
              </>
            ) : (
              <>
                <span><span className="kbd-badge">Enter</span> Confirmar</span>
                <span><span className="kbd-badge">R</span> Áudio</span>
              </>
            )}
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
