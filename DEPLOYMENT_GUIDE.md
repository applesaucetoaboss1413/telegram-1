# Deployment Guide

## Prerequisites

- Node.js 16+
- PostgreSQL
- Telegram Bot Token
- Stripe API Keys

## Setup Steps

1. Configure environment variables in `.env`
2. Initialize database: `npm run db:migrate`
3. Build frontend: `npm run build`
4. Start services: `npm start`

## Security Checklist

- [ ] Rotated all API keys
- [ ] Verified .env is gitignored
- [ ] Set up HTTPS
- [ ] Configured firewall rules

## Monitoring

- Logs are stored in `/var/log/telegram-bot`
- Admin notifications enabled by default
