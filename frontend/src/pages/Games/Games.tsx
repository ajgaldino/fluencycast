import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Trophy, Flame, Type, Award, Calendar, X, Users } from 'lucide-react';
import {
  gamesService, GameStats, LeaderboardRow, Player, DuelSummary, GameType, Achievement, WordleState, WeeklyData, QueueStatus, MpGameType, queueSocketUrl,
} from '../../services/games';
import { usePolling } from '../../hooks/usePolling';
import './Games.css';

const TYPE_LABEL: Record<GameType, string> = { VOCAB: 'Vocabulário', CLOZE: 'Complete a Frase' };

export const Games: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<GameStats | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [duels, setDuels] = useState<DuelSummary[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [wordle, setWordle] = useState<WordleState | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [betInput, setBetInput] = useState('');
  const [betEditing, setBetEditing] = useState(false);
  const [savingBet, setSavingBet] = useState(false);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [mpGame, setMpGame] = useState<MpGameType>('HANGMAN');
  const [queueBusy, setQueueBusy] = useState(false);
  const [opponent, setOpponent] = useState('');
  const [gameType, setGameType] = useState<GameType>('VOCAB');
  const [live, setLive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<Achievement[]>([]);

  const load = useCallback(async () => {
    try {
      const [s, b, p, d, a, w, wk, q] = await Promise.all([
        gamesService.getStats(),
        gamesService.getLeaderboard(),
        gamesService.getPlayers(),
        gamesService.listDuels(),
        gamesService.getAchievements(),
        gamesService.getWordle(),
        gamesService.getWeekly(),
        gamesService.getQueueStatus(),
      ]);
      setStats(s);
      setBoard(b);
      setPlayers(p);
      setDuels(d);
      setAchievements(a);
      setWordle(w);
      setWeekly(wk);
      setQueue(q);
      if (q.match_id && q.my_status === 'MATCHED') {
        navigate(`/games/match/${q.match_id}`);
      }
      setBetInput((cur) => (betEditing ? cur : wk.stake));
      setOpponent((cur) => cur || p[0]?.id || '');

      // Unseen state lives on the server, so a badge unlocked on one device
      // is celebrated once, on whichever device opens the Arena first.
      const fresh = a.filter((x) => x.unlocked && !x.seen);
      if (fresh.length) {
        setToast(fresh);
        gamesService.markAchievementsSeen().catch(() => undefined);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  usePolling(load, queue?.my_status === 'WAITING' ? 2000 : 8000);

  // Instant match notification when waiting in queue
  useEffect(() => {
    if (queue?.my_status !== 'WAITING') return;
    const ws = new WebSocket(queueSocketUrl());
    ws.onmessage = () => void load();
    return () => ws.close();
  }, [queue?.my_status, load]);

  const enterQueue = async () => {
    setQueueBusy(true);
    setError('');
    try {
      const res = await gamesService.joinQueue(mpGame);
      if (res.matched && res.match_id) {
        navigate(`/games/match/${res.match_id}`);
      } else {
        await load();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setQueueBusy(false);
    }
  };

  const exitQueue = async () => {
    setQueueBusy(true);
    try {
      await gamesService.leaveQueue();
      await load();
    } finally {
      setQueueBusy(false);
    }
  };

  const startDuel = async () => {
    if (!opponent) return;
    setCreating(true);
    setError('');
    try {
      const duel = await gamesService.createDuel(opponent, gameType, 10, live ? 'LIVE' : 'ASYNC');
      navigate(live ? `/games/live/${duel.id}` : `/games/duel/${duel.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const saveBet = async () => {
    setSavingBet(true);
    setError('');
    try {
      const updated = await gamesService.updateWeeklyBet(betInput);
      setWeekly(updated);
      setBetEditing(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingBet(false);
    }
  };

  const cancelDuel = async (duelId: string) => {
    try {
      await gamesService.cancelDuel(duelId);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const span = stats ? Math.max(stats.next_level_xp - stats.level_floor_xp, 1) : 1;
  const pct = stats ? Math.min(100, ((stats.xp - stats.level_floor_xp) / span) * 100) : 0;

  const statusLabel = (d: DuelSummary) => {
    if (d.status === 'FINISHED') {
      if (d.is_draw) return <span>🤝 Empate ({d.my_score} x {d.opponent_score})</span>;
      return d.i_won
        ? <span className="games-badge-win">🏆 Vitória ({d.my_score} x {d.opponent_score})</span>
        : <span className="games-badge-lose">Derrota ({d.my_score} x {d.opponent_score})</span>;
    }
    if (d.mode === 'LIVE') return <span className="games-badge-win">🔴 Sala ao vivo aberta</span>;
    return d.my_turn_pending
      ? <span className="games-badge-win">Sua vez!</span>
      : <span className="games-muted">Aguardando {d.opponent_name}</span>;
  };

  const wordleLabel = () => {
    if (!wordle) return '';
    if (wordle.status === 'WON') return `✅ Acertou em ${wordle.guesses.length}/${wordle.max_guesses}`;
    if (wordle.status === 'LOST') return `❌ Era "${wordle.answer}"`;
    return wordle.guesses.length ? `Em andamento: ${wordle.guesses.length}/${wordle.max_guesses}` : 'Ainda não jogou hoje';
  };

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const couple = stats?.couple_streak;

  return (
    <div className="games-page">
      <h1 style={{ margin: 0 }}>🎮 Arena</h1>

      {toast.length > 0 && (
        <div className="games-card games-toast" onClick={() => setToast([])}>
          <strong>🎉 Nova conquista!</strong>
          {toast.map((a) => (
            <div key={a.code}>{a.icon} {a.name} — <span className="games-muted">{a.description}</span></div>
          ))}
          <div className="games-muted" style={{ marginTop: 4 }}>toque para fechar</div>
        </div>
      )}

      {stats && (
        <div className="games-card games-hero">
          <div className="games-hero-top">
            <div>
              <div className="games-level-pill">Nível {stats.level}</div>
              <div className="games-xp-big">{stats.xp} <span>XP</span></div>
            </div>
            <div className="games-streak-box">
              <Flame size={20} color="#f59e0b" />
              <div>
                <strong>{stats.streak_days}d</strong>
                <div className="games-muted" style={{ fontSize: '0.72rem' }}>sequência</div>
              </div>
            </div>
          </div>
          <div className="games-xp-bar"><div className="games-xp-fill" style={{ width: `${pct}%` }} /></div>
          <div className="games-muted">{stats.next_level_xp - stats.xp} XP para o nível {stats.level + 1}</div>
          <div className="games-stats-row">
            <span className="games-chip">🏆 {stats.wins} vitórias</span>
            <span className="games-chip">💀 {stats.losses} derrotas</span>
            <span className="games-chip">🤝 {stats.draws} empates</span>
          </div>
          {couple && couple.partner_name && couple.days > 0 && (
            <div className="games-couple">
              💞 Streak do casal com {couple.partner_name}: <strong>{couple.days} dia{couple.days > 1 ? 's' : ''}</strong>
              {!couple.today_done && <span className="games-muted"> · falta hoje para manter!</span>}
            </div>
          )}
        </div>
      )}

      <div className="games-card games-mp-card">
        <h2><Users size={18} /> Multiplayer Online (Fila de Match)</h2>
        <p className="games-muted" style={{ marginTop: 0 }}>
          Entre na fila e espere o outro jogador entrar para dar match automático! Palavras do seu vocabulário + repertório geral.
        </p>
        {queue?.match_id && queue.my_status !== 'WAITING' && (
          <div className="games-couple" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🎮 Você tem uma partida em andamento!</span>
            <button className="games-btn" onClick={() => navigate(`/games/match/${queue.match_id}`)}>Voltar à sala</button>
          </div>
        )}
        {queue?.my_status === 'WAITING' ? (
          <div className="queue-waiting">
            <div className="queue-pulse">⏳ Procurando oponente na fila ({queue.my_game_type === 'HANGMAN' ? 'Jogo da Forca MD5' : 'Anagrama MD5'})…</div>
            <button className="games-btn secondary" onClick={exitQueue} disabled={queueBusy}>Sair da fila</button>
          </div>
        ) : (
          <>
            <div className="games-tabs">
              <button className={`games-tab ${mpGame === 'HANGMAN' ? 'active' : ''}`} onClick={() => setMpGame('HANGMAN')}>
                🪢 Forca MD5 {(queue?.waiting_by_game?.HANGMAN || 0) > 0 && <span className="queue-dot">1 na fila!</span>}
              </button>
              <button className={`games-tab ${mpGame === 'SCRAMBLE' ? 'active' : ''}`} onClick={() => setMpGame('SCRAMBLE')}>
                🔤 Anagrama {(queue?.waiting_by_game?.SCRAMBLE || 0) > 0 && <span className="queue-dot">1 na fila!</span>}
              </button>
            </div>
            <button className="games-btn" style={{ width: '100%' }} onClick={enterQueue} disabled={queueBusy}>
              {queueBusy ? 'Entrando...' : (queue?.waiting_by_game?.[mpGame] || 0) > 0 ? '⚡ Dar Match Agora!' : 'Entrar na Fila'}
            </button>
          </>
        )}
      </div>

      <div className="games-card">
        <h2><Type size={18} /> Palavra do Dia</h2>
        <p className="games-muted" style={{ marginTop: 0 }}>
          Mesma palavra para todos, 6 tentativas. Seu jogo fica salvo no servidor: comece no celular e continue em qualquer aparelho.
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{wordleLabel()}</span>
          <button className="games-btn" onClick={() => navigate('/games/wordle')}>
            {wordle?.status === 'IN_PROGRESS' ? 'Jogar' : 'Ver'}
          </button>
        </div>
        {wordle?.others.map((o) => (
          <div key={o.name} className="games-muted" style={{ marginTop: 6 }}>
            {o.name}: {o.finished
              ? (wordle.status === 'IN_PROGRESS' ? 'já terminou (termine para ver)' : o.won ? `acertou em ${o.attempts}` : 'não acertou')
              : o.played ? 'jogando...' : 'ainda não jogou'}
          </div>
        ))}
      </div>

      <div className="games-card">
        <h2><Swords size={18} /> Duelos</h2>
        <p className="games-muted" style={{ marginTop: 0 }}>
          10 perguntas com as palavras e frases que vocês salvaram. Cada um joga no seu tempo, em qualquer aparelho;
          o placar é revelado quando os dois terminam.
        </p>
        {players.length === 0 ? (
          <div className="games-muted">Nenhum outro jogador cadastrado ainda. Crie a conta da sua esposa para começar!</div>
        ) : (
          <>
            <div className="games-tabs">
              {(Object.keys(TYPE_LABEL) as GameType[]).map((t) => (
                <button key={t} className={`games-tab ${gameType === t ? 'active' : ''}`} onClick={() => setGameType(t)}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <label className="games-live-toggle">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              🔴 Ao vivo (os dois online agora, 15s por pergunta)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="games-select" value={opponent} onChange={(e) => setOpponent(e.target.value)}>
                {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="games-btn" onClick={startDuel} disabled={creating || !opponent}>
                {creating ? '...' : live ? 'Chamar' : 'Desafiar'}
              </button>
            </div>
          </>
        )}
        {error && <div className="games-error">{error}</div>}
      </div>

      <div className="games-card">
        <h2>Meus duelos</h2>
        {duels.length === 0 && <div className="games-muted">Nenhum duelo ainda.</div>}
        {duels.map((d) => (
          <div className="games-row" key={d.id}>
            <div>
              <div>vs {d.opponent_name} <span className="games-muted">· {TYPE_LABEL[d.game_type]}</span></div>
              <div style={{ fontSize: '0.85rem' }}>{statusLabel(d)}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {d.mode === 'LIVE' && d.status === 'ACTIVE' && (
                <button
                  className="games-btn secondary"
                  style={{ padding: '10px' }}
                  title="Cancelar convite"
                  onClick={() => cancelDuel(d.id)}
                >
                  <X size={16} />
                </button>
              )}
              <button
                className={`games-btn ${d.my_turn_pending ? '' : 'secondary'}`}
                onClick={() => navigate(d.mode === 'LIVE' && d.status === 'ACTIVE' ? `/games/live/${d.id}` : `/games/duel/${d.id}`)}
              >
                {d.mode === 'LIVE' && d.status === 'ACTIVE' ? 'Entrar' : d.my_turn_pending ? (d.my_answered > 0 ? 'Continuar' : 'Jogar') : 'Ver'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="games-card">
        <h2><Award size={18} /> Conquistas ({unlockedCount}/{achievements.length})</h2>
        <div className="games-badges">
          {achievements.map((a) => (
            <div key={a.code} className={`games-achv ${a.unlocked ? '' : 'locked'}`} title={a.description}>
              <div style={{ fontSize: '1.6rem' }}>{a.unlocked ? a.icon : '🔒'}</div>
              <div style={{ fontSize: '0.7rem' }}>{a.name}</div>
            </div>
          ))}
        </div>
      </div>

      {weekly && (
        <div className="games-card">
          <h2><Calendar size={18} /> Placar da Semana</h2>
          <div className="games-bet-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span className="games-muted">🎯 Aposta da semana:</span>
              {!betEditing && (
                <button
                  className="games-btn secondary"
                  style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                  onClick={() => { setBetInput(weekly.stake); setBetEditing(true); }}
                >
                  {weekly.stake ? 'Editar' : 'Definir'}
                </button>
              )}
            </div>
            {betEditing ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  className="games-select"
                  placeholder="Ex: Quem perder faz o jantar"
                  maxLength={120}
                  value={betInput}
                  onChange={(e) => setBetInput(e.target.value)}
                />
                <button className="games-btn" onClick={saveBet} disabled={savingBet}>
                  {savingBet ? '...' : 'Salvar'}
                </button>
                <button className="games-btn secondary" onClick={() => setBetEditing(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 4, fontWeight: 600 }}>
                {weekly.stake || <span className="games-muted">Nenhuma aposta combinada ainda.</span>}
                {weekly.stake && weekly.stake_updated_by_name && (
                  <span className="games-muted" style={{ fontWeight: 400 }}> · por {weekly.stake_updated_by_name}</span>
                )}
              </div>
            )}
          </div>

          {weekly.rows.map((r) => (
            <div className={`games-row ${r.is_me ? 'me' : ''}`} key={r.user_id}>
              <span>#{r.rank} {r.name} {r.is_me && '(você)'}</span>
              <span>{r.weekly_xp} XP · {r.weekly_wins}V</span>
            </div>
          ))}

          {weekly.last_week_winner && (
            <div className="games-muted" style={{ marginTop: 8 }}>
              🏅 Semana passada: <strong>{weekly.last_week_winner.name}</strong> ({weekly.last_week_winner.xp} XP)
              {weekly.last_week_winner.stake ? ` — "${weekly.last_week_winner.stake}"` : ''}
            </div>
          )}
        </div>
      )}

      <div className="games-card">
        <h2><Trophy size={18} /> Ranking Geral</h2>
        {board.map((r) => (
          <div className={`games-row ${r.is_me ? 'me' : ''}`} key={r.user_id}>
            <span>#{r.rank} {r.name} {r.is_me && '(você)'}</span>
            <span>Nv {r.level} · {r.xp} XP</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Games;
