import { Buffer } from 'buffer';

/**
 * Convert 16-bit PCM audio to 32-bit float (s16le to f32le)
 * Required for QVAC SDK Whisper model
 */
export function convertPCM16ToFloat32(pcm16Buffer: Buffer): Buffer {
  const int16Array = new Int16Array(
    pcm16Buffer.buffer,
    pcm16Buffer.byteOffset,
    pcm16Buffer.length / 2
  );
  const float32Array = new Float32Array(int16Array.length);
  
  // Convert each 16-bit sample to 32-bit float (-1.0 to 1.0)
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  
  return Buffer.from(float32Array.buffer);
}

/**
 * Concatenate Uint8Array chunks into a single Buffer
 */
export function concatenateAudioChunks(chunks: Uint8Array[]): Buffer {
  const bufferChunks = chunks.map(chunk => Buffer.from(chunk));
  return Buffer.concat(bufferChunks);
}

/**
 * Clean and normalize transcription text
 */
export function cleanTranscription(transcription: string): string {
  return transcription
    .replace(/<\|[\d.]+\|>/g, '') // Remove timestamps
    .replace(/[^a-zA-Z0-9\s]/g, ' ') // Remove special characters
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Sanitize command text for safe processing
 */
export function sanitizeCommand(command: string): string {
  let sanitized = command;
  
  // Check for corrupted/encoded data
  if (sanitized.includes('/') || sanitized.includes('+') || sanitized.includes('=')) {
    return '';
  }
  
  // Remove non-printable characters
  sanitized = sanitized.replace(/[^\x20-\x7E]/g, '').trim();
  
  // Remove quotes and commas at the beginning and end
  sanitized = sanitized.replace(/^['"`,\s]+/, '').replace(/['"`,\s]+$/, '').trim();
  
  // Only allow safe characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9\s\.\?\!\-]/g, ' ').trim();
  
  // Limit length
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }
  
  return sanitized;
}

