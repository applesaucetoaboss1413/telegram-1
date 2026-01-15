# API Reference

## Endpoints

### `POST /api/payment`

- Creates payment session
- Parameters: `currency`, `amount`, `user_id`
- Returns: Stripe session ID

### `POST /api/webhook`

- Handles Stripe webhooks
- Validates signatures
- Processes completed payments

### `GET /api/templates`

- Lists user templates
- Requires authentication
- Returns: Array of template objects

## Error Codes

- 400: Invalid request
- 401: Unauthorized
- 500: Server error
