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
      // An unexpected 401 means our session died (e.g. server restart).
      // Send the user to login instead of failing inside a form.
      if (res.status === 401 && !path.startsWith('/api/auth/')) {
        token = null;
        sessionStorage.removeItem('annpurnn_token');
        if (API.onUnauthorized) API.onUnauthorized();
      }
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

  const API = {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b ?? {}),
    setToken: (t) => { token = t; sessionStorage.setItem('annpurnn_token', t); },
    clearToken: () => { token = null; sessionStorage.removeItem('annpurnn_token'); },
    onUnauthorized: null
  };
  return API;
})();
