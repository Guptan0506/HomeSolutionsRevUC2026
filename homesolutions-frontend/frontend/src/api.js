const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// JWT Token Management
const TOKEN_STORAGE_KEY = 'hs_auth_token';
const TOKEN_EXPIRY_KEY = 'hs_auth_token_expiry';

/**
 * Get stored JWT token
 * @returns {string|null} JWT token or null if expired/not found
 */
export function getAuthToken() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

  if (!token || !expiry) {
    return null;
  }

  // Check if token is expired
  if (Date.now() > parseInt(expiry, 10)) {
    // Token expired, remove it
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    return null;
  }

  return token;
}

/**
 * Store JWT token with expiry
 * @param {string} token - JWT token
 * @param {number} expiresAt - Unix timestamp when token expires
 */
export function setAuthToken(token, expiresAt) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt * 1000)); // Convert to milliseconds
}

/**
 * Clear stored JWT token
 */
export function clearAuthToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

/**
 * Get default headers with authorization
 * @returns {Object} Headers object with Authorization if token exists
 */
export function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAuthToken();

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

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
    headers: getAuthHeaders(),
    body: JSON.stringify({
      userMessage,
      conversationHistory,
    }),
  });

  const data = await readJsonSafely(response);

  if (!response.ok || !data?.assistantReply) {
    throw new Error(getApiErrorMessage(response, data, 'Unable to get troubleshooting help right now.'));
  }

  return {
    assistantReply: data.assistantReply,
    complexity: data.complexity,
    recommendedServiceType: data.recommendedServiceType,
    safetyReminder: data.safetyReminder
  };
}
