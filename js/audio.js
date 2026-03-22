/**
 * Audio Module - Handles microphone recording, speech-to-text, and text-to-speech
 * Provides visual feedback for recording states and manages audio playback
 */

import { transcribeAudio, speakText as aiSpeakText } from './ai-service.js';

// DOM Elements
const voiceIndicator = document.getElementById('voiceIndicator');
const voiceText = document.querySelector('.voice-text');
const cancelVoiceBtn = document.getElementById('cancelVoiceBtn');
const mainActionBtn = document.getElementById('mainActionBtn');
const stopAudioBtn = document.getElementById('stopAudioBtn');

// State variables
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStream = null;
let currentAudioSource = null;
let currentAudioContext = null;
let isSpeaking = false;
let recordingStartTime = null;
let recordingTimer = null;
let recordingTimeout = null;
let onRecordingCompleteCallbacks = [];

// Configuration
const MAX_RECORDING_DURATION = 30000; // 30 seconds max
const MIN_RECORDING_DURATION = 500; // 0.5 seconds minimum
const SILENCE_TIMEOUT = 2000; // 2 seconds of silence to auto-stop

// Audio context for visualization and playback
let audioContext = null;

/**
 * Check if browser supports required audio APIs
 * @returns {Object} Support status for different features
 */
export function checkAudioSupport() {
  const support = {
    mediaRecorder: !!(window.MediaRecorder),
    getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    audioContext: !!(window.AudioContext || window.webkitAudioContext),
    speechSynthesis: !!(window.speechSynthesis)
  };
  
  support.allSupported = support.mediaRecorder && support.getUserMedia;
  
  if (!support.allSupported) {
    console.warn('Audio support missing:', {
      mediaRecorder: support.mediaRecorder,
      getUserMedia: support.getUserMedia
    });
  }
  
  return support;
}

/**
 * Initialize audio context for better audio handling
 */
function initAudioContext() {
  if (!audioContext && (window.AudioContext || window.webkitAudioContext)) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

/**
 * Request and check microphone permission
 * @returns {Promise<boolean>} True if permission granted
 */
export async function checkMicrophonePermission() {
  const support = checkAudioSupport();
  
  if (!support.getUserMedia) {
    console.error('getUserMedia not supported');
    updateVoiceIndicator('Microphone not supported in this browser', 'error');
    return false;
  }
  
  try {
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Stop the stream immediately (just testing permission)
    stream.getTracks().forEach(track => track.stop());
    
    console.log('Microphone permission granted');
    return true;
    
  } catch (error) {
    console.error('Microphone permission error:', error);
    
    let errorMessage = '';
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        errorMessage = 'Microphone access denied. Please grant permission and refresh.';
        break;
      case 'NotFoundError':
        errorMessage = 'No microphone found on this device.';
        break;
      case 'NotReadableError':
        errorMessage = 'Microphone is in use by another application.';
        break;
      default:
        errorMessage = `Microphone error: ${error.message}`;
    }
    
    updateVoiceIndicator(errorMessage, 'error');
    return false;
  }
}

/**
 * Update voice indicator UI
 * @param {string} message - Status message
 * @param {string} type - Message type: 'listening', 'processing', 'error', 'success'
 */
function updateVoiceIndicator(message, type = 'info') {
  if (voiceText) {
    voiceText.textContent = message;
  }
  
  // Update indicator visibility and styling
  if (voiceIndicator) {
    if (type === 'listening') {
      voiceIndicator.classList.remove('hidden');
      voiceIndicator.classList.add('active');
      voiceIndicator.style.borderColor = '#4caf50';
    } else if (type === 'processing') {
      voiceIndicator.classList.remove('hidden');
      voiceIndicator.classList.add('active');
      voiceIndicator.style.borderColor = '#ff9800';
    } else if (type === 'error') {
      voiceIndicator.classList.remove('hidden');
      voiceIndicator.classList.add('error');
      voiceIndicator.style.borderColor = '#f44336';
      
      // Auto-hide error after 3 seconds
      setTimeout(() => {
        if (voiceIndicator && voiceIndicator.classList.contains('error')) {
          hideVoiceIndicator();
        }
      }, 3000);
    } else {
      hideVoiceIndicator();
    }
  }
  
  // Update main action button if needed
  if (mainActionBtn && type === 'listening') {
    const actionIcon = mainActionBtn.querySelector('.action-icon');
    const actionText = mainActionBtn.querySelector('.action-text');
    if (actionIcon) actionIcon.textContent = '🔴';
    if (actionText) actionText.textContent = 'Listening...';
  }
}

/**
 * Hide voice indicator
 */
function hideVoiceIndicator() {
  if (voiceIndicator) {
    voiceIndicator.classList.add('hidden');
    voiceIndicator.classList.remove('active', 'error');
  }
  
  // Reset main action button
  if (mainActionBtn) {
    const actionIcon = mainActionBtn.querySelector('.action-icon');
    const actionText = mainActionBtn.querySelector('.action-text');
    if (actionIcon && actionText && !isRecording) {
      const isAutoMode = document.getElementById('autoModeBtn')?.classList.contains('active');
      if (isAutoMode) {
        actionIcon.textContent = '⏸️';
        actionText.textContent = 'Pause Auto Mode';
      } else {
        actionIcon.textContent = '🎤';
        actionText.textContent = 'Ask Question';
      }
    }
  }
}

/**
 * Start recording audio from microphone
 * @param {Object} options - Recording options
 * @returns {Promise<MediaRecorder>} MediaRecorder instance
 */
export async function startRecording(options = {}) {
  const support = checkAudioSupport();
  
  if (!support.allSupported) {
    throw new Error('Audio recording not supported in this browser');
  }
  
  // Stop any ongoing recording
  if (isRecording) {
    await stopRecording();
  }
  
  try {
    // Request microphone with optimal settings
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000, // Optimal for Whisper
        channelCount: 1 // Mono for speech recognition
      }
    });
    
    recordingStream = stream;
    
    // Determine supported MIME type
    const mimeTypes = [
      'audio/webm',
      'audio/mp4',
      'audio/ogg',
      'audio/wav'
    ];
    
    let mimeType = '';
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }
    
    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    audioChunks = [];
    
    // Set up event handlers
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstart = () => {
      isRecording = true;
      recordingStartTime = Date.now();
      
      // Update UI
      updateVoiceIndicator('Listening... Speak now', 'listening');
      
      // Set auto-stop timer for max duration
      if (recordingTimeout) clearTimeout(recordingTimeout);
      recordingTimeout = setTimeout(() => {
        if (isRecording) {
          console.log('Max recording duration reached, stopping...');
          stopRecording();
        }
      }, options.maxDuration || MAX_RECORDING_DURATION);
      
      // Start timer for visual feedback
      startRecordingTimer();
      
      // Trigger callback
      if (options.onStart) options.onStart();
    };
    
    mediaRecorder.onstop = () => {
      isRecording = false;
      
      // Clear timers
      if (recordingTimeout) clearTimeout(recordingTimeout);
      if (recordingTimer) clearInterval(recordingTimer);
      
      // Stop all tracks
      if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
      }
      
      // Trigger callback with audio blob
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      
      if (options.onStop) {
        options.onStop(audioBlob);
      }
      
      // Notify all registered callbacks
      onRecordingCompleteCallbacks.forEach(callback => {
        callback(audioBlob);
      });
      
      // Hide indicator after short delay
      setTimeout(() => {
        if (!isRecording) {
          hideVoiceIndicator();
        }
      }, 500);
    };
    
    mediaRecorder.onerror = (error) => {
      console.error('MediaRecorder error:', error);
      updateVoiceIndicator(`Recording error: ${error.message}`, 'error');
      stopRecording();
    };
    
    // Start recording with timeslice for continuous data
    mediaRecorder.start(1000); // Capture data every second
    
    return mediaRecorder;
    
  } catch (error) {
    console.error('Failed to start recording:', error);
    
    let errorMessage = '';
    if (error.name === 'NotAllowedError') {
      errorMessage = 'Microphone access denied. Please grant permission.';
    } else if (error.name === 'NotFoundError') {
      errorMessage = 'No microphone found. Please connect a microphone.';
    } else {
      errorMessage = `Failed to access microphone: ${error.message}`;
    }
    
    updateVoiceIndicator(errorMessage, 'error');
    throw new Error(errorMessage);
  }
}

/**
 * Start recording timer for visual feedback
 */
function startRecordingTimer() {
  if (recordingTimer) clearInterval(recordingTimer);
  
  recordingTimer = setInterval(() => {
    if (isRecording && recordingStartTime) {
      const duration = Date.now() - recordingStartTime;
      const seconds = Math.floor(duration / 1000);
      
      // Update voice indicator with duration
      if (voiceText && seconds > 0) {
        voiceText.textContent = `Listening... ${seconds}s`;
      }
      
      // Auto-stop after silence detection (simplified - would need VAD)
      if (duration >= MAX_RECORDING_DURATION - 1000) {
        voiceText.textContent = 'Almost done...';
      }
    }
  }, 1000);
}

/**
 * Stop recording and return audio blob
 * @returns {Promise<Blob|null>} Audio blob or null if no recording
 */
export async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    console.log('No active recording to stop');
    return null;
  }
  
  return new Promise((resolve) => {
    // Store resolve function to be called onstop
    const originalOnStop = mediaRecorder.onstop;
    mediaRecorder.onstop = () => {
      if (originalOnStop) originalOnStop();
      
      const audioBlob = new Blob(audioChunks, { type: audioChunks[0]?.type || 'audio/webm' });
      resolve(audioBlob);
    };
    
    mediaRecorder.stop();
  });
}

/**
 * Record audio and transcribe using AI service
 * @param {Object} options - Recording options
 * @returns {Promise<string>} Transcribed text
 */
export async function recordAndTranscribe(options = {}) {
  const support = checkAudioSupport();
  
  if (!support.allSupported) {
    throw new Error('Audio recording not supported in this browser');
  }
  
  try {
    // Update UI
    updateVoiceIndicator('Listening...', 'listening');
    
    // Start recording
    const recordingPromise = new Promise((resolve) => {
      startRecording({
        onStop: (audioBlob) => {
          resolve(audioBlob);
        },
        maxDuration: options.maxDuration || MAX_RECORDING_DURATION
      });
    });
    
    // Wait for recording to complete
    const audioBlob = await recordingPromise;
    
    // Check minimum duration
    if (audioBlob.size < MIN_RECORDING_DURATION * 16) { // Rough estimate
      updateVoiceIndicator('Recording too short. Please try again.', 'error');
      throw new Error('Recording too short');
    }
    
    // Update UI for processing
    updateVoiceIndicator('Processing speech...', 'processing');
    
    // Transcribe using AI service
    const text = await transcribeAudio(audioBlob);
    
    if (!text || text.trim() === '') {
      updateVoiceIndicator('No speech detected. Please try again.', 'error');
      throw new Error('No speech detected');
    }
    
    // Success
    updateVoiceIndicator(`Recognized: "${text}"`, 'success');
    
    // Auto-hide after success
    setTimeout(() => {
      hideVoiceIndicator();
    }, 2000);
    
    return text;
    
  } catch (error) {
    console.error('Record and transcribe error:', error);
    updateVoiceIndicator(`Error: ${error.message}`, 'error');
    throw error;
  } finally {
    // Ensure recording is stopped
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      await stopRecording();
    }
  }
}

/**
 * Speak text using TTS with queue management
 * @param {string} text - Text to speak
 * @returns {Promise<void>}
 */
export async function speak(text) {
  if (!text || text.trim() === '') {
    console.log('Empty text, skipping speech');
    return;
  }
  
  // Stop any current speech
  await stopSpeaking();
  
  try {
    isSpeaking = true;
    
    // Update UI
    if (stopAudioBtn) {
      stopAudioBtn.style.opacity = '1';
      stopAudioBtn.style.transform = 'scale(1)';
    }
    
    // Use Web Speech API as fallback if AI TTS fails
    let success = false;
    
    try {
      // Try AI TTS first
      const audioBuffer = await aiSpeakText(text);
      
      if (audioBuffer) {
        await playAudioBuffer(audioBuffer);
        success = true;
      }
    } catch (aiError) {
      console.warn('AI TTS failed, falling back to Web Speech:', aiError);
    }
    
    // Fallback to Web Speech API
    if (!success && window.speechSynthesis) {
      await speakWithWebSpeech(text);
      success = true;
    }
    
    if (!success) {
      throw new Error('No TTS engine available');
    }
    
  } catch (error) {
    console.error('Speech error:', error);
    throw new Error(`Failed to speak: ${error.message}`);
  } finally {
    isSpeaking = false;
    
    // Update UI
    if (stopAudioBtn) {
      stopAudioBtn.style.opacity = '0.7';
    }
  }
}

/**
 * Play audio buffer using Web Audio API
 * @param {AudioBuffer} audioBuffer - Audio buffer to play
 * @returns {Promise<void>}
 */
async function playAudioBuffer(audioBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const context = initAudioContext();
      if (!context) {
        reject(new Error('AudioContext not available'));
        return;
      }
      
      // Resume context if suspended
      if (context.state === 'suspended') {
        context.resume();
      }
      
      // Create buffer source
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(context.destination);
      
      currentAudioSource = source;
      
      source.onended = () => {
        if (currentAudioSource === source) {
          currentAudioSource = null;
        }
        resolve();
      };
      
      source.start();
      
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Speak text using Web Speech API fallback
 * @param {string} text - Text to speak
 * @returns {Promise<void>}
 */
function speakWithWebSpeech(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Web Speech API not supported'));
      return;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Select a voice if available
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(voice => voice.lang.startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    
    utterance.onstart = () => {
      isSpeaking = true;
    };
    
    utterance.onend = () => {
      isSpeaking = false;
      resolve();
    };
    
    utterance.onerror = (event) => {
      isSpeaking = false;
      reject(new Error(`Speech error: ${event.error}`));
    };
    
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Stop current speech output
 */
export async function stopSpeaking() {
  // Stop AI TTS playback
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
      currentAudioSource = null;
    } catch (e) {
      // Already stopped
    }
  }
  
  // Stop Web Speech API
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  
  isSpeaking = false;
  
  // Update UI
  if (stopAudioBtn) {
    stopAudioBtn.style.opacity = '0.7';
    
    // Visual feedback
    stopAudioBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
      if (stopAudioBtn) stopAudioBtn.style.transform = '';
    }, 200);
  }
}

/**
 * Check if currently speaking
 * @returns {boolean} True if speaking
 */
export function isCurrentlySpeaking() {
  return isSpeaking;
}

/**
 * Check if currently recording
 * @returns {boolean} True if recording
 */
export function isCurrentlyRecording() {
  return isRecording;
}

/**
 * Register callback for when recording completes
 * @param {Function} callback - Callback function
 */
export function onRecordingComplete(callback) {
  if (typeof callback === 'function') {
    onRecordingCompleteCallbacks.push(callback);
  }
}

/**
 * Remove recording complete callback
 * @param {Function} callback - Callback to remove
 */
export function offRecordingComplete(callback) {
  const index = onRecordingCompleteCallbacks.indexOf(callback);
  if (index > -1) {
    onRecordingCompleteCallbacks.splice(index, 1);
  }
}

/**
 * Get available audio input devices
 * @returns {Promise<Array>} List of audio input devices
 */
export async function getAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    return [];
  }
  
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  } catch (error) {
    console.error('Error enumerating audio devices:', error);
    return [];
  }
}

/**
 * Test microphone levels (visual feedback)
 * @param {Function} onLevel - Callback with current audio level (0-1)
 * @returns {Promise<Function>} Cleanup function
 */
export async function testMicrophone(onLevel) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = initAudioContext();
    
    if (!audioContext) {
      throw new Error('AudioContext not available');
    }
    
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    let animationId;
    
    const updateLevel = () => {
      analyser.getByteTimeDomainData(dataArray);
      
      let maxSample = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        maxSample = Math.max(maxSample, Math.abs(v));
      }
      
      onLevel(maxSample);
      
      animationId = requestAnimationFrame(updateLevel);
    };
    
    updateLevel();
    
    // Return cleanup function
    return () => {
      cancelAnimationFrame(animationId);
      stream.getTracks().forEach(track => track.stop());
      source.disconnect();
    };
    
  } catch (error) {
    console.error('Microphone test failed:', error);
    throw error;
  }
}

// Setup event listeners for UI elements
if (cancelVoiceBtn) {
  cancelVoiceBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    }
    hideVoiceIndicator();
  });
}

if (stopAudioBtn) {
  stopAudioBtn.addEventListener('click', () => {
    stopSpeaking();
  });
}

// Initialize audio context on first user interaction
document.addEventListener('click', () => {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}, { once: true });

export class AudioManager {
  async checkMicrophonePermission() { return checkMicrophonePermission(); }
  async recordAndTranscribe() { return recordAndTranscribe(); }
  async speak(text) { return speak(text); }
  async stopSpeaking() { return stopSpeaking(); }
  isCurrentlySpeaking() { return isCurrentlySpeaking(); }
  isCurrentlyRecording() { return isCurrentlyRecording(); }
  onRecordingComplete(callback) { onRecordingComplete(callback); }
}

// Export all functions
export default {
  startRecording,
  stopRecording,
  recordAndTranscribe,
  speak,
  stopSpeaking,
  checkMicrophonePermission,
  checkAudioSupport,
  isCurrentlySpeaking,
  isCurrentlyRecording,
  onRecordingComplete,
  offRecordingComplete,
  getAudioDevices,
  testMicrophone
};