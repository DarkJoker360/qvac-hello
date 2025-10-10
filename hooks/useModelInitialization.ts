import { useState, useRef } from 'react';
import { Alert } from 'react-native';
import { initialize } from '@speechmatics/expo-two-way-audio';
import { loadModel, WHISPER_TINY } from '@tetherto/qvac-sdk';
import { MODEL_URLS, MESSAGES, TIMING_CONFIG } from '@/constants/chatbot';
import type { DownloadProgress, ChatMessage } from '@/types/chatbot';

export function useModelInitialization() {
  const [isModelReady, setIsModelReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [whisperModelId, setWhisperModelId] = useState<string | null>(null);
  const [completionModelId, setCompletionModelId] = useState<string | null>(null);
  
  const whisperModelRef = useRef<string | null>(null);
  const completionModelRef = useRef<string | null>(null);

  const initializeModels = async (
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    startContinuousListening: (modelId: string) => Promise<void>
  ) => {
    if (isInitializing || isModelReady) return;

    try {
      setIsInitializing(true);
      
      // Initialize audio system
      await initialize();

      // Load completion model
      const completionId = await loadModel(MODEL_URLS.COMPLETION, {
        modelType: "llm",
        onProgress: (progress: any) => {
          setDownloadProgress({ ...progress, model: 'Chat Model' });
        },
      });
      
      // Load Whisper model
      const whisperId = await loadModel(WHISPER_TINY, {
        modelType: "whisper",
        onProgress: (progress: any) => {
          setDownloadProgress({ ...progress, model: 'Speech Recognition' });
        },
        modelConfig: {
          audio_format: "f32le"
        }
      });
      
      // Store in refs immediately
      whisperModelRef.current = whisperId;
      completionModelRef.current = completionId;
      
      // Update state
      setCompletionModelId(completionId);
      setWhisperModelId(whisperId);
      setIsModelReady(true);
      setDownloadProgress(null);
      
      // Add welcome message
      const welcomeMessage: ChatMessage = {
        id: 'welcome',
        type: 'assistant',
        content: MESSAGES.WELCOME,
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
      
      // Start continuous listening after delay
      setTimeout(async () => {
        await startContinuousListening(whisperId);
      }, TIMING_CONFIG.STATE_UPDATE_DELAY);
      
    } catch (error) {
      Alert.alert('Error', 'Failed to load the AI models. Please try again.');
    } finally {
      setIsInitializing(false);
    }
  };

  return {
    isModelReady,
    isInitializing,
    downloadProgress,
    whisperModelId,
    completionModelId,
    whisperModelRef,
    completionModelRef,
    initializeModels
  };
}

