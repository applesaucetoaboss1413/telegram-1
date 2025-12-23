export type A2EStartResponse = {
  code?: number;
  data?: { _id?: string; current_status?: string; result_url?: string; coins?: number; cost?: number };
  id?: string;
  task_id?: string;
  status?: string;
  message?: string;
};

export type A2EStatusResponse = {
  data?: { current_status?: string; result_url?: string; failed_message?: string } | any;
};

export type Image2VideoStartPayload = {
  name: string;
  image_url: string;
  prompt: string;
};

export type PollResult =
  | { status: 'completed'; result_url: string | null }
  | { status: 'failed'; error?: string }
  | { status: 'processing' }
  | { status: 'bad_request'; error?: string }
  | { status: 'not_found'; error?: string }
  | { status: 'server_error'; error?: string }
  | { status: 'provider_error_html'; error?: string };

export const A2E_API_RESOURCE_BASE = process.env.A2E_API_RESOURCE_BASE || 'https://video.a2e.ai/api/v1';
export const A2E_API_KEY = process.env.A2E_API_KEY || '';

export async function startImage2Video(payload: Image2VideoStartPayload): Promise<{ taskId: string }> {
  const res = await fetch(`${A2E_API_RESOURCE_BASE}/userImage2Video/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${A2E_API_KEY}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: A2EStartResponse | null = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
  const id = json?.data?._id || json?.id || json?.task_id;
  if (!id) throw new Error('No task id');
  return { taskId: id };
}

export async function checkImage2VideoStatus(taskId: string): Promise<PollResult> {
  const endpoint = `${A2E_API_RESOURCE_BASE}/userImage2Video/${encodeURIComponent(taskId)}`;
  try { console.log('[ENV] A2E_API_RESOURCE_BASE', (process.env.A2E_API_RESOURCE_BASE || '')); } catch {}
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${A2E_API_KEY}`, Accept: 'application/json' },
  });
  const text = await res.text();
  try { console.log('[A2E STATUS REQUEST]', { type: 'image2video', taskId, url: endpoint, httpStatus: res.status, body: text.slice(0, 300) }); } catch {}
  const isHtml = /<\/?html/i.test(text);
  if (isHtml) return { status: 'provider_error_html', error: 'HTML 404' };
  if (res.status >= 500) return { status: 'server_error', error: `HTTP ${res.status}` };
  if (res.status === 404) return { status: 'not_found', error: text.slice(0, 300) };
  if (!res.ok) return { status: 'bad_request', error: text.slice(0, 300) };
  let json: A2EStatusResponse | null = null;
  try { json = JSON.parse(text); } catch {}
  const data: any = (json && json.data) || json;
  const s: string = (data && data.current_status) || '';
  if (s === 'completed') return { status: 'completed', result_url: data.result_url || null };
  if (s === 'failed') return { status: 'failed', error: data.failed_message || '' };
  return { status: 'processing' };
}
