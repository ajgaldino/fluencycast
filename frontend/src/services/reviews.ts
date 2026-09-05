import { request } from './api';
import { SavedPhrase, ReviewSummary } from '../types/phrase';

export interface SubmitReviewResponse {
  id: string;
  saved_phrase_id: string;
  quality: number;
  interval_days: number;
  ease_factor: number;
  reviewed_at: string;
}

export const reviewService = {
  async getSummary(): Promise<ReviewSummary> {
    return request<ReviewSummary>('/reviews/summary');
  },

  async getTodayReviews(): Promise<SavedPhrase[]> {
    return request<SavedPhrase[]>('/reviews/today');
  },

  async submitReview(phraseId: string, quality: number): Promise<SubmitReviewResponse> {
    return request<SubmitReviewResponse>(`/reviews/${phraseId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ quality }),
    });
  },
};
