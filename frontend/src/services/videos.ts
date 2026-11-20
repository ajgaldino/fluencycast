import { API_BASE_URL, request } from './api';
import { Video, VideoCreatePayload } from '../types/video';

export type VideoProcessStage = 'metadata' | 'transcript' | 'saving' | 'keywords' | 'finalizing';

export interface VideoStreamProgress {
  type: 'progress' | 'complete' | 'error';
  stage?: VideoProcessStage;
  progress?: number;
  message?: string;
  detail?: string;
  completed?: number;
  total?: number;
  current_word?: string;
  segments_count?: number;
  keywords_count?: number;
  video?: Video;
}

export interface VideoStreamResult {
  video: Video;
  keywordsCount?: number;
  segmentsCount?: number;
}

export const videoService = {
  async getVideos(): Promise<Video[]> {
    return request<Video[]>('/videos/');
  },

  async getVideoById(id: string): Promise<Video> {
    return request<Video>(`/videos/${id}`);
  },

  async createVideo(data: VideoCreatePayload): Promise<Video> {
    return request<Video>('/videos/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async createVideoStream(
    data: VideoCreatePayload,
    onProgress: (event: VideoStreamProgress) => void,
    signal?: AbortSignal
  ): Promise<VideoStreamResult> {
    const token = localStorage.getItem('fluency_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}/videos/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal,
    });

    if (response.status === 401) {
      localStorage.removeItem('fluency_token');
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login';
      }
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    // Fallback to legacy POST /videos/ if /stream isn't live yet
    if (response.status === 404 || response.status === 405) {
      onProgress({
        type: 'progress',
        stage: 'saving',
        progress: 50,
        message: 'Processando vídeo e gerando flashcards no servidor...',
      });
      const video = await this.createVideo(data);
      return { video, segmentsCount: video.segments?.length };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.detail || errorData.message || `Erro ${response.status}: Falha na requisição.`;
      throw new Error(message);
    }

    if (!response.body) {
      const video = await this.createVideo(data);
      return { video, segmentsCount: video.segments?.length };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalResult: VideoStreamResult | null = null;

    const processEventBlock = (block: string) => {
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

      if (dataLines.length === 0) return;

      const rawJson = dataLines.join('\n').trim();
      if (!rawJson) return;

      const parsed = JSON.parse(rawJson) as VideoStreamProgress;
      if (parsed.type === 'error') {
        throw new Error(parsed.message || 'Falha ao processar vídeo');
      }
      if (parsed.type === 'progress') {
        onProgress(parsed);
        return;
      }
      if (parsed.type === 'complete' && parsed.video) {
        onProgress(parsed);
        finalResult = {
          video: parsed.video,
          keywordsCount: parsed.keywords_count,
          segmentsCount: parsed.segments_count,
        };
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            processEventBlock(block);
          }
        }
        if (done) {
          buffer += decoder.decode().replace(/\r\n/g, '\n');
          if (buffer.trim()) {
            for (const block of buffer.split('\n\n')) {
              processEventBlock(block);
            }
          }
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (!finalResult) {
      throw new Error('A conexão foi encerrada antes da conclusão do processamento.');
    }

    return finalResult;
  },

  async extractKeywords(videoId: string, limit?: number): Promise<any[]> {
    const query = limit ? `?limit=${limit}` : '';
    return request<any[]>(`/videos/${videoId}/extract-keywords${query}`, {
      method: 'POST',
    });
  },

  async syncAllKeywords(): Promise<{ message: string; videos_processed: number; total_cards_created: number }> {
    return request('/videos/sync-all-keywords', {
      method: 'POST',
    });
  },

  async deleteVideo(id: string): Promise<void> {
    return request<void>(`/videos/${id}`, {
      method: 'DELETE',
    });
  },
};

