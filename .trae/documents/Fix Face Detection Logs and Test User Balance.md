I will fix the production issues with face detection and test user balance, adding explicit verification logs as requested.

### 1. Fix Face Detection (`src/services/faceService.js`)
The user reports `ERR_MODULE_NOT_FOUND` for `register_all_gradients`. This confirms that despite my previous changes, the environment is still struggling with the TensorFlow backend.
**Plan:**
*   **Verify Imports:** I will check `src/services/faceService.js` to ensure it requires `@tensorflow/tfjs-node`.
*   **Explicit Logging:** I will add the requested logs:
    *   Success: `DEBUG: face detection OK for user=<user_id>`
    *   Failure: `ERROR: face detection failed for user=<user_id>: <message>`
*   **Dependency Check:** I will re-verify `package.json` has `@tensorflow/tfjs-node`.

### 2. Fix Test User Balance (`src/database.js`)
The user reports 0 points despite my previous fix. This suggests the override logic might not be triggering or the user ID is being passed differently (e.g., number vs string).
**Plan:**
*   **Verify Logic:** I will check `getUser(id)` in `src/database.js`. I suspect a type mismatch (ID passed as number vs string in DB) or the check happening *after* the user is retrieved/created.
*   **Explicit Logging:** I will add the requested log:
    *   `INFO: test user 8063916626 balance=<points>` immediately after the override logic runs.
*   **Refinement:** I will ensure the override runs *every time* `getUser` is called for that ID, forcing the balance to 10,000 if it's lower.

### 3. Local Verification
*   **Install:** Run `npm install` (expecting `tfjs-node` failure locally on Windows, but `package.json` correctness is what matters for Render).
*   **Test Script:** Create a small `test-face.js` script that mocks the face detection call to ensure it imports correctly (on a system that supports it) or at least passes the syntax check.

### 4. Commit & Push
*   Commit message: `fix: tfjs face detection logging + force test user points`
*   Push to `main`.

I will now proceed to implement these changes.