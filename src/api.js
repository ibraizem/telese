/**
 * Client HTTP de l'API : un seul point d'entrée, gestion uniforme des
 * erreurs ({ error: { code, message, fields } }) et des sessions.
 */
export class ApiError extends Error {
  constructor(message, code = 'error', status = 0, fields = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur. Vérifiez votre connexion.', 'network');
  }

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }

  if (!res.ok) {
    const err = data?.error || {};
    throw new ApiError(err.message || `Erreur ${res.status}`, err.code || 'error', res.status, err.fields || null);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

/** Récupère le message et les champs en erreur d'un formulaire. */
export function formError(err) {
  if (err instanceof ApiError) return { message: err.message, fields: err.fields || {} };
  return { message: err?.message || 'Erreur inattendue.', fields: {} };
}
