# Implementation Plan: Video Intelligence & Dubbing Studio for DoudouVoice

An end-to-end studio extension integrating Meta AI (Muse Spark & Voice Transcribe) for visual video intelligence and script generation with Google Gemini TTS and server-side FFmpeg for synchronized advertising voiceovers, dubbing, and final MP4 export.

---

## User Review Required

> [!IMPORTANT]
> **Decisions Incorporated from Your Clarifications:**
> 1. **Location**: Accessible via a new dedicated top navigation tab **"Video Studio"** in the main header (`src/components/Navbar.tsx`).
> 2. **Audio Mixing**: Configurable audio mixing toggle allowing the user to select between **Smart Audio Ducking** (ducking original video sound to ~12-15% during voiceover segments with smooth decay/attack) and **Full Audio Replacement** (muting original audio completely for a clean commercial voiceover).
> 3. **Constraints**: Maximum video length capped at **60 seconds** and **50MB** file size, optimized for TikTok, Instagram Reels, and YouTube Shorts social ads.

---

## Architecture & System Design

```
                     ┌─────────────────────────────────────────────────────────────┐
                     │                 DOUDOUVOICE FRONTEND                        │
                     │  - Video Player + Scrubber with Canvas Timeline             │
                     │  - Scene Cards (visual cues, timestamps, OCR tags)          │
                     │  - Interactive Script Editor (per-segment editing)          │
                     │  - Audio Mixer Toggle (Smart Ducking vs Full Replace)       │
                     └──────────────┬───────────────────────────────▲──────────────┘
                                    │ Upload (mp4, webm <= 50MB)     │ Progress / Final MP4
                                    ▼                               │
                     ┌──────────────────────────────────────────────┴──────────────┐
                     │                 EXPRESS BACKEND (/api/video/*)              │
                     │  - Video validation & metadata probe (ffprobe)              │
                     │  - Frame extraction & audio demuxing (ffmpeg)               │
                     └──────────────┬───────────────────────────────┬──────────────┘
                                    │                               │
            ┌───────────────────────▼─────────┐           ┌─────────▼─────────────────────┐
            │         META MODEL API          │           │       GEMINI TTS ENGINE       │
            │  1. Meta Files API (/v1/files)  │           │  - gemini-3.1-flash-tts       │
            │  2. Muse Spark Multimodal       │           │  - Multi-dialect synthesis    │
            │     - Scene decomposition       │           │  - Segmented timing alignment │
            │     - Visual OCR & object det   │           │  - Exact duration matching    │
            │  3. Voice Transcribe & Diarize  │           └─────────┬─────────────────────┘
            └───────────────────────┬─────────┘                     │
                                    │                               │
                                    └───────────────┬───────────────┘
                                                    │
                                      ┌─────────────▼─────────────┐
                                      │   FFMPEG COMPOSITING      │
                                      │   - Audio ducking (amix)  │
                                      │   - Subtitle burning      │
                                      │   - MP4 export packaging  │
                                      └─────────────┬─────────────┘
                                                    │
                                      ┌─────────────▼─────────────┐
                                      │   CLOUD SQL (PostgreSQL)  │
                                      │   Table: video_projects   │
                                      └───────────────────────────┘
```

---

## Proposed Changes

### 1. Database Schema & Migration (`src/db/schema.ts`)
- Add `videoProjects` table to store:
  - `id`: UUID primary key
  - `uid`: Firebase Auth user ID
  - `title`: Project title or original filename
  - `originalVideoUrl`: Path to original uploaded video (`/api/video/stream/:id`)
  - `durationSec`: Total video duration probed via `ffprobe`
  - `status`: `'uploaded' | 'analyzing' | 'analyzed' | 'generating' | 'completed' | 'failed'`
  - `mode`: `'understand' | 'dub_ad' | 'localize'`
  - `analysisData`: JSON column storing scenes `[{ id, startTime, endTime, description, visualText, productsDetected, hookPotential }]`
  - `scriptData`: JSON column storing script segments `[{ id, startTime, endTime, text, dialect, voice, emotion, audioUrl }]`
  - `finalVideoUrl`: URL of the composited output video with dubbed audio
  - `audioMixMode`: `'ducking' | 'replace'`
  - `createdAt`, `updatedAt`

### 2. Backend Video Processing Service (`server/videoService.ts`)
- **Probe Video (`probeVideo`)**: Uses `ffprobe` to validate duration ($\le 60$s), resolution, FPS, and audio streams.
- **Frame Sampler (`extractSceneFrames`)**: Extracts representative high-quality JPEG frames at detected scene boundaries or regular 1.5s intervals using `ffmpeg -vf "fps=1/1.5,scale=720:-1"`.
- **Audio Demuxer (`extractAudioTrack`)**: Extracts 16kHz mono PCM/WAV from original video for speech transcription (`ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 output.wav`).
- **Compositor (`composeFinalVideo`)**:
  - Full Replacement: Mutes original audio, overlays aligned voiceover audio segments onto the video stream.
  - Smart Audio Ducking: Uses FFmpeg filter complex:
    `[0:a]volume=0.15[bg];[1:a]volume=1.0[voice];[bg][voice]amix=inputs=2:duration=first:dropout_transition=1.5[aout]`
  - Burns optional formatted Arabic/English subtitles using FFmpeg `subtitles` filter or generates standalone `.vtt` track.

### 3. Meta AI Video Intelligence Extension (`server/metaVideoClient.ts`)
- **Video Analysis (Mode A)**:
  - Uploads sampled keyframes to Meta Files API (`POST https://api.meta.ai/v1/files`) with `purpose: "user_data"`.
  - Invokes `muse-spark-1.2-contributor` via Responses API to reason over the sequence of visual events, reading on-screen graphics, product features, and actions.
  - Emits structured JSON containing timeline scenes with start/end seconds and visual narrative descriptions.
- **Advertising Script Generation (Mode B)**:
  - Takes scene analysis, target dialect (Algerian Arabic, Saudi Arabic, etc.), platform (TikTok, Reels), and tone.
  - Generates synchronized script segments tailored to video pacing.
- **Speech Extraction & Localization (Mode C)**:
  - Transcribes dialogue with timestamps using Meta Voice Transcribe.
  - Adapts content to target dialect and outputs new translated segments matching original cadence.

### 4. API Endpoints (`server.ts`)
- `POST /api/video/upload`: Multipart video upload (up to 50MB) with user authentication, probed via `ffprobe`.
- `POST /api/video/:id/analyze`: Initiates Meta Muse Spark video decomposition.
- `POST /api/video/:id/generate-dub`: Generates dialect script and Gemini TTS segments.
- `POST /api/video/:id/regenerate-segment`: Regenerates TTS audio for a single modified segment.
- `POST /api/video/:id/render`: Executes server-side FFmpeg composition with ducking or audio replacement.
- `GET /api/video/:id/status`: Polls status and progress of rendering jobs.
- `GET /api/video/stream/:id`: Express video streaming with HTTP 206 Partial Content range support for smooth video player scrubbing.
- `GET /api/video/projects`: Lists user's past video studio projects.

### 5. Frontend Video Studio Interface (`src/pages/VideoStudio.tsx`)
- **Top Navigation Integration**: Add "Video Studio" tab in `Navbar.tsx` alongside Studio and TTS Lab.
- **Studio Layout**:
  - **Left / Center**: Responsive 9:16 / 16:9 Video Player with:
    - Interactive timeline scrubber with timestamp markers.
    - Live audio overlay playback synchronized with video play/pause/seek.
    - Subtitle overlay toggle.
  - **Right / Bottom**:
    - **Scene Decomposition Drawer**: Visual thumbnails, timestamps, and detected product/text badges.
    - **Script & Dubbing Segment Editor**: Editable cards for each time-coded voiceover line.
    - **Regenerate Single Segment**: One-click audio re-synthesis if the user tweaks words.
    - **Audio Mixer Panel**: Toggle between Smart Ducking (with slider) and Full Replacement.
    - **Export Button**: Progress indicator and direct download of final rendered `.mp4`.

---

## Verification Plan

### Automated Tests
1. **FFmpeg & Probe Unit Tests (`server/video.test.ts`)**:
   - Verify `ffprobe` correctly reads video metadata, duration, and dimensions.
   - Verify frame extraction generates valid JPEG files.
   - Verify audio demuxing produces 16kHz WAV.
   - Verify audio ducking and video composition produces valid playable MP4s.
2. **Meta Video Analysis Integration Tests (`server/metaVideo.test.ts`)**:
   - Verify keyframe upload to Meta Files API with `purpose="user_data"`.
   - Verify `muse-spark-1.2-contributor` responds with structured scene JSON.
   - Verify token usage and response ID extraction.
3. **Database Migration Check**:
   - Run SQL schema update on Cloud SQL and test CRUD on `video_projects`.

### Manual End-to-End Verification
1. Upload a real product advertising video ($\le 50$MB, $\le 60$s) in the Video Studio.
2. Verify Scene Decomposition correctly identifies scenes, timestamps, and on-screen product features.
3. Generate an Algerian Arabic advertising script for TikTok and verify synchronized Gemini TTS audio generation.
4. Scrub the timeline and verify playback sync between video and voiceover.
5. Export the final video with Smart Audio Ducking and verify the resulting MP4 plays with blended audio and subtitles.
