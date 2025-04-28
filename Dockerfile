# Use official Python image
FROM python:3.11

# Set working directory in container
WORKDIR /localtodo

# Copy project files into the container
COPY . .

# Install dependencies from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Expose Flask's default port
EXPOSE 5000

# Command to run the app
CMD ["gunicorn", "-b", "0.0.0.0:5000", "logic.main:app"]
