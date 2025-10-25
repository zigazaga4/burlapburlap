#!/bin/bash

# Create logs directory if it doesn't exist
mkdir -p logs

# Get current date for log file
LOG_FILE="logs/qdrant-$(date +%Y-%m-%d).log"

# Cleanup function
cleanup() {
    echo "Stopping Qdrant database..."
    echo "Daciapop1." | sudo -S docker-compose down
    exit 0
}

# Set trap for cleanup
trap cleanup SIGINT SIGTERM

# Stop any existing Qdrant containers first
echo "Checking for existing Qdrant containers..."
if echo "Daciapop1." | sudo -S docker ps -a | grep -q qdrant; then
    echo "Stopping and removing existing Qdrant containers..."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Stopping existing Qdrant containers..." >> "$LOG_FILE"
    echo "Daciapop1." | sudo -S docker-compose down
    sleep 2
fi

# Start Qdrant database
echo "Starting Qdrant database..."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Qdrant database..." >> "$LOG_FILE"
echo "Daciapop1." | sudo -S docker-compose up 2>&1 | tee -a "$LOG_FILE"

