import { request, API_BASE_URL } from './api';

export type GameType = 'VOCAB' | 'CLOZE';

export interface CoupleStreak {
  days: number;
  partner_name: string | null;
  today_done: boolean;
}

export interface GameStats {
  user_id: string;
  name: string;
  xp: number;
  level: number;
  level_floor_xp: number;
  next_level_xp: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  streak_days: number;
  couple_streak?: CoupleStreak;
}

export interface LeaderboardRow extends GameStats {
  rank: number;
  is_me: boolean;
}

export interface Player {
  id: string;
  name: string;
}

export interface DuelSummary {
  id: string;
  status: 'ACTIVE' | 'FINISHED';
  game_type: GameType;
  mode: 'ASYNC' | 'LIVE';
  live_phase: 'LOBBY' | 'QUESTION' | 'REVEAL' | null;
  opponent_id: string;
  opponent_name: string;
  total_questions: number;
  my_answered: number;
  opponent_answered: number;
  my_turn_pending: boolean;
  my_score: number;
  opponent_score: number | null;
  winner_id: string | null;
  i_won: boolean;
  is_draw: boolean;
  created_at: string | null;
}

export interface DuelDetail extends DuelSummary {
  questions: { text: string; options: string[]; hint?: string | null }[];
  my_answers: { choice: number; correct: boolean; correct_index: number }[];
}

export interface AnswerResult {
  correct: boolean;
  correct_index: number;
  finished_me: boolean;
  already_answered: boolean;
  duel: DuelSummary;
}

export interface Achievement {
  code: string;
  icon: string;
  name: string;
  description: string;
  unlocked: boolean;
  seen: boolean;
  unlocked_at: string | null;
}

export type LetterResult = 'correct' | 'present' | 'absent';

export interface WordleState {
  day: string;
  status: 'IN_PROGRESS' | 'WON' | 'LOST';
  max_guesses: number;
  word_length: number;
  guesses: { word: string; result: LetterResult[] }[];
  answer: string | null;
  others: { name: string; played: boolean; finished: boolean; won?: boolean; attempts?: number }[];
  new_achievements?: string[];
}

export const gamesService = {
  getStats: () => request<GameStats>('/games/stats'),
  getLeaderboard: () => request<LeaderboardRow[]>('/games/leaderboard'),
  getPlayers: () => request<Player[]>('/games/players'),
  listDuels: () => request<DuelSummary[]>('/games/duels'),
  getDuel: (id: string) => request<DuelDetail>(`/games/duels/${id}`),
  createDuel: (opponent_id: string, game_type: GameType = 'VOCAB', num_questions = 10, mode: 'ASYNC' | 'LIVE' = 'ASYNC') =>
    request<DuelSummary>('/games/duels', {
      method: 'POST',
      body: JSON.stringify({ opponent_id, num_questions, game_type, mode }),
    }),
  getLive: (id: string) => request<LiveState>(`/games/duels/${id}/live`),
  joinLive: (id: string) => request<LiveState>(`/games/duels/${id}/live/join`, { method: 'POST' }),
  answerLive: (id: string, question_index: number, choice: number) =>
    request<LiveState>(`/games/duels/${id}/live/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_index, choice }),
    }),
  answer: (id: string, question_index: number, choice: number, time_ms: number) =>
    request<AnswerResult>(`/games/duels/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_index, choice, time_ms }),
    }),
  getAchievements: () => request<Achievement[]>('/games/achievements'),
  markAchievementsSeen: () => request<{ ok: boolean }>('/games/achievements/seen', { method: 'POST' }),
  getWordle: () => request<WordleState>('/games/wordle/today'),
  guessWordle: (guess: string, expected_attempt: number) =>
    request<WordleState>('/games/wordle/guess', {
      method: 'POST',
      body: JSON.stringify({ guess, expected_attempt }),
    }),
  cancelDuel: (id: string) => request<{ ok: boolean }>(`/games/duels/${id}`, { method: 'DELETE' }),
  getPendingCount: () => request<PendingCount>('/games/pending-count'),
  getWeekly: () => request<WeeklyData>('/games/weekly'),
  updateWeeklyBet: (stake: string) =>
    request<WeeklyData>('/games/weekly/bet', {
      method: 'PUT',
      body: JSON.stringify({ stake }),
    }),
  getQueueStatus: () => request<QueueStatus>('/games/queue/status'),
  joinQueue: (game_type: MpGameType) =>
    request<{ matched: boolean; match_id: string | null; game_type: MpGameType }>('/games/queue/join', {
      method: 'POST',
      body: JSON.stringify({ game_type }),
    }),
  leaveQueue: () => request<{ ok: boolean }>('/games/queue/leave', { method: 'POST' }),
  getMatch: (id: string) => request<MatchView>(`/games/matches/${id}`),
  hangmanMove: (id: string, letter: string) =>
    request<MatchView>(`/games/matches/${id}/hangman`, {
      method: 'POST',
      body: JSON.stringify({ letter }),
    }),
  scrambleMove: (id: string, guess: string) =>
    request<MatchView>(`/games/matches/${id}/scramble`, {
      method: 'POST',
      body: JSON.stringify({ guess }),
    }),
  cancelMatch: (id: string) => request<{ ok: boolean }>(`/games/matches/${id}/cancel`, { method: 'POST' }),
};

export type MpGameType = 'HANGMAN' | 'SCRAMBLE';

export interface QueueStatus {
  my_status: 'IDLE' | 'WAITING' | 'MATCHED';
  my_game_type: MpGameType | null;
  match_id: string | null;
  waiting_by_game: Record<string, number>;
}

export interface MatchView {
  id: string;
  game_type: MpGameType;
  status: 'ACTIVE' | 'FINISHED' | 'CANCELLED';
  opponent_name: string;
  is_p1: boolean;
  winner_id: string | null;
  i_won: boolean;
  is_draw: boolean;
  hit?: boolean;
  hangman?: {
    length: number;
    hint: string;
    max_errors: number;
    my_mask: string[];
    opp_mask: string[];
    opp_revealed_count: number;
    my_guessed: string[];
    my_wrong: number;
    opp_wrong: number;
    my_status: 'PLAYING' | 'WON' | 'LOST';
    opp_status: 'PLAYING' | 'WON' | 'LOST';
    word: string | null;
  };
  scramble?: {
    round_index: number;
    total_rounds: number;
    scrambled: string;
    hint: string;
    word_length: number;
    my_score: number;
    opp_score: number;
    last_word: string | null;
  };
}

export function queueSocketUrl(): string {
  const token = encodeURIComponent(localStorage.getItem('fluency_token') || '');
  const base = /^https?:/.test(API_BASE_URL)
    ? API_BASE_URL.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_BASE_URL}`;
  return `${base}/games/ws/queue?token=${token}`;
}

export function matchSocketUrl(matchId: string): string {
  const token = encodeURIComponent(localStorage.getItem('fluency_token') || '');
  const base = /^https?:/.test(API_BASE_URL)
    ? API_BASE_URL.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_BASE_URL}`;
  return `${base}/games/ws/matches/${matchId}?token=${token}`;
}

export interface PendingCount {
  count: number;
  live_invites: number;
  my_turn_duels: number;
  unseen_achievements: number;
}

export interface WeeklyRow {
  rank: number;
  user_id: string;
  name: string;
  weekly_xp: number;
  weekly_wins: number;
  is_me: boolean;
}

export interface WeeklyData {
  week_key: string;
  stake: string;
  stake_updated_by_name: string | null;
  rows: WeeklyRow[];
  last_week_winner: { name: string; xp: number; wins: number; stake: string } | null;
}

export interface LiveState {
  id: string;
  mode: 'LIVE';
  game_type: GameType;
  phase: 'LOBBY' | 'QUESTION' | 'REVEAL' | 'FINISHED' | 'CANCELLED';
  index: number;
  total: number;
  is_challenger: boolean;
  opponent_name: string;
  question_seconds: number;
  reveal_seconds: number;
  my_score: number;
  opponent_score: number;
  remaining_ms: number;
  question: { text: string; options: string[]; hint?: string | null } | null;
  my_answered: boolean;
  opponent_answered: boolean;
  my_choice: number | null;
  reveal: { correct_index: number; my_choice: number; opponent_choice: number } | null;
  winner_id: string | null;
  i_won: boolean;
  is_draw: boolean;
}

/** ws(s):// URL of the live room. Works with a full API URL (Render) or a same-origin proxy. */
export function liveSocketUrl(duelId: string): string {
  const token = encodeURIComponent(localStorage.getItem('fluency_token') || '');
  const base = /^https?:/.test(API_BASE_URL)
    ? API_BASE_URL.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_BASE_URL}`;
  return `${base}/games/ws/duels/${duelId}?token=${token}`;
}