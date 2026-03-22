// Main application entry point
import { CameraManager } from './camera.js';
import { AIService } from './ai-service.js';
import { AudioManager } from './audio.js';
import { debounce, showStatus, addToLog } from './utils.js';

class VisionAssistant {
  constructor() {
    this.cameraManager = null;
    this.aiService = null;
    this.audioManager = null;
    this.isAutoMode = false;
    this.autoModeInterval = null;
    this.currentFrame = null;
    
    this.init();
  }
  
  async init() {
    try {
      // Show model loading status
      this.showModelLoading(true);
      
      // Initialize services
      this.audioManager = new AudioManager();
      this.aiService = new AIService();
      this.cameraManager = new CameraManager();
      
      // Load AI models
      await this.aiService.loadModels((progress, status) => {
        this.updateModelProgress(progress, status);
      });
      
      // Initialize camera
      await this.cameraManager.init();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Hide loading screen
      this.showModelLoading(false);
      showStatus('Ready! Models loaded successfully. Start auto mode for continuous detection.');
      
    } catch (error) {
      console.error('Initialization error:', error);
      showStatus(`Error: ${error.message}`);
      this.showModelLoading(false);
    }
  }
  
  setupEventListeners() {
    // Auto mode button
    const autoBtn = document.getElementById('autoModeBtn');
    autoBtn.addEventListener('click', () => this.toggleAutoMode());
    
    // Query mode button
    const queryBtn = document.getElementById('queryModeBtn');
    queryBtn.addEventListener('click', () => this.startQueryMode());
    
    // Stop audio button
    const stopBtn = document.getElementById('stopAudioBtn');
    stopBtn.addEventListener('click', () => this.audioManager.stop());
    
    // Update camera frame for auto mode
    this.cameraManager.onFrame((video) => {
      if (this.isAutoMode) {
        this.processFrame(video);
      }
      this.currentFrame = video;
    });
  }
  
  async toggleAutoMode() {
    this.isAutoMode = !this.isAutoMode;
    const autoBtn = document.getElementById('autoModeBtn');
    
    if (this.isAutoMode) {
      autoBtn.textContent = '🔴 Stop Auto Mode';
      autoBtn.classList.add('btn-outline');
      autoBtn.classList.remove('btn-primary');
      showStatus('Auto mode active - continuous scene analysis');
      addToLog('Auto mode started. I will describe what I see.');
    } else {
      autoBtn.textContent = '🎯 Start Auto Mode';
      autoBtn.classList.add('btn-primary');
      autoBtn.classList.remove('btn-outline');
      showStatus('Auto mode stopped');
      addToLog('Auto mode stopped.');
      
      if (this.autoModeInterval) {
        clearInterval(this.autoModeInterval);
        this.autoModeInterval = null;
      }
    }
  }
  
  async processFrame(video) {
    if (!this.isAutoMode) return;
    
    // Capture frame from video
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const frameData = canvas.toDataURL('image/jpeg', 0.8);
    
    try {
      // Run VLM analysis
      const analysis = await this.aiService.analyzeScene(frameData);
      
      if (analysis && analysis.description) {
        // Debounced audio output to avoid spam
        this.debouncedAnnounce(analysis.description);
        addToLog(`Detected: ${analysis.description}`);
      }
    } catch (error) {
      console.error('Frame processing error:', error);
    }
  }
  
  debouncedAnnounce = debounce((message) => {
    if (this.isAutoMode) {
      this.audioManager.speak(message);
    }
  }, 3000); // 3 second debounce
  
  async startQueryMode() {
    if (this.isAutoMode) {
      this.toggleAutoMode(); // Stop auto mode first
    }
    
    showStatus('Listening... Please ask your question.');
    addToLog('🎤 Listening for your question...');
    
    try {
      // Record and transcribe
      const question = await this.audioManager.listen();
      
      if (!question || question.trim() === '') {
        showStatus('No speech detected. Please try again.');
        addToLog('No speech detected.');
        return;
      }
      
      showStatus(`Question: "${question}" - Generating answer...`);
      addToLog(`Question: ${question}`);
      
      // Capture current frame
      let imageData = null;
      if (this.currentFrame) {
        const canvas = document.createElement('canvas');
        canvas.width = this.currentFrame.videoWidth;
        canvas.height = this.currentFrame.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.currentFrame, 0, 0, canvas.width, canvas.height);
        imageData = canvas.toDataURL('image/jpeg', 0.8);
      }
      
      // Generate answer with LLM
      const answer = await this.aiService.answerQuestion(question, imageData);
      
      if (answer) {
        showStatus(`Answer: ${answer}`);
        addToLog(`Answer: ${answer}`);
        await this.audioManager.speak(answer);
      } else {
        showStatus('Sorry, I could not generate an answer.');
        addToLog('Failed to generate answer.');
      }
      
    } catch (error) {
      console.error('Query mode error:', error);
      showStatus(`Error: ${error.message}`);
      addToLog(`Error: ${error.message}`);
    }
  }
  
  showModelLoading(show) {
    const statusDiv = document.getElementById('modelStatus');
    if (show) {
      statusDiv.classList.remove('hidden');
    } else {
      statusDiv.classList.add('hidden');
    }
  }
  
  updateModelProgress(progress, status) {
    const progressFill = document.getElementById('modelProgress');
    const statusText = document.getElementById('modelStatusText');
    
    if (progressFill) {
      progressFill.style.width = `${progress}%`;
    }
    if (statusText) {
      statusText.textContent = status || `Loading models... ${Math.round(progress)}%`;
    }
  }
}

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new VisionAssistant();
});