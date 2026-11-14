FROM python:3.11-slim

WORKDIR /app

# One OpenMP thread per model fit: avoids spin-wait overhead on a 1-vCPU VM.
ENV OMP_NUM_THREADS=1 PYTHONUNBUFFERED=1

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
