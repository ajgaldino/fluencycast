export interface TranscriptSegment {
  id: string;
  video_id: string;
  sequence: number;
  text: string;
  start_time: number;
  end_time: number;
}

export interface Video {
  id: string;
  user_id: string;
  youtube_id: string;
  url: string;
  title: string;
  channel?: string;
  thumbnail_url?: string;
  duration?: number;
  language: string;
  category: "video" | "music";
  created_at: string;
  segments?: TranscriptSegment[];
}

export interface VideoCreatePayload {
  url: string;
  category?: "video" | "music";
}
