# Use official Python image
FROM python:3.13-slim

# Set working directory in container
WORKDIR /localtodo

# Copy project files into the container
COPY requirements.txt .

# Install dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Give the user a real home so gunicorn's control socket has somewhere to live
# (without one it logs a permission error on /nonexistent at every boot).
RUN adduser --system --home /home/appuser appuser && chown -R appuser /localtodo

USER appuser
ENV HOME=/home/appuser

# Expose Flask's default port
EXPOSE 5000

# 4 workers * 10 threads = 40 concurrent connections max
CMD ["gunicorn", "-b", "0.0.0.0:5000", "-w", "4", "--threads", "20", "--worker-class", "gthread", "logic.main:app"]
