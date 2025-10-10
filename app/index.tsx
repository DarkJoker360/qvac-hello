import {
  initialize,
  toggleRecording,
  useExpoTwoWayAudioEventListener,
  type MicrophoneDataCallback
} from '@speechmatics/expo-two-way-audio';
import { Buffer } from 'buffer';
import {
  completion,
  transcribe,
  type Message
} from '@tetherto/qvac-sdk';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  AppState,
  Platform,
  BackHandler,
  FlatList,
  Animated
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { AUDIO_CONFIG, TIMING_CONFIG, MESSAGES } from '@/constants/chatbot';
import { 
  convertPCM16ToFloat32, 
  concatenateAudioChunks, 
  cleanTranscription, 
  sanitizeCommand 
} from '@/utils/audioUtils';
import { detectWakeWord, extractCommand } from '@/utils/wakeWordUtils';
import { useModelInitialization } from '@/hooks/useModelInitialization';
import type { ChatMessage, ListeningState } from '@/types/chatbot';

export default function QVACChatbot() {
  // Model initialization hook
  const {
    isModelReady,
    isInitializing,
    downloadProgress,
    whisperModelId,
    completionModelId,
    whisperModelRef,
    completionModelRef,
    initializeModels
  } = useModelInitialization();
  
  // Chat states
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [listeningState, setListeningState] = useState<ListeningState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [detectedWakeWord, setDetectedWakeWord] = useState('');
  
  // Audio states
  const [isRecording, setIsRecording] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  
  const insets = useSafeAreaInsets();
  
  // Refs for audio processing
  const audioChunksRef = useRef<Uint8Array[]>([]);
  const continuousAudioBuffer = useRef<Uint8Array[]>([]);
  const wakeWordDetectionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const commandListeningTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnimation = useRef(new Animated.Value(1)).current;
  const wakeWordFlashAnimation = useRef(new Animated.Value(0)).current;
  const isTranscribing = useRef(false);

  // Flash animation for wake word detection
  const triggerWakeWordFlash = useCallback(() => {
    setWakeWordDetected(true);
    
    Animated.sequence([
      Animated.timing(wakeWordFlashAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(wakeWordFlashAnimation, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(wakeWordFlashAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(wakeWordFlashAnimation, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => {
        setWakeWordDetected(false);
        setDetectedWakeWord('');
      }, 1000);
    });
  }, [wakeWordFlashAnimation]);

  // Start continuous audio stream for wake word detection
  const startContinuousListening = useCallback(async (modelId: string) => {
    // Prevent multiple instances
    if (wakeWordDetectionTimer.current) {
      clearInterval(wakeWordDetectionTimer.current);
      wakeWordDetectionTimer.current = null;
    }
    
    isTranscribing.current = false;
    
    try {
      setListeningState('listening_for_wake_word');
      setIsRecording(true);
      await toggleRecording(true);
      
      // Start interval-based wake word checking
      wakeWordDetectionTimer.current = setInterval(async () => {
        await checkForWakeWordNow(modelId);
      }, TIMING_CONFIG.WAKE_WORD_CHECK_INTERVAL);
      
    } catch (error) {
      setListeningState('idle');
      isTranscribing.current = false;
      setTimeout(async () => {
        await startContinuousListening(modelId);
      }, TIMING_CONFIG.RETRY_DELAY);
    }
  }, []);

  // Check for wake word in audio buffer
  const checkForWakeWordNow = useCallback(async (modelId: string) => {
    const actualModelId = whisperModelRef.current || modelId;
    
    if (isTranscribing.current || !actualModelId || continuousAudioBuffer.current.length < 50) {
      return;
    }
    
    try {
      isTranscribing.current = true;
      
      const recentChunks = continuousAudioBuffer.current.slice(-AUDIO_CONFIG.CHUNKS_FOR_TRANSCRIPTION);
      if (recentChunks.length === 0) return;
      
      const pcm16Buffer = concatenateAudioChunks(recentChunks);
      const audioBuffer = convertPCM16ToFloat32(pcm16Buffer);
      
      if (audioBuffer.length === 0 || audioBuffer.length > AUDIO_CONFIG.MAX_FLOAT32_BUFFER_SIZE) {
        return;
      }
      
      const transcription = await transcribe({
        modelId: actualModelId,
        audioChunk: audioBuffer
      });
      
      if (!transcription || typeof transcription !== 'string' || transcription.length > 500) {
        return;
      }
      
      const cleanedText = cleanTranscription(transcription);
      
      if (cleanedText && cleanedText.length > 2 && cleanedText.length < 100) {
        const isWakeWord = detectWakeWord(cleanedText);
        if (isWakeWord) {
          await handleWakeWordDetected(cleanedText);
        }
      }
    } catch (error) {
      // Silent error handling - don't crash on transcription errors
    } finally {
      isTranscribing.current = false;
    }
  }, [whisperModelId]);

  // Handle wake word detected
  const handleWakeWordDetected = useCallback(async (transcription: string) => {
    try {
      // Stop transcription timer
      if (wakeWordDetectionTimer.current) {
        clearInterval(wakeWordDetectionTimer.current);
        wakeWordDetectionTimer.current = null;
      }
      
      setListeningState('wake_word_detected');
      setDetectedWakeWord(transcription);
      
      triggerWakeWordFlash();
      
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch {}
      
      // Clear buffers
      audioChunksRef.current = [];
      continuousAudioBuffer.current = [];
      
      // Extract and process command
      const command = extractCommand(transcription);
      
      if (command && command.length > 0) {
        await processUserCommand(command);
      } else {
        await processUserCommand(MESSAGES.DEFAULT_COMMAND);
      }
    } catch (error) {
      setListeningState('listening_for_wake_word');
      setIsSpeaking(false);
      setCurrentTranscription('');
      
      if (whisperModelId) {
        setTimeout(async () => {
          await startContinuousListening(whisperModelId);
        }, TIMING_CONFIG.RETRY_DELAY);
      }
    }
  }, [whisperModelId, triggerWakeWordFlash, startContinuousListening]);

  // Process user command
  const processUserCommand = useCallback(async (command: string) => {
    try {
      const sanitizedCommand = sanitizeCommand(command) || MESSAGES.DEFAULT_COMMAND;
      
      setListeningState('processing');
      setCurrentTranscription(sanitizedCommand);
      
      // Add user message to chat
      const userMessage: ChatMessage = {
        id: Date.now().toString() + '_user',
        type: 'user',
        content: sanitizedCommand,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, userMessage]);
      
      const actualCompletionModelId = completionModelRef.current || completionModelId;
      
      if (!actualCompletionModelId) {
        throw new Error('Completion model not ready');
      }
      
      const history: Message[] = [
        {
          role: "user",
          content: sanitizedCommand
        }
      ];
      
      let response = '';
      setListeningState('responding');
      
      try {
        for await (const token of completion({ modelId: actualCompletionModelId, history, stream: true }).tokenStream) {
          response += token;
        }
      } catch (completionError) {
        throw new Error('AI completion failed');
      }
      
      const cleanResponse = response.trim();
      
      if (cleanResponse) {
        const assistantMessage: ChatMessage = {
          id: Date.now().toString() + '_assistant',
          type: 'assistant',
          content: cleanResponse,
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, assistantMessage]);
        
        setIsSpeaking(true);
        try {
          Speech.speak(cleanResponse, {
            rate: 1.0,
            pitch: 1.0,
            onDone: () => {
              setIsSpeaking(false);
              setCurrentTranscription('');
              setTimeout(async () => {
                if (whisperModelId) {
                  startContinuousListening(whisperModelId);
                }
              }, TIMING_CONFIG.SPEECH_DELAY);
            }
          });
        } catch (speechError) {
          setIsSpeaking(false);
          if (whisperModelId) {
            startContinuousListening(whisperModelId);
          }
        }
      } else {
        throw new Error('No response generated');
      }
      
    } catch (error) {
      setListeningState('listening_for_wake_word');
      setCurrentTranscription('');
      setIsSpeaking(false);
      
      try {
        Speech.speak(MESSAGES.ERROR_PROCESSING);
      } catch {}
      
      if (whisperModelId) {
        setTimeout(async () => {
          await startContinuousListening(whisperModelId);
        }, 1000);
      }
    }
  }, [completionModelId, whisperModelId, startContinuousListening]);

  // Stop continuous listening
  const stopContinuousListening = useCallback(() => {
    if (wakeWordDetectionTimer.current) {
      clearInterval(wakeWordDetectionTimer.current);
      wakeWordDetectionTimer.current = null;
    }
    
    if (commandListeningTimeout.current) {
      clearTimeout(commandListeningTimeout.current);
      commandListeningTimeout.current = null;
    }
    
    if (isRecording) {
      toggleRecording(false);
      setIsRecording(false);
    }
    
    setListeningState('idle');
    audioChunksRef.current = [];
    continuousAudioBuffer.current = [];
    isTranscribing.current = false;
  }, [isRecording]);

  // Pulse animation
  const startPulseAnimation = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnimation, {
          toValue: 1.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnimation]);

  const stopPulseAnimation = useCallback(() => {
    pulseAnimation.stopAnimation();
    pulseAnimation.setValue(1);
  }, [pulseAnimation]);

  // Initialize models on mount
  useEffect(() => {
    initializeModels(setMessages, startContinuousListening);
  }, []);

  // Pulse animation based on listening state
  useEffect(() => {
    if (listeningState === 'listening_for_wake_word' || listeningState === 'listening_for_command') {
      startPulseAnimation();
    } else {
      stopPulseAnimation();
    }
  }, [listeningState, startPulseAnimation, stopPulseAnimation]);

  // Audio event listener
  useExpoTwoWayAudioEventListener(
    "onMicrophoneData",
    useCallback<MicrophoneDataCallback>((event) => {
      if (isRecording) {
        const audioBuffer = event.data;
        continuousAudioBuffer.current.push(audioBuffer);
        
        // Keep only last 5 seconds
        if (continuousAudioBuffer.current.length > AUDIO_CONFIG.MAX_BUFFER_CHUNKS) {
          continuousAudioBuffer.current = continuousAudioBuffer.current.slice(-AUDIO_CONFIG.MAX_BUFFER_CHUNKS);
        }
        
        // For command listening, collect separately
        if (listeningState === 'listening_for_command') {
          audioChunksRef.current.push(audioBuffer);
        }
      }
    }, [isRecording, listeningState]),
  );

  // Screen focus management
  useFocusEffect(
    useCallback(() => {
      if (isModelReady && whisperModelId && listeningState === 'idle') {
        setTimeout(async () => {
          await startContinuousListening(whisperModelId);
        }, 500);
      }
      
      return () => {
        if (isSpeaking) {
          Speech.stop();
          setIsSpeaking(false);
        }
      };
    }, [isModelReady, whisperModelId, listeningState, startContinuousListening, isSpeaking])
  );

  // Hardware button and app state management
  useEffect(() => {
    if (!isModelReady) return;

    let backButtonListener: any = null;
    let appStateListener: any = null;

    const setupListeners = () => {
      try {
        if (Platform.OS === 'android') {
          backButtonListener = BackHandler.addEventListener('hardwareBackPress', () => {
            Speech.stop();
            stopContinuousListening();
            setIsSpeaking(false);
            setCurrentTranscription('');
            return true;
          });
        }

        const handleAppStateChange = (nextAppState: any) => {
          if (nextAppState === 'background' || nextAppState === 'inactive') {
            if (isSpeaking) {
              Speech.stop();
              setIsSpeaking(false);
            }
          }
          
          if (nextAppState === 'active' && (appState === 'background' || appState === 'inactive')) {
            if (whisperModelId && listeningState === 'idle') {
              setTimeout(async () => {
                await startContinuousListening(whisperModelId);
              }, 1000);
            }
          }
          
          setAppState(nextAppState);
        };

        appStateListener = AppState.addEventListener('change', handleAppStateChange);
      } catch (error) {
        // Silent error handling
      }
    };

    setupListeners();

    return () => {
      if (backButtonListener) backButtonListener.remove();
      if (appStateListener) appStateListener.remove();
    };
  }, [isModelReady, appState, whisperModelId, listeningState, startContinuousListening, isSpeaking, stopContinuousListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopContinuousListening();
      Speech.stop();
    };
  }, [stopContinuousListening]);

  // Get listening state display text
  const getListeningStateText = () => {
    switch (listeningState) {
      case 'listening_for_wake_word':
        return 'Listening for wake word...';
      case 'wake_word_detected':
        return 'Wake word detected! 🎯';
      case 'listening_for_command':
        return 'Listening for your command...';
      case 'processing':
        return 'Processing your request...';
      case 'responding':
        return 'Generating response...';
      default:
        return 'Ready to start';
    }
  };

  // Get listening state color
  const getListeningStateColor = () => {
    switch (listeningState) {
      case 'listening_for_wake_word':
        return '#16E3C1';
      case 'wake_word_detected':
        return '#FFD700';
      case 'listening_for_command':
        return '#FF6B6B';
      case 'processing':
        return '#4ECDC4';
      case 'responding':
        return '#45B7D1';
      default:
        return '#888';
    }
  };

  // Render chat message
  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <View style={[
      styles.messageContainer,
      item.type === 'user' ? styles.userMessage : styles.assistantMessage
    ]}>
      <View style={[
        styles.messageBubble,
        item.type === 'user' ? styles.userBubble : styles.assistantBubble
      ]}>
        <ThemedText style={[
          styles.messageText,
          item.type === 'user' ? styles.userMessageText : styles.assistantMessageText
        ]}>
          {item.content}
        </ThemedText>
        <ThemedText style={[
          styles.messageTime,
          item.type === 'user' ? styles.userMessageTime : styles.assistantMessageTime
        ]}>
          {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </ThemedText>
      </View>
    </View>
  );

  // Loading screen
  const renderLoadingScreen = () => (
    <ThemedView style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#16E3C1" />
      <ThemedText style={styles.loadingTitle}>
        {downloadProgress ? `Loading ${downloadProgress.model || 'AI Model'}...` : 'Preparing QVAC Chatbot...'}
      </ThemedText>
      {downloadProgress && downloadProgress.percentage && (
        <>
          <ThemedText style={styles.progressText}>
            {Math.round(downloadProgress.percentage)}% complete
          </ThemedText>
          <View style={styles.progressBarContainer}>
            <View 
              style={[
                styles.progressBarFill, 
                { width: `${downloadProgress.percentage}%` }
              ]} 
            />
          </View>
        </>
      )}
      <ThemedText style={styles.loadingSubtext}>
        Setting up AI models for voice chat...
      </ThemedText>
    </ThemedView>
  );

  if (!isModelReady) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {renderLoadingScreen()}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <ThemedView style={styles.header}>
        <ThemedText type="title" style={styles.title}>◊ QVAC Chatbot ◊</ThemedText>
        <ThemedView style={styles.glitchLine} />
      </ThemedView>

      {/* Chat Messages */}
      <View style={styles.chatContainer}>
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          style={styles.messagesList}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* Listening Status */}
      <ThemedView style={styles.statusContainer}>
        {wakeWordDetected && (
          <Animated.View 
            style={[
              styles.wakeWordFlashOverlay,
              { opacity: wakeWordFlashAnimation }
            ]}
          />
        )}
        
        <Animated.View 
          style={[
            styles.statusIndicator,
            { 
              transform: [{ scale: pulseAnimation }],
              backgroundColor: getListeningStateColor()
            }
          ]}
        />
        <ThemedText style={[styles.statusText, { color: getListeningStateColor() }]}>
          {getListeningStateText()}
        </ThemedText>
        
        {wakeWordDetected && detectedWakeWord && (
          <ThemedText style={styles.wakeWordText}>
            🎯 Detected: "{detectedWakeWord}"
          </ThemedText>
        )}
        
        {currentTranscription && (
          <ThemedText style={styles.transcriptionText}>
            "{currentTranscription}"
          </ThemedText>
        )}
        {isSpeaking && (
          <ThemedText style={styles.speakingText}>
            Speaking...
          </ThemedText>
        )}
      </ThemedView>

      {/* Instructions */}
      <ThemedView style={styles.instructionsContainer}>
        <ThemedText style={styles.instructionText}>
          Say "Hello/Hi/Hey Assistant/QVAC" followed by your question
        </ThemedText>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#16E3C1',
    backgroundColor: 'rgba(22, 227, 193, 0.05)',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#16E3C1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 2,
  },
  glitchLine: {
    width: '100%',
    height: 2,
    backgroundColor: '#16E3C1',
    marginTop: 10,
    shadowColor: '#16E3C1',
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  chatContainer: {
    flex: 1,
    padding: 16,
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingVertical: 8,
  },
  messageContainer: {
    marginVertical: 4,
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  assistantMessage: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginHorizontal: 8,
  },
  userBubble: {
    backgroundColor: '#16E3C1',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: 'rgba(22, 227, 193, 0.1)',
    borderWidth: 1,
    borderColor: '#16E3C1',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  userMessageText: {
    color: '#000',
  },
  assistantMessageText: {
    color: '#16E3C1',
  },
  messageTime: {
    fontSize: 12,
    marginTop: 4,
    opacity: 0.7,
  },
  userMessageTime: {
    color: '#000',
    textAlign: 'right',
  },
  assistantMessageTime: {
    color: '#16E3C1',
    textAlign: 'left',
  },
  statusContainer: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(22, 227, 193, 0.05)',
    borderTopWidth: 1,
    borderTopColor: '#16E3C1',
    position: 'relative',
  },
  wakeWordFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFD700',
    borderRadius: 8,
    zIndex: 1,
  },
  statusIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginBottom: 8,
    zIndex: 2,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
    zIndex: 2,
  },
  wakeWordText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 8,
    color: '#FFD700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFD700',
    zIndex: 2,
  },
  transcriptionText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
    color: '#FFD700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    zIndex: 2,
  },
  speakingText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    color: '#45B7D1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    zIndex: 2,
  },
  instructionsContainer: {
    padding: 16,
    backgroundColor: 'rgba(22, 227, 193, 0.1)',
    borderTopWidth: 1,
    borderTopColor: '#16E3C1',
  },
  instructionText: {
    fontSize: 14,
    textAlign: 'center',
    color: '#16E3C1',
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
    color: '#16E3C1',
  },
  progressText: {
    fontSize: 18,
    marginTop: 10,
    textAlign: 'center',
    color: '#16E3C1',
  },
  loadingSubtext: {
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
    opacity: 0.7,
    color: '#888',
  },
  progressBarContainer: {
    width: '80%',
    height: 8,
    backgroundColor: 'rgba(22, 227, 193, 0.2)',
    borderRadius: 4,
    marginTop: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#16E3C1',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#16E3C1',
    borderRadius: 4,
    shadowColor: '#16E3C1',
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
