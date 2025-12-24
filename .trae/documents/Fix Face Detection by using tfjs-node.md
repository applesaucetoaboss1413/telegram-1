I will fix the face detection module issue by installing `@tensorflow/tfjs-node` and updating the `faceService.js` file to use it. This is the recommended approach for running TensorFlow.js in a Node.js environment (like Render), as it provides native bindings and better performance than the vanilla JS version, and avoids the module resolution issues seen with `register_all_gradients`.

Here is the plan:

1.  **Install Dependencies:**
    *   Install `@tensorflow/tfjs-node` (version matching `@tensorflow/tfjs` if possible, or latest compatible).
    *   This ensures we have the correct native backend for Node.js.

2.  **Update `src/services/faceService.js`:**
    *   Change the import from `@tensorflow/tfjs` to `@tensorflow/tfjs-node`.
    *   Explicitly require `@tensorflow/tfjs-node` to register the backend.
    *   Remove any manual monkey-patching if `tfjs-node` handles it, or ensure it's compatible.
    *   Add the requested logging:
        *   `DEBUG: face detection OK` on success.
        *   `ERROR: face detection failed: <message>` on internal errors (logging the real error but throwing a clean message).

3.  **Verify:**
    *   I will run a quick test script or start the bot locally to ensure `faceService.js` loads without the `ERR_MODULE_NOT_FOUND` error.

4.  **Commit:**
    *   Commit the changes to `package.json`, `package-lock.json`, and `src/services/faceService.js`.

This approach directly addresses the user's "build/runtime module path issue" by using the correct server-side library.