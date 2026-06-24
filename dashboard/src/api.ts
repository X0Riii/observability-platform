const BASE = '';

export async function fetchSessions(url?: string, limit = 50, offset = 0) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (url) params.set('url', url);
  const res = await fetch(`${BASE}/api/sessions?${params}`);
  return res.json();
}

export async function fetchSession(id: string) {
  const res = await fetch(`${BASE}/api/sessions/${id}`);
  return res.json();
}

export async function fetchTimeline(id: string, from = 0, limit = 1000) {
  const res = await fetch(`${BASE}/api/sessions/${id}/timeline?from=${from}&limit=${limit}`);
  return res.json();
}

export async function fetchScreenshots(pageId: string) {
  const res = await fetch(`${BASE}/api/pages/${pageId}/screenshots`);
  return res.json();
}

export async function search(q: string, filters?: Record<string, string>, from = 0, size = 20) {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, ...filters, from, size }),
  });
  return res.json();
}

export async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}
