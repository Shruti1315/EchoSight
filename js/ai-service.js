/**
 * AI Service Module - Wraps RunAnywhere Web SDK for offline AI processing
 * Handles model downloads, loading, and inference for STT, TTS, LLM, and VLM
 */

import { RunAnywhere } from '@runanywhere/web';

// Model configurations
const MODELS = {
  stt: {
    name: 'whisper-tiny',
    displayName: 'Speech Recognition',
    size: 75 * 1024 * 1024, // 75MB
    type: 'stt',
    required: true
  },
  tts: {
    name: 'piper-en-us',
    displayName: 'Text-to-Speech',
    size: 65 * 1024 * 1024, // 65MB
    type: 'tts',
    required: true
  },
  llm: {
    name: 'smollm2-360m',
    displayName: 'Language Model',
    size: 400 * 1024 * 1024, // 400MB
    type: 'llm',
    required: true
  },
  vlm: {
    name: 'qwen-vl',
    displayName: 'Vision Model',
    size: 2 * 1024 * 1024 * 1024, // 2GB
    type: 'vlm',
    required: false, // Optional, fallback to LLM if not available
    webgpuRequired: true
  }
};
// Patch missing SDKEnvironment (SDK bug)
if (typeof window.SDKEnvironment === 'undefined') {
  window.SDKEnvironment = {
    Development: 'development',
    Production: 'production',
    Test: 'test'
  };
}
// State management
let runAnywhereInstance = null;
let isInitialized = false;
let modelsLoaded = {
  stt: false,
  tts: false,
  llm: false,
  vlm: false
};
let modelDownloadProgress = {
  stt: 0,
  tts: 0,
  llm: 0,
  vlm: 0
};
let totalProgress = 0;
let currentOperation = null;
let abortControllers = new Map();

/**
 * Check if WebGPU is supported
 * @returns {boolean} True if WebGPU is supported
 */
export function isWebGPUSupported() {
  return 'gpu' in navigator;
}

/**
 * Initialize RunAnywhere SDK
 * @returns {Promise<Object>} Initialization status
 */
export async function initializeRunAnywhere() {
  try {
    console.log('Initializing RunAnywhere SDK...');
    
    const webgpuSupported = isWebGPUSupported();
    if (!webgpuSupported) {
      console.warn('WebGPU not supported, falling back to WebGL');
    }
    
    // Create instance with environment option
    runAnywhereInstance = new RunAnywhere({
      backend: webgpuSupported ? 'webgpu' : 'webgl',
      cache: 'indexeddb',
      cachePrefix: 'vision_assistant',
      verbose: true,
      environment: 'development' // Explicitly set environment
    });
    
    // Wait for initialization
    await runAnywhereInstance.initialize();
    
    isInitialized = true;
    console.log('RunAnywhere SDK initialized successfully');
    
    return {
      success: true,
      webgpuSupported,
      backend: webgpuSupported ? 'webgpu' : 'webgl',
      version: runAnywhereInstance.version
    };
    
  } catch (error) {
    console.error('Failed to initialize RunAnywhere:', error);
    isInitialized = false;
    
    return {
      success: false,
      error: error.message,
      webgpuSupported: isWebGPUSupported()
    };
  }
}

/**
 * Download a single model with progress tracking
 * @param {string} modelKey - Key from MODELS object
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<boolean>} True if download successful
 */
async function downloadModel(modelKey, onProgress) {
  const model = MODELS[modelKey];
  if (!model) {
    throw new Error(`Unknown model: ${modelKey}`);
  }
  
  try {
    console.log(`Starting download of ${model.displayName}...`);
    
    // Create abort controller for this download
    const abortController = new AbortController();
    abortControllers.set(modelKey, abortController);
    
    // Check if model is already cached
    const isCached = await runAnywhereInstance.isModelCached(model.name);
    if (isCached) {
      console.log(`${model.displayName} already cached`);
      modelDownloadProgress[modelKey] = 100;
      if (onProgress) {
        onProgress(modelKey, 100, `${model.displayName} already cached`);
      }
      return true;
    }
    
    // Download model with progress
    await runAnywhereInstance.downloadModel(model.name, {
      onProgress: (progress) => {
        const percent = Math.round(progress * 100);
        modelDownloadProgress[modelKey] = percent;
        
        if (onProgress) {
          onProgress(modelKey, percent, `Downloading ${model.displayName}... ${percent}%`);
        }
        
        // Update total progress
        updateTotalProgress();
      },
      signal: abortController.signal
    });
    
    console.log(`${model.displayName} downloaded successfully`);
    modelDownloadProgress[modelKey] = 100;
    if (onProgress) {
      onProgress(modelKey, 100, `${model.displayName} ready`);
    }
    
    return true;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`${model.displayName} download cancelled`);
      return false;
    }
    
    console.error(`Failed to download ${model.displayName}:`, error);
    throw new Error(`Failed to download ${model.displayName}: ${error.message}`);
    
  } finally {
    abortControllers.delete(modelKey);
  }
}

/**
 * Update total download progress across all models
 */
function updateTotalProgress() {
  const models = Object.keys(MODELS).filter(key => MODELS[key].required);
  let total = 0;
  
  for (const key of models) {
    total += modelDownloadProgress[key] || 0;
  }
  
  totalProgress = Math.round(total / models.length);
}

/**
 * Download all required models
 * @param {Function} onProgress - Progress callback (modelKey, percent, message)
 * @returns {Promise<Object>} Download results
 */
export async function downloadModels(onProgress) {
  if (!isInitialized) {
    throw new Error('RunAnywhere not initialized. Call initializeRunAnywhere() first.');
  }
  
  const results = {
    success: {},
    failed: {},
    totalTime: 0
  };
  
  const startTime = Date.now();
  
  // Determine which models to download
  const modelsToDownload = [];
  for (const [key, model] of Object.entries(MODELS)) {
    if (model.required) {
      modelsToDownload.push(key);
    } else if (model.required === false && isWebGPUSupported()) {
      // Optional models only if WebGPU is supported
      modelsToDownload.push(key);
    }
  }
  
  console.log(`Downloading ${modelsToDownload.length} models...`);
  
  // Download models sequentially to avoid overwhelming network/storage
  for (let i = 0; i < modelsToDownload.length; i++) {
    const modelKey = modelsToDownload[i];
    const model = MODELS[modelKey];
    
    try {
      if (onProgress) {
        onProgress(modelKey, 0, `Starting download of ${model.displayName}...`);
      }
      
      const success = await downloadModel(modelKey, onProgress);
      
      if (success) {
        results.success[modelKey] = true;
      } else {
        results.failed[modelKey] = 'Download cancelled';
      }
      
    } catch (error) {
      console.error(`Error downloading ${modelKey}:`, error);
      results.failed[modelKey] = error.message;
      
      if (onProgress) {
        onProgress(modelKey, 0, `Failed: ${error.message}`, true);
      }
    }
  }
  
  results.totalTime = Date.now() - startTime;
  results.totalProgress = totalProgress;
  
  console.log(`Model download completed in ${results.totalTime}ms`, results);
  
  return results;
}

/**
 * Cancel ongoing model downloads
 * @param {string} modelKey - Specific model to cancel, or null for all
 */
export function cancelModelDownload(modelKey = null) {
  if (modelKey) {
    const controller = abortControllers.get(modelKey);
    if (controller) {
      controller.abort();
      abortControllers.delete(modelKey);
      console.log(`Cancelled download for ${modelKey}`);
    }
  } else {
    // Cancel all downloads
    for (const [key, controller] of abortControllers) {
      controller.abort();
      abortControllers.delete(key);
      console.log(`Cancelled download for ${key}`);
    }
  }
}

/**
 * Load a specific model into memory
 * @param {string} modelKey - Key from MODELS object
 * @returns {Promise<boolean>} True if loaded successfully
 */
async function loadModel(modelKey) {
  const model = MODELS[modelKey];
  if (!model) {
    throw new Error(`Unknown model: ${modelKey}`);
  }
  
  try {
    console.log(`Loading ${model.displayName} into memory...`);
    
    // Check if model is already loaded
    const isLoaded = await runAnywhereInstance.isModelLoaded(model.name);
    if (isLoaded) {
      console.log(`${model.displayName} already loaded`);
      modelsLoaded[modelKey] = true;
      return true;
    }
    
    // Load the model
    await runAnywhereInstance.loadModel(model.name);
    
    modelsLoaded[modelKey] = true;
    console.log(`${model.displayName} loaded successfully`);
    
    return true;
    
  } catch (error) {
    console.error(`Failed to load ${model.displayName}:`, error);
    modelsLoaded[modelKey] = false;
    throw new Error(`Failed to load ${model.displayName}: ${error.message}`);
  }
}

/**
 * Load all downloaded models into memory
 * @param {Function} onProgress - Progress callback (modelKey, status)
 * @returns {Promise<Object>} Loading results
 */
export async function loadModels(onProgress) {
  if (!isInitialized) {
    throw new Error('RunAnywhere not initialized. Call initializeRunAnywhere() first.');
  }
  
  const results = {
    success: {},
    failed: {},
    totalTime: 0
  };
  
  const startTime = Date.now();
  
  // Determine which models to load (only those that were downloaded)
  const modelsToLoad = [];
  for (const [key, model] of Object.entries(MODELS)) {
    if (model.required || (model.required === false && isWebGPUSupported())) {
      modelsToLoad.push(key);
    }
  }
  
  console.log(`Loading ${modelsToLoad.length} models...`);
  
  // Load models sequentially
  for (let i = 0; i < modelsToLoad.length; i++) {
    const modelKey = modelsToLoad[i];
    const model = MODELS[modelKey];
    
    try {
      if (onProgress) {
        onProgress(modelKey, `Loading ${model.displayName}...`);
      }
      
      await loadModel(modelKey);
      results.success[modelKey] = true;
      
      if (onProgress) {
        onProgress(modelKey, `${model.displayName} ready`);
      }
      
    } catch (error) {
      console.error(`Error loading ${modelKey}:`, error);
      results.failed[modelKey] = error.message;
      
      if (onProgress) {
        onProgress(modelKey, `Failed to load ${model.displayName}`, true);
      }
    }
  }
  
  results.totalTime = Date.now() - startTime;
  
  console.log(`Model loading completed in ${results.totalTime}ms`, results);
  
  return results;
}

/**
 * Transcribe audio using Whisper Tiny
 * @param {Blob|ArrayBuffer} audioBlob - Audio data to transcribe
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeAudio(audioBlob) {
  if (!isModelReady('stt')) {
    throw new Error('Speech recognition model not ready');
  }
  
  try {
    console.log('Starting transcription...');
    currentOperation = 'transcribe';
    
    // Convert blob to array buffer if needed
    let audioData = audioBlob;
    if (audioBlob instanceof Blob) {
      audioData = await audioBlob.arrayBuffer();
    }
    
    // Run STT inference
    const result = await runAnywhereInstance.run('whisper-tiny', {
      audio: audioData,
      language: 'en',
      task: 'transcribe',
      temperature: 0.0
    });
    
    const text = result.text || '';
    console.log(`Transcription result: "${text}"`);
    
    return text;
    
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  } finally {
    currentOperation = null;
  }
}

/**
 * Convert text to speech using Piper TTS
 * @param {string} text - Text to speak
 * @returns {Promise<AudioBuffer>} Audio buffer for playback
 */
export async function speakText(text) {
  if (!isModelReady('tts')) {
    throw new Error('Text-to-speech model not ready');
  }
  
  try {
    console.log(`Generating speech for: "${text.substring(0, 50)}..."`);
    currentOperation = 'tts';
    
    // Run TTS inference
    const result = await runAnywhereInstance.run('piper-en-us', {
      text: text,
      speaker: 0, // Default speaker
      speed: 1.0
    });
    
    // Convert audio data to AudioBuffer
    const audioBuffer = await audioDataToBuffer(result.audio);
    
    console.log('Speech generated successfully');
    return audioBuffer;
    
  } catch (error) {
    console.error('TTS error:', error);
    throw new Error(`Failed to generate speech: ${error.message}`);
  } finally {
    currentOperation = null;
  }
}

/**
 * Helper: Convert audio data to AudioBuffer
 * @param {ArrayBuffer} audioData - Raw audio data
 * @returns {Promise<AudioBuffer>} Audio buffer
 */
async function audioDataToBuffer(audioData) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(audioData);
  return audioBuffer;
}

/**
 * Query LLM with prompt and optional context
 * @param {string} prompt - User prompt
 * @param {Object} context - Additional context (optional)
 * @returns {Promise<AsyncIterable>} Stream of response tokens
 */
export async function askLLM(prompt, context = null) {
  if (!isModelReady('llm')) {
    throw new Error('Language model not ready');
  }
  
  try {
    console.log(`Querying LLM with prompt: "${prompt.substring(0, 50)}..."`);
    currentOperation = 'llm';
    
    // Build full prompt with context
    let fullPrompt = prompt;
    if (context) {
      fullPrompt = `Context: ${JSON.stringify(context)}\n\nQuestion: ${prompt}\n\nAnswer:`;
    }
    
    // Run LLM inference with streaming
    const stream = await runAnywhereInstance.run('smollm2-360m', {
      prompt: fullPrompt,
      max_tokens: 150,
      temperature: 0.7,
      top_p: 0.9,
      stream: true
    });
    
    return stream;
    
  } catch (error) {
    console.error('LLM error:', error);
    throw new Error(`Failed to query LLM: ${error.message}`);
  } finally {
    currentOperation = null;
  }
}

/**
 * Analyze image using VLM (Vision Language Model)
 * @param {string} imageData - Base64 encoded image
 * @param {string} prompt - Analysis prompt
 * @returns {Promise<string>} Analysis result
 */
export async function analyzeImage(imageData, prompt = "Describe what you see in this image") {
  // Try VLM first if available
  if (isModelReady('vlm')) {
    try {
      console.log('Analyzing image with VLM...');
      currentOperation = 'vlm';
      
      const result = await runAnywhereInstance.run('qwen-vl', {
        image: imageData,
        prompt: prompt,
        max_tokens: 100,
        temperature: 0.3
      });
      
      console.log('VLM analysis complete');
      return result.text;
      
    } catch (error) {
      console.error('VLM analysis failed:', error);
      // Fall back to LLM with basic description
      console.log('Falling back to LLM-based analysis...');
    }
  }
  
  // Fallback: Use LLM with generic description
  if (isModelReady('llm')) {
    const fallbackPrompt = `You are a vision assistant. Based on the following scene description from the user, answer concisely: ${prompt}`;
    const stream = await askLLM(fallbackPrompt);
    
    // Collect stream into single string
    let result = '';
    for await (const chunk of stream) {
      result += chunk.text;
    }
    
    return result;
  }
  
  throw new Error('No vision or language models available for analysis');
}

/**
 * Check if a specific model is ready for inference
 * @param {string} modelKey - Key from MODELS object
 * @returns {boolean} True if model is loaded and ready
 */
export function isModelReady(modelKey) {
  return modelsLoaded[modelKey] === true;
}

/**
 * Get current model status
 * @returns {Object} Status of all models
 */
export function getModelStatus() {
  return {
    initialized: isInitialized,
    models: {
      stt: { ready: modelsLoaded.stt, progress: modelDownloadProgress.stt },
      tts: { ready: modelsLoaded.tts, progress: modelDownloadProgress.tts },
      llm: { ready: modelsLoaded.llm, progress: modelDownloadProgress.llm },
      vlm: { ready: modelsLoaded.vlm, progress: modelDownloadProgress.vlm }
    },
    totalProgress: totalProgress,
    currentOperation: currentOperation,
    webgpuSupported: isWebGPUSupported()
  };
}

/**
 * Unload models to free memory
 * @param {string} modelKey - Specific model to unload, or null for all
 * @returns {Promise<void>}
 */
export async function unloadModels(modelKey = null) {
  if (!isInitialized) {
    return;
  }
  
  try {
    if (modelKey) {
      const model = MODELS[modelKey];
      if (model && modelsLoaded[modelKey]) {
        await runAnywhereInstance.unloadModel(model.name);
        modelsLoaded[modelKey] = false;
        console.log(`Unloaded ${model.displayName}`);
      }
    } else {
      // Unload all models
      for (const [key, model] of Object.entries(MODELS)) {
        if (modelsLoaded[key]) {
          await runAnywhereInstance.unloadModel(model.name);
          modelsLoaded[key] = false;
          console.log(`Unloaded ${model.displayName}`);
        }
      }
    }
  } catch (error) {
    console.error('Error unloading models:', error);
  }
}

/**
 * Get cached model sizes
 * @returns {Promise<Object>} Cache sizes per model
 */
export async function getCacheInfo() {
  if (!isInitialized) {
    return null;
  }
  
  try {
    const cacheInfo = {};
    for (const [key, model] of Object.entries(MODELS)) {
      const size = await runAnywhereInstance.getCachedModelSize(model.name);
      cacheInfo[key] = size;
    }
    return cacheInfo;
  } catch (error) {
    console.error('Error getting cache info:', error);
    return null;
  }
}

/**
 * Clear all cached models from IndexedDB
 * @returns {Promise<boolean>} True if cleared successfully
 */
export async function clearCache() {
  if (!isInitialized) {
    return false;
  }
  
  try {
    await unloadModels(); // Unload from memory first
    await runAnywhereInstance.clearCache();
    console.log('All model caches cleared');
    return true;
  } catch (error) {
    console.error('Error clearing cache:', error);
    return false;
  }
}

/**
 * Get current operation status
 * @returns {Object} Current operation info
 */
export function getCurrentOperation() {
  return {
    operation: currentOperation,
    isRunning: currentOperation !== null
  };
}
export class AIService {
  async initializeRunAnywhere() { return initializeRunAnywhere(); }
  async downloadModels(onProgress) { return downloadModels(onProgress); }
  async loadModels(onProgress) { return loadModels(onProgress); }
  async transcribeAudio(audioBlob) { return transcribeAudio(audioBlob); }
  async speakText(text) { return speakText(text); }
  async askLLM(prompt, context) { return askLLM(prompt, context); }
  async analyzeImage(imageData, prompt) { return analyzeImage(imageData, prompt); }
  isModelReady(modelKey) { return isModelReady(modelKey); }
  getModelStatus() { return getModelStatus(); }
  cancelModelDownload(modelKey) { cancelModelDownload(modelKey); }
  getCurrentOperation() { return getCurrentOperation(); }
  isWebGPUSupported() { return isWebGPUSupported(); }
}

// Export all functions
export default {
  initializeRunAnywhere,
  downloadModels,
  loadModels,
  transcribeAudio,
  speakText,
  askLLM,
  analyzeImage,
  isModelReady,
  getModelStatus,
  unloadModels,
  cancelModelDownload,
  getCacheInfo,
  clearCache,
  getCurrentOperation,
  isWebGPUSupported
};