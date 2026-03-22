/**
 * Main Application Logic for Vision Assistant
 * Handles auto mode, query mode, and UI integration
 */

import { CameraManager } from './camera.js';
import { AIService } from './ai-service.js';
import { AudioManager } from './audio.js';
import { 
  debounce, 
  showStatus, 
  addToLog, 
  checkBrowserSupport, 
  showCompatibilityWarning,
  shouldSpeak,
  updateDetectionHistory,
  clearDetectionHistory
} from './utils.js';

// DOM Elements
const autoModeBtn = document.getElementById('autoModeBtn');
const queryModeBtn = document.getElementById('queryModeBtn');
const mainActionBtn = document.getElementById('mainActionBtn');
const stopAudioBtn = document.getElementById('stopAudioBtn');
const currentModeSpan = document.getElementById('currentMode');
const lastDetectionDiv = document.getElementById('lastDetection');
const autoModeStatus = document.getElementById('autoModeStatus');
const detectionLog = document.getElementById('detectionLog');
const clearLogBtn = document.getElementById('clearLogBtn');
const privacyInfoBtn = document.getElementById('privacyInfoBtn');
const helpBtn = document.getElementById('helpBtn');
const privacyModal = document.getElementById('privacyModal');
const helpModal = document.getElementById('helpModal');
const modalCloses = document.querySelectorAll('.modal-close');
const voiceIndicator = document.getElementById('voiceIndicator');
const voiceText = document.querySelector('.voice-text');

// Application State
let cameraManager = null;
let aiService = null;
let audioManager = null;
let isAutoModeActive = false;
let autoModeInterval = null;
let currentFrame = null;
let isProcessingFrame = false;
let lastDetection = null;
let detectionHistory = new Map(); // Track object detection history for debouncing
let isQueryModeActive = false;
let currentQueryState = 'idle'; // idle, listening, transcribing, analyzing, speaking
let queryAbortController = null;

// Configuration
const AUTO_MODE_INTERVAL = 2000; // 2 seconds between captures
const DEBOUNCE_COOLDOWN = 5000; // 5 seconds cooldown for same object
const MIN_CONFIDENCE_THRESHOLD = 0.6; // Minimum confidence for detection

/**
 * Initialize the application
 */
async function init() {
  try {
    showStatus('Initializing Vision Assistant...');
    addToLog('System', 'Starting initialization...');
    
    // Check browser compatibility
    const isCompatible = showCompatibilityWarning();
    if (!isCompatible) {
      showStatus('Browser not fully compatible. Some features may not work.', 'warning');
    }
    
    // Initialize managers (without AI yet)
    audioManager = new AudioManager();
    aiService = new AIService();
    cameraManager = new CameraManager();
    
    // Set up frame callback (before camera init)
    cameraManager.onFrame(handleFrameCapture);
    
    // Set up audio recording callback
    if (audioManager.onRecordingComplete) {
      audioManager.onRecordingComplete(handleRecordingComplete);
    }
    
    // Show loading overlay
    showModelLoading(true);
    
    // Try to initialize AI, but don't block camera
    let aiAvailable = false;
    try {
      const initResult = await aiService.initializeRunAnywhere();
      if (!initResult.success) {
        throw new Error(initResult.error || 'AI initialization failed');
      }
      addToLog('System', `AI initialized with ${initResult.backend} backend`);
      
      // Download models (with timeout to avoid infinite hang)
      const downloadPromise = aiService.downloadModels((modelKey, progress, message) => {
        updateModelProgress(modelKey, progress, message);
      });
      
      // Set a timeout for model download (5 minutes)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Model download timeout')), 300000)
      );
      
      await Promise.race([downloadPromise, timeoutPromise]);
      
      // Load models
      await aiService.loadModels((modelKey, status, isError) => {
        updateModelLoadStatus(modelKey, status, isError);
      });
      
      aiAvailable = true;
      addToLog('System', 'AI models ready');
      
    } catch (aiError) {
      console.error('AI initialization failed:', aiError);
      addToLog('Error', `AI not available: ${aiError.message}`, 'error');
      showStatus('AI models failed to load. Camera will work but AI features disabled.', 'error');
      // Continue without AI
    }
    
    // Store AI availability globally
    window.__aiAvailable = aiAvailable;
    
    // Initialize camera (always attempt, even if AI failed)
    const cameraInitialized = await cameraManager.init();
    if (!cameraInitialized) {
      throw new Error('Camera initialization failed');
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Hide loading overlay
    showModelLoading(false);
    
    showStatus('Vision Assistant ready! Choose a mode to begin.');
    addToLog('System', 'Ready for action');
    
  } catch (error) {
    console.error('Initialization error:', error);
    showStatus(`Initialization failed: ${error.message}`, 'error');
    addToLog('Error', error.message, 'error');
    showModelLoading(false); // Ensure overlay hides even on error
  }
}

/**
 * Handle frame capture from camera
 * @param {HTMLVideoElement} video - Video element
 */
function handleFrameCapture(video) {
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
    return;
  }
  
  // Store current frame for query mode
  currentFrame = video;
  
  // Process frame if auto mode is active
  if (isAutoModeActive && !isProcessingFrame) {
    processAutoModeFrame(video);
  }
}

// ============================================================================
// QUERY MODE IMPLEMENTATION
// ============================================================================

/**
 * Activate query mode
 */
async function activateQueryMode() {
  // Stop auto mode if active
  if (isAutoModeActive) {
    toggleAutoMode();
  }
  
  isQueryModeActive = true;
  
  // Update UI
  queryModeBtn.classList.add('active');
  queryModeBtn.setAttribute('aria-checked', 'true');
  currentModeSpan.textContent = 'Query Mode';
  currentModeSpan.className = 'mode-indicator mode-query';
  
  // Update main action button
  if (mainActionBtn) {
    const actionIcon = mainActionBtn.querySelector('.action-icon');
    const actionText = mainActionBtn.querySelector('.action-text');
    if (actionIcon) actionIcon.textContent = '🎤';
    if (actionText) actionText.textContent = 'Ask Question';
    mainActionBtn.classList.add('query-mode');
    mainActionBtn.disabled = false;
  }
  
  showStatus('Query mode active - Press the microphone to ask a question');
  addToLog('Query Mode', 'Ready for questions - Press the microphone button');
  
  // Reset state
  currentQueryState = 'idle';
}

/**
 * Deactivate query mode
 */
function deactivateQueryMode() {
  isQueryModeActive = false;
  
  // Cancel any ongoing query
  if (queryAbortController) {
    queryAbortController.abort();
    queryAbortController = null;
  }
  
  // Hide voice indicator if visible
  hideVoiceIndicator();
  
  // Update UI
  queryModeBtn.classList.remove('active');
  queryModeBtn.setAttribute('aria-checked', 'false');
  
  if (!isAutoModeActive) {
    currentModeSpan.textContent = 'Idle';
    currentModeSpan.className = 'mode-indicator mode-idle';
  }
  
  // Reset main action button
  if (mainActionBtn) {
    const actionIcon = mainActionBtn.querySelector('.action-icon');
    const actionText = mainActionBtn.querySelector('.action-text');
    if (actionIcon) actionIcon.textContent = '🎯';
    if (actionText) actionText.textContent = 'Start Auto Mode';
    mainActionBtn.classList.remove('query-mode');
    mainActionBtn.disabled = false;
  }
  
  currentQueryState = 'idle';
  showStatus('Query mode deactivated');
}

/**
 * Handle query mode action (record and answer)
 */
async function handleQueryMode() {
  // Check if query mode is active
  if (!isQueryModeActive) {
    activateQueryMode();
    return;
  }
  
  // Don't start new query if already processing
  if (currentQueryState !== 'idle') {
    showStatus('Already processing a question. Please wait...', 'warning');
    return;
  }
  
  try {
    // Check microphone permission
    const hasPermission = await audioManager.checkMicrophonePermission();
    if (!hasPermission) {
      showStatus('Microphone access required for query mode. Please grant permission and refresh.', 'error');
      addToLog('Query Mode', 'Microphone permission denied', 'error');
      return;
    }
    
    // Start query
    await startQuery();
    
  } catch (error) {
    console.error('Query mode error:', error);
    handleQueryError(error);
  }
}

/**
 * Start the query process
 */
async function startQuery() {
  // Create abort controller for this query
  queryAbortController = new AbortController();
  
  try {
    // Phase 1: Listening
    setQueryState('listening');
    showStatus('Listening... Speak your question now', 'info');
    addToLog('Query Mode', '🎤 Listening for your question...');
    
    // Record and transcribe
    const question = await audioManager.recordAndTranscribe();
    
    // Check if aborted
    if (queryAbortController.signal.aborted) {
      return;
    }
    
    if (!question || question.trim() === '') {
      throw new Error('No speech detected');
    }
    
    // Phase 2: Transcribing complete
    setQueryState('transcribing');
    showStatus(`Question: "${question}" - Analyzing...`, 'info');
    addToLog('You', question, 'user');
    
    // Phase 3: Analyzing scene
    setQueryState('analyzing');
    showStatus('Analyzing scene...', 'info');
    
    // Capture current camera frame
    const imageData = await captureCurrentFrame();
    
    // Get VLM description of the scene
    let sceneDescription = '';
    if (imageData && aiService.isModelReady('vlm')) {
      const vlmPrompt = "Describe what you see in detail. Focus on objects, people, colors, positions, and any notable details. Be concise but informative.";
      sceneDescription = await aiService.analyzeImage(imageData, vlmPrompt);
      
      if (sceneDescription) {
        addToLog('Vision', sceneDescription, 'assistant');
      }
    } else if (imageData) {
      addToLog('Vision', 'VLM model not ready, using text-only response', 'warning');
    }
    
    // Check if aborted
    if (queryAbortController.signal.aborted) {
      return;
    }
    
    // Phase 4: Generating answer with LLM
    setQueryState('generating');
    showStatus('Generating answer...', 'info');
    
    // Build combined prompt for LLM
    const answer = await generateAnswer(question, sceneDescription);
    
    if (!answer || answer.trim() === '') {
      throw new Error('Failed to generate answer');
    }
    
    // Phase 5: Speaking response
    setQueryState('speaking');
    showStatus(`Answer: ${answer.substring(0, 100)}...`, 'success');
    addToLog('Assistant', answer, 'assistant');
    
    // Speak the answer
    await audioManager.speak(answer);
    
    // Phase 6: Complete
    setQueryState('idle');
    showStatus('Query complete. Press microphone for another question.', 'success');
    
    // Update last detection with query info
    updateLastQueryResult(question, answer);
    
  } catch (error) {
    if (error.message === 'No speech detected') {
      showStatus('No speech detected. Please try again.', 'warning');
      addToLog('Query Mode', 'No speech detected', 'warning');
    } else if (error.name === 'AbortError') {
      addToLog('Query Mode', 'Query cancelled', 'info');
    } else {
      throw error;
    }
  } finally {
    queryAbortController = null;
    
    // Reset state if not already idle
    if (currentQueryState !== 'idle') {
      setQueryState('idle');
    }
  }
}

/**
 * Generate answer using LLM with context
 * @param {string} question - User's question
 * @param {string} sceneDescription - VLM description of scene
 * @returns {Promise<string>} Generated answer
 */
async function generateAnswer(question, sceneDescription) {
  // Build system prompt
  let systemPrompt = `You are a helpful vision assistant for visually impaired people. `;
  systemPrompt += `Provide clear, concise, and actionable answers. `;
  systemPrompt += `Keep responses under 50 words and focus on what's most important. `;
  systemPrompt += `Use a friendly, supportive tone.\n\n`;
  
  // Build context with scene description if available
  let userPrompt = '';
  if (sceneDescription && sceneDescription.trim()) {
    userPrompt += `Scene description: ${sceneDescription}\n\n`;
    userPrompt += `User's question: ${question}\n\n`;
    userPrompt += `Based on the scene described, provide a helpful answer.`;
  } else {
    userPrompt += `User's question: ${question}\n\n`;
    userPrompt += `Provide a helpful answer to assist the user.`;
  }
  
  // Add response guidelines
  userPrompt += `\n\nResponse guidelines:
  - Be concise and clear
  - Focus on actionable information
  - Mention objects and their positions if relevant
  - Use simple language
  - End with a brief suggestion if appropriate`;
  
  try {
    // Get streaming response from LLM
    const stream = await aiService.askLLM(userPrompt, {
      system: systemPrompt,
      question: question,
      hasScene: !!sceneDescription
    });
    
    // Collect stream into full answer
    let fullAnswer = '';
    for await (const chunk of stream) {
      if (queryAbortController?.signal.aborted) {
        throw new Error('AbortError');
      }
      fullAnswer += chunk.text;
      
      // Update UI with streaming response
      updateStreamingAnswer(fullAnswer);
    }
    
    // Clean up answer
    fullAnswer = fullAnswer.trim()
      .replace(/^["']|["']$/g, '') // Remove quotes
      .replace(/\n/g, ' ') // Replace newlines with spaces
      .replace(/\s+/g, ' '); // Normalize spaces
    
    return fullAnswer;
    
  } catch (error) {
    console.error('LLM generation error:', error);
    throw new Error(`Failed to generate answer: ${error.message}`);
  }
}

/**
 * Update UI with streaming answer
 * @param {string} partialAnswer - Partial answer text
 */
function updateStreamingAnswer(partialAnswer) {
  const statusMessage = document.getElementById('statusMessage');
  if (statusMessage) {
    const preview = partialAnswer.length > 80 
      ? partialAnswer.substring(0, 80) + '...' 
      : partialAnswer;
    statusMessage.innerHTML = `💭 Generating: ${preview}`;
  }
}

/**
 * Capture current frame from camera
 * @returns {Promise<string|null>} Base64 image data
 */
async function captureCurrentFrame() {
  if (!currentFrame) {
    console.warn('No current frame available');
    return null;
  }
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = currentFrame.videoWidth;
    canvas.height = currentFrame.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(currentFrame, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    canvas.remove();
    return imageData;
  } catch (error) {
    console.error('Frame capture error:', error);
    return null;
  }
}

/**
 * Handle recording completion from audio manager
 * @param {Blob} audioBlob - Recorded audio blob
 */
function handleRecordingComplete(audioBlob) {
  // This is called when audio recording completes
  // We're already handling this in recordAndTranscribe
  console.log('Recording complete, size:', audioBlob.size);
}

/**
 * Set query state and update UI accordingly
 * @param {string} state - New state (idle, listening, transcribing, analyzing, generating, speaking)
 */
function setQueryState(state) {
  currentQueryState = state;
  
  // Update voice indicator based on state
  switch (state) {
    case 'listening':
      showVoiceIndicator('Listening... Speak your question', 'listening');
      if (mainActionBtn) {
        mainActionBtn.disabled = true;
      }
      break;
      
    case 'transcribing':
      showVoiceIndicator('Processing your speech...', 'processing');
      break;
      
    case 'analyzing':
      showVoiceIndicator('Analyzing the scene...', 'processing');
      break;
      
    case 'generating':
      showVoiceIndicator('Generating answer...', 'processing');
      break;
      
    case 'speaking':
      showVoiceIndicator('Speaking answer...', 'speaking');
      break;
      
    case 'idle':
      hideVoiceIndicator();
      if (mainActionBtn) {
        mainActionBtn.disabled = false;
      }
      break;
  }
  
  // Update status message
  const statusMessages = {
    listening: '🎤 Listening... Speak your question',
    transcribing: '📝 Transcribing your question...',
    analyzing: '🔍 Analyzing the scene...',
    generating: '🧠 Generating answer...',
    speaking: '🔊 Speaking answer...',
    idle: 'Ready for your next question'
  };
  
  if (statusMessages[state]) {
    showStatus(statusMessages[state], 'info');
  }
}

/**
 * Show voice indicator with custom message
 * @param {string} message - Message to display
 * @param {string} type - Type of indicator (listening, processing, speaking)
 */
function showVoiceIndicator(message, type = 'listening') {
  if (voiceIndicator) {
    voiceIndicator.classList.remove('hidden');
    
    // Update styling based on type
    voiceIndicator.className = 'voice-indicator';
    voiceIndicator.classList.add(type);
    
    if (voiceText) {
      voiceText.textContent = message;
    }
  }
}

/**
 * Hide voice indicator
 */
function hideVoiceIndicator() {
  if (voiceIndicator) {
    voiceIndicator.classList.add('hidden');
    voiceIndicator.classList.remove('listening', 'processing', 'speaking');
  }
}

/**
 * Handle query errors
 * @param {Error} error - Error object
 */
function handleQueryError(error) {
  console.error('Query error:', error);
  
  let errorMessage = '';
  let userMessage = '';
  
  switch (error.message) {
    case 'No speech detected':
      errorMessage = 'No speech detected. Please speak clearly and try again.';
      userMessage = 'No speech detected';
      break;
    case 'Microphone access denied':
      errorMessage = 'Microphone access is required for voice queries. Please grant permission and refresh.';
      userMessage = 'Microphone permission denied';
      break;
    case 'Recording too short':
      errorMessage = 'Recording was too short. Please speak for at least 1 second.';
      userMessage = 'Recording too short';
      break;
    default:
      errorMessage = `Sorry, I encountered an error: ${error.message}. Please try again.`;
      userMessage = error.message;
  }
  
  showStatus(errorMessage, 'error');
  addToLog('Query Error', userMessage, 'error');
  
  // Try to speak error message if appropriate
  if (errorMessage.length < 150) {
    audioManager.speak(errorMessage).catch(e => console.error('Error speaking:', e));
  }
  
  // Reset state
  setQueryState('idle');
  
  // Hide voice indicator after delay
  setTimeout(() => {
    hideVoiceIndicator();
  }, 3000);
}

/**
 * Update last query result in UI
 * @param {string} question - User's question
 * @param {string} answer - Assistant's answer
 */
function updateLastQueryResult(question, answer) {
  if (lastDetectionDiv) {
    const timestamp = new Date().toLocaleTimeString();
    lastDetectionDiv.innerHTML = `
      <div class="query-result">
        <div class="query-question">
          <span class="query-label">Q:</span>
          <span class="query-text">${escapeHtml(question)}</span>
        </div>
        <div class="query-answer">
          <span class="query-label">A:</span>
          <span class="query-text">${escapeHtml(answer.substring(0, 100))}${answer.length > 100 ? '...' : ''}</span>
        </div>
        <div class="query-time">${timestamp}</div>
      </div>
    `;
  }
}

/**
 * Cancel current query
 */
function cancelCurrentQuery() {
  if (queryAbortController) {
    queryAbortController.abort();
    queryAbortController = null;
  }
  
  // Stop any ongoing recording
  if (audioManager && audioManager.isCurrentlyRecording()) {
    audioManager.stopRecording();
  }
  
  // Stop any ongoing speech
  if (audioManager) {
    audioManager.stopSpeaking();
  }
  
  setQueryState('idle');
  showStatus('Query cancelled', 'info');
  addToLog('Query Mode', 'Cancelled by user');
  hideVoiceIndicator();
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// AUTO MODE IMPLEMENTATION (Previous code continues)
// ============================================================================

/**
 * Process frame for auto mode detection
 * @param {HTMLVideoElement} video - Video element
 */
async function processAutoModeFrame(video) {
  if (isProcessingFrame) return;
  
  isProcessingFrame = true;
  
  try {
    // Capture frame as base64
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    canvas.remove();
    
    // Update status
    if (autoModeStatus) {
      autoModeStatus.querySelector('.status-text')?.setAttribute('data-text', 'Analyzing scene...');
    }
    
    // Analyze with VLM
    const prompt = "Describe important objects, people, or obstacles in front of me. Be brief and focus on what's most relevant. List key objects only.";
    const analysis = await aiService.analyzeImage(imageData, prompt);
    
    if (analysis && analysis.trim()) {
      handleDetectionResult(analysis);
    }
    
    // Update last detection time
    updateAutoModeStatus(true);
    
  } catch (error) {
    console.error('Auto mode frame processing error:', error);
    addToLog('Auto Mode', `Error: ${error.message}`, 'error');
  } finally {
    isProcessingFrame = false;
  }
}

/**
 * Handle detection result from VLM
 * @param {string} analysis - Analysis text from VLM
 */
function handleDetectionResult(analysis) {
  // Extract key objects from analysis
  const objects = extractKeyObjects(analysis);
  
  // Track which objects to speak
  const objectsToSpeak = [];
  
  for (const object of objects) {
    // Check if we should speak this object based on cooldown
    if (shouldSpeak(object.name, DEBOUNCE_COOLDOWN, detectionHistory)) {
      objectsToSpeak.push(object);
      // Update detection history
      updateDetectionHistory(object.name, detectionHistory);
    }
  }
  
  // Speak new objects if any
  if (objectsToSpeak.length > 0) {
    const message = formatDetectionMessage(objectsToSpeak);
    speakDetection(message);
    
    // Update last detection in UI
    updateLastDetection(analysis, objectsToSpeak);
    
    // Add to log
    addToLog('Auto Mode', `Detected: ${message}`);
  }
  
  // Always update status with full analysis
  updateAutoModeStatus(true, analysis);
}

/**
 * Extract key objects from VLM analysis text
 * @param {string} analysis - Analysis text
 * @returns {Array} Array of objects with name and confidence
 */
function extractKeyObjects(analysis) {
  const objects = [];
  
  // Common objects to look for
  const commonObjects = [
    'person', 'people', 'man', 'woman', 'child',
    'car', 'vehicle', 'truck', 'bus', 'bicycle',
    'dog', 'cat', 'pet', 'animal',
    'chair', 'table', 'desk', 'furniture',
    'door', 'window', 'wall', 'obstacle',
    'stairs', 'steps', 'railing',
    'food', 'drink', 'cup', 'bottle',
    'phone', 'laptop', 'screen',
    'book', 'newspaper', 'magazine'
  ];
  
  const lowerAnalysis = analysis.toLowerCase();
  
  for (const obj of commonObjects) {
    if (lowerAnalysis.includes(obj)) {
      // Extract the actual object from the text with context
      const index = lowerAnalysis.indexOf(obj);
      const context = lowerAnalysis.substring(Math.max(0, index - 20), Math.min(lowerAnalysis.length, index + obj.length + 20));
      
      objects.push({
        name: obj,
        confidence: calculateConfidence(context, obj),
        context: context.trim()
      });
    }
  }
  
  // If no common objects found, try to extract any noun phrases
  if (objects.length === 0) {
    const words = analysis.split(' ');
    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase().replace(/[^\w]/g, '');
      if (word.length > 3 && !isStopWord(word)) {
        objects.push({
          name: word,
          confidence: 0.5,
          context: analysis.substring(0, 50)
        });
        break; // Only take one
      }
    }
  }
  
  // Sort by confidence
  objects.sort((a, b) => b.confidence - a.confidence);
  
  return objects;
}

/**
 * Calculate confidence score for detection
 * @param {string} context - Surrounding context
 * @param {string} objectName - Detected object
 * @returns {number} Confidence score (0-1)
 */
function calculateConfidence(context, objectName) {
  let confidence = 0.5; // Base confidence
  
  // Boost confidence based on context words
  const boostWords = ['clear', 'directly', 'front', 'near', 'close', 'large', 'important'];
  for (const word of boostWords) {
    if (context.includes(word)) {
      confidence += 0.1;
    }
  }
  
  // Boost if object appears multiple times
  const matches = (context.match(new RegExp(objectName, 'g')) || []).length;
  confidence += Math.min(matches * 0.05, 0.2);
  
  return Math.min(confidence, 0.95);
}

/**
 * Check if word is a stop word (common word not worth detecting)
 * @param {string} word - Word to check
 * @returns {boolean} True if stop word
 */
function isStopWord(word) {
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'];
  return stopWords.includes(word);
}

/**
 * Format detection message for speech
 * @param {Array} objects - Objects to speak
 * @returns {string} Formatted message
 */
function formatDetectionMessage(objects) {
  if (objects.length === 0) return '';
  
  if (objects.length === 1) {
    return `I see a ${objects[0].name}`;
  } else if (objects.length === 2) {
    return `I see a ${objects[0].name} and a ${objects[1].name}`;
  } else {
    const firstTwo = objects.slice(0, 2).map(o => `a ${o.name}`).join(' and ');
    return `I see ${firstTwo} and ${objects.length - 2} other objects`;
  }
}

/**
 * Speak detection message
 * @param {string} message - Message to speak
 */
function speakDetection(message) {
  if (!message) return;
  
  // Use debounced speech to avoid rapid-fire announcements
  debouncedSpeak(message);
}

/**
 * Debounced speech for auto mode
 */
const debouncedSpeak = debounce((message) => {
  if (isAutoModeActive) {
    audioManager.speak(message);
    showStatus(`Auto Mode: ${message}`, 'info');
  }
}, 2000); // 2 second debounce between speeches

/**
 * Update last detection in UI
 * @param {string} fullAnalysis - Full analysis text
 * @param {Array} objects - Detected objects
 */
function updateLastDetection(fullAnalysis, objects) {
  if (lastDetectionDiv) {
    const timestamp = new Date().toLocaleTimeString();
    const objectSummary = objects.length > 0 
      ? objects.map(o => o.name).join(', ')
      : fullAnalysis.substring(0, 50);
    
    lastDetectionDiv.innerHTML = `
      <span class="detection-time">[${timestamp}]</span>
      <span class="detection-content">${escapeHtml(objectSummary)}</span>
    `;
    
    lastDetection = {
      timestamp: Date.now(),
      objects: objects,
      fullAnalysis: fullAnalysis
    };
  }
}

/**
 * Update auto mode status in UI
 * @param {boolean} active - Whether auto mode is active
 * @param {string} lastAnalysis - Last analysis text
 */
function updateAutoModeStatus(active, lastAnalysis = null) {
  if (autoModeStatus) {
    if (active) {
      autoModeStatus.classList.remove('hidden');
      if (lastAnalysis) {
        const statusText = autoModeStatus.querySelector('.status-text');
        if (statusText) {
          statusText.textContent = `Analyzing: ${lastAnalysis.substring(0, 50)}...`;
        }
      }
    } else {
      autoModeStatus.classList.add('hidden');
    }
  }
}

/**
 * Toggle auto mode on/off
 */
async function toggleAutoMode() {
  if (isAutoModeActive) {
    // Stop auto mode
    isAutoModeActive = false;
    
    if (autoModeInterval) {
      clearInterval(autoModeInterval);
      autoModeInterval = null;
    }
    
    // Update UI
    autoModeBtn.classList.remove('active');
    autoModeBtn.setAttribute('aria-checked', 'false');
    currentModeSpan.textContent = 'Idle';
    currentModeSpan.className = 'mode-indicator mode-idle';
    
    // Update main action button
    if (mainActionBtn) {
      const actionIcon = mainActionBtn.querySelector('.action-icon');
      const actionText = mainActionBtn.querySelector('.action-text');
      if (actionIcon) actionIcon.textContent = '🎯';
      if (actionText) actionText.textContent = 'Start Auto Mode';
      mainActionBtn.classList.remove('query-mode');
      mainActionBtn.disabled = false;
    }
    
    updateAutoModeStatus(false);
    showStatus('Auto mode stopped');
    addToLog('Auto Mode', 'Stopped');
    
  } else {
    // Start auto mode
    // Stop query mode if active
    if (isQueryModeActive) {
      deactivateQueryMode();
    }
    
    isAutoModeActive = true;
    
    // Update UI
    autoModeBtn.classList.add('active');
    autoModeBtn.setAttribute('aria-checked', 'true');
    currentModeSpan.textContent = 'Auto Mode';
    currentModeSpan.className = 'mode-indicator mode-auto';
    
    // Update main action button
    if (mainActionBtn) {
      const actionIcon = mainActionBtn.querySelector('.action-icon');
      const actionText = mainActionBtn.querySelector('.action-text');
      if (actionIcon) actionIcon.textContent = '⏸️';
      if (actionText) actionText.textContent = 'Pause Auto Mode';
      mainActionBtn.classList.remove('query-mode');
      mainActionBtn.disabled = false;
    }
    
    updateAutoModeStatus(true);
    showStatus('Auto mode active - analyzing scene continuously');
    addToLog('Auto Mode', 'Started - Scene analysis active');
    
    // Clear detection history when starting auto mode
    clearDetectionHistory(detectionHistory);
    
    // Trigger first frame immediately
    if (currentFrame) {
      processAutoModeFrame(currentFrame);
    }
  }
}

/**
 * Pause auto mode (keep state but stop processing)
 */
function pauseAutoMode() {
  if (isAutoModeActive) {
    if (autoModeInterval) {
      clearInterval(autoModeInterval);
      autoModeInterval = null;
    }
    
    updateAutoModeStatus(false);
    showStatus('Auto mode paused');
    addToLog('Auto Mode', 'Paused');
  }
}

/**
 * Resume auto mode
 */
function resumeAutoMode() {
  if (isAutoModeActive) {
    updateAutoModeStatus(true);
    showStatus('Auto mode resumed');
    addToLog('Auto Mode', 'Resumed');
    
    // Trigger immediate frame
    if (currentFrame) {
      processAutoModeFrame(currentFrame);
    }
  }
}

/**
 * Stop all audio output
 */
function stopAllAudio() {
  audioManager.stopSpeaking();
  showStatus('Audio stopped', 'info');
  addToLog('System', 'Audio playback stopped');
}

/**
 * Update model loading progress in UI
 * @param {string} modelKey - Model identifier
 * @param {number} progress - Progress percentage
 * @param {string} message - Status message
 */
function updateModelProgress(modelKey, progress, message) {
  const progressBar = document.getElementById('progressBar');
  const loadingStatus = document.getElementById('loadingStatus');
  
  if (progressBar) {
    const totalProgress = calculateTotalProgress();
    progressBar.style.width = `${totalProgress}%`;
  }
  
  if (loadingStatus) {
    loadingStatus.textContent = message || `Loading ${modelKey}... ${progress}%`;
  }
}

/**
 * Update model load status
 * @param {string} modelKey - Model identifier
 * @param {string} status - Status message
 * @param {boolean} isError - Whether this is an error
 */
function updateModelLoadStatus(modelKey, status, isError) {
  const loadingStatus = document.getElementById('loadingStatus');
  if (loadingStatus && !isError) {
    loadingStatus.textContent = status;
  }
}

/**
 * Calculate total download progress
 * @returns {number} Total progress percentage
 */
function calculateTotalProgress() {
  const status = aiService?.getModelStatus();
  if (!status) return 0;
  
  let total = 0;
  let count = 0;
  
  for (const [key, model] of Object.entries(status.models)) {
    if (model.progress !== undefined) {
      total += model.progress;
      count++;
    }
  }
  
  return count > 0 ? Math.round(total / count) : 0;
}

/**
 * Show/hide model loading overlay
 * @param {boolean} show - Show or hide
 */
ffunction showModelLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    if (show) {
      overlay.classList.remove('hidden');
      // Safety timeout: hide after 10 seconds to avoid infinite loading
      setTimeout(() => {
        if (overlay && !overlay.classList.contains('hidden')) {
          console.warn('Loading overlay timed out');
          overlay.classList.add('hidden');
          showStatus('Model loading timed out. Camera may still work.', 'warning');
        }
      }, 10000);
    } else {
      overlay.classList.add('hidden');
    }
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Mode buttons
  if (autoModeBtn) {
    autoModeBtn.addEventListener('click', toggleAutoMode);
  }
  
  if (queryModeBtn) {
    queryModeBtn.addEventListener('click', () => {
      if (isQueryModeActive) {
        deactivateQueryMode();
      } else {
        activateQueryMode();
      }
    });
  }
  
  // Main action button
  if (mainActionBtn) {
    mainActionBtn.addEventListener('click', () => {
      if (isAutoModeActive) {
        if (autoModeInterval) {
          pauseAutoMode();
        } else {
          resumeAutoMode();
        }
      } else if (isQueryModeActive) {
        handleQueryMode();
      } else {
        // Default to auto mode
        toggleAutoMode();
      }
    });
  }
  
  // Stop audio button
  if (stopAudioBtn) {
    stopAudioBtn.addEventListener('click', stopAllAudio);
  }
  
  // Clear log button
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      if (detectionLog) {
        detectionLog.innerHTML = '';
        addToLog('System', 'Log cleared');
      }
    });
  }
  
  // Cancel voice button in voice indicator
  const cancelVoiceBtn = document.getElementById('cancelVoiceBtn');
  if (cancelVoiceBtn) {
    cancelVoiceBtn.addEventListener('click', cancelCurrentQuery);
  }
  
  // Modal handling
  if (privacyInfoBtn) {
    privacyInfoBtn.addEventListener('click', () => {
      if (privacyModal) {
        privacyModal.classList.remove('hidden');
      }
    });
  }
  
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      if (helpModal) {
        helpModal.classList.remove('hidden');
      }
    });
  }
  
  // Close modals
  modalCloses.forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
      if (privacyModal) privacyModal.classList.add('hidden');
      if (helpModal) helpModal.classList.add('hidden');
    });
  });
  
  // Close modals on background click
  window.addEventListener('click', (event) => {
    if (event.target === privacyModal) {
      privacyModal.classList.add('hidden');
    }
    if (event.target === helpModal) {
      helpModal.classList.add('hidden');
    }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    // Spacebar to trigger main action
    if (event.code === 'Space' && document.activeElement !== mainActionBtn) {
      event.preventDefault();
      if (mainActionBtn && !mainActionBtn.disabled) {
        mainActionBtn.click();
      }
    }
    
    // Escape to cancel current operation
    if (event.code === 'Escape') {
      if (isQueryModeActive && currentQueryState !== 'idle') {
        cancelCurrentQuery();
      } else if (audioManager.isCurrentlySpeaking()) {
        stopAllAudio();
      }
    }
    
    // 'A' key for auto mode toggle
    if (event.code === 'KeyA' && !event.ctrlKey && !event.metaKey) {
      toggleAutoMode();
    }
    
    // 'Q' key for query mode toggle
    if (event.code === 'KeyQ' && !event.ctrlKey && !event.metaKey) {
      if (isQueryModeActive) {
        deactivateQueryMode();
      } else {
        activateQueryMode();
      }
    }
  });
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', init);

// Export for testing
export default {
  init,
  toggleAutoMode,
  pauseAutoMode,
  resumeAutoMode,
  activateQueryMode,
  deactivateQueryMode,
  handleQueryMode,
  stopAllAudio,
  cancelCurrentQuery
};