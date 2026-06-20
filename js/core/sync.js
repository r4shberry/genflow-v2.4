/* ============================================================
   sync.js  —  app-side auth guard + cross-device sync
   Load order in index.html:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="supabase-config.js"></script>
     <script src="system.js"></script>
     <script src="gemini.js"></script>
     <script src="hook-people.js"></script>
     <script src="sync.js"></script>

   - If not signed in -> redirects to login.html.
   - Syncs builder state (pb_state) across devices (last-write-wins).
   - Gemini key + chat history stay local to each device.
   ============================================================ */
(function () {
  var sb = window.sbClient;
  var STATE_KEY = 'pb_state', TS_KEY = 'pb_state_ts';
  var user = null, pushT = null, statusEl = null;

  function ts() { return parseInt(localStorage.getItem(TS_KEY) || '0', 10) || 0; }
  function setTs(ms) { try { localStorage.setItem(TS_KEY, String(ms)); } catch (e) {} }

  if (!sb) { console.warn('[sync] Supabase not configured — running without login.'); return; }

  // ---- guard: must be signed in ----
  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { location.replace('login.html'); return; }
    user = r.data.session.user;
    start();
  });
  sb.auth.onAuthStateChange(function (_e, session) {
    if (!session) { location.replace('login.html'); return; }
    user = session.user;
  });

  function start() {
    buildBar();
    if (typeof window.vbSave === 'function') {
      var orig = window.vbSave;
      window.vbSave = function () { var x = orig.apply(this, arguments); schedulePush(); return x; };
    }
    pullNow(false);
  }

  // ---- small top-right bar: email · Save · Load · Log out ----
  function buildBar() {
    var email = user.email || 'Signed in';
    var initial = (email[0] || '?').toUpperCase();

    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;right:16px;top:16px;z-index:9997;display:flex;align-items:center';
    bar.innerHTML =
      '<button data-avatar title="Account" style="border:none;border-radius:50%;cursor:pointer;width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6c5ce7,#3b2f8f);color:#fff;font:700 14px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.4)">' + initial + '</button>';
    document.body.appendChild(bar);

    // dropdown menu (hidden until the avatar is tapped)
    var menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;right:16px;top:58px;z-index:9999;min-width:210px;display:none;flex-direction:column;background:#15151b;border:1px solid #2a2a33;border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.5);overflow:hidden;font:13px system-ui;color:#eee';
    menu.innerHTML =
      '<div style="padding:10px 14px;border-bottom:1px solid #2a2a33;color:#9a9aa6;font-size:12px;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + email + '</div>' +
      '<button data-save style="text-align:left;border:none;background:none;color:#eee;cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;font:13px system-ui"><i class="ti ti-cloud-upload"></i> Save progress</button>' +
      '<button data-load style="text-align:left;border:none;background:none;color:#eee;cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;font:13px system-ui"><i class="ti ti-cloud-download"></i> Load progress</button>' +
      '<div style="height:1px;background:#2a2a33"></div>' +
      '<button data-prof style="text-align:left;border:none;background:none;color:#eee;cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;font:13px system-ui"><i class="ti ti-user"></i> View profile</button>' +
      '<button data-logout style="text-align:left;border:none;background:none;color:#ff8a8a;cursor:pointer;padding:10px 14px;display:flex;align-items:center;gap:8px;font:13px system-ui"><i class="ti ti-logout"></i> Log out</button>';
    document.body.appendChild(menu);

    statusEl = document.createElement('div');
    statusEl.style.cssText = 'position:fixed;right:16px;top:58px;z-index:9997;font:12px system-ui;color:#888;text-align:right';
    document.body.appendChild(statusEl);

    function closeMenu() { menu.style.display = 'none'; }
    function toggleMenu() { menu.style.display = (menu.style.display === 'none') ? 'flex' : 'none'; }

    bar.querySelector('[data-avatar]').onclick = function (e) { e.stopPropagation(); toggleMenu(); };
    menu.querySelector('[data-save]').onclick = function () { closeMenu(); pushNow(true); };
    menu.querySelector('[data-load]').onclick = function () { closeMenu(); pullNow(true); };
    menu.querySelector('[data-logout]').onclick = function () { closeMenu(); sb.auth.signOut(); };
    menu.querySelector('[data-prof]').onclick = function () { closeMenu(); showProfile(email); };

    document.addEventListener('click', function (e) {
      if (menu.style.display !== 'none' && !menu.contains(e.target) && e.target.closest('[data-avatar]') === null) closeMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  }

  // simple profile card (no dedicated page yet — shows the signed-in identity)
  function showProfile(email) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
    var initial = (email[0] || '?').toUpperCase();
    ov.innerHTML =
      '<div style="width:300px;max-width:90vw;background:#15151b;border:1px solid #2a2a33;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);font:14px system-ui;color:#eee;text-align:center">' +
        '<div style="width:56px;height:56px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6c5ce7,#3b2f8f);color:#fff;font:700 24px system-ui">' + initial + '</div>' +
        '<div style="font-weight:600;margin-bottom:4px">Signed in</div>' +
        '<div style="color:#9a9aa6;font-size:13px;word-break:break-all;margin-bottom:16px">' + email + '</div>' +
        '<button data-close style="width:100%;padding:10px;border:none;border-radius:10px;background:#6c5ce7;color:#fff;cursor:pointer;font:600 14px system-ui">Close</button>' +
      '</div>';
    document.body.appendChild(ov);
    function kill() { ov.remove(); }
    ov.querySelector('[data-close]').onclick = kill;
    ov.addEventListener('click', function (e) { if (e.target === ov) kill(); });
  }
  function status(t) { if (statusEl) statusEl.textContent = t || ''; }

  // ---- cloud read/write ----
  async function fetchRow() {
    var r = await sb.from('profiles').select('state,updated_at').eq('id', user.id).maybeSingle();
    if (r.error) { status(r.error.message); return null; }
    return r.data;
  }
  async function pushNow() {
    if (!user) return;
    var state; try { state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { state = {}; }
    var iso = new Date().toISOString();
    setTs(Date.now());
    var r = await sb.from('profiles').upsert({ id: user.id, state: state, updated_at: iso });
    status(r.error ? r.error.message : ('Saved ' + new Date().toLocaleTimeString()));
  }
  function schedulePush() { if (!user) return; clearTimeout(pushT); pushT = setTimeout(function () { pushNow(); }, 1500); }

  async function pullNow(manual) {
    if (!user) return;
    var row = await fetchRow();
    if (!row || !row.state) { status('No cloud data yet — saving this device.'); return pushNow(); }
    var cloudTs = row.updated_at ? Date.parse(row.updated_at) : 0;
    var incoming = JSON.stringify(row.state);
    var localNow = localStorage.getItem(STATE_KEY) || '';
    var adopt = manual || cloudTs > ts();
    if (adopt && incoming !== localNow) {
      localStorage.setItem(STATE_KEY, incoming);
      setTs(cloudTs || Date.now());
      if (!sessionStorage.getItem('pb_pulled')) {
        sessionStorage.setItem('pb_pulled', '1');
        status('Loading your data...');
        location.reload();
        return;
      }
    }
    sessionStorage.removeItem('pb_pulled');
    if (!adopt) pushNow();          // local newer -> push up
    else status('Up to date.');
  }
})();
