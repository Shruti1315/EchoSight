/**
 * Utility Functions for Vision Assistant
 * Provides debouncing, object cooldown management, formatting, and browser support checking
 */

// ============================================================================
// Debouncing and Throttling
// ============================================================================

/**
 * Debounce function to limit how often a function can be called
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
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

/**
 * Throttle function to limit execution rate
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Debounce with immediate execution on leading edge
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @param {boolean} immediate - Execute immediately on first call
 * @returns {Function} Debounced function
 */
export function debounceImmediate(func, wait, immediate = true) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    
    if (callNow) func(...args);
  };
}

// ============================================================================
// Object Cooldown Management for Auto Mode
// ============================================================================

// Global cooldown map for object detection
let objectCooldownMap = new Map();
let cooldownCleanupInterval = null;

/**
 * Initialize cooldown management with automatic cleanup
 * @param {number} cleanupIntervalMs - How often to clean up old entries (default: 60000ms)
 */
export function initCooldownManager(cleanupIntervalMs = 60000) {
  if (cooldownCleanupInterval) {
    clearInterval(cooldownCleanupInterval);
  }
  
  cooldownCleanupInterval = setInterval(() => {
    cleanupCooldownMap(300000); // Remove entries older than 5 minutes
  }, cleanupIntervalMs);
}

/**
 * Check if an object should be spoken based on cooldown period
 * @param {string} objectName - Name of detected object
 * @param {number} cooldownSeconds - Cooldown period in seconds
 * @param {Map} [customMap] - Optional custom map to use instead of global
 * @returns {boolean} True if should speak
 */
export function shouldSpeak(objectName, cooldownSeconds, customMap = null) {
  const map = customMap || objectCooldownMap;
  const now = Date.now();
  const lastSpoken = map.get(objectName);
  
  if (!lastSpoken) {
    return true;
  }
  
  const timeSinceLast = (now - lastSpoken) / 1000;
  return timeSinceLast >= cooldownSeconds;
}

/**
 * Update detection history with current detection
 * @param {string} objectName - Name of detected object
 * @param {Map} [customMap] - Optional custom map to use instead of global
 */
export function updateDetectionHistory(objectName, customMap = null) {
  const map = customMap || objectCooldownMap;
  map.set(objectName, Date.now());
}

/**
 * Clear entire detection history
 * @param {Map} [customMap] - Optional custom map to use instead of global
 */
export function clearDetectionHistory(customMap = null) {
  const map = customMap || objectCooldownMap;
  map.clear();
}

/**
 * Get time since last detection for an object
 * @param {string} objectName - Name of detected object
 * @param {Map} [customMap] - Optional custom map to use instead of global
 * @returns {number|null} Seconds since last detection or null if never detected
 */
export function timeSinceLastDetection(objectName, customMap = null) {
  const map = customMap || objectCooldownMap;
  const lastSpoken = map.get(objectName);
  
  if (!lastSpoken) return null;
  return (Date.now() - lastSpoken) / 1000;
}

/**
 * Clean up old detection history entries
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 300000 = 5 minutes)
 * @param {Map} [customMap] - Optional custom map to use instead of global
 */
export function cleanupCooldownMap(maxAgeMs = 300000, customMap = null) {
  const map = customMap || objectCooldownMap;
  const now = Date.now();
  
  for (const [objectName, timestamp] of map.entries()) {
    if (now - timestamp > maxAgeMs) {
      map.delete(objectName);
    }
  }
}

/**
 * Get all objects currently on cooldown
 * @param {Map} [customMap] - Optional custom map to use instead of global
 * @returns {Array} Array of objects with their remaining cooldown
 */
export function getCooldownObjects(customMap = null) {
  const map = customMap || objectCooldownMap;
  const now = Date.now();
  const result = [];
  
  for (const [objectName, timestamp] of map.entries()) {
    const elapsed = (now - timestamp) / 1000;
    result.push({
      name: objectName,
      lastSpoken: timestamp,
      elapsedSeconds: elapsed
    });
  }
  
  return result.sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Convert bytes to human readable format (KB, MB, GB)
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Human readable size
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format milliseconds to human readable time
 * @param {number} ms - Milliseconds
 * @returns {string} Human readable time (e.g., "2.5 seconds", "1 minute")
 */
export function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} seconds`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} minutes`;
  return `${(ms / 3600000).toFixed(1)} hours`;
}

/**
 * Format date to local time string
 * @param {Date|number} date - Date object or timestamp
 * @returns {string} Formatted time string
 */
export function formatTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Truncate text to specified length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// Browser Support and WebGPU Detection
// ============================================================================

/**
 * Check if WebGPU is supported in current browser
 * @returns {boolean} True if WebGPU is supported
 */
export function checkWebGPUSupport() {
  const supported = 'gpu' in navigator;
  
  if (!supported) {
    console.warn('WebGPU not supported in this browser. Falling back to WebGL.');
  }
  
  return supported;
}

/**
 * Check all required browser APIs
 * @returns {Object} Support status for all required features
 */
export function checkBrowserSupport() {
  const support = {
    webgpu: checkWebGPUSupport(),
    mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    mediaRecorder: !!(window.MediaRecorder),
    webAudio: !!(window.AudioContext || window.webkitAudioContext),
    speechSynthesis: !!(window.speechSynthesis),
    speechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    indexedDB: !!(window.indexedDB),
    webWorkers: !!(window.Worker)
  };
  
  support.allSupported = Object.values(support).every(v => v === true);
  
  return support;
}

/**
 * Show compatibility warning if browser doesn't meet requirements
 * @returns {boolean} True if compatible enough to run
 */
export function showCompatibilityWarning() {
  const support = checkBrowserSupport();
  const warnings = [];
  
  if (!support.webgpu) {
    warnings.push('WebGPU not supported (performance may be slower)');
  }
  if (!support.mediaDevices) {
    warnings.push('Camera access not supported');
  }
  if (!support.mediaRecorder) {
    warnings.push('Audio recording not supported');
  }
  if (!support.speechSynthesis) {
    warnings.push('Text-to-speech not fully supported');
  }
  
  if (warnings.length > 0) {
    console.warn('Browser compatibility issues:', warnings);
    
    // Show warning in UI if available
    const statusDiv = document.getElementById('statusMessage');
    if (statusDiv) {
      statusDiv.innerHTML = `⚠️ ${warnings.join('. ')}<br>Some features may not work optimally.`;
      statusDiv.style.borderLeftColor = '#ff9800';
    }
    
    return false;
  }
  
  return true;
}

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Log message with timestamp and type
 * @param {string} message - Message to log
 * @param {string} type - Log type: 'info', 'warn', 'error', 'debug'
 * @param {Object} [data] - Optional data to log
 */
export function log(message, type = 'info', data = null) {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}]`;
  
  // Console logging with appropriate method
  switch (type) {
    case 'error':
      console.error(prefix, message, data || '');
      break;
    case 'warn':
      console.warn(prefix, message, data || '');
      break;
    case 'debug':
      console.debug(prefix, message, data || '');
      break;
    default:
      console.log(prefix, message, data || '');
  }
  
  // Also add to UI log if available
  if (typeof window !== 'undefined' && window.addToLog) {
    window.addToLog(message, type);
  }
}

/**
 * Create a performance timer for measuring operation duration
 * @param {string} name - Timer name
 * @returns {Object} Timer with start, end, and duration methods
 */
export function createTimer(name) {
  const startTime = performance.now();
  
  return {
    start: startTime,
    end: () => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      log(`${name} completed in ${formatTime(duration)}`, 'debug');
      return duration;
    },
    duration: () => {
      return performance.now() - startTime;
    }
  };
}

/**
 * Measure and log execution time of a function
 * @param {Function} fn - Function to measure
 * @param {string} name - Name for logging
 * @returns {any} Return value of the function
 */
export async function measurePerformance(fn, name) {
  const timer = createTimer(name);
  try {
    const result = await fn();
    timer.end();
    return result;
  } catch (error) {
    timer.end();
    throw error;
  }
}

// ============================================================================
// Toast/Notification Utilities
// ============================================================================

let toastTimeout = null;
let toastElement = null;

/**
 * Create toast element if it doesn't exist
 */
function ensureToastElement() {
  if (!toastElement) {
    toastElement = document.createElement('div');
    toastElement.id = 'toast-notification';
    toastElement.className = 'toast-notification';
    document.body.appendChild(toastElement);
  }
  return toastElement;
}

/**
 * Show temporary toast message
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'info', 'success', 'warning', 'error'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const toast = ensureToastElement();
  
  // Clear existing timeout
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  
  // Set message and type
  toast.textContent = message;
  toast.className = `toast-notification toast-${type}`;
  toast.classList.add('show');
  
  // Auto-hide after duration
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    toastTimeout = null;
  }, duration);
}

/**
 * Quick success toast
 * @param {string} message - Success message
 * @param {number} duration - Duration in milliseconds
 */
export function showSuccess(message, duration = 2000) {
  showToast(message, 'success', duration);
}

/**
 * Quick error toast
 * @param {string} message - Error message
 * @param {number} duration - Duration in milliseconds
 */
export function showError(message, duration = 4000) {
  showToast(message, 'error', duration);
}

/**
 * Quick info toast
 * @param {string} message - Info message
 * @param {number} duration - Duration in milliseconds
 */
export function showInfo(message, duration = 3000) {
  showToast(message, 'info', duration);
}

/**
 * Quick warning toast
 * @param {string} message - Warning message
 * @param {number} duration - Duration in milliseconds
 */
export function showWarning(message, duration = 3000) {
  showToast(message, 'warning', duration);
}

// ============================================================================
// UI Helper Functions
// ============================================================================

/**
 * Show status message in main status area
 * @param {string} message - Status message
 * @param {string} type - Message type: 'info', 'error', 'warning', 'success'
 */
export function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('statusMessage');
  if (statusDiv) {
    statusDiv.textContent = message;
    
    // Update styling based on type
    const colors = {
      info: '#2196f3',
      success: '#4caf50',
      warning: '#ff9800',
      error: '#f44336'
    };
    
    statusDiv.style.borderLeftColor = colors[type] || colors.info;
    
    // Auto-clear non-error messages after 5 seconds
    if (type !== 'error') {
      setTimeout(() => {
        if (statusDiv.textContent === message) {
          // Don't clear if it's been replaced
        }
      }, 5000);
    }
  }
  
  // Also log to console
  log(message, type);
}

/**
 * Add message to detection log
 * @param {string} source - Message source (e.g., 'System', 'User', 'Assistant')
 * @param {string} message - Message content
 * @param {string} type - Message type: 'info', 'user', 'assistant', 'error'
 */
export function addToLog(source, message, type = 'info') {
  const logDiv = document.getElementById('detectionLog');
  if (!logDiv) return;
  
  const timestamp = formatTimestamp();
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  
  // Determine icon based on type
  let icon = '';
  switch (type) {
    case 'user':
      icon = '👤 ';
      break;
    case 'assistant':
      icon = '🤖 ';
      break;
    case 'error':
      icon = '❌ ';
      break;
    case 'warning':
      icon = '⚠️ ';
      break;
    default:
      icon = 'ℹ️ ';
  }
  
  logEntry.innerHTML = `
    <span class="log-time">[${timestamp}]</span>
    <span class="log-source">${icon}${source}:</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;
  
  logDiv.appendChild(logEntry);
  
  // Scroll to bottom
  logDiv.scrollTop = logDiv.scrollHeight;
  
  // Limit log entries to 100
  while (logDiv.children.length > 100) {
    logDiv.removeChild(logDiv.firstChild);
  }
}

/**
 * Clear all log entries
 */
export function clearLog() {
  const logDiv = document.getElementById('detectionLog');
  if (logDiv) {
    logDiv.innerHTML = '';
    addToLog('System', 'Log cleared', 'info');
  }
}

// ============================================================================
// Local Storage Helpers
// ============================================================================

/**
 * Save data to localStorage
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @returns {boolean} Success status
 */
export function saveToStorage(key, value) {
  try {
    localStorage.setItem(`vision_assistant_${key}`, JSON.stringify(value));
    return true;
  } catch (error) {
    log(`Failed to save to storage: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Load data from localStorage
 * @param {string} key - Storage key
 * @param {any} defaultValue - Default value if not found
 * @returns {any} Loaded value or default
 */
export function loadFromStorage(key, defaultValue = null) {
  try {
    const value = localStorage.getItem(`vision_assistant_${key}`);
    return value ? JSON.parse(value) : defaultValue;
  } catch (error) {
    log(`Failed to load from storage: ${error.message}`, 'error');
    return defaultValue;
  }
}

/**
 * Remove data from localStorage
 * @param {string} key - Storage key
 * @returns {boolean} Success status
 */
export function removeFromStorage(key) {
  try {
    localStorage.removeItem(`vision_assistant_${key}`);
    return true;
  } catch (error) {
    log(`Failed to remove from storage: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Clear all Vision Assistant data from localStorage
 * @returns {boolean} Success status
 */
export function clearAllStorage() {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('vision_assistant_')) {
        localStorage.removeItem(key);
      }
    }
    return true;
  } catch (error) {
    log(`Failed to clear storage: ${error.message}`, 'error');
    return false;
  }
}

// ============================================================================
// Animation Frame Helpers
// ============================================================================

/**
 * Request animation frame with automatic cleanup
 * @param {Function} callback - Animation callback
 * @returns {Object} Animation controller with stop method
 */
export function createAnimation(callback) {
  let animationId = null;
  let isRunning = true;
  
  const animate = () => {
    if (!isRunning) return;
    callback();
    animationId = requestAnimationFrame(animate);
  };
  
  const start = () => {
    isRunning = true;
    animate();
  };
  
  const stop = () => {
    isRunning = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  };
  
  return { start, stop };
}

/**
 * Debounced animation frame for smooth UI updates
 * @param {Function} callback - Animation callback
 * @returns {Function} Debounced animation function
 */
export function debounceAnimation(callback) {
  let animationId = null;
  
  return (...args) => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    
    animationId = requestAnimationFrame(() => {
      callback(...args);
      animationId = null;
    });
  };
}

// ============================================================================
// Export All Utilities
// ============================================================================

// Export everything as default object
export default {
  // Debouncing
  debounce,
  throttle,
  debounceImmediate,
  
  // Cooldown management
  initCooldownManager,
  shouldSpeak,
  updateDetectionHistory,
  clearDetectionHistory,
  timeSinceLastDetection,
  cleanupCooldownMap,
  getCooldownObjects,
  
  // Formatting
  formatBytes,
  formatTime,
  formatTimestamp,
  truncateText,
  escapeHtml,
  
  // Browser support
  checkWebGPUSupport,
  checkBrowserSupport,
  showCompatibilityWarning,
  
  // Logging
  log,
  createTimer,
  measurePerformance,
  
  // Toast notifications
  showToast,
  showSuccess,
  showError,
  showInfo,
  showWarning,
  
  // UI helpers
  showStatus,
  addToLog,
  clearLog,
  
  // Storage
  saveToStorage,
  loadFromStorage,
  removeFromStorage,
  clearAllStorage,
  
  // Animation
  createAnimation,
  debounceAnimation
};