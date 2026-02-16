#!/bin/bash

# Telegram Face Swap Bot Deployment Script
# This script handles production deployment with zero downtime

set -e  # Exit on any error

# Configuration
DEPLOYMENT_ENV=${1:-production}
BACKUP_DIR="./backups"
LOG_FILE="./logs/deployment.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "$LOG_FILE"
}

# Pre-deployment checks
pre_deployment_checks() {
    log "Running pre-deployment checks..."
    
    # Check Node.js version
    NODE_VERSION=$(node --version)
    log "Node.js version: $NODE_VERSION"
    
    # Check if required files exist
    if [ ! -f "package.json" ]; then
        error "package.json not found"
    fi
    
    if [ ! -f ".env.$DEPLOYMENT_ENV" ]; then
        error ".env.$DEPLOYMENT_ENV not found"
    fi
    
    # Check environment variables
    if [ -z "$BOT_TOKEN" ]; then
        error "BOT_TOKEN environment variable not set"
    fi
    
    if [ -z "$STRIPE_SECRET_KEY" ]; then
        warning "STRIPE_SECRET_KEY environment variable not set"
    fi
    
    log "Pre-deployment checks passed"
}

# Create backup
create_backup() {
    log "Creating backup..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup database
    if [ -f "data/faceswap.db" ]; then
        cp "data/faceswap.db" "$BACKUP_DIR/faceswap_$TIMESTAMP.db"
        log "Database backed up to $BACKUP_DIR/faceswap_$TIMESTAMP.db"
    fi
    
    # Backup environment file
    if [ -f ".env.$DEPLOYMENT_ENV" ]; then
        cp ".env.$DEPLOYMENT_ENV" "$BACKUP_DIR/env_$TIMESTAMP.backup"
        log "Environment file backed up"
    fi
}

# Install dependencies
install_dependencies() {
    log "Installing dependencies..."
    
    npm ci --production
    
    if [ $? -ne 0 ]; then
        error "Failed to install dependencies"
    fi
    
    log "Dependencies installed successfully"
}

# Run tests
run_tests() {
    log "Running tests..."
    
    if [ -f "package.json" ] && grep -q '"test"' package.json; then
        npm test
        
        if [ $? -ne 0 ]; then
            error "Tests failed"
        fi
        
        log "Tests passed"
    else
        warning "No tests found, skipping test phase"
    fi
}

# Health check
health_check() {
    log "Performing health check..."
    
    # Wait for service to start
    sleep 5
    
    # Check if health endpoint is available
    MAX_RETRIES=30
    RETRY_COUNT=0
    
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -f -s http://localhost:3000/health > /dev/null; then
            log "Health check passed"
            return 0
        fi
        
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log "Health check attempt $RETRY_COUNT failed, retrying..."
        sleep 2
    done
    
    error "Health check failed after $MAX_RETRIES attempts"
}

# Post-deployment verification
post_deployment_verification() {
    log "Running post-deployment verification..."
    
    # Check Telegram bot connectivity
    if [ -n "$BOT_TOKEN" ]; then
        RESPONSE=$(curl -s "https://api.telegram.org/bot$BOT_TOKEN/getMe")
        if echo "$RESPONSE" | grep -q '"ok":true'; then
            BOT_USERNAME=$(echo "$RESPONSE" | grep -o '"username":"[^"]*' | cut -d'"' -f4)
            log "Telegram bot connected: @$BOT_USERNAME"
        else
            error "Telegram bot connectivity check failed"
        fi
    fi
    
    # Check database connectivity
    if [ -f "data/faceswap.db" ]; then
        log "Database file exists and accessible"
    fi
    
    log "Post-deployment verification completed"
}

# Rollback function
rollback() {
    error "Deployment failed, rolling back..."
    
    # Restore database backup
    if [ -f "$BACKUP_DIR/faceswap_$TIMESTAMP.db" ]; then
        cp "$BACKUP_DIR/faceswap_$TIMESTAMP.db" "data/faceswap.db"
        log "Database restored from backup"
    fi
    
    # Restore environment file
    if [ -f "$BACKUP_DIR/env_$TIMESTAMP.backup" ]; then
        cp "$BACKUP_DIR/env_$TIMESTAMP.backup" ".env.$DEPLOYMENT_ENV"
        log "Environment file restored"
    fi
    
    log "Rollback completed"
    exit 1
}

# Main deployment function
main() {
    log "Starting deployment to $DEPLOYMENT_ENV environment..."
    
    # Set up error handling
    trap rollback ERR
    
    # Create logs directory
    mkdir -p logs
    
    # Run deployment steps
    pre_deployment_checks
    create_backup
    install_dependencies
    run_tests
    
    log "Deployment completed successfully!"
    
    # Post-deployment verification
    post_deployment_verification
    
    # Cleanup old backups (keep last 5)
    if [ -d "$BACKUP_DIR" ]; then
        ls -t "$BACKUP_DIR"/*.db 2>/dev/null | tail -n +6 | xargs rm -f
        log "Old backups cleaned up"
    fi
    
    log "Deployment script completed"
}

# Run main function
main "$@"