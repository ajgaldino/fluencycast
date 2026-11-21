import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { gamesService, DuelDetail, DuelSummary } from '../../services/games';
import { usePolling } from '../../hooks/usePolling';
import './Games.css';

export const DuelPlay: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [duel, setDuel] = useState<DuelDetail | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctIdx, setCorrectIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<DuelSummary | null>(null);
  const [error, setError] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const startRef = useRef(Date.now());
  const initialised = useRef(false);

  // Pulls the authoritative state from the server. If the server is ahead of this
  // device (e.g. answers were given on another device) we jump forward to match.
  const sync = useCallback(async () => {
    try {
      const d = await gamesService.getDuel(id);
      setSummary(d);
      setDuel((prev) => (prev && prev.questions.length === d.questions.length ? { ...prev, ...d } : d));
      if (!initialised.current) {
        initialised.current = true;
        setIndex(d.my_answered);
        startRef.current = Date.now();
      } else {
        setIndex((cur) => {
          if (d.my_answered > cur) {
            setPicked(null);
            setCorrectIdx(null);
            startRef.current = Date.now();
            setSyncNote('Sincronizado com seu outro aparelho.');
            return d.my_answered;
          }
          return cur;
        });
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    sync();
  }, [sync]);

  // Don't poll in the middle of answering a question; do poll everywhere else
  // (including the "waiting for opponent" screen, so the result appears by itself).
  usePolling(sync, 4000, !busy && picked === null);

  if (error && !duel) return <div className="games-page"><div className="games-error">{error}</div></div>;
  if (!duel || !summary) return <div className="games-page"><div className="games-muted">Carregando...</div></div>;

  const total = duel.total_questions;
  const finished = index >= total && picked === null;
  const isCloze = duel.game_type === 'CLOZE';

  const choose = async (choice: number) => {
    if (busy || picked !== null) return;
    setBusy(true);
    setPicked(choice);
    setError('');
    try {
      const res = await gamesService.answer(id, index, choice, Date.now() - startRef.current);
      setCorrectIdx(res.correct_index);
      setSummary(res.duel);
      if (res.already_answered) setSyncNote('Essa pergunta já tinha sido respondida em outro aparelho.');
    } catch (e: any) {
      // Out of sync (409): drop the local pick and re-read the server state.
      setPicked(null);
      setCorrectIdx(null);
      setError(e.message);
      await sync();
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setPicked(null);
    setCorrectIdx(null);
    setSyncNote('');
    setIndex((i) => i + 1);
    startRef.current = Date.now();
  };

  if (finished) {
    const s = summary;
    const over = s.status === 'FINISHED';
    return (
      <div className="games-page">
        <div className="games-card duel-result">
          <h2 style={{ justifyContent: 'center' }}>
            {over ? (s.is_draw ? '🤝 Empate!' : s.i_won ? '🏆 Você venceu!' : 'Você perdeu desta vez') : '✅ Você terminou!'}
          </h2>
          <div className="big">{s.my_score} / {total}</div>
          {over ? (
            <div>{s.opponent_name}: {s.opponent_score} / {total}</div>
          ) : (
            <div className="games-muted">
              Aguardando {s.opponent_name} ({s.opponent_answered}/{total}). O resultado aparece aqui automaticamente.
            </div>
          )}
          <button className="games-btn" style={{ marginTop: 16 }} onClick={() => navigate('/games')}>
            Voltar à Arena
          </button>
        </div>
      </div>
    );
  }

  const q = duel.questions[index];
  const answered = picked !== null && correctIdx !== null;

  return (
    <div className="games-page">
      <div className="duel-progress">
        <span>vs {duel.opponent_name} ({summary.opponent_answered}/{total})</span>
        <span>Pergunta {index + 1}/{total} · ✅ {summary.my_score}</span>
      </div>
      {syncNote && <div className="games-muted" style={{ textAlign: 'center' }}>🔄 {syncNote}</div>}
      <div className="games-card">
        <div className="games-muted" style={{ textAlign: 'center' }}>
          {isCloze ? 'Complete a frase:' : 'O que significa:'}
        </div>
        <div className={`duel-question ${isCloze ? 'cloze' : ''}`}>{q.text}</div>
        {isCloze && q.hint && <div className="games-muted" style={{ textAlign: 'center', marginBottom: 12 }}>💡 {q.hint}</div>}
        <div className="duel-options">
          {q.options.map((opt, i) => {
            let cls = 'duel-option';
            if (answered) {
              if (i === correctIdx) cls += ' correct';
              else if (i === picked) cls += ' wrong';
            }
            return (
              <button key={i} className={cls} disabled={picked !== null} onClick={() => choose(i)}>
                {opt}
              </button>
            );
          })}
        </div>
        {answered && (
          <button className="games-btn" style={{ marginTop: 16, width: '100%' }} onClick={next}>
            {index + 1 >= total ? 'Finalizar' : 'Próxima'}
          </button>
        )}
        {error && <div className="games-error">{error}</div>}
      </div>
    </div>
  );
};

export default DuelPlay;
