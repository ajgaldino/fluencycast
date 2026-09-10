import { request } from './api';
import { AuthResponse, LoginPayload, RegisterPayload, User } from '../types/auth';

export const authService = {
  async register(data: RegisterPayload): Promise<User> {
    return request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async login(data: LoginPayload): Promise<AuthResponse> {
    const res = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    localStorage.setItem('fluency_token', res.access_token);
    return res;
  },

  async getMe(): Promise<User> {
    return request<User>('/auth/me');
  },

  async resetData(): Promise<{ message: string }> {
    return request<{ message: string }>('/auth/reset-data', {
      method: 'POST',
    });
  },

  logout(): void {
    localStorage.removeItem('fluency_token');
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem('fluency_token');
  },
};
