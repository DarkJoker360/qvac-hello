// Wake words configuration
export const WAKE_WORDS = [
  'hi qvac',
  'hello qvac',
  'hey qvac',
  'hello assistant',
  'hey phone',
  'hello phone',
  'hey assistant',
  'hello bro'
] as const;

// Audio configuration
export const AUDIO_CONFIG = {
  MAX_BUFFER_CHUNKS: 250, // ~5 seconds at 50 chunks/sec
  CHUNKS_FOR_TRANSCRIPTION: 200, // ~4 seconds
  SAMPLE_RATE: 16000,
  FORMAT: 'f32le' as const,
  MAX_FLOAT32_BUFFER_SIZE: 800000, // bytes - ~10 seconds of f32le audio
  MAX_PCM16_BUFFER_SIZE: 200000, // bytes - ~6 seconds of pcm16 audio
} as const;

// Timing configuration
export const TIMING_CONFIG = {
  WAKE_WORD_CHECK_INTERVAL: 1500, // ms - check every 1.5 seconds
  COMMAND_TIMEOUT: 5000, // ms - wait 5 seconds for command after wake word
  STATE_UPDATE_DELAY: 2000, // ms - delay before starting listening
  RETRY_DELAY: 3000, // ms - delay before retrying on error
  SPEECH_DELAY: 100, // ms - delay before returning to listening after speech
} as const;

// Messages
export const MESSAGES = {
  WELCOME: 'Hello! I\'m QVAC, your AI assistant. Say "Hi QVAC" or "Hello QVAC" followed by your question to start chatting with me.',
  ERROR_PROCESSING: "Sorry, I couldn't process that request. Please try again.",
  DEFAULT_COMMAND: "Hello, how can I help you?",
  MODELS_LOADING: "Welcome to QVAC Chatbot. Loading AI models...",
  MODELS_FAILED: "Failed to start QVAC Chatbot. Please try again.",
} as const;

// Model URLs
export const MODEL_URLS = {
  COMPLETION: "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_0.gguf",
} as const;

