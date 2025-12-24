# Deploying to Render

## Build Command
Render requires a build command. Since this project is a Node.js app without a compilation step, we use a no-op build script.

**Build Command:**
```bash
npm install && npm run build
```

## Start Command
The start command launches the server.

**Start Command:**
```bash
npm start
```

## Environment Variables
Ensure all necessary environment variables (e.g., `BOT_TOKEN`, `STRIPE_SECRET_KEY`, `PUBLIC_URL`, `DATABASE_URL`) are set in the Render Dashboard.

## Notes
- The root `package.json` contains a `build` script (`echo "no build step"`) to prevent Render deployment failures.
- `npm start` runs `node backend/server.js`, which redirects to the modular application in `backend/src/server.js`.
