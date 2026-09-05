import { request } from './api';

export interface TranslateResponse {
  original: string;
  translation: string;
}

export interface ExplainResponse {
  sentence: string;
  explanation: string;
  examples: string[];
}

export const aiService = {
  async translate(text: string): Promise<TranslateResponse> {
    return request<TranslateResponse>('/ai/translate', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  async explain(text: string, context?: string): Promise<ExplainResponse> {
    return request<ExplainResponse>('/ai/explain', {
      method: 'POST',
      body: JSON.stringify({ text, context }),
    });
  },
};
