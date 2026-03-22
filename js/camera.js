/**
 * Camera Module - Handles camera access, video streaming, and frame capture
 * for the Vision Assistant application
 */

// DOM Elements
const videoElement = document.getElementById('cameraPreview');
const cameraStatusDiv = document.getElementById('cameraStatus');
const overlayCanvas = document.getElementById('overlayCanvas');

// State variables
let mediaStream = null;
let CameraActive = false;
let currentVideoTrack = null;
let frameCaptureInterval = null;
let frameCallbacks = [];

/**
 * Check if the browser supports camera access via MediaDevices API
 * @returns {boolean} True if camera is supported
 */
export function cameraSupported() {
  const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  
  if (!supported) {
    console.warn('Camera API not supported in this browser');
    updateCameraStatus('Camera not supported. Please use a modern browser (Chrome 124+).', 'error');
  }
  
  return supported;
}

/**
 * Update camera status message in UI
 * @param {string} message - Status message to display
 * @param {string} type - Message type: 'info', 'error', 'success'
 */
function updateCameraStatus(message, type = 'info') {
  if (cameraStatusDiv) {
    cameraStatusDiv.textContent = message;
    
    // Update styling based on message type
    cameraStatusDiv.style.borderLeftColor = 
      type === 'error' ? '#f44336' : 
      type === 'success' ? '#4caf50' : 
      '#2196f3';
    
    // Auto-clear error messages after 5 seconds
    if (type === 'error') {
      setTimeout(() => {
        if (cameraStatusDiv.textContent === message) {
          cameraStatusDiv.textContent = 'Camera ready';
          cameraStatusDiv.style.borderLeftColor = '#4caf50';
        }
      }, 5000);
    }
  }
}

/**
 * Initialize camera with specified constraints
 * @param {Object} constraints - Custom video constraints (optional)
 * @returns {Promise<boolean>} True if camera initialized successfully
 */
export async function initCamera(constraints = null) {
  // Check browser support first
  if (!cameraSupported()) {
    updateCameraStatus('Camera not supported in this browser', 'error');
    return false;
  }
  
  // Default video constraints - prioritize rear camera on mobile
  const defaultConstraints = {
    video: {
      width: { ideal: 1280, min: 640 },
      height: { ideal: 720, min: 480 },
      facingMode: { ideal: 'environment' }, // Prefer rear camera
      frameRate: { ideal: 30 }
    },
    audio: false
  };
  
  const videoConstraints = constraints || defaultConstraints;
  
  try {
    updateCameraStatus('Requesting camera permission...', 'info');
    
    // Request camera access
    mediaStream = await navigator.mediaDevices.getUserMedia(videoConstraints);
    
    // Check if we got video tracks
    const videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length === 0) {
      throw new Error('No video tracks available');
    }
    
    currentVideoTrack = videoTracks[0];
    const trackSettings = currentVideoTrack.getSettings();
    
    console.log('Camera initialized:', {
      label: currentVideoTrack.label,
      settings: trackSettings
    });
    
    // Set up video element
    if (videoElement) {
      videoElement.srcObject = mediaStream;
      videoElement.onloadedmetadata = () => {
        videoElement.play().catch(error => {
          console.error('Error playing video:', error);
          updateCameraStatus('Error playing video stream', 'error');
        });
      };
      
      // Wait for video to be ready
      await new Promise((resolve) => {
        if (videoElement.readyState >= 2) {
          resolve();
        } else {
          videoElement.onloadeddata = () => resolve();
        }
      });
    }
    
    isCameraActive = true;
    
    // Update canvas size to match video
    updateCanvasSize();
    
    // Success message with camera info
    const cameraName = currentVideoTrack.label || 'Camera';
    updateCameraStatus(`${cameraName} ready - ${trackSettings.width}x${trackSettings.height}`, 'success');
    
    // Start frame capture loop for continuous processing
    startFrameCapture();
    
    return true;
    
  } catch (error) {
    console.error('Camera initialization error:', error);
    
    // Handle specific error types with user-friendly messages
    let errorMessage = '';
    
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        errorMessage = 'Camera permission denied. Please grant camera access and refresh the page.';
        break;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        errorMessage = 'No camera found on this device. Please connect a camera.';
        break;
      case 'NotSupportedError':
        errorMessage = 'Camera not supported. Please use Chrome 124+ with WebGPU.';
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        errorMessage = 'Camera is in use by another application. Please close other apps using the camera.';
        break;
      case 'OverconstrainedError':
        errorMessage = 'Camera cannot meet the requested constraints. Trying with default settings...';
        // Try again with default constraints
        updateCameraStatus(errorMessage, 'error');
        return await initCamera({ video: true });
      default:
        errorMessage = `Camera error: ${error.message || 'Unknown error'}`;
    }
    
    updateCameraStatus(errorMessage, 'error');
    
    // Add to log if available
    if (window.addToLog) {
      window.addToLog(`Camera error: ${errorMessage}`, 'error');
    }
    
    return false;
  }
}

/**
 * Update canvas size to match video dimensions
 */
function updateCanvasSize() {
  if (overlayCanvas && videoElement && videoElement.videoWidth > 0) {
    overlayCanvas.width = videoElement.videoWidth;
    overlayCanvas.height = videoElement.videoHeight;
  }
}

/**
 * Start frame capture loop for continuous frame processing
 */
function startFrameCapture() {
  if (frameCaptureInterval) {
    clearInterval(frameCaptureInterval);
  }
  
  // Capture frames at 30 FPS for smooth processing
  frameCaptureInterval = setInterval(() => {
    if (isCameraActive && videoElement && videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
      // Execute all registered frame callbacks
      frameCallbacks.forEach(callback => {
        try {
          callback(videoElement);
        } catch (error) {
          console.error('Frame callback error:', error);
        }
      });
    }
  }, 33); // ~30 FPS
}

/**
 * Capture current video frame as ImageBitmap
 * @returns {Promise<ImageBitmap|null>} ImageBitmap of current frame or null if failed
 */
export async function captureFrameAsImageBitmap() {
  if (!isCameraActive || !videoElement || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
    console.warn('Camera not ready for frame capture');
    return null;
  }
  
  try {
    // Update canvas size if needed
    updateCanvasSize();
    
    // Create an ImageBitmap from the video frame
    const imageBitmap = await createImageBitmap(videoElement);
    return imageBitmap;
    
  } catch (error) {
    console.error('Error capturing frame as ImageBitmap:', error);
    return null;
  }
}

/**
 * Capture current video frame as base64 JPEG
 * @param {number} quality - JPEG quality (0-1), default 0.8
 * @returns {Promise<string|null>} Base64 encoded JPEG or null if failed
 */
export async function captureFrameAsBase64(quality = 0.8) {
  if (!isCameraActive || !videoElement || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
    console.warn('Camera not ready for frame capture');
    return null;
  }
  
  try {
    // Create a canvas element
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    // Draw video frame to canvas
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // Convert to base64
    const base64Data = canvas.toDataURL('image/jpeg', quality);
    
    // Clean up
    canvas.remove();
    
    return base64Data;
    
  } catch (error) {
    console.error('Error capturing frame as base64:', error);
    return null;
  }
}

/**
 * Capture current video frame as Blob
 * @param {string} format - Image format ('image/jpeg' or 'image/png')
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<Blob|null>} Blob of captured frame or null if failed
 */
export async function captureFrameAsBlob(format = 'image/jpeg', quality = 0.8) {
  if (!isCameraActive || !videoElement || videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) {
    console.warn('Camera not ready for frame capture');
    return null;
  }
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // Convert to blob
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, format, quality);
    });
    
    // Clean up
    canvas.remove();
    
    return blob;
    
  } catch (error) {
    console.error('Error capturing frame as blob:', error);
    return null;
  }
}

/**
 * Convenience method - returns frame as base64 (most compatible for AI processing)
 * @returns {Promise<string|null>} Base64 encoded frame
 */
export async function captureFrame() {
  return await captureFrameAsBase64(0.8);
}

/**
 * Register a callback to be called on each video frame
 * @param {Function} callback - Function to call with video element on each frame
 */
export function onFrame(callback) {
  if (typeof callback === 'function') {
    frameCallbacks.push(callback);
  }
}

/**
 * Remove a frame callback
 * @param {Function} callback - The callback to remove
 */
export function offFrame(callback) {
  const index = frameCallbacks.indexOf(callback);
  if (index > -1) {
    frameCallbacks.splice(index, 1);
  }
}

/**
 * Get current camera settings
 * @returns {Object|null} Camera settings or null if camera not active
 */
export function getCameraSettings() {
  if (!currentVideoTrack) {
    return null;
  }
  
  return currentVideoTrack.getSettings();
}

/**
 * Switch camera (front/rear)
 * @returns {Promise<boolean>} True if switched successfully
 */
export async function switchCamera() {
  if (!isCameraActive) {
    console.warn('Camera not active');
    return false;
  }
  
  try {
    // Get current facing mode
    const currentSettings = currentVideoTrack.getSettings();
    const currentFacing = currentSettings.facingMode || 'environment';
    
    // Switch to opposite facing mode
    const newFacing = currentFacing === 'environment' ? 'user' : 'environment';
    
    // Stop current camera
    await stopCamera();
    
    // Initialize with new facing mode
    const success = await initCamera({
      video: {
        facingMode: { exact: newFacing }
      }
    });
    
    if (!success) {
      // Fallback to any camera
      return await initCamera({ video: true });
    }
    
    return success;
    
  } catch (error) {
    console.error('Error switching camera:', error);
    return false;
  }
}

/**
 * Stop camera and release resources
 * @returns {Promise<void>}
 */
export async function stopCamera() {
  // Stop frame capture interval
  if (frameCaptureInterval) {
    clearInterval(frameCaptureInterval);
    frameCaptureInterval = null;
  }
  
  // Clear frame callbacks
  frameCallbacks = [];
  
  // Stop all media tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
      console.log(`Stopped track: ${track.kind} - ${track.label}`);
    });
    mediaStream = null;
  }
  
  // Clear video element
  if (videoElement) {
    videoElement.srcObject = null;
    videoElement.onloadedmetadata = null;
    videoElement.onloadeddata = null;
  }
  
  currentVideoTrack = null;
  CameraActive = false;
  
  updateCameraStatus('Camera stopped', 'info');
  console.log('Camera resources released');
}

/**
 * Check if camera is currently active
 * @returns {boolean} True if camera is active
 */
export function isCameraActive() {
  return CameraActive && mediaStream !== null && mediaStream.active;
}

/**
 * Get camera capabilities (supported resolutions, frame rates, etc.)
 * @returns {Promise<Object|null>} Camera capabilities or null
 */
export async function getCameraCapabilities() {
  if (!cameraSupported()) {
    return null;
  }
  
  try {
    // Get available devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    const capabilities = [];
    
    for (const device of videoDevices) {
      try {
        // Test device capabilities by requesting a temporary stream
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: device.deviceId } }
        });
        
        const track = testStream.getVideoTracks()[0];
        const settings = track.getSettings();
        const constraints = track.getConstraints();
        
        capabilities.push({
          deviceId: device.deviceId,
          label: device.label || `Camera ${capabilities.length + 1}`,
          settings: settings,
          constraints: constraints
        });
        
        // Stop test stream
        testStream.getTracks().forEach(t => t.stop());
        
      } catch (error) {
        console.warn(`Could not test device ${device.deviceId}:`, error);
      }
    }
    
    return {
      devices: capabilities,
      hasMultipleCameras: capabilities.length > 1
    };
    
  } catch (error) {
    console.error('Error getting camera capabilities:', error);
    return null;
  }
}

/**
 * Request camera permission only (without starting stream)
 * @returns {Promise<boolean>} True if permission granted
 */
export async function requestCameraPermission() {
  if (!cameraSupported()) {
    return false;
  }
  
  try {
    // Try to get a temporary stream to request permission
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
    
    // Immediately stop the stream after getting permission
    tempStream.getTracks().forEach(track => track.stop());
    
    updateCameraStatus('Camera permission granted', 'success');
    return true;
    
  } catch (error) {
    console.error('Camera permission denied:', error);
    updateCameraStatus('Camera permission denied', 'error');
    return false;
  }
}
export class CameraManager {
  constructor() {}
  
  async init() {
    return initCamera();
  }
  
  onFrame(callback) {
    onFrame(callback);
  }
  
  captureFrame() {
    return captureFrame();
  }
  
  isCameraActive() {
    return isCameraActive();
  }
  
  stopCamera() {
    return stopCamera();
  }
}

// Export all functions
export default {
  initCamera,
  captureFrame,
  captureFrameAsImageBitmap,
  captureFrameAsBase64,
  captureFrameAsBlob,
  stopCamera,
  cameraSupported,
  onFrame,
  offFrame,
  isCameraActive,
  getCameraSettings,
  switchCamera,
  getCameraCapabilities,
  requestCameraPermission
};