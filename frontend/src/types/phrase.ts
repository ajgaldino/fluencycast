export interface SavedPhrase {
  id: string;
  user_id: string;
  video_id: string;
  transcript_segment_id?: string | null;
  text: string;
  translation?: string | null;
  context_sentence?: string | null;
  timestamp?: number | null;
  phrase_type: "WORD" | "EXPRESSION" | "PHRASAL_VERB" | "SENTENCE";
  difficulty: "EASY" | "NORMAL" | "HARD" | "STRUGGLE";
  status: "NEW" | "LEARNING" | "REVIEW" | "MASTERED";
  repetitions: number;
  ease_factor: number;
  interval_days: number;
  next_review_at: string;
  last_reviewed_at?: string | null;
  created_at: string;
}

export interface ReviewSummary {
  due_phrases_count: number;
  mastered_count: number;
  learning_count: number;
  streak_days: number;
  reviewed_today_count: number;
}
