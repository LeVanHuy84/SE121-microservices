FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runner
FROM python:3.11-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /root/.local
COPY app/ ./app
COPY docs/ ./docs
COPY tools/ ./tools

ENV PATH=/root/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Memory & CPU Optimizations for ONNX Runtime & Linux Glibc
ENV MALLOC_ARENA_MAX=2
ENV OMP_WAIT_POLICY=PASSIVE
ENV KMP_BLOCKTIME=0
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2

EXPOSE 4006
EXPOSE 5006

CMD ["python", "-m", "app.main"]
