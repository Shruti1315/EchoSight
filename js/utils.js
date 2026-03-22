// Debounce function to limit how often a function can be called
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function to limit execution rate
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Show status message in UI
export function showStatus(message, isError = false) {
  const statusDiv = document.getElementById('statusMessage');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.style.borderLeftColor = isError ? '#f44336' : '#4CAF50';
    
    // Auto-clear after 5 seconds for non-error messages
    if (!isError) {
      setTimeout(() => {
        if (statusDiv.textContent === message) {
          // Don't clear if it's been replaced
        }
      }, 5000);
    }
  }
}

// Add message to detection log
export function addToLog(message, type = 'info') {
  const logDiv = document.getElementById('detectionLog');
  if (logDiv) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('p');
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    // Add type-based styling
    if (type === 'error') {
      logEntry.style.borderLeftColor = '#f44336';
      logEntry.style.backgroundColor = '#ffebee';
    } else if (type === 'warning') {
      logEntry.style.borderLeftColor = '#ff9800';
      logEntry.style.backgroundColor = '#fff3e0';
    }
    
    logDiv.appendChild(logEntry);
    
    // Scroll to bottom
    logDiv.scrollTop = logDiv.scrollHeight;
    
    // Limit log entries to 50
    while (logDiv.children.length > 50) {
      logDiv.removeChild(logDiv.firstChild);
    }
  }
}

// Format file size for display
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Check if WebGPU is supported
export function checkWebGPUSupport() {
  return 'gpu' in navigator;
}

// Check if required APIs are supported
export function checkBrowserSupport() {
  const support = {
    webgpu: checkWebGPUSupport(),
    mediaDevices: 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices,
    speechSynthesis: 'speechSynthesis' in window,
    speechRecognition: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    indexedDB: 'indexedDB' in window
  };
  
  const allSupported = Object.values(support).every(v => v === true);
  
  return {
    supported: allSupported,
    details: support
  };
}

// Show browser compatibility warning if needed
export function showCompatibilityWarning() {
  const support = checkBrowserSupport();
  
  if (!support.supported) {
    const warnings = [];
    
    if (!support.details.webgpu) {
      warnings.push('WebGPU not supported (required for AI acceleration)');
    }
    if (!support.details.mediaDevices) {
      warnings.push('Camera access not supported');
    }
    if (!support.details.speechRecognition) {
      warnings.push('Speech recognition not fully supported (fallback mode)');
    }
    
    const warningMessage = `⚠️ Browser compatibility issues:\n${warnings.join('\n')}\n\nPlease use Chrome 124+ with WebGPU enabled.`;
    
    showStatus(warningMessage, true);
    addToLog(warningMessage, 'error');
    
    return false;
  }
  
  return true;
}

// Simple object detection visualization (optional)
export function drawDetectionBoxes(canvas, detections) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  detections.forEach(detection => {
    if (detection.bbox) {
      // Draw bounding box
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(detection.bbox.x, detection.bbox.y, detection.bbox.width, detection.bbox.height);
      
      // Draw label
      ctx.fillStyle = '#00ff00';
      ctx.font = '16px Arial';
      ctx.fillText(detection.label, detection.bbox.x, detection.bbox.y - 5);
    }
  });
}

// Local storage helpers for settings
export const Settings = {
  save(key, value) {
    try {
      localStorage.setItem(`vision_assistant_${key}`, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Failed to save setting:', e);
      return false;
    }
  },
  
  load(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(`vision_assistant_${key}`);
      return value ? JSON.parse(value) : defaultValue;
    } catch (e) {
      console.error('Failed to load setting:', e);
      return defaultValue;
    }
  },
  
  remove(key) {
    try {
      localStorage.removeItem(`vision_assistant_${key}`);
      return true;
    } catch (e) {
      console.error('Failed to remove setting:', e);
      return false;
    }
  }
};

// Export all utilities
export default {
  debounce,
  throttle,
  showStatus,
  addToLog,
  formatFileSize,
  checkWebGPUSupport,
  checkBrowserSupport,
  showCompatibilityWarning,
  drawDetectionBoxes,
  Settings
};