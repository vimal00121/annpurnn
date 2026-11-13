// Tiny API client. Session cookie is HttpOnly; token also kept for the
// future Android app which will use the same backend via Bearer auth.
const API = (() => {
  let token = sessionStorage.getItem('annpurnn_token') || null;

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    if (data.token) {
      token = data.token;
      sessionStorage.setItem('annpurnn_token', token);
    }
    return data;
  }

  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b ?? {}),
    setToken: (t) => { token = t; sessionStorage.setItem('annpurnn_token', t); },
    clearToken: () => { token = null; sessionStorage.removeItem('annpurnn_token'); }
  };
})();
