# Stemizer

AI-powered music stem separation for electronic music. Upload a track, select time ranges, and remove or isolate individual stems (vocals, drums, bass, keys, synths, pads) using Meta's Demucs neural network.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (React + TypeScript + Tailwind)        │
│  - Waveform visualization (wavesurfer.js)        │
│  - Timeline range selection                      │
│  - Stem operation builder                        │
│  - Real-time job status polling                  │
└────────────────────┬────────────────────────────┘
                     │ REST API
┌────────────────────▼────────────────────────────┐
│  Backend (Python + FastAPI)                      │
│  - File upload & validation (MP3/WAV)            │
│  - Audio processing pipeline                     │
│  - Async job processing                          │
│  ┌─────────────────────────────────────────────┐ │
│  │  Demucs htdemucs_6s (Meta AI)               │ │
│  │  Stems: vocals, drums, bass, guitar,        │ │
│  │         piano, other                         │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

## Stems (6-source separation)

| Stem | Electronic Music Mapping | Color |
|------|--------------------------|-------|
| `vocals` | Vocals, vocal chops | Red |
| `drums` | Drums, percussion, hats | Orange |
| `bass` | Bass, sub-bass | Blue |
| `guitar` | Synth leads, guitar | Green |
| `piano` | Keys, piano, plucks | Yellow |
| `other` | Pads, FX, atmospheres | Purple |

## Prerequisites

- **Python 3.11+**
- **Node.js 20+**
- **FFmpeg** (required for audio conversion)
- **CUDA GPU** (recommended — Demucs runs on CPU but is much slower)

## Quick Start (Development)

### Backend

```bash
cd backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Copy env file
cp .env.example .env

# Start the API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`. Docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

The UI will be at `http://localhost:5173` with API requests proxied to the backend.

## Quick Start (Docker)

```bash
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`

> The Docker setup auto-detects NVIDIA GPUs. For CPU-only, remove the `deploy.resources` block from `docker-compose.yml`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/tracks/upload` | Upload MP3/WAV file |
| `GET` | `/api/tracks/{id}` | Get track metadata |
| `GET` | `/api/tracks` | List all tracks |
| `POST` | `/api/process` | Start stem processing job |
| `GET` | `/api/process/jobs/{id}` | Check job status |
| `GET` | `/api/process/jobs/{id}/download` | Download result |

### Example: Remove vocals from 0:30 to 1:45

```bash
# 1. Upload track
curl -X POST http://localhost:8000/api/tracks/upload \
  -F "file=@my_track.wav"
# Returns: { "track_id": "abc-123", "duration": 240.5, ... }

# 2. Process — remove vocals in the specified range
curl -X POST http://localhost:8000/api/process \
  -H "Content-Type: application/json" \
  -d '{
    "track_id": "abc-123",
    "operations": [{
      "stem": "vocals",
      "time_range": { "start": 30.0, "end": 105.0 },
      "action": "remove"
    }],
    "output_format": "wav"
  }'
# Returns: { "job_id": "xyz-789", "status": "pending", ... }

# 3. Poll status
curl http://localhost:8000/api/process/jobs/xyz-789

# 4. Download when complete
curl -O http://localhost:8000/api/process/jobs/xyz-789/download
```

## Project Structure

```
Stemizer/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI application
│   │   ├── config.py          # Settings & environment
│   │   ├── api/routes/
│   │   │   ├── health.py      # Health check
│   │   │   ├── upload.py      # File upload & track registry
│   │   │   └── process.py     # Stem processing jobs
│   │   └── core/
│   │       ├── audio.py       # Audio I/O & manipulation
│   │       ├── models.py      # Pydantic data models
│   │       └── stemmer.py     # Demucs AI engine
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Main application
│   │   ├── components/        # UI components
│   │   ├── services/api.ts    # Backend API client
│   │   └── types/index.ts     # TypeScript types
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## How It Works

1. **Upload** — Drop an MP3/WAV file. It's stored and converted to WAV for processing.
2. **Visualize** — The waveform renders via wavesurfer.js for precise time navigation.
3. **Select** — Choose a time range with the timeline sliders.
4. **Operate** — Pick a stem and action (remove or isolate). Stack multiple operations.
5. **Process** — The backend runs Demucs to separate the track into 6 stems, then applies your operations to the specified time ranges.
6. **Download** — Get the processed track in WAV (lossless) or MP3 (320kbps).

## Tech Stack

- **AI Model**: [Demucs](https://github.com/facebookresearch/demucs) (Meta Research) — state-of-the-art music source separation
- **Backend**: Python, FastAPI, PyTorch, soundfile, pydub
- **Frontend**: React 19, TypeScript, Tailwind CSS, wavesurfer.js
- **Infra**: Docker, NVIDIA CUDA (optional)
