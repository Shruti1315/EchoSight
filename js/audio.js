export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.currentAudio = null;
    this.isSpeaking = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
  
  async speak(text) {
    if (this.isSpeaking) {
      this.stop();
    }
    
    try {
      // Use Web Speech API as fallback if available
      if ('speechSynthesis' in window && !this.aiService) {
        return this.speakWithWebSpeech(text);
      }
      
      // For now, use Web Speech API
      // Will be replaced with Piper TTS when integrated
      return this.speakWithWebSpeech(text);
      
    } catch (error) {
      console.error('TTS error:', error);
    }
  }
  
  speakWithWebSpeech(text) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('Speech synthesis not supported'));
        return;
      }
      
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      
      utterance.onstart = () => {
        this.isSpeaking = true;
      };
      
      utterance.onend = () => {
        this.isSpeaking = false;
        resolve();
      };
      
      utterance.onerror = (error) => {
        this.isSpeaking = false;
        reject(error);
      };
      
      window.speechSynthesis.speak(utterance);
    });
  }
  
  async listen() {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up media recording
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      
      return new Promise((resolve, reject) => {
        let timeout = setTimeout(() => {
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.stopListening();
            reject(new Error('Listening timeout'));
          }
        }, 10000); // 10 second timeout
        
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };
        
        this.mediaRecorder.onstop = async () => {
          clearTimeout(timeout);
          
          // Create audio blob
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          
          // For now, use Web Speech API for recognition
          // Will be replaced with Whisper when integrated
          const text = await this.recognizeWithWebSpeech();
          
          // Clean up
          stream.getTracks().forEach(track => track.stop());
          
          resolve(text);
        };
        
        this.mediaRecorder.onerror = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
        
        // Start recording
        this.mediaRecorder.start();
        
        // Auto-stop after 5 seconds of silence or when user stops
        setTimeout(() => {
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.stopListening();
          }
        }, 5000);
      });
      
    } catch (error) {
      console.error('Microphone error:', error);
      throw new Error('Could not access microphone');
    }
  }
  
  recognizeWithWebSpeech() {
    return new Promise((resolve, reject) => {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        reject(new Error('Speech recognition not supported'));
        return;
      }
      
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        resolve(transcript);
      };
      
      recognition.onerror = (event) => {
        reject(new Error(`Recognition error: ${event.error}`));
      };
      
      recognition.onend = () => {
        // Recognition ended
      };
      
      recognition.start();
      
      // Auto-stop after 5 seconds
      setTimeout(() => {
        try {
          recognition.stop();
        } catch (e) {
          // Already stopped
        }
      }, 5000);
    });
  }
  
  stopListening() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }
  
  stop() {
    if (this.isSpeaking) {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      this.isSpeaking = false;
    }
    
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.stopListening();
    }
  }
  
  async playAudioBuffer(audioData) {
    // Placeholder for Piper TTS playback
    // Will be implemented when RunAnywhere SDK provides audio playback
    console.log('Play audio buffer:', audioData);
  }
}