const STORAGE_KEY = 'freecell-partner-session';
export function createPartnerFlow({ api, request, storage = sessionStorage }) {
  const state = { session: null, connecting: false, error: '', submitting: false, submitted: false, result: null };
  const call = (path, body) => request(`${api}/partner/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(state.session ? { authorization: `Bearer ${state.session.session_id}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    state,
    async connect(launch) {
      const saved = storage.getItem(STORAGE_KEY);
      if (!launch && !saved) return null;
      state.connecting = true;
      try {
        if (launch) { storage.removeItem(STORAGE_KEY); state.session = await call('session', { ticket: launch.ticket, template_id: launch.templateId, return_url: launch.returnUrl, proto: launch.proto }); }
        else { state.session = { session_id: saved }; state.session = await call('session'); }
        if (!state.session.return_url) throw new Error('平台会话缺少返回地址。');
        storage.setItem(STORAGE_KEY, state.session.session_id);
        state.submitted = ['pending_confirm', 'published', 'failed', 'offline', 'deleted'].includes(state.session.state);
        return state.session;
      } catch (error) { state.error = error.message; throw error; }
      finally { if (launch) { launch.ticket = ''; launch.returnUrl = ''; } state.connecting = false; }
    },
    async create(prompt) { return call('jobs', { prompt }); },
    async job() { return call('job'); },
    async submit() {
      if (state.submitting) return;
      state.submitting = true; state.error = '';
      try {
        // Query only a server-owned reservation; if absent, submit creates it once.
        try { state.result = await call('query'); }
        catch { state.result = await call('submit', { hosting: 'external' }); }
        state.submitted = true; return state.result;
      } catch (error) { state.error = error.message; throw error; }
      finally { state.submitting = false; }
    },
    returnToPlatform() {
      if (!state.session?.return_url) return;
      const url = new URL(state.session.return_url);
      if (state.result?.work_id) url.searchParams.set('work_id', state.result.work_id);
      url.searchParams.set('result', state.result?.state === 'failed' || state.session.state === 'failed' ? 'failed' : 'ok');
      storage.removeItem(STORAGE_KEY); location.assign(url.href);
    },
  };
}
