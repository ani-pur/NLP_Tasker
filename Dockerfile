# Use official Python image
FROM python:3.11

# Set working directory in container
WORKDIR /localtodo

# Copy project files into the container
COPY requirements.txt .

# Install dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Expose Flask's default port
EXPOSE 5000

# 4 workers * 20 threads = 80 concurrent connections max
CMD ["gunicorn", "-b", "0.0.0.0:5000", "-w", "4", "--threads", "20", "--worker-class", "gthread", "logic.main:app"]
