import { WAKE_WORDS, MESSAGES } from '@/constants/chatbot';

/**
 * Detect if transcription contains a wake word
 */
export function detectWakeWord(transcription: string): boolean {
  const lowerText = transcription.toLowerCase();
  
  return WAKE_WORDS.some(wakeWord => 
    lowerText.includes(wakeWord) || 
    lowerText.startsWith(wakeWord) ||
    lowerText.endsWith(wakeWord)
  );
}

/**
 * Extract command from transcription after wake word
 */
export function extractCommand(transcription: string): string {
  const lowerText = transcription.toLowerCase();
  
  for (const wakeWord of WAKE_WORDS) {
    const index = lowerText.indexOf(wakeWord);
    if (index !== -1) {
      let command = transcription.substring(index + wakeWord.length).trim();
      
      // Sanitize the command - remove quotes, commas at the beginning
      command = command.replace(/^['"`,\s]+/, '').replace(/['"`,\s]+$/, '').trim();
      
      // If no command after wake word, return default
      if (!command || command.length === 0) {
        return MESSAGES.DEFAULT_COMMAND;
      }
      
      return command;
    }
  }
  
  // No wake word found, use default
  return MESSAGES.DEFAULT_COMMAND;
}

