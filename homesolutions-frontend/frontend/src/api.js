const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function readJsonSafely(response) {
  const bodyText = await response.text();

  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

export function getApiErrorMessage(response, data, fallbackMessage) {
  if (data && typeof data.message === 'string' && data.message.trim()) {
    return data.message;
  }

  if (response.status >= 500) {
    return 'Server error. Please try again shortly.';
  }

  return fallbackMessage;
}

export async function sendTroubleshootMessage(userMessage, conversationHistory = []) {
  const response = await fetch(buildApiUrl('/api/chat/troubleshoot'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userMessage,
      conversationHistory,
    }),
  });

  const data = await readJsonSafely(response);

  if (!response.ok || !data?.assistantReply) {
    throw new Error(getApiErrorMessage(response, data, 'Unable to get troubleshooting help right now.'));
  }

  return data.assistantReply;
}
