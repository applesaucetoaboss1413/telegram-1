A2E Image‑to‑Video (Production)

- Start: `https://video.a2e.ai/api/v1/userImage2Video/start`
- Status: `https://video.a2e.ai/api/v1/userImage2Video/{task_id}`
- Configure bases via env: `A2E_VIDEO_BASE`, `A2E_API_BASE`
- Poll: exponential backoff (2s → max 15s), timeout ~120s
- Errors: HTML 404 → provider issue; 5xx → retries; long “processing” → timeout

