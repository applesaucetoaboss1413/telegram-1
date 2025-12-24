# Telegram A2E Integration

## Image → Video Flow
- User sends a photo to the bot using `/image2video` or the button.
- Bot uploads the image to Cloudinary and asks for a motion prompt.
- Backend calls A2E Image-to-Video with `image_url` and `prompt`.
- Polls the status until `completed` and sends the final video URL to the chat.

## Endpoints
- Start: `POST /userImageToVideoTask/add`
- Status: `GET /userImageToVideoTask/status`

## Credits
- Fixed price per job: `A2E_IMAGE2VIDEO_COST` (default 10 points).
- Deduct on start; refund if A2E reports `failed` or timeout.
- Logs include user id, image_url, prompt, task id, and cost.

## Environment
- `A2E_API_KEY`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `A2E_IMAGE2VIDEO_COST` (optional)

## Next Services (Scaffold)
- Avatar/talking photo: image + script via `Generate Avatar Videos` family.
- Face swap video: enforce `face_url` as image and `video_url` as real video.
- Link-to-video: accept URL; call `/api/link_to_videos/` to generate narrated video.

Enable each by creating dedicated start/status helpers, wiring commands, and using the shared polling helper pattern. Configure costs per service via env and integrate with the existing credits system.
