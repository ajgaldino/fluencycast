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
  async getSummary(videoId?: string): Promise<ReviewSummary> {
    const params = new URLSearchParams();
    if (videoId && videoId !== 'ALL') params.append('video_id', videoId);
    const qs = params.toString();
    return request<ReviewSummary>(`/reviews/summary${qs ? `?${qs}` : ''}`);
  },

  async getTodayReviews(phraseType?: string, allCards?: boolean, videoId?: string): Promise<SavedPhrase[]> {
    const params = new URLSearchParams();
    if (phraseType && phraseType !== 'ALL') params.append('phrase_type', phraseType);
    if (allCards) params.append('all_cards', 'true');
    if (videoId && videoId !== 'ALL') params.append('video_id', videoId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<SavedPhrase[]>(`/reviews/today${query}`);
  },

  async submitReview(phraseId: string, quality: number): Promise<SubmitReviewResponse> {
    return request<SubmitReviewResponse>(`/reviews/${phraseId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ quality }),
    });
  },
};

