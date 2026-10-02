// Served as a static script; no private data is interpolated into JavaScript.
export const CLIENT_SCRIPT = String.raw`(() => {
  const $ = id => document.getElementById(id);
  let pendingId;
  function feedback(text) { $('feedback').textContent = text; }
  async function api(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json, text/event-stream', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data;
    try { data = await response.json(); }
    catch {
      if (!response.ok) throw new Error('This action could not be completed (HTTP ' + response.status + '). Try again.');
      throw new Error('The Site returned an invalid response. Refresh Settings and try again.');
    }
    if (!response.ok) throw new Error(data?.error?.message || 'This action could not be completed (HTTP ' + response.status + '). Try again.');
    return data;
  }
  async function action(button, fn) {
    button.disabled = true;
    try { await fn(); } catch (error) { feedback(error.message || 'This action could not be completed.'); }
    finally { button.disabled = false; }
  }
  async function load() {
    const status = await api('/api/settings');
    const connection = status.connection;
    $('connection-state').textContent = connection.state === 'not_connected' ? 'Microsoft is not connected.' : connection.state === 'reconnect_required' ? 'Microsoft needs you to reconnect.' : 'Microsoft is connected.';
    $('account-label').textContent = connection.accountLabel || '';
    $('connect').hidden = connection.state !== 'not_connected';
    for (const id of ['reconnect', 'replace', 'disconnect']) $(id).hidden = connection.state === 'not_connected';
    $('check-access').hidden = connection.state !== 'connected';
    pendingId = status.pending?.id;
    $('replacement').hidden = !pendingId;
    $('replacement-label').textContent = status.pending ? 'New account: ' + status.pending.label : '';
    $('endpoint').textContent = status.mcpUrl;
    const list = $('token-list'); list.replaceChildren();
    if (!status.tokens.length) { const p = document.createElement('p'); p.textContent = 'No personal tokens yet.'; list.append(p); }
    let active = 0;
    for (const token of status.tokens) {
      const expired = token.expiresAt <= Date.now();
      const revoked = token.revokedAt !== null;
      const row = document.createElement('div'); row.className = 'token';
      const detail = document.createElement('div'); const name = document.createElement('strong'); name.textContent = token.label; detail.append(name);
      const meta = document.createElement('small'); meta.textContent = (token.permission === 'write' ? 'Read/write' : 'Read-only') + ' · ' + (revoked ? 'Revoked' : expired ? 'Expired' : 'Expires ' + new Date(token.expiresAt).toLocaleDateString()) + ' · todo_' + token.id;
      detail.append(meta);
      const dates = document.createElement('small'); dates.textContent = 'Created ' + new Date(token.createdAt).toLocaleDateString() + ' · Last used ' + (token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'never'); detail.append(dates);
      row.append(detail);
      if (!expired && !revoked) { active++; const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Revoke';
        button.addEventListener('click', () => action(button, async () => { await api('/api/tokens/' + encodeURIComponent(token.id) + '/revoke', {}); feedback('Token revoked.'); await load(); })); row.append(button); }
      list.append(row);
    }
    $('revoke-all').hidden = !active;
  }
  for (const purpose of ['connect', 'reconnect', 'replace']) $(purpose).addEventListener('click', () => action($(purpose), async () => {
    $('authorize').hidden = true;
    const data = await api('/api/microsoft/connect', { purpose });
    $('authorize').href = data.authorizationUrl; $('authorize').hidden = false;
    feedback('Continue to Microsoft to choose your account and grant permission.');
  }));
  $('disconnect').addEventListener('click', () => { if (confirm('Disconnect Microsoft and revoke all personal tokens?')) action($('disconnect'), async () => { await api('/api/microsoft/disconnect', {}); $('authorize').hidden = true; $('authorize').removeAttribute('href'); feedback('Microsoft disconnected. Personal tokens revoked.'); await load(); }); });
  $('check-access').addEventListener('click', () => action($('check-access'), async () => {
    feedback('Checking Microsoft To Do access…');
    try {
      const data = await api('/api/check-access', {});
      if (data.verified !== true) throw new Error('To Do access could not be verified. Try again.');
      feedback('To Do access verified through this Site. No tasks were changed.');
    } finally { await load(); }
  }));
  $('confirm-replacement').addEventListener('click', () => action($('confirm-replacement'), async () => { await api('/api/microsoft/confirm-replacement', { pendingId }); feedback('Microsoft account replaced. Personal tokens revoked.'); await load(); }));
  $('cancel-replacement').addEventListener('click', () => action($('cancel-replacement'), async () => { await api('/api/microsoft/cancel-replacement', {}); feedback('Replacement cancelled. Your existing account is still connected.'); await load(); }));
  $('token-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget; action(form.querySelector('button'), async () => {
    const data = await api('/api/tokens', { label: form.elements.label.value, permission: form.elements.permission.value, days: Number(form.elements.days.value) });
    $('token-value').textContent = data.token; $('new-token').hidden = false; feedback('Token created. Copy it before leaving this page.'); await load();
  }); });
  $('copy-token').addEventListener('click', () => action($('copy-token'), async () => { await navigator.clipboard.writeText($('token-value').textContent); feedback('Token copied. Store it securely.'); }));
  $('dismiss-token').addEventListener('click', () => { $('token-value').textContent = ''; $('new-token').hidden = true; });
  $('revoke-all').addEventListener('click', () => { if (confirm('Revoke every personal API token?')) action($('revoke-all'), async () => { await api('/api/tokens/revoke-all', {}); $('token-value').textContent = ''; $('new-token').hidden = true; feedback('All personal tokens revoked.'); await load(); }); });
  window.addEventListener('pagehide', () => { $('token-value').textContent = ''; $('new-token').hidden = true; });
  load().catch(error => feedback(error.message));
})();`;
