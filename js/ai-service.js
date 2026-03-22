import { RunAnywhere } from '@runanywhere/web';

export class AIService {
  constructor() {
    this.ra = null;
    this.modelsLoaded = {
      stt: false,
      tts: false,
      llm: false,
      vlm: false
    };
  }
  
  async loadModels(progressCallback) {
    try {
      // Initialize RunAnywhere
      this.ra = new RunAnywhere({
        backend: 'webgpu',
        cache: 'indexeddb'
      });
      
      // Load models with progress tracking
      const totalModels = 4;
      let loadedModels = 0;
      
      const updateProgress = (modelName) => {
        loadedModels++;
        const progress = (loadedModels / totalModels) * 100;
        progressCallback(progress, `Loading ${modelName}... (${loadedModels}/${totalModels})`);
      };
      
      // Load Whisper Tiny for STT
      progressCallback(10, 'Loading speech recognition model...');
      await this.ra.loadModel('whisper-tiny', {
        onProgress: (progress) => {
          const totalProgress = 10 + (progress * 20);
          progressCallback(totalProgress, 'Loading speech recognition...');
        }
      });
      this.modelsLoaded.stt = true;
      updateProgress('speech recognition');
      
      // Load Piper for TTS
      progressCallback(30, 'Loading text-to-speech model...');
      await this.ra.loadModel('piper-en-us', {
        onProgress: (progress) => {
          const totalProgress = 30 + (progress * 20);
          progressCallback(totalProgress, 'Loading text-to-speech...');
        }
      });
      this.modelsLoaded.tts = true;
      updateProgress('text-to-speech');
      
      // Load SmolLM2 for LLM
      progressCallback(50, 'Loading language model...');
      await this.ra.loadModel('smolm2-360m', {
        onProgress: (progress) => {
          const totalProgress = 50 + (progress * 25);
          progressCallback(totalProgress, 'Loading language model...');
        }
      });
      this.modelsLoaded.llm = true;
      updateProgress('language model');
      
      // Load Qwen-VL for vision
      progressCallback(75, 'Loading vision model...');
      await this.ra.loadModel('qwen-vl', {
        onProgress: (progress) => {
          const totalProgress = 75 + (progress * 25);
          progressCallback(totalProgress, 'Loading vision model...');
        }
      });
      this.modelsLoaded.vlm = true;
      updateProgress('vision model');
      
      progressCallback(100, 'All models loaded successfully!');
      
      return true;
      
    } catch (error) {
      console.error('Model loading error:', error);
      throw new Error(`Failed to load AI models: ${error.message}`);
    }
  }
  
  async transcribeAudio(audioData) {
    if (!this.modelsLoaded.stt) {
      throw new Error('Speech recognition model not loaded');
    }
    
    try {
      const result = await this.ra.run('whisper-tiny', {
        audio: audioData,
        language: 'en'
      });
      
      return result.text;
    } catch (error) {
      console.error('Transcription error:', error);
      return null;
    }
  }
  
  async synthesizeSpeech(text) {
    if (!this.modelsLoaded.tts) {
      throw new Error('Text-to-speech model not loaded');
    }
    
    try {
      const audioData = await this.ra.run('piper-en-us', {
        text: text,
        speaker: 0
      });
      
      return audioData;
    } catch (error) {
      console.error('TTS error:', error);
      return null;
    }
  }
  
  async analyzeScene(imageData) {
    if (!this.modelsLoaded.vlm) {
      throw new Error('Vision model not loaded');
    }
    
    try {
      const result = await this.ra.run('qwen-vl', {
        image: imageData,
        prompt: "Describe what you see in this image briefly. Focus on objects, people, and potential hazards. Keep it concise (max 20 words).",
        max_tokens: 50
      });
      
      return {
        description: result.text,
        objects: this.extractObjects(result.text)
      };
    } catch (error) {
      console.error('Scene analysis error:', error);
      return null;
    }
  }
  
  async answerQuestion(question, imageData = null) {
    if (!this.modelsLoaded.llm) {
      throw new Error('Language model not loaded');
    }
    
    try {
      let prompt = `You are a vision assistant for visually impaired people. `;
      
      if (imageData) {
        // Use VLM to analyze image first
        const visionResult = await this.analyzeScene(imageData);
        prompt += `The user is looking at: ${visionResult.description}. `;
      }
      
      prompt += `Answer this question concisely: "${question}". Keep response under 30 words.`;
      
      const result = await this.ra.run('smolm2-360m', {
        prompt: prompt,
        max_tokens: 100,
        temperature: 0.7
      });
      
      return result.text;
    } catch (error) {
      console.error('LLM answer error:', error);
      return null;
    }
  }
  
  extractObjects(description) {
    // Simple object extraction from text
    const commonObjects = ['person', 'car', 'dog', 'cat', 'chair', 'table', 'door', 'window'];
    const found = [];
    
    for (const obj of commonObjects) {
      if (description.toLowerCase().includes(obj)) {
        found.push(obj);
      }
    }
    
    return found;
  }
  
  areModelsLoaded() {
    return Object.values(this.modelsLoaded).every(loaded => loaded === true);
  }
}