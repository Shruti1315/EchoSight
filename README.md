# EcoSight - AI for Visually Impaired

An offline-first web application that uses on-device AI to help visually impaired people understand their environment through real-time object detection and voice queries. All processing happens locally in your browser - no cloud, no backend, no privacy concerns.

## Features

- 📷 **Live Camera Feed** - Real-time video from your device camera
- 🎯 **Auto Mode** - Continuous scene description with audio alerts (debounced to avoid spam)
- 🎤 **Query Mode** - Ask questions about what you see using voice commands
- 🤖 **100% Offline** - Everything runs locally after initial model download
- 🔒 **Privacy First** - No data ever leaves your device
- ⚡ **WebGPU Acceleration** - Fast AI inference on supported devices

## Tech Stack

- **Framework**: Vanilla JavaScript with Vite
- **AI Runtime**: RunAnywhere Web SDK
- **Models**:
  - STT: Whisper Tiny (speech-to-text)
  - TTS: Piper US English (text-to-speech)
  - LLM: SmolLM2 360M (language model)
  - VLM: Qwen-VL (vision-language model)
- **APIs**: MediaDevices, WebGPU, IndexedDB, Web Speech API (fallback)

## Browser Requirements

- **Chrome 124+** with WebGPU enabled
- Modern mobile browsers with WebGPU support (Chrome on Android, Safari on iOS 17+)
- Camera and microphone permissions required
- At least 4GB RAM recommended
- 500MB free storage for models

## Setup Instructions

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Shruti1315/EcoSight-web.git
cd vision-assistant-web
