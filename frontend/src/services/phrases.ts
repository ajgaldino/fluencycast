import { request } from './api';
import { SavedPhrase } from '../types/phrase';

export interface CreatePhrasePayload {
  video_id: string;
  transcript_segment_id?: string | null;
  text: string;
  translation?: string | null;
  context_sentence?: string | null;
  timestamp?: number | null;
  phrase_type?: string;
  difficulty?: string;
}

export interface UpdatePhrasePayload {
  text?: string;
  translation?: string | null;
  context_sentence?: string | null;
  difficulty?: string;
  status?: string;
}

export const phraseService = {
  async getPhrases(status?: string): Promise<SavedPhrase[]> {
    const query = status ? `?status=${status}` : '';
    return request<SavedPhrase[]>(`/phrases/${query}`);
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

