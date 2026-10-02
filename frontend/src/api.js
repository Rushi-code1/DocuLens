const API_BASE = 'http://127.0.0.1:8000/api';

export function getAuthHeaders() {
  const token = localStorage.getItem('access_token');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {})
  };

  // If not FormData, default to application/json
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 401) {
    // If unauthorized, clear tokens and dispatch event
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.dispatchEvent(new Event('auth_unauthorized'));
  }

  if (!res.ok) {
    let errorDetail = 'Request failed';
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || JSON.stringify(errJson);
    } catch {
      errorDetail = `HTTP ${res.status}: ${res.statusText}`;
    }
    throw new Error(errorDetail);
  }

  return res.json();
}

// Authentication Endpoints
export async function registerUser(username, email, password) {
  return apiRequest('/auth/register/', {
    method: 'POST',
    body: JSON.stringify({ username, email, password })
  });
}

export async function loginUser(username, password) {
  return apiRequest('/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function getCurrentUser() {
  return apiRequest('/auth/me/');
}

// Document Management Endpoints
export async function fetchDocuments() {
  return apiRequest('/documents/');
}

export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);

  return apiRequest('/documents/upload/', {
    method: 'POST',
    body: formData
  });
}

export async function fetchDocument(docId) {
  return apiRequest(`/documents/${docId}/`);
}

export async function deleteDocument(docId) {
  return apiRequest(`/documents/${docId}/`, {
    method: 'DELETE'
  });
}

// Chat Endpoints
export async function fetchMessages(docId) {
  return apiRequest(`/documents/${docId}/messages/`);
}

export async function askQuestion(docId, question, selectedContext = '') {
  return apiRequest(`/documents/${docId}/ask/`, {
    method: 'POST',
    body: JSON.stringify({
      question,
      selected_context: selectedContext
    })
  });
}
