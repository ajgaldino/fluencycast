import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gamesService, WordleState, LetterResult } from '../../services/games';
import { usePolling } from '../../hooks/usePolling';
import './Games.css';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const RANK: Record<LetterResult, number> = { absent: 0, present: 1, correct: 2 };

export const Wordle: React.FC = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<WordleState | null>(null);
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sync = useCallback(async () => {
    try {
      setState(await gamesService.getWordle());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);
  // Another device may have played a guess: keep the board aligned with the server.
  usePolling(sync, 5000, !busy);

  const length = state?.word_length ?? 5;
  const playing = state?.status === 'IN_PROGRESS';

  const submit = useCallback(async () => {
    if (!state || busy || !playing) return;
    if (current.length !== length) {
      setError(`Digite ${length} letras.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await gamesService.guessWordle(current, state.guesses.length);
      setState(next);
      setCurrent('');
    } catch (e: any) {
      setError(e.message);
      setCurrent('');
      await sync(); // stale device (409) or invalid word: re-read the server board
    } finally {
      setBusy(false);
    }
  }, [state, busy, playing, current, length, sync]);

  const press = (key: string) => {
    if (!playing || busy) return;
    if (key === 'ENTER') return void submit();
    if (key === 'DEL') return setCurrent((c) => c.slice(0, -1));
    setCurrent((c) => (c.length < length ? c + key : c));
  };

  // Physical keyboard support on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') press('ENTER');
      else if (e.key === 'Backspace') press('DEL');
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!state) return <div className="games-page"><div className="games-muted">{error || 'Carregando...'}</div></div>;

  const letterState: Record<string, LetterResult> = {};
  state.guesses.forEach((g) =>
    g.word.split('').forEach((ch, i) => {
      const r = g.result[i];
      if (!(ch in letterState) || RANK[r] > RANK[letterState[ch]]) letterState[ch] = r;
    })
  );

  const rows = Array.from({ length: state.max_guesses }, (_, r) => {
    const g = state.guesses[r];
    if (g) return g.word.split('').map((ch, i) => ({ ch, cls: g.result[i] }));
    const word = r === state.guesses.length && playing ? current : '';
    return Array.from({ length }, (_, i) => ({ ch: word[i] ?? '', cls: word[i] ? 'typing' : '' }));
  });

  return (
    <div className="games-page">
      <div className="duel-progress">
        <button className="games-btn secondary" onClick={() => navigate('/games')}>← Arena</button>
        <span>Palavra do dia · {state.day}</span>
      </div>

      <div className="games-card">
        <div className="wordle-grid">
          {rows.map((row, r) => (
            <div className="wordle-row" key={r}>
              {row.map((cell, i) => (
                <div key={i} className={`wordle-cell ${cell.cls}`}>{cell.ch}</div>
              ))}
            </div>
          ))}
        </div>

        {state.status === 'WON' && <div className="games-badge-win" style={{ textAlign: 'center', marginTop: 12 }}>🎉 Acertou em {state.guesses.length}!</div>}
        {state.status === 'LOST' && <div className="games-badge-lose" style={{ textAlign: 'center', marginTop: 12 }}>A palavra era <strong>{state.answer}</strong></div>}
        {error && <div className="games-error" style={{ textAlign: 'center' }}>{error}</div>}

        {playing ? (
          <div className="wordle-keyboard">
            {ROWS.map((row, ri) => (
              <div className="wordle-krow" key={ri}>
                {ri === 2 && <button className="wordle-key wide" onClick={() => press('ENTER')}>⏎</button>}
                {row.split('').map((k) => (
                  <button key={k} className={`wordle-key ${letterState[k] ?? ''}`} onClick={() => press(k)}>{k}</button>
                ))}
                {ri === 2 && <button className="wordle-key wide" onClick={() => press('DEL')}>⌫</button>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            {state.others.map((o) => (
              <div key={o.name} className="games-row">
                <span>{o.name}</span>
                <span className="games-muted">
                  {o.finished ? (o.won ? `acertou em ${o.attempts}` : 'não acertou') : o.played ? 'jogando...' : 'ainda não jogou'}
                </span>
              </div>
            ))}
            <div className="games-muted" style={{ marginTop: 8 }}>Uma nova palavra aparece à meia-noite (horário de Brasília).</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Wordle;
