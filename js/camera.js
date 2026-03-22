export class CameraManager {
  constructor() {
    this.video = null;
    this.stream = null;
    this.frameCallbacks = [];
    this.animationId = null;
  }
  
  async init() {
    try {
      // Request camera access
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment' // Use rear camera on mobile
        }
      });
      
      // Get video element
      this.video = document.getElementById('cameraPreview');
      this.video.srcObject = this.stream;
      
      // Wait for video to be ready
      await new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          resolve();
        };
      });
      
      // Start frame capture loop
      this.startFrameCapture();
      
      // Update status
      this.updateStatus('Camera ready');
      
      return true;
      
    } catch (error) {
      console.error('Camera initialization error:', error);
      this.updateStatus(`Camera error: ${error.message}`);
      throw error;
    }
  }
  
  startFrameCapture() {
    const captureFrame = () => {
      if (this.video && this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
        this.frameCallbacks.forEach(callback => {
          callback(this.video);
        });
      }
      
      this.animationId = requestAnimationFrame(captureFrame);
    };
    
    captureFrame();
  }
  
  onFrame(callback) {
    this.frameCallbacks.push(callback);
  }
  
  captureImage() {
    if (!this.video) return null;
    
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  }
  
  updateStatus(message) {
    const statusDiv = document.getElementById('cameraStatus');
    if (statusDiv) {
      statusDiv.textContent = message;
      
      // Auto-hide after 3 seconds if it's a success message
      if (!message.includes('error')) {
        setTimeout(() => {
          if (statusDiv.textContent === message) {
            statusDiv.style.opacity = '0';
            setTimeout(() => {
              if (statusDiv.textContent === message) {
                statusDiv.textContent = '';
                statusDiv.style.opacity = '1';
              }
            }, 1000);
          }
        }, 3000);
      }
    }
  }
  
  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    
    if (this.video) {
      this.video.srcObject = null;
    }
  }
}