I have analyzed the codebase and identified the necessary changes to fix the Face Swap functionality and implement the Payment system.

### **1. Face Swap Enhancements**
**Goal:** Implement robust photo validation (format, size, face detection) and improve error handling.

*   **Dependencies**: Add `@vladmandic/face-api` (or similar lightweight alternative) and `canvas` for server-side face detection.
*   **File Modifications**:
    *   `new_backend/src/bot.js`:
        *   Implement `validatePhoto(ctx, fileId)` function.
        *   **Size Check**: Reject files > 10MB.
        *   **Format Check**: Verify MIME type (JPEG, PNG, WEBP).
        *   **Face Detection**: Use `face-api` to load the image and check for faces. If no face is detected with >90% confidence, reject the request with a specific error message.
        *   Update `handleSwapRequest` to use this validation *before* deducting points or calling the API.
    *   `new_backend/src/utils/fileUtils.js`: Add helper to download file buffer for validation.

### **2. Payment System Implementation**
**Goal:** Fix the "Pay Now" button and integrate Stripe for secure payments.

*   **Dependencies**: `stripe` is already in `package.json`.
*   **File Modifications**:
    *   `new_backend/src/server.js`:
        *   Add a Stripe Webhook endpoint (`/webhook`) to listen for `checkout.session.completed`.
        *   On success, call `updateUserPoints` to credit the user.
    *   `new_backend/src/bot.js`:
        *   Add a "Pay Now" / "Buy Credits" button to the `/start` menu.
        *   Implement the action handler for this button to create a Stripe Checkout Session.
        *   Send the payment link to the user.
    *   `new_backend/.env`: Update to include `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (I will add placeholders).

### **3. Testing & Verification**
*   **Face Swap**:
    *   Test with invalid file types (e.g., text file).
    *   Test with a large image (>10MB).
    *   Test with a photo containing no faces.
    *   Test with a valid photo.
*   **Payment**:
    *   Generate a payment link.
    *   Simulate a successful webhook event to verify point crediting.

I will proceed with these changes step-by-step, starting with the Face Swap validation logic.
