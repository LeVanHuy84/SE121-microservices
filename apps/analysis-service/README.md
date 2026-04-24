# Analysis Service

An AI-powered emotion analysis microservice built with FastAPI, PyTorch, and transformers. Provides REST endpoints for emotion detection, music analysis, and community emotion dashboards.

## Overview

The Analysis Service processes text and audio to extract emotional insights. It leverages multiple machine learning models including arousal/valence prediction and supports internal API endpoints for integration with other microservices in the platform.

**Key Features:**

- Emotion analysis with arousal and valence prediction
- Music emotion analysis from URLs
- Community emotion dashboard with configurable date ranges
- Internal security with API key verification
- MongoDB and Redis integration for caching and persistence

## Project Structure

```
analysis-service/
├── app/
│   ├── api/                    # FastAPI route handlers
│   │   ├── analyze_api.py      # Emotion analysis endpoints
│   │   ├── music_api.py        # Music analysis endpoints
│   │   ├── health_api.py       # Health check endpoint
│   │   ├── image_api.py        # Image analysis (available)
│   │   ├── moderation_api.py   # Content moderation (available)
│   │   └── test_api.py         # Testing endpoints
│   ├── core/                   # Core configurations
│   │   ├── lifespan.py         # FastAPI lifespan management
│   │   └── security.py         # API key verification
│   ├── database/               # MongoDB repositories
│   ├── enums/                  # Enumerations (emotion types, status)
│   ├── messaging/              # Kafka integration
│   ├── models/                 # ML model implementations
│   ├── processors/             # Data processing pipelines
│   ├── redis/                  # Redis client and utilities
│   ├── services/               # Business logic and orchestration
│   ├── utils/                  # Helper utilities
│   └── main.py                 # FastAPI app initialization
├── model/                      # Model files directory (ignored in git)
├── download_models.py          # Script to download pre-trained models
├── requirements.txt            # Python dependencies
├── package.json                # Node.js metadata (npm scripts)
└── .env.example                # Environment variable template
```

## Setup Instructions

### Prerequisites

- Python 3.8 or higher
- pip or conda package manager
- 4GB+ RAM recommended (for model loading)
- Approximately 3.5GB disk space for downloaded models

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd apps/analysis-service
```

2. Create a virtual environment:

```bash
python -m venv venv
```

3. Activate the virtual environment:

**Windows:**

```bash
venv\Scripts\activate
```

**macOS/Linux:**

```bash
source venv/bin/activate
```

4. Install dependencies:

```bash
pip install -r requirements.txt
```

### Model Setup

Pre-trained model files are required but not included in the repository due to size constraints. Download them using the provided script:

```bash
python download_models.py
```

This will download two models:

- `model_arousal.pkl` - Arousal prediction model
- `model_valence.pkl` - Valence prediction model

Models are saved to the `model/` directory, which is excluded from version control.

## Running the Service

### Development Mode

```bash
python -m app.main
```

The service will start on `http://localhost:4011` by default.

### Production Mode

```bash
uvicorn app.main:app --host 0.0.0.0 --port 4011 --workers 1
```

### Health Check

```bash
curl http://localhost:4011/health
```

## Environment Variables

Create a `.env` file in the service root directory. Required variables:

```
HOST=0.0.0.0
PORT=4011
MONGO_URL=mongodb://localhost:27017
MONGO_DB=analysis_service

REDIS_HOST=localhost
REDIS_PORT=6379

KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=analysis_service

INTERNAL_SERVICE_KEY=emotion-internal-key-123

EMOTION_DAILY_CRON_HOUR_UTC=17
EMOTION_DAILY_CRON_MINUTE_UTC=05
```

Refer to `.env.example` for a complete template.

## API Endpoints

All endpoints require the `X-Internal-Key` header with the value from `INTERNAL_SERVICE_KEY`.

### Emotion Analysis

- `GET /emotion/dashboard` - Community emotion dashboard
  - Query params: `from` (date), `to` (date)
  - Default range: Last 7 days
  - Max range: 30 days

### Music Analysis

- `POST /musics/analyze` - Analyze music emotion from URL
  - Request body: `{"url": "music_file_url"}`

### Health Check

- `GET /health` - Service health status

### Additional Endpoints

- `GET /test` - Testing endpoints
- Image and moderation endpoints available but disabled by default

## Notes

- Model files (`.pkl`) are git-ignored. Always run `python download_models.py` after cloning.
- The service integrates with Kafka for event streaming and MongoDB for persistence.
- Redis is used for caching and session management.
- All internal endpoints require API key verification via the `INTERNAL_SERVICE_KEY` environment variable.
- First startup may take longer due to model initialization.
