# Telegram Face-Swap Bot

## Key Features

- User-provided template system
- Multi-currency payment support
- Secure environment management
- Admin notification system

## Setup Guide

1. Copy `.env.example` to `.env`
2. Configure all required variables
3. Install dependencies: `npm install`
4. Start bot: `npm start`

## Security Notes

- Never commit `.env` files
- Rotate tokens if exposed
- Use git-filter-repo to clean history

## Payment System

- Supports USD, EUR, GBP, MXN, CAD
- Dynamic exchange rates
- 3% spread on conversions
