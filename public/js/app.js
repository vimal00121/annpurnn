/* ANNPURNN SPA — hash router + views. Mobile-first. */
let ME = null;
let AREAS = [];

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg, isErr) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  if (isErr) $toast.style.background = '#b3261e'; else $toast.style.background = '';
  setTimeout(() => $toast.classList.remove('show'), 2600);
}

function requireLogin() {
  if (!ME) { toast(t('login_required'), true); location.hash = '#/auth'; return false; }
  return true;
}

function statusLabel(s) { return t('status_' + s) || s; }

function requestCard(r, opts = {}) {
  const pills = [];
  pills.push(`<span class="pill">${esc(r.people_count)} 👥</span>`);
  pills.push(`<span class="pill">${r.veg_pref === 'nonveg' ? '🍗 ' + t('nonveg') : r.veg_pref === 'any' ? t('any') : '🥬 ' + t('veg')}</span>`);
  pills.push(`<span class="pill">${esc(r.area)}</span>`);
  pills.push(`<span class="pill warn">⏰ ${esc(r.collection_time)}</span>`);
  if (r.fulfilment_mode === 'pickup_or_delivery') pills.push('<span class="pill">🛵 delivery OK</span>');
  if (r.created_by_helper) pills.push(`<span class="pill helper">🤝 ${esc(t('helper_banner'))}</span>`);
  if (r.is_anonymous) pills.push(`<span class="pill anon">🕶️ anonymous</span>`);
  return `<a class="card req-card status-${esc(r.status)}" href="#/request/${r.id}">
    <div class="req-head"><strong>${esc(r.food_desc)}</strong><span class="req-code">${esc(r.code || r.request_code || '')}</span></div>
    <div class="pills">${pills.join('')}</div>
    <div class="row spread">
      <span class="status ${esc(r.status)}">${esc(statusLabel(r.status))}</span>
      <small class="muted">${esc((r.created_at || '').slice(0, 16))}</small>
    </div>
  </a>`;
}

// ---------------- views ----------------

const views = {};

views.home = () => {
  const tiles = [
    { href: '#/request/new', em: '🍚', label: t('tile_request'), sub: t('tile_request_sub') },
    { href: '#/donate/new', em: '🤲', label: t('tile_donate'), sub: t('tile_donate_sub') },
    { href: '#/request/new?for=someone', em: '🤝', label: t('tile_help'), sub: t('tile_help_sub') },
    { href: '#/requests', em: '🍲', label: t('tile_feed'), sub: t('tile_feed_sub') },
    { href: '#/events', em: '📅', label: t('tile_events'), sub: t('tile_events_sub') },
    { href: '#/community', em: '💬', label: t('tile_community'), sub: t('tile_community_sub') }
  ];
  $app.innerHTML = `
    <div class="home-hero">
      <img src="/img/emblem.png" alt="" class="hero-emblem" width="72" height="72">
      <h1>${esc(t('hero_title'))}</h1>
      <p class="slogan">${esc(t('slogan'))}</p>
      <p>${esc(t('hero_sub'))}</p>
    </div>
    ${ME ? `<div class="card green">🙏 <strong>${esc(ME.name)}</strong>
        <div class="muted">${ME.roles.map((r) => esc(r)).join(' · ')}
        ${ME.donorVerified ? ' · ✅ verified donor' : ''}${ME.helperVerified ? ' · ✅ verified helper' : ''}</div></div>`
      : `<a class="btn gold" href="#/auth">${esc(t('login'))}</a>`}
    <div class="tile-grid">
      ${tiles.map((tl) => `<a class="tile ${tl.commercial ? 'commercial' : ''}" href="${tl.href}">
        <span class="em">${tl.em}</span>${esc(tl.label)}<small>${esc(tl.sub)}</small></a>`).join('')}
    </div>
    <div class="notice">💚 ${esc(t('free_forever'))}</div>`;
};

views.auth = () => {
  $app.innerHTML = `
    <div class="card"><h2>${esc(t('login'))}</h2>
      <div class="row" style="gap:8px;margin-bottom:10px">
        <button class="chip" id="modePhone" style="border-color:var(--green)">📱 ${esc(t('use_phone'))}</button>
        <button class="chip" id="modeEmail" style="border-color:var(--muted,#999)">✉️ ${esc(t('use_email'))}</button>
      </div>
      <div class="field" id="phoneField"><label>${esc(t('phone'))}</label>
        <input id="phone" type="tel" inputmode="numeric" placeholder="98XXXXXXXX" autocomplete="tel"></div>
      <div class="field" id="emailField" hidden><label>${esc(t('email'))}</label>
        <input id="email" type="email" placeholder="you@example.com" autocomplete="email"></div>
      <div class="field" id="nameField" hidden><label>${esc(t('name'))}</label>
        <input id="name" maxlength="80" autocomplete="name"></div>
      <div class="field" id="rolesField" hidden>
        <label>${esc(t('nav_me'))}</label>
        <label style="font-weight:500"><input type="checkbox" id="rSeeker" checked> ${esc(t('role_seekers'))}</label>
        <label style="font-weight:500"><input type="checkbox" id="rDonor"> ${esc(t('role_donors'))}</label>
        <label style="font-weight:500"><input type="checkbox" id="rHelper"> ${esc(t('role_helpers'))}</label>
      </div>
      <div class="field" id="otpField" hidden><label>${esc(t('otp'))}</label>
        <input id="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <button class="btn primary" id="step1">${esc(t('get_otp'))}</button>
      <button class="btn gold" id="step2" hidden>${esc(t('verify_otp'))}</button>
      <div id="authErr"></div>
      <p class="hint">We verify your phone or email with an OTP to keep the community safe. Your contact details are never shown publicly.</p>
    </div>`;
  let mode = 'phone';
  const modePhoneBtn = document.getElementById('modePhone');
  const modeEmailBtn = document.getElementById('modeEmail');
  function setMode(m) {
    mode = m;
    document.getElementById('phoneField').hidden = m !== 'phone';
    document.getElementById('emailField').hidden = m !== 'email';
    modePhoneBtn.style.borderColor = m === 'phone' ? 'var(--green)' : 'var(--muted,#999)';
    modeEmailBtn.style.borderColor = m === 'email' ? 'var(--green)' : 'var(--muted,#999)';
  }
  modePhoneBtn.onclick = () => setMode('phone');
  modeEmailBtn.onclick = () => setMode('email');
  document.getElementById('step1').onclick = async () => {
    const payload = mode === 'email'
      ? { email: document.getElementById('email').value.trim() }
      : { phone: document.getElementById('phone').value.trim() };
    try {
      const r = await API.post('/api/auth/otp/request', payload);
      document.getElementById('authErr').innerHTML = r.dev_otp
        ? `<div class="okmsg">OTP sent ✅ Dev mode (no SMS/email gateway configured): your code is <b>${esc(r.dev_otp)}</b>. With a real provider this code arrives by SMS or email instead.</div>`
        : `<div class="okmsg">${mode === 'email' ? 'OTP sent to your email' : 'OTP sent by SMS'}. It is valid for 10 minutes.</div>`;
      document.getElementById('otpField').hidden = false;
      document.getElementById('nameField').hidden = false;
      document.getElementById('rolesField').hidden = false;
      document.getElementById('step1').hidden = true;
      document.getElementById('step2').hidden = false;
    } catch (e) {
      document.getElementById('authErr').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
  document.getElementById('step2').onclick = async () => {
    const roles = [];
    if (document.getElementById('rSeeker').checked) roles.push('seeker');
    if (document.getElementById('rDonor').checked) roles.push('donor');
    if (document.getElementById('rHelper').checked) roles.push('helper');
    try {
      const payload = mode === 'email'
        ? { email: document.getElementById('email').value.trim(), code: document.getElementById('otp').value.trim(),
            name: document.getElementById('name').value.trim(), roles }
        : { phone: document.getElementById('phone').value.trim(), code: document.getElementById('otp').value.trim(),
            name: document.getElementById('name').value.trim(), roles };
      const r = await API.post('/api/auth/otp/verify', payload);
      ME = r.user;
      toast('🙏 ' + (ME.name || 'Welcome'));
      location.hash = '#/';
      render();
    } catch (e) {
      document.getElementById('authErr').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
};

views.requestNew = (query) => {
  if (!requireLogin()) return;
  const onBehalf = query.get('for') === 'someone';
  const isHelper = ME.roles.includes('helper');
  if (onBehalf && !isHelper) {
    $app.innerHTML = `<div class="card"><h2>${esc(t('helper_new'))}</h2>
      <p>Becoming a community helper requires verification by the ANNPURNN team, so vulnerable people are protected from fake requests.</p>
      <p class="muted">Your account currently has roles: ${esc(ME.roles.join(', '))}. Register with the helper role and wait for verification.</p>
      <a class="btn outline" href="#/requests">${esc(t('back'))}</a></div>`;
    return;
  }
  const areaOpts = AREAS.map((a) => `<option>${esc(a)}</option>`).join('');
  $app.innerHTML = `
    <div class="card ${onBehalf ? 'green' : 'gold'}">
      <h2>${esc(onBehalf ? t('helper_new') : t('request_new'))}</h2>
      <p class="muted">${esc(t('request_new_sub'))}</p>
      ${onBehalf ? `<div class="notice">🤝 ${esc(t('helper_banner'))}. ${esc(t('privacy_note'))}</div>` : ''}
      <form id="f">
        <div class="field"><label>${esc(t('food_needed'))} *</label>
          <textarea id="food" required maxlength="500" placeholder="e.g. Cooked dal, rice and sabzi"></textarea></div>
        <div class="field"><label>${esc(t('people'))} *</label>
          <input id="people" type="number" min="1" max="200" required value="2"></div>
        <div class="field"><label>${esc(t('veg_pref'))}</label>
          <select id="veg"><option value="veg">${esc(t('veg'))}</option><option value="nonveg">${esc(t('nonveg'))}</option><option value="any">${esc(t('any'))}</option></select></div>
        <div class="field"><label>${esc(t('area'))} *</label><select id="area">${areaOpts}</select></div>
        <div class="field"><label>${esc(t('time'))} *</label>
          <input id="time" required placeholder="e.g. Today 7:00 PM"></div>
        <div class="field"><label>${esc(t('mode'))}</label>
          <select id="mode"><option value="pickup">${esc(t('pickup'))}</option><option value="pickup_or_delivery">${esc(t('pickup_or_delivery'))}</option></select></div>
        <div class="field"><label>${esc(t('urgency'))}</label><input id="urgency" maxlength="500"></div>
        <div class="field"><label>${esc(t('access'))}</label><input id="access" maxlength="500"></div>
        <div class="field"><label>${esc(t('exact_address'))}</label>
          <input id="address" maxlength="300"><p class="hint">🔒 ${esc(t('privacy_note'))}</p></div>

        ${onBehalf ? `
        <hr class="divider">
        <div class="field"><label style="font-weight:500"><input type="checkbox" id="anon" checked> ${esc(t('anonymous'))}</label></div>
        <div class="field" id="aliasField" hidden><label>${esc(t('beneficiary'))}</label><input id="alias" maxlength="40"></div>
        <div class="field"><label>${esc(t('safe_point'))}</label><input id="point" maxlength="300"></div>
        <div class="field"><label>${esc(t('supporting'))}</label><textarea id="supporting" maxlength="1000"></textarea></div>
        <div class="field"><label style="font-weight:500"><input type="checkbox" id="consent" required> ${esc(t('consent'))} *</label></div>
        <div class="field"><label>Beneficiary photo (optional)</label><input id="photo" type="file" accept="image/*">
          <label style="font-weight:500;margin-top:6px"><input type="checkbox" id="photoConsent"> ${esc(t('photo_consent'))}</label></div>` : ''}
        <button class="btn primary" type="submit">${esc(t('submit_request'))}</button>
      </form><div id="reqErr"></div>
    </div>`;
  const anonEl = document.getElementById('anon');
  if (anonEl) anonEl.onchange = () => { document.getElementById('aliasField').hidden = anonEl.checked; };
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    const body = {
      on_behalf: onBehalf,
      food_desc: document.getElementById('food').value,
      people_count: Number(document.getElementById('people').value),
      veg_pref: document.getElementById('veg').value,
      area: document.getElementById('area').value,
      collection_time: document.getElementById('time').value,
      fulfilment_mode: document.getElementById('mode').value,
      urgency_note: document.getElementById('urgency').value || undefined,
      accessibility_note: document.getElementById('access').value || undefined,
      exact_address: document.getElementById('address').value || undefined
    };
    if (onBehalf) {
      body.is_anonymous = document.getElementById('anon').checked ? 1 : 0;
      body.beneficiary_alias = document.getElementById('alias')?.value || '';
      body.safe_collection_point = document.getElementById('point').value || undefined;
      body.supporting_info = document.getElementById('supporting').value || undefined;
      body.helper_consent_confirmed = document.getElementById('consent').checked;
      body.allow_multiple_donors = false;
      const photoInput = document.getElementById('photo');
      if (photoInput.files.length) {
        if (!document.getElementById('photoConsent').checked) {
          document.getElementById('reqErr').innerHTML = `<div class="err">${esc(t('photo_consent'))}</div>`;
          return;
        }
        const file = photoInput.files[0];
        const upRes = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        const up = await upRes.json();
        if (!upRes.ok) throw new Error(up.error || 'Upload failed');
        body.photo_path = up.path;
        body.photo_consent_confirmed = true;
      }
    }
    try {
      await API.post('/api/requests', body);
      toast(t('request_created'));
      location.hash = '#/me';
    } catch (e) {
      if (e.status === 409 && String(e.message).includes('duplicate')) {
        if (confirm(e.message + '\n\nSubmit anyway?')) {
          body.confirm_duplicate = true;
          try { await API.post('/api/requests', body); toast(t('request_created')); location.hash = '#/me'; }
          catch (e2) { document.getElementById('reqErr').innerHTML = `<div class="err">${esc(e2.message)}</div>`; }
        }
      } else {
        document.getElementById('reqErr').innerHTML = `<div class="err">${esc(e.message)}</div>`;
      }
    }
  };
};

views.requests = () => {
  $app.innerHTML = `
    <h2>${esc(t('feed_title'))}</h2>
    <div class="tabs">
      <div class="tab active" id="tabSeeker">${esc(t('tab_seeker'))}</div>
      <div class="tab" id="tabHelper">${esc(t('tab_helper'))}</div>
    </div>
    <div class="filters card">
      <div><label>${esc(t('filter_area'))}</label><select id="fArea"><option value="">—</option>${AREAS.map((a) => `<option>${esc(a)}</option>`).join('')}</select></div>
      <div><label>${esc(t('filter_pref'))}</label><select id="fVeg"><option value="any">${esc(t('any'))}</option><option value="veg">${esc(t('veg'))}</option><option value="nonveg">${esc(t('nonveg'))}</option></select></div>
      <div><label>${esc(t('filter_people'))}</label><input id="fPeople" type="number" min="0" value="0"></div>
      <div style="align-self:end"><button class="btn small primary" id="fApply">${esc(t('apply'))}</button></div>
    </div>
    <div id="feedList"></div>`;
  let tab = 'seeker';
  async function load() {
    const p = new URLSearchParams({ tab });
    if (document.getElementById('fArea').value) p.set('area', document.getElementById('fArea').value);
    if (document.getElementById('fVeg').value !== 'any') p.set('veg', document.getElementById('fVeg').value);
    const mp = Number(document.getElementById('fPeople').value || 0);
    if (mp > 0) p.set('min_people', mp);
    const r = await API.get('/api/requests?' + p);
    document.getElementById('feedList').innerHTML = r.requests.length
      ? r.requests.map((x) => requestCard(x)).join('')
      : '<div class="card muted">No open requests right now. 💛</div>';
  }
  document.getElementById('tabSeeker').onclick = () => {
    tab = 'seeker';
    document.getElementById('tabSeeker').classList.add('active');
    document.getElementById('tabHelper').classList.remove('active');
    load();
  };
  document.getElementById('tabHelper').onclick = () => {
    tab = 'helper';
    document.getElementById('tabHelper').classList.add('active');
    document.getElementById('tabSeeker').classList.remove('active');
    load();
  };
  document.getElementById('fApply').onclick = load;
  load();
};

views.requestDetail = async (id) => {
  let r;
  try { r = (await API.get('/api/requests/' + id)).request; }
  catch (e) { $app.innerHTML = `<div class="err card">${esc(e.message)}</div>`; return; }
  const mine = ME && r.private; // private block present => participant
  const canAccept = ME && ME.roles.includes('donor') && r.status === 'open' && !(mine && ME.id === r.creator_id);
  $app.innerHTML = `
    <a class="btn small outline" href="#/requests">← ${esc(t('back'))}</a>
    <div class="card req-card status-${esc(r.status)}">
      <div class="req-head"><h2>${esc(r.food_desc)}</h2><span class="req-code">${esc(r.code)}</span></div>
      <div class="pills">
        <span class="pill">${esc(r.people_count)} 👥</span>
        <span class="pill">${r.veg_pref === 'veg' ? '🥬 ' + t('veg') : r.veg_pref === 'nonveg' ? '🍗 ' + t('nonveg') : t('any')}</span>
        <span class="pill">📍 ${esc(r.area)}</span>
        <span class="pill warn">⏰ ${esc(r.collection_time)}</span>
        ${r.fulfilment_mode === 'pickup_or_delivery' ? '<span class="pill">🛵 delivery OK</span>' : ''}
        ${r.created_by_helper ? `<span class="pill helper">🤝 ${esc(t('helper_banner'))}</span>` : ''}
        ${r.is_anonymous ? '<span class="pill anon">🕶️ anonymous</span>' : ''}
      </div>
      ${r.beneficiary_alias ? `<p class="muted">For: ${esc(r.beneficiary_alias)}</p>` : ''}
      ${r.urgency_note ? `<p>⚡ ${esc(r.urgency_note)}</p>` : ''}
      ${r.accessibility_note ? `<p>♿ ${esc(r.accessibility_note)}</p>` : ''}
      <p class="status ${esc(r.status)}">${esc(statusLabel(r.status))}</p>
      ${r.private ? `
        <hr class="divider"><h3>${esc(t('collection_details'))}</h3>
        ${r.private.exact_address ? `<p>🏠 ${esc(r.private.exact_address)}</p>` : ''}
        ${r.private.safe_collection_point ? `<p>📌 ${esc(r.private.safe_collection_point)}</p>` : ''}
        ${r.private.contact_phone_masked ? `<p>📞 ${esc(r.private.contact_phone_masked)}</p>` : ''}
        ${r.private.supporting_info ? `<p class="muted">${esc(r.private.supporting_info)}</p>` : ''}
      ` : `<div class="notice">🔒 Exact address is shared privately only after a donor accepts.</div>`}
      ${(r.events && r.events.length) ? `<hr class="divider"><h3>History</h3>
        ${r.events.map((e) => `<div class="muted">• ${esc(e.to_status)} — ${esc((e.created_at || '').slice(0, 16))}${e.note ? ' (' + esc(e.note) + ')' : ''}</div>`).join('')}` : ''}
    </div>
    <div id="actions"></div>`;
  const actions = document.getElementById('actions');
  if (canAccept) {
    actions.innerHTML = `<button class="btn primary" id="acceptBtn">✅ ${esc(t('accept'))}</button>`;
    document.getElementById('acceptBtn').onclick = async () => {
      if (!confirm(t('accept_confirm'))) return;
      try {
        await API.post(`/api/requests/${id}/accept`);
        toast(t('accepted_by_you'));
        views.requestDetail(id);
      } catch (e) { toast(e.message, true); }
    };
  } else if (mine && ME) {
    const btns = [];
    if (ME.roles.includes('donor') && r.status === 'accepted' && r.private) {
      btns.push(`<button class="btn gold" id="readyBtn">🍱 ${esc(t('mark_ready'))}</button>`);
    }
    if (['accepted', 'ready'].includes(r.status)) {
      btns.push(`<button class="btn primary" id="doneBtn">🙏 ${esc(t('mark_completed'))}</button>`);
      btns.push(`<button class="btn danger" id="cancelBtn">${esc(t('cancel'))}</button>`);
    }
    if (r.status !== 'completed' && r.status !== 'cancelled') {
      btns.push(`<button class="btn danger" id="reportBtn">🚩 ${esc(t('report'))}</button>`);
    }
    actions.innerHTML = btns.join('');
    const readyBtn = document.getElementById('readyBtn');
    if (readyBtn) readyBtn.onclick = async () => {
      try { await API.post(`/api/requests/${id}/status`, { status: 'ready' }); views.requestDetail(id); }
      catch (e) { toast(e.message, true); }
    };
    const doneBtn = document.getElementById('doneBtn');
    if (doneBtn) doneBtn.onclick = async () => {
      try { await API.post(`/api/requests/${id}/status`, { status: 'completed' }); toast('🙏'); views.requestDetail(id); }
      catch (e) { toast(e.message, true); }
    };
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) cancelBtn.onclick = async () => {
      if (!confirm(t('cancel') + '?')) return;
      try { await API.post(`/api/requests/${id}/status`, { status: 'cancelled' }); views.requestDetail(id); }
      catch (e) { toast(e.message, true); }
    };
    const reportBtn = document.getElementById('reportBtn');
    if (reportBtn) reportBtn.onclick = async () => {
      const details = prompt('Describe the problem (never share personal details here):');
      if (details === null) return;
      try { await API.post(`/api/requests/${id}/report`, { category: 'suspicious', details }); toast(t('report_sent')); }
      catch (e) { toast(e.message, true); }
    };
  }
  if (mine && ['accepted', 'ready'].includes(r.status)) {
    actions.insertAdjacentHTML('beforeend', `<a class="btn outline" href="#/threads">💬 ${esc(t('chat'))}</a>`);
  }
};

views.donateNew = () => {
  if (!requireLogin()) return;
  if (!ME.roles.includes('donor')) {
    $app.innerHTML = `<div class="card gold"><h2>${esc(t('donate_new'))}</h2>
      <p>🤲 To share food, your account needs the <strong>donor</strong> role.</p>
      <p class="muted">It takes 20 seconds: tap the button below, verify with an OTP again, and tick <strong>${esc(t('role_donors'))}</strong> before verifying. Your other roles are kept — no need to log out first.</p>
      <a class="btn primary" href="#/auth">✅ ${esc(t('become_donor'))}</a></div>`;
    return;
  }
  const areaOpts = AREAS.map((a) => `<option>${esc(a)}</option>`).join('');
  $app.innerHTML = `
    <div class="card gold"><h2>${esc(t('donate_new'))}</h2>
      <form id="f">
        <div class="field"><label>${esc(t('d_title'))} *</label><input id="dTitle" required maxlength="120"></div>
        <div class="field"><label>${esc(t('d_desc'))} *</label><textarea id="dDesc" required maxlength="1000"></textarea></div>
        <div class="field"><label>${esc(t('d_qty'))}</label><input id="dQty" maxlength="120" placeholder="e.g. 20 thalis"></div>
        <div class="field"><label>${esc(t('d_portions'))}</label><input id="dPortions" type="number" min="1"></div>
        <div class="field"><label>${esc(t('veg_pref'))}</label><select id="dVeg"><option value="1">${esc(t('veg'))}</option><option value="0">${esc(t('nonveg'))}</option></select></div>
        <div class="field"><label>${esc(t('d_ingredients'))}</label><input id="dIng" maxlength="500"></div>
        <div class="field"><label>${esc(t('d_allergens'))}</label><input id="dAll" maxlength="500" placeholder="e.g. contains dairy, peanuts"></div>
        <div class="field"><label>${esc(t('d_storage'))}</label><input id="dStore" maxlength="300" placeholder="e.g. kept hot above 60°C"></div>
        <div class="field"><label>${esc(t('d_prepared'))}</label><input id="dPrep" placeholder="e.g. today 3:00 PM"></div>
        <div class="field"><label>${esc(t('d_until'))} *</label><input id="dUntil" required placeholder="e.g. today 8:00 PM"></div>
        <div class="field"><label>${esc(t('area'))} *</label><select id="dArea">${areaOpts}</select></div>
        <div class="field"><label>${esc(t('d_address'))}</label><input id="dAddr" maxlength="300"></div>
        <div class="field"><label style="font-weight:500"><input type="checkbox" id="dPickup" checked> ${esc(t('d_pickup'))}</label></div>
        <div class="field"><label style="font-weight:500"><input type="checkbox" id="dDelivery"> ${esc(t('d_delivery'))}</label></div>
        <button class="btn primary" type="submit">${esc(t('submit_donation'))}</button>
      </form><div id="dErr"></div></div>`;
  document.getElementById('f').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await API.post('/api/donations', {
        title: document.getElementById('dTitle').value,
        description: document.getElementById('dDesc').value,
        quantity: document.getElementById('dQty').value || undefined,
        portions: Number(document.getElementById('dPortions').value) || undefined,
        veg: document.getElementById('dVeg').value === '1',
        ingredients: document.getElementById('dIng').value || undefined,
        allergens: document.getElementById('dAll').value || undefined,
        storage_conditions: document.getElementById('dStore').value || undefined,
        prepared_at: document.getElementById('dPrep').value || undefined,
        safe_until: document.getElementById('dUntil').value,
        area: document.getElementById('dArea').value,
        exact_address: document.getElementById('dAddr').value || undefined,
        pickup_available: document.getElementById('dPickup').checked,
        delivery_available: document.getElementById('dDelivery').checked
      });
      toast(t('donation_created'));
      location.hash = '#/donations';
    } catch (e) {
      document.getElementById('dErr').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  };
};

function donationCard(d, extra = '') {
  return `<a class="card req-card ${d.safety_review === 'passed' ? 'status-ready' : ''}" href="#/donation/${d.id}">
    <div class="req-head"><strong>${esc(d.title)}</strong><span class="req-code">${esc(d.code)}</span></div>
    ${extra}
    <p class="muted">${esc(d.description)}</p>
    <div class="pills">
      ${d.portions ? `<span class="pill">${esc(d.portions)} portions</span>` : ''}
      <span class="pill">${d.veg ? '🥬 ' + t('veg') : '🍗 ' + t('nonveg')}</span>
      <span class="pill">📍 ${esc(d.area)}</span>
      <span class="pill warn">⏰ ${esc(d.safe_until)}</span>
      ${d.delivery_available ? '<span class="pill">🛵 delivery</span>' : ''}
    </div></a>`;
}

views.donations = async () => {
  $app.innerHTML = `<h2>${esc(t('tile_donate'))}</h2><div id="myPending"></div><div id="donList"><div class="muted">…</div></div>
    ${ME && ME.roles.includes('donor') ? '<a class="btn gold" href="#/donate/new">+ ' + esc(t('donate_new')) + '</a>' : ''}`;
  const r = await API.get('/api/donations');
  // Show the donor their own listings that are not publicly visible yet,
  // so a fresh donation never looks like it failed to save.
  if (ME) {
    try {
      const mine = await API.get('/api/donations/mine');
      const pending = mine.donations.filter((d) => d.safety_review !== 'passed' || d.status !== 'available');
      if (pending.length) {
        document.getElementById('myPending').innerHTML = `<h3>${esc(t('my_donations'))}</h3>` +
          pending.map((d) => donationCard(d,
            d.safety_review === 'pending' ? '<div class="notice">⏳ ' + esc(t('awaiting_review')) + '</div>'
            : d.safety_review === 'rejected' ? '<div class="err">❌ ' + esc(t('review_rejected')) + '</div>'
            : `<div class="muted">${esc(t('status_' + d.status) || d.status)}</div>`)).join('');
      }
    } catch (e) { /* not logged in or offline — public list still shows */ }
  }
  document.getElementById('donList').innerHTML = r.donations.length
    ? r.donations.map((d) => donationCard(d)).join('')
    : '<div class="card muted">No donations available right now.</div>';
};

views.donationDetail = async (id) => {
  let d;
  try { d = (await API.get('/api/donations/' + id)).donation; }
  catch (e) { $app.innerHTML = `<div class="err card">${esc(e.message)}</div>`; return; }
  $app.innerHTML = `
    <a class="btn small outline" href="#/donations">← ${esc(t('back'))}</a>
    <div class="card req-card status-ready">
      <div class="req-head"><h2>${esc(d.title)}</h2><span class="req-code">${esc(d.code)}</span></div>
      <p>${esc(d.description)}</p>
      <div class="pills">
        ${d.quantity ? `<span class="pill">${esc(d.quantity)}</span>` : ''}
        ${d.portions ? `<span class="pill">${esc(d.portions)} portions</span>` : ''}
        <span class="pill">${d.veg ? '🥬 ' + t('veg') : '🍗 ' + t('nonveg')}</span>
        <span class="pill">📍 ${esc(d.area)}</span>
        <span class="pill warn">⏰ ${esc(d.safe_until)}</span>
      </div>
      ${d.ingredients ? `<p class="muted">🧾 ${esc(d.ingredients)}</p>` : ''}
      ${d.allergens ? `<p class="muted">⚠️ ${esc(d.allergens)}</p>` : ''}
      ${d.storage_conditions ? `<p class="muted">🧊 ${esc(d.storage_conditions)}</p>` : ''}
      ${d.private ? `<hr class="divider"><p>🏠 ${esc(d.private.exact_address || '')}</p><p>📞 ${esc(d.private.contact_phone_masked || '')}</p>` : ''}
      <div class="notice">This food is shared in good faith by a community donor. ANNPURNN does not guarantee food safety. Check the food before eating. <a href="#/safety">${esc(t('nav_safety'))} →</a></div>
    </div>
    <div id="dActions"></div>`;
  const box = document.getElementById('dActions');
  if (ME && ME.id !== d.donor_id && d.status === 'available' && d.safety_review === 'passed') {
    box.innerHTML = `<button class="btn primary" id="claimBtn">🙏 ${esc(t('tile_request'))}</button>`;
    document.getElementById('claimBtn').onclick = async () => {
      try {
        const r = await API.post(`/api/donations/${id}/claim`);
        toast(r.message || 'Claim sent'); views.donations();
      } catch (e) { toast(e.message, true); }
    };
  }
  if (ME && ME.roles.includes('donor')) {
    box.insertAdjacentHTML('beforeend', `<button class="btn danger" id="repD">🚩 ${esc(t('report'))}</button>`);
    document.getElementById('repD').onclick = async () => {
      try { await API.post(`/api/donations/${id}/report`, { category: 'safety', details: 'reported from app' }); toast(t('report_sent')); }
      catch (e) { toast(e.message, true); }
    };
  }
};

views.me = async () => {
  if (!requireLogin()) return;
  const [mine, mineD, notif] = await Promise.all([
    API.get('/api/requests/mine'), API.get('/api/donations/mine'), API.get('/api/notifications')
  ]);
  $app.innerHTML = `
    <div class="card green">
      <h2>👤 ${esc(ME.name)}</h2>
      <p class="muted">${esc(ME.phone)} · ${ME.roles.map(esc).join(' · ')}</p>
      <p>${ME.phoneVerified ? '✅ phone verified' : '⚠️ phone not verified'}
         ${ME.donorVerified ? ' · ✅ verified donor' : ''}${ME.helperVerified ? ' · ✅ verified helper' : ''}</p>
      <button class="btn outline" id="logoutBtn">${esc(t('logout'))}</button>
    </div>
    <h3>${esc(t('my_requests'))}</h3>
    ${mine.requests.length ? mine.requests.map((x) => requestCard(x)).join('') : '<div class="card muted">—</div>'}
    <h3>${esc(t('my_donations'))}</h3>
    ${mineD.donations.length ? mineD.donations.map((d) => `<a class="card" href="#/donation/${d.id}">
      <strong>${esc(d.title)}</strong> <span class="status ${esc(d.status)}">${esc(d.status)}</span>
      ${d.safety_review === 'pending' ? '<span class="pill warn">⏳ ' + esc(t('awaiting_review')) + '</span>' : ''}
      ${d.safety_review === 'rejected' ? '<span class="pill warn">❌ ' + esc(t('review_rejected')) + '</span>' : ''}
      <div class="muted">${esc(d.area)} · ${esc(d.safe_until)}</div></a>`).join('') : '<div class="card muted">—</div>'}
    <a class="btn outline" href="#/threads">💬 ${esc(t('chat'))}</a>`;
  document.getElementById('logoutBtn').onclick = async () => {
    await API.post('/api/auth/logout');
    API.clearToken();
    ME = null;
    location.hash = '#/';
    render();
  };
};

views.threads = async () => {
  if (!requireLogin()) return;
  const r = await API.get('/api/threads');
  $app.innerHTML = `<h2>💬 ${esc(t('chat'))}</h2>` + (r.threads.length
    ? r.threads.map((th) => `<a class="card" href="#/chat/${th.id}">
        <div class="row spread"><strong>${esc(th.other.name)}</strong><span class="req-code">${esc(th.request_code || th.donation_code || '')}</span></div>
        ${th.last_message ? `<div class="muted">${th.last_message.mine ? 'You: ' : ''}${esc(th.last_message.body.slice(0, 60))}</div>` : '<div class="muted">—</div>'}
      </a>`).join('')
    : '<div class="card muted">No conversations yet. They start when a donor accepts a request.</div>');
};

views.chat = async (id) => {
  if (!requireLogin()) return;
  $app.innerHTML = `<a class="btn small outline" href="#/threads">← ${esc(t('back'))}</a>
    <div class="card chat" id="msgList"></div>
    <div class="row"><input id="msgInput" placeholder="${esc(t('type_message'))}" maxlength="1000">
    <button class="btn small primary" id="msgSend" style="width:auto">${esc(t('send'))}</button></div>`;
  let lastId = 0;
  async function poll() {
    try {
      const r = await API.get(`/api/threads/${id}/messages?after=${lastId}`);
      if (r.messages.length) {
        lastId = r.messages[r.messages.length - 1].id;
        document.getElementById('msgList').insertAdjacentHTML('beforeend',
          r.messages.map((m) => `<div class="msg ${m.mine ? 'mine' : ''}">${esc(m.body)}<time>${esc((m.created_at || '').slice(11, 16))}</time></div>`).join(''));
      }
    } catch (e) { /* stopped */ }
  }
  document.getElementById('msgSend').onclick = async () => {
    const inp = document.getElementById('msgInput');
    if (!inp.value.trim()) return;
    try { await API.post(`/api/threads/${id}/messages`, { body: inp.value }); inp.value = ''; poll(); }
    catch (e) { toast(e.message, true); }
  };
  await poll();
  const timer = setInterval(() => {
    if (!location.hash.startsWith(`#/chat/${id}`)) { clearInterval(timer); return; }
    poll();
  }, 3000);
};

views.notifications = async () => {
  if (!requireLogin()) return;
  const r = await API.get('/api/notifications');
  $app.innerHTML = `<h2>🔔 ${esc(t('notifications'))}</h2>` + (r.notifications.length
    ? r.notifications.map((n) => `<div class="card ${n.read ? '' : 'gold'}">
        <strong>${esc(n.type.replace(/_/g, ' '))}</strong>
        <div>${esc(n.payload.message || '')}</div>
        <small class="muted">${esc((n.created_at || '').slice(0, 16))}</small>
        ${n.payload.request_id ? `<a class="btn small outline" href="#/request/${n.payload.request_id}">${esc(t('nav_requests'))} →</a>` : ''}
      </div>`).join('')
    : `<div class="card muted">${esc(t('no_notifications'))}</div>`);
  API.post('/api/notifications/read');
};

views.safety = async () => {
  const r = await API.get('/api/safety/rules');
  $app.innerHTML = `
    <h2>🛡️ ${esc(t('safety_title'))}</h2>
    <div class="card gold"><strong>${esc(r.disclaimer)}</strong></div>
    <div class="card"><h3>✅ Guidance</h3><ul>${r.guidance.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>
    <div class="card"><h3>⛔ Never share</h3><ul>${r.prohibited.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>
    <div class="card"><h3>🚩 Report</h3>
      <p class="muted">If a request or listing looks suspicious, report it from its detail page. Our moderators review every report.</p>
      <p class="muted">Never pay anyone for donated food. Requesting and collecting food is always free.</p></div>`;
};

views.events = async () => {
  const r = await API.get('/api/events');
  $app.innerHTML = `<h2>📅 ${esc(t('tile_events'))}</h2>` + (r.events.length
    ? r.events.map((e) => `<div class="card green"><strong>${esc(e.title)}</strong>
        <div class="muted">🧭 ${esc(e.area)} · 🗓️ ${esc(e.starts_at)}${e.ends_at ? ' – ' + esc(e.ends_at) : ''}</div>
        <p>${esc(e.description || '')}</p></div>`).join('')
    : '<div class="card muted">No upcoming events.</div>');
};

views.community = async () => {
  if (!requireLogin()) return;
  $app.innerHTML = `<a class="btn small outline" href="#/">← ${esc(t('nav_home'))}</a>
    <h2>💬 ${esc(t('community_title'))}</h2>
    <div class="notice">${esc(t('community_rules'))}</div>
    <div class="card chat" id="communityList"></div>
    <div class="row"><input id="communityInput" placeholder="${esc(t('type_message'))}" maxlength="500">
    <button class="btn small primary" id="communitySend" style="width:auto">${esc(t('send'))}</button></div>`;
  const list = document.getElementById('communityList');
  let lastId = 0;
  function renderMsgs(msgs) {
    list.insertAdjacentHTML('beforeend', msgs.map((m) =>
      `<div class="msg ${m.mine ? 'mine' : ''}"><b>${esc(m.sender_name)}</b><br>${esc(m.body)}<time>${esc((m.created_at || '').slice(11, 16))}</time></div>`).join(''));
    list.scrollTop = list.scrollHeight;
  }
  async function poll() {
    try {
      const r = await API.get(`/api/community/messages?after=${lastId}`);
      if (r.messages.length) {
        lastId = r.messages[r.messages.length - 1].id;
        renderMsgs(r.messages);
      }
    } catch (e) { /* stopped */ }
  }
  document.getElementById('communitySend').onclick = async () => {
    const inp = document.getElementById('communityInput');
    if (!inp.value.trim()) return;
    try {
      const m = await API.post('/api/community/messages', { body: inp.value });
      inp.value = '';
      lastId = Math.max(lastId, m.id);
      renderMsgs([m]);
    } catch (e) { toast(e.message, true); }
  };
  await poll();
  const timer = setInterval(() => {
    if (!location.hash.startsWith('#/community')) { clearInterval(timer); return; }
    poll();
  }, 3000);
};

// ---------------- router ----------------

const routes = [
  { re: /^#?\/?$/, view: 'home' },
  { re: /^#\/auth$/, view: 'auth' },
  { re: /^#\/request\/new(\?.*)?$/, view: 'requestNew' },
  { re: /^#\/requests$/, view: 'requests' },
  { re: /^#\/request\/([^/]+)$/, view: 'requestDetail' },
  { re: /^#\/donate\/new$/, view: 'donateNew' },
  { re: /^#\/donations$/, view: 'donations' },
  { re: /^#\/donation\/([^/]+)$/, view: 'donationDetail' },
  { re: /^#\/me$/, view: 'me' },
  { re: /^#\/threads$/, view: 'threads' },
  { re: /^#\/chat\/([^/]+)$/, view: 'chat' },
  { re: /^#\/notifications$/, view: 'notifications' },
  { re: /^#\/safety$/, view: 'safety' },
  { re: /^#\/events$/, view: 'events' },
  { re: /^#\/community$/, view: 'community' }
];

async function render() {
  const hash = location.hash || '#/';
  for (const route of routes) {
    const m = route.re.exec(hash);
    if (m) {
      const query = new URLSearchParams((m[1] || '').replace(/^\?/, ''));
      document.querySelectorAll('.bottomnav a').forEach((a) => {
        a.classList.toggle('active', hash.startsWith(a.getAttribute('href')));
      });
      try {
        if (route.view === 'requestDetail' || route.view === 'donationDetail' || route.view === 'chat') {
          await views[route.view](m[1]);
        } else {
          await views[route.view](query);
        }
      } catch (e) {
        $app.innerHTML = `<div class="err card">${esc(e.message)}
          <div style="margin-top:8px"><button class="btn small primary" onclick="render()">↻ Retry</button>
          <span class="muted"> If the server was sleeping (free hosting), wait a few seconds and retry.</span></div></div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
  }
  views.home();
}

window.appRerender = render;

(async function init() {
  // If the session dies mid-use (server restart), go to login with a clear message.
  API.onUnauthorized = () => {
    ME = null;
    toast(t('session_expired'), true);
    location.hash = '#/auth';
    render();
  };
  try {
    const [me, areas] = await Promise.all([API.get('/api/me'), API.get('/api/meta/areas')]);
    ME = me.user;
    AREAS = areas.areas;
    if (ME) {
      const n = await API.get('/api/notifications');
      const badge = document.getElementById('notifBadge');
      if (n.unread) { badge.hidden = false; badge.textContent = n.unread; }
    }
  } catch (e) { /* offline start */ }
  window.addEventListener('hashchange', render);
  render();
})();
