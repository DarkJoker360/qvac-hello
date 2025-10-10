export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type ListeningState = 
  | 'idle' 
  | 'listening_for_wake_word' 
  | 'wake_word_detected' 
  | 'listening_for_command' 
  | 'processing' 
  | 'responding';

export interface DownloadProgress {
  model?: string;
  percentage?: number;
}

