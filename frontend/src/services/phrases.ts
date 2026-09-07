import { request } from './api';
import { SavedPhrase } from '../types/phrase';

export interface CreatePhrasePayload {
  video_id?: string | null;
  transcript_segment_id?: string | null;
  text: string;
  translation?: string | null;
  context_sentence?: string | null;
  timestamp?: number | null;
  phrase_type?: string;
  difficulty?: string;
  status?: string;
}

export interface UpdatePhrasePayload {
  text?: string;
  translation?: string | null;
  context_sentence?: string | null;
  difficulty?: string;
  status?: string;
}

export const phraseService = {
  async getPhrases(status?: string, phraseType?: string): Promise<SavedPhrase[]> {
    const params = new URLSearchParams();
    if (status && status !== 'ALL') params.append('status', status);
    if (phraseType && phraseType !== 'ALL') params.append('phrase_type', phraseType);
    const qs = params.toString();
    return request<SavedPhrase[]>(`/phrases/${qs ? `?${qs}` : ''}`);
  },

  async savePhrase(data: CreatePhrasePayload): Promise<SavedPhrase> {
    return request<SavedPhrase>('/phrases/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePhrase(id: string, data: UpdatePhrasePayload): Promise<SavedPhrase> {
    return request<SavedPhrase>(`/phrases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async extractWords(videoId?: string): Promise<SavedPhrase[]> {
    const query = videoId ? `?video_id=${videoId}` : '';
    return request<SavedPhrase[]>(`/phrases/extract-words${query}`, {
      method: 'POST',
    });
  },

  async deletePhrase(id: string): Promise<void> {
    return request<void>(`/phrases/${id}`, {
      method: 'DELETE',
    });
  },
};

