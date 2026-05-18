# Use official Python image
FROM python:3.13-slim

# Set working directory in container
WORKDIR /localtodo

# Copy project files into the container
COPY requirements.txt .

# Install dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN adduser --system --no-create-home appuser && chown -R appuser /localtodo

USER appuser

# Expose Flask's default port
EXPOSE 5000

# 4 workers * 10 threads = 40 concurrent connections max
CMD ["gunicorn", "-b", "0.0.0.0:5000", "-w", "4", "--threads", "10", "--worker-class", "gthread", "logic.main:app"]
