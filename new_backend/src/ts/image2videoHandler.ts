import { startImage2Video, checkImage2VideoStatus, Image2VideoStartPayload, PollResult } from './a2eClient';

export async function runImage2VideoFlow(imageUrl: string, prompt: string, onProgress: (msg: string) => void, maxMs = 120000): Promise<string> {
  const payload: Image2VideoStartPayload = { name: `image2video_${Date.now()}`, image_url: imageUrl, prompt };
  onProgress('We’re checking your video. This can take up to 120 seconds…');
  const { taskId } = await startImage2Video(payload);
  const started = Date.now();
  let delay = 2000;
  while (Date.now() - started < maxMs) {
    const res: PollResult = await checkImage2VideoStatus(taskId);
    if (res.status === 'completed') return res.result_url || '';
    if (res.status === 'failed') throw new Error(res.error || 'Provider failed');
    if (res.status === 'provider_error_html') throw new Error('The video provider returned an unexpected error. Your request did not complete; please try again in a few minutes.');
    if (res.status === 'server_error') {
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(15000, delay * 2);
      continue;
    }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(15000, delay * 2);
  }
  throw new Error('Timed out while waiting for the provider');
}

