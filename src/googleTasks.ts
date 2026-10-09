export interface GoogleTaskList {
  id: string;
  title: string;
  updated: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  updated: string;
  status: 'needsAction' | 'completed';
  due?: string;
  notes?: string;
  completed?: string;
}

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

async function fetchWithAuth(url: string, accessToken: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = await res.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(`Google Tasks API Error (${res.status}): ${errorDetail}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

/**
 * Lists user Google Task Lists
 */
export async function listTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const data = await fetchWithAuth(`${TASKS_API_BASE}/users/@me/lists`, accessToken);
  return data.items || [];
}

/**
 * Finds or creates a designated "موهو — جدول المشاهدة" task list
 */
export async function getOrCreateAnimeTaskList(accessToken: string): Promise<GoogleTaskList> {
  const lists = await listTaskLists(accessToken);
  const existing = lists.find(
    (l) => l.title === 'موهو — جدول المشاهدة' || l.title === 'MOHO Anime Watchlist'
  );
  if (existing) return existing;

  // Create list
  const created = await fetchWithAuth(`${TASKS_API_BASE}/users/@me/lists`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      title: 'موهو — جدول المشاهدة',
    }),
  });
  return created;
}

/**
 * Creates a scheduled watching task in Google Tasks
 */
export async function createWatchTask(
  accessToken: string,
  listId: string,
  params: {
    episodeNumber: number;
    episodeTitle: string;
    scheduledDate: string;
    notes?: string;
  }
): Promise<GoogleTask> {
  const dueIso = params.scheduledDate
    ? new Date(params.scheduledDate).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const title = `📺 موهو: مشاهدة حلقة ${params.episodeNumber} (${params.episodeTitle})`;
  const notes = [
    `موعد مجدول لمشاهدة ناروتو شيبودن عبر منصة موهو.`,
    `الحلقة: ${params.episodeNumber} — ${params.episodeTitle}`,
    params.notes ? `ملاحظاتك: ${params.notes}` : '',
    `المنصة: موهو MOHO Anime Space`
  ].filter(Boolean).join('\n');

  const body = {
    title,
    notes,
    due: dueIso,
    status: 'needsAction',
  };

  const created = await fetchWithAuth(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(listId)}/tasks`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
  return created;
}

/**
 * Fetches all tasks from a task list
 */
export async function listAnimeTasks(accessToken: string, listId: string): Promise<GoogleTask[]> {
  const data = await fetchWithAuth(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true`,
    accessToken
  );
  return data.items || [];
}

/**
 * Marks a task as completed in Google Tasks
 */
export async function completeTask(
  accessToken: string,
  listId: string,
  taskId: string
): Promise<GoogleTask> {
  return await fetchWithAuth(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
      }),
    }
  );
}

/**
 * Deletes a task from Google Tasks (Always requires user confirmation)
 */
export async function deleteTask(
  accessToken: string,
  listId: string,
  taskId: string
): Promise<void> {
  await fetchWithAuth(
    `${TASKS_API_BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    accessToken,
    {
      method: 'DELETE',
    }
  );
}
