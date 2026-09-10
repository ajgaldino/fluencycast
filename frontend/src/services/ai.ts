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

export interface ExampleResponse {
  original: string;
  example: string;
  translation?: string;
}

export const aiService = {
  async generateExample(text: string): Promise<ExampleResponse> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { original: '', example: '' };
    }

    // 1. Try Backend Example Endpoint
    try {
      const res = await request<ExampleResponse>('/ai/example', {
        method: 'POST',
        body: JSON.stringify({ text: trimmed }),
      });
      if (res && res.example && res.example.trim()) {
        return res;
      }
    } catch (err) {
      console.warn('Backend example generation failed, falling back to client-side:', err);
    }

    // 2. Direct client-side Google Dictionary Chrome API
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=pt&dt=ex&dt=md&q=${encodeURIComponent(trimmed)}`;
      const gRes = await fetch(gUrl);
      if (gRes.ok) {
        const data = await gRes.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            if (Array.isArray(item)) {
              for (const sub of item) {
                if (Array.isArray(sub) && sub.length > 1 && Array.isArray(sub[1])) {
                  for (const defItem of sub[1]) {
                    if (Array.isArray(defItem) && defItem.length > 2 && typeof defItem[2] === 'string') {
                      const candidate = defItem[2].trim();
                      if (candidate && candidate.length > 10) {
                        const formatted = candidate.charAt(0).toUpperCase() + candidate.slice(1) + (/[.!?]$/.test(candidate) ? '' : '.');
                        return { original: trimmed, example: formatted };
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Client example fallback 1 failed:', err);
    }

    // 3. Direct client-side Tatoeba API
    try {
      const tUrl = `https://tatoeba.org/en/api_v0/search?from=eng&query=${encodeURIComponent(trimmed)}`;
      const tRes = await fetch(tUrl);
      if (tRes.ok) {
        const tData = await tRes.json();
        const results = tData?.results;
        if (Array.isArray(results)) {
          for (const r of results) {
            const txt = r?.text?.trim();
            if (txt && txt.toLowerCase().includes(trimmed.toLowerCase()) && txt.length >= 12) {
              return { original: trimmed, example: txt };
            }
          }
        }
      }
    } catch (err) {
      console.warn('Client example fallback 2 failed:', err);
    }

    // 4. Smart conversational fallback
    const fallbackSentence = trimmed.includes(' ')
      ? `Native speakers frequently use "${trimmed}" in casual conversations.`
      : `You can practice using "${trimmed}" in sentences to sound more natural.`;

    return { original: trimmed, example: fallbackSentence };
  },
  async translate(text: string): Promise<TranslateResponse> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { original: '', translation: '' };
    }

    // 1. Try Backend Translation Endpoint
    try {
      const res = await request<TranslateResponse>('/ai/translate', {
        method: 'POST',
        body: JSON.stringify({ text: trimmed }),
      });

      if (res && res.translation && res.translation.trim().toLowerCase() !== trimmed.toLowerCase()) {
        return res;
      }
    } catch (err) {
      console.warn('Backend translation failed, falling back to client-side translation:', err);
    }

    // 2. Client-side Direct Fallback (runs from user Brazilian IP, bypasses server IP restrictions)
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=en|pt-BR`;
      const directRes = await fetch(url);
      if (directRes.ok) {
        const data = await directRes.json();
        const translated = data?.responseData?.translatedText;
        if (translated && translated.trim().toLowerCase() !== trimmed.toLowerCase()) {
          return { original: trimmed, translation: translated };
        }
      }
    } catch (err) {
      console.warn('Client fallback 1 failed:', err);
    }

    // 3. Client-side Google Translate Chrome endpoint fallback
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=pt&dt=t&q=${encodeURIComponent(trimmed)}`;
      const gRes = await fetch(gUrl);
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData && Array.isArray(gData) && gData[0] && Array.isArray(gData[0])) {
          const gTranslated = gData[0].map((p: any) => p[0]).join('');
          if (gTranslated) {
            return { original: trimmed, translation: gTranslated };
          }
        }
      }
    } catch (err) {
      console.warn('Client fallback 2 failed:', err);
    }

    return { original: trimmed, translation: trimmed };
  },

  async explain(text: string, context?: string): Promise<ExplainResponse> {
    try {
      return await request<ExplainResponse>('/ai/explain', {
        method: 'POST',
        body: JSON.stringify({ text, context }),
      });
    } catch (err) {
      return {
        sentence: text,
        explanation: `A frase "${text}" é usada no inglês cotidiano para expressar uma ideia com clareza. Observe o uso dos verbos e conectivos no contexto da conversa.`,
        examples: [
          'I understand you feel frustrated.',
          'What do you think could help make things better?'
        ],
      };
    }
  },

  async getWordInfo(word: string, context?: string): Promise<WordInfoResponse> {
    try {
      const res = await request<WordInfoResponse>('/ai/word-info', {
        method: 'POST',
        body: JSON.stringify({ word, context }),
      });
      if (
        res &&
        res.translation &&
        res.translation !== 'palavra em inglês' &&
        res.translation.toLowerCase() !== word.toLowerCase()
      ) {
        return res;
      }
    } catch (e) {
      // Backend unavailable or rate-limited, fall back to robust client translator
    }

    const tr = await this.translate(word);
    const cleanW = word.trim().toLowerCase().replace(/[^a-zA-Z]/g, '');

    return {
      word: cleanW,
      translation: tr.translation || cleanW,
      part_of_speech: 'palavra',
      definition: `Significa "${tr.translation || cleanW}" em português.`,
      example: context || word,
    };
  },

  async chatWithTutor(message: string, context?: string): Promise<ChatResponse> {
    try {
      return await request<ChatResponse>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message, context }),
      });
    } catch (e) {
      return {
        reply: 'Praticar com este trecho ajuda a internalizar a gramática natural do inglês falado!',
      };
    }
  },
};

export interface WordInfoResponse {
  word: string;
  translation: string;
  part_of_speech: string;
  definition: string;
  example: string;
  tip?: string;
}

export interface ChatResponse {
  reply: string;
}

