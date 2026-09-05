export interface UserProfile {
  id: string;
  user_id: string;
  english_level: string;
  goal: string;
  daily_goal_minutes: number;
  current_streak: number;
  last_study_date: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
  profile?: UserProfile;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name?: string;
}
