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
