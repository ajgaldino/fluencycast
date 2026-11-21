import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { gamesService, liveSocketUrl, LiveState } from '../../services/games';
import { usePolling } from '../../hooks/usePolling';
import './Games.css';

export const LiveDuel: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [socketUp, setSocketUp] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  // Remaining time arrives from the server as a duration, never as a clock time,
  // so a wrong clock on either device cannot desynchronise the countdown.
  const received = useRef({ at: Date.now(), ms: 0 });
  const inFlight = useRef(false);

  const apply = useCallback((s: LiveState) => {
    received.current = { at: Date.now(), ms: s.remaining_ms };
    setRemaining(s.remaining_ms);
    setState(s);
    setPending(null);
  }, []);

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      apply(await gamesService.getLive(id));
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      inFlight.current = false;
    }
  }, [id, apply]);

  useEffect(() => {
    sync();
  }, [sync]);

  // Fallback: polling keeps the room working even if the WebSocket is blocked.
  usePolling(sync, 2500, state?.phase !== 'FINISHED');

  // Push channel: the server only says "changed", we refetch the real state.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let ping: number | undefined;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(liveSocketUrl(id));
      ws.onopen = () => {
        setSocketUp(true);
        ping = window.setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25000);
      };
      ws.onmessage = () => void sync();
      ws.onclose = () => {
        setSocketUp(false);
        window.clearInterval(ping);
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      window.clearInterval(ping);
      window.clearTimeout(retry);
      ws?.close();
    };
  }, [id, sync]);

  // Local countdown + "time is up" nudge so the server advances the round promptly.
  useEffect(() => {
    const t = window.setInterval(() => {
      const left = Math.max(0, received.current.ms - (Date.now() - received.current.at));
      setRemaining(left);
      if (left === 0 && state && (state.phase === 'QUESTION' || state.phase === 'REVEAL')) void sync();
    }, 250);
    return () => window.clearInterval(t);
  }, [state, sync]);

  const join = async () => {
    try {
      apply(await gamesService.joinLive(id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const choose = async (choice: number) => {
    if (!state || state.my_answered || pending !== null || state.phase !== 'QUESTION') return;
    setPending(choice);
    try {
      apply(await gamesService.answerLive(id, state.index, choice));
    } catch (e: any) {
      setError(e.message);
      await sync(); // 409: the round moved on; show what the server says
    }
  };

  const cancel = async () => {
    try {
      await gamesService.cancelDuel(id);
      navigate('/games');
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!state) return <div className="games-page"><div className="games-muted">{error || 'Entrando na sala...'}</div></div>;

  const isCloze = state.game_type === 'CLOZE';
  const header = (
    <div className="duel-progress">
      <span>🔴 Ao vivo vs {state.opponent_name} {socketUp ? '' : '(reconectando…)'}</span>
      <span>{state.my_score} x {state.opponent_score}</span>
    </div>
  );

  if (state.phase === 'CANCELLED') {
    return (
      <div className="games-page">
        {header}
        <div className="games-card duel-result">
          <h2 style={{ justifyContent: 'center' }}>Sala cancelada</h2>
          <p className="games-muted">Este convite ao vivo foi encerrado.</p>
          <button className="games-btn" onClick={() => navigate('/games')}>Voltar à Arena</button>
        </div>
      </div>
    );
  }

  if (state.phase === 'LOBBY') {
    return (
      <div className="games-page">
        {header}
        <div className="games-card duel-result">
          {state.is_challenger ? (
            <>
              <h2 style={{ justifyContent: 'center' }}>⏳ Aguardando {state.opponent_name}…</h2>
              <p className="games-muted">Peça para entrar em Games → “Entrar” no seu convite. O jogo começa assim que ela(e) entrar.</p>
            </>
          ) : (
            <>
              <h2 style={{ justifyContent: 'center' }}>{state.opponent_name} chamou você!</h2>
              <p className="games-muted">{state.total} perguntas, {state.question_seconds}s cada. Valem acertos e velocidade.</p>
              <button className="games-btn" onClick={join}>Entrar e começar</button>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
            <button className="games-btn secondary" onClick={() => navigate('/games')}>Voltar</button>
            <button className="games-btn secondary" onClick={cancel}>Cancelar convite</button>
          </div>
          {error && <div className="games-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (state.phase === 'FINISHED') {
    return (
      <div className="games-page">
        {header}
        <div className="games-card duel-result">
          <h2 style={{ justifyContent: 'center' }}>
            {state.is_draw ? '🤝 Empate!' : state.i_won ? '🏆 Você venceu!' : 'Você perdeu desta vez'}
          </h2>
          <div className="big">{state.my_score} x {state.opponent_score}</div>
          <div className="games-muted">{state.opponent_name} fez {state.opponent_score} / {state.total}</div>
          <button className="games-btn" style={{ marginTop: 16 }} onClick={() => navigate('/games')}>Voltar à Arena</button>
        </div>
      </div>
    );
  }

  const q = state.question!;
  const reveal = state.phase === 'REVEAL' ? state.reveal : null;
  const total = state.phase === 'QUESTION' ? state.question_seconds * 1000 : state.reveal_seconds * 1000;
  const pct = Math.min(100, (remaining / total) * 100);

  return (
    <div className="games-page">
      {header}
      <div className="live-timer"><div className={`live-timer-fill ${state.phase === 'REVEAL' ? 'reveal' : ''}`} style={{ width: `${pct}%` }} /></div>
      <div className="duel-progress">
        <span>Pergunta {state.index + 1}/{state.total}</span>
        <span>
          {state.phase === 'QUESTION' ? `⏱ ${Math.ceil(remaining / 1000)}s` : 'Resultado'}
          {' · '}{state.opponent_answered ? `${state.opponent_name} respondeu` : `${state.opponent_name} pensando…`}
        </span>
      </div>
      <div className="games-card">
        <div className="games-muted" style={{ textAlign: 'center' }}>{isCloze ? 'Complete a frase:' : 'O que significa:'}</div>
        <div className={`duel-question ${isCloze ? 'cloze' : ''}`}>{q.text}</div>
        {isCloze && q.hint && <div className="games-muted" style={{ textAlign: 'center', marginBottom: 12 }}>💡 {q.hint}</div>}
        <div className="duel-options">
          {q.options.map((opt, i) => {
            const mine = (state.my_choice ?? pending) === i;
            let cls = 'duel-option';
            if (reveal) {
              if (i === reveal.correct_index) cls += ' correct';
              else if (i === reveal.my_choice) cls += ' wrong';
            } else if (mine) {
              cls += ' picked';
            }
            return (
              <button key={i} className={cls} disabled={state.my_answered || pending !== null || state.phase !== 'QUESTION'} onClick={() => choose(i)}>
                {opt}
                {reveal && i === reveal.my_choice && <span className="live-tag"> você</span>}
                {reveal && i === reveal.opponent_choice && <span className="live-tag"> {state.opponent_name}</span>}
              </button>
            );
          })}
        </div>
        {state.phase === 'QUESTION' && state.my_answered && <div className="games-muted" style={{ textAlign: 'center', marginTop: 12 }}>Resposta enviada. Aguardando {state.opponent_name}…</div>}
        {reveal && reveal.my_choice === -1 && <div className="games-error" style={{ textAlign: 'center' }}>Tempo esgotado!</div>}
        {error && <div className="games-error">{error}</div>}
      </div>
    </div>
  );
};

export default LiveDuel;
