# Telegram Bot + Channel Architecture

## Overview

This project implements a Telegram bot as the primary interface, integrated with a channel and a linked discussion group. The previous Mini App has been removed.

## Features

- Points system with daily check-in, referrals, promotions, and leaderboards
- Faceswap and short video creation
- Stripe checkout for buying points with tier bonuses and first-recharge bonus
- Promo rewards with 20% cash credit for promoters

## Setup

1. Create a bot with BotFather and get `BOT_TOKEN` and bot username
2. Create a Telegram channel and add the bot as admin
3. Link a discussion group to the channel and add the bot, disable privacy mode
4. Set environment variables in `backend/.env`:

```
STRIPE_SECRET_KEY=sk_test_replace
MAGICAPI_KEY=replace
BOT_TOKEN=replace
BOT_USERNAME=replace
PUBLIC_ORIGIN=http://localhost:3000
```

## Run

```
npm start
```

## Bot Commands

- `/start` shows points, invite and promo links, and menu
- `/checkin` awards +1 point per day
- `/faceswap` starts faceswap; send a face photo then a target video
- `/leaderboard` shows top inviters and promoters
- `/confirm <session_id>` credits points after Stripe payment

## Buying Points

Use the bot menu to select a package and get a Stripe checkout link. After payment, use `/confirm <session_id>` to credit points.

## Channel Guidelines

- Add the bot as admin
- Enable comments via a linked discussion group
- Use the bot to post leaderboards and announcements

## Testing

- Verify command responses in private chat and in the linked group
- Test faceswap photo+video flow
- Test Stripe checkout and `/confirm`

