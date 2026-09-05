import { request } from './api';
import { Video, VideoCreatePayload } from '../types/video';

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

  async deleteVideo(id: string): Promise<void> {
    return request<void>(`/videos/${id}`, {
      method: 'DELETE',
    });
  },
};
