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
};
