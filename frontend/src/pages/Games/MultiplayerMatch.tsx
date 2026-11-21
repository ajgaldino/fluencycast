import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { gamesService, matchSocketUrl, MatchView } from '../../services/games';
import { usePolling } from '../../hooks/usePolling';
import './Games.css';

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const HangmanSvg: React.FC<{ errors: number }> = ({ errors }) => (
  <svg viewBox="0 0 140 140" className="hangman-svg">
    <line x1="15" y1="130" x2="105" y2="130" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <line x1="35" y1="130" x2="35" y2="15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <line x1="35" y1="15" x2="90" y2="15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <line x1="90" y1="15" x2="90" y2="30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    {errors >= 1 && <circle cx="90" cy="42" r="12" stroke="#f43f5e" strokeWidth="3.5" fill="none" />}
    {errors >= 2 && <line x1="90" y1="54" x2="90" y2="90" stroke="#f43f5e" strokeWidth="3.5" strokeLinecap="round" />}
    {errors >= 3 && <line x1="90" y1="64" x2="72" y2="78" stroke="#f43f5e" strokeWidth="3.5" strokeLinecap="round" />}
    {errors >= 4 && <line x1="90" y1="64" x2="108" y2="78" stroke="#f43f5e" strokeWidth="3.5" strokeLinecap="round" />}
    {errors >= 5 && <line x1="90" y1="90" x2="75" y2="112" stroke="#f43f5e" strokeWidth="3.5" strokeLinecap="round" />}
    {errors >= 6 && <line x1="90" y1="90" x2="105" y2="112" stroke="#f43f5e" strokeWidth="3.5" strokeLinecap="round" />}
  </svg>
);

export const MultiplayerMatch: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [socketUp, setSocketUp] = useState(false);
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setMatch(await gamesService.getMatch(id));
      setError('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  useEffect(() => {
    void sync();
  }, [sync]);

  usePolling(sync, 2000, match?.status === 'ACTIVE');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let ping: number | undefined;
    let retry: number | undefined;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(matchSocketUrl(id));
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

  const sendLetter = useCallback(
    async (letter: string) => {
      if (!match || match.status !== 'ACTIVE' || match.game_type !== 'HANGMAN' || busy) return;
      if (match.hangman?.my_status !== 'PLAYING' || match.hangman.my_guessed.includes(letter)) return;
      setBusy(true);
      try {
        setMatch(await gamesService.hangmanMove(id, letter));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [match, busy, id]
  );

  // Physical keyboard support for Hangman
  useEffect(() => {
    if (match?.game_type !== 'HANGMAN' || match.status !== 'ACTIVE') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) void sendLetter(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [match, sendLetter]);

  const sendScramble = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guess.trim() || busy) return;
    setBusy(true);
    setFeedback('');
    try {
      const res = await gamesService.scrambleMove(id, guess.trim());
      setMatch(res);
      setGuess('');
      if (!res.hit) setFeedback('❌ Ainda não é essa!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const leaveMatch = async () => {
    try {
      await gamesService.cancelMatch(id);
    } catch {
      // ignore
    }
    navigate('/games');
  };

  if (!match) return <div className="games-page"><div className="games-muted">{error || 'Carregando partida...'}</div></div>;

  if (match.status === 'CANCELLED') {
    return (
      <div className="games-page">
        <div className="games-card duel-result">
          <h2 style={{ justifyContent: 'center' }}>Partida encerrada</h2>
          <p className="games-muted">Um dos jogadores saiu da sala.</p>
          <button className="games-btn" onClick={() => navigate('/games')}>Voltar à Arena</button>
        </div>
      </div>
    );
  }

  const finished = match.status === 'FINISHED';

  return (
    <div className="games-page">
      <div className="duel-progress">
        <span>
          {match.game_type === 'HANGMAN' ? '🪢 Jogo da Forca' : '🔤 Batalha de Anagrama'} vs {match.opponent_name}
          {!finished && !socketUp && ' (reconectando…)'}
        </span>
        {match.status === 'ACTIVE' && (
          <button className="games-btn secondary" style={{ padding: '4px 10px', fontSize: '0.78rem' }} onClick={leaveMatch}>
            Sair
          </button>
        )}
      </div>

      {match.game_type === 'HANGMAN' && match.hangman && (
        <div className="games-card">
          <div className="mp-opp-bar">
            <span>
              {match.opponent_name}: {match.hangman.opp_revealed_count}/{match.hangman.length} letras
            </span>
            <span>
              {'❤️'.repeat(Math.max(0, match.hangman.max_errors - match.hangman.opp_wrong))}
              {'🖤'.repeat(match.hangman.opp_wrong)}
            </span>
          </div>

          <HangmanSvg errors={match.hangman.my_wrong} />

          <div className="games-muted" style={{ textAlign: 'center', marginBottom: 8 }}>
            💡 Dica: <strong>{match.hangman.hint}</strong>
          </div>

          <div className="hangman-word">
            {match.hangman.my_mask.map((ch, i) => (
              <span key={i} className={`hangman-letter ${ch !== '_' ? 'revealed' : ''}`}>
                {ch === '_' ? '' : ch}
              </span>
            ))}
          </div>

          {finished ? (
            <div className="duel-result" style={{ marginTop: 16 }}>
              <h3>{match.is_draw ? '🤝 Empate!' : match.i_won ? '🏆 Você venceu!' : `😅 ${match.opponent_name} venceu!`}</h3>
              <p className="games-muted">Palavra: <strong style={{ textTransform: 'uppercase' }}>{match.hangman.word}</strong></p>
              <button className="games-btn" onClick={() => navigate('/games')}>Voltar à Arena</button>
            </div>
          ) : match.hangman.my_status === 'LOST' ? (
            <div className="duel-result" style={{ marginTop: 16 }}>
              <div className="games-error">💀 Você perdeu todas as vidas! Aguardando {match.opponent_name}…</div>
            </div>
          ) : (
            <div className="wordle-keyboard">
              {KEY_ROWS.map((row, ri) => (
                <div className="wordle-krow" key={ri}>
                  {row.split('').map((k) => {
                    const used = match.hangman!.my_guessed.includes(k);
                    const inWord = used && match.hangman!.my_mask.includes(k);
                    const cls = used ? (inWord ? 'correct' : 'absent') : '';
                    return (
                      <button key={k} className={`wordle-key ${cls}`} disabled={used || busy} onClick={() => sendLetter(k)}>
                        {k}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {match.game_type === 'SCRAMBLE' && match.scramble && (
        <div className="games-card">
          <div className="mp-opp-bar">
            <span>Rodada {match.scramble.round_index + 1}/{match.scramble.total_rounds}</span>
            <span>Você {match.scramble.my_score} x {match.scramble.opp_score} {match.opponent_name}</span>
          </div>

          {match.scramble.last_word && !finished && (
            <div className="games-muted" style={{ textAlign: 'center', marginBottom: 8 }}>
              Rodada anterior: <strong>{match.scramble.last_word}</strong>
            </div>
          )}

          {finished ? (
            <div className="duel-result" style={{ marginTop: 12 }}>
              <h2>{match.is_draw ? '🤝 Empate!' : match.i_won ? '🏆 Você venceu!' : `😅 ${match.opponent_name} venceu!`}</h2>
              <div className="big">{match.scramble.my_score} x {match.scramble.opp_score}</div>
              <button className="games-btn" style={{ marginTop: 12 }} onClick={() => navigate('/games')}>Voltar à Arena</button>
            </div>
          ) : (
            <>
              <div className="games-muted" style={{ textAlign: 'center', marginTop: 8 }}>
                💡 Dica: <strong>{match.scramble.hint}</strong> ({match.scramble.word_length} letras)
              </div>
              <div className="scramble-tiles">
                {match.scramble.scrambled.split('').map((ch, i) => (
                  <span key={i} className="scramble-tile">{ch}</span>
                ))}
              </div>
              <form onSubmit={sendScramble} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <input
                  className="games-select"
                  placeholder="Digite a palavra em inglês..."
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  autoFocus
                />
                <button className="games-btn" type="submit" disabled={busy || !guess.trim()}>
                  Enviar
                </button>
              </form>
              {feedback && <div className="games-error" style={{ textAlign: 'center' }}>{feedback}</div>}
            </>
          )}
        </div>
      )}

      {error && <div className="games-error">{error}</div>}
    </div>
  );
};

export default MultiplayerMatch;
