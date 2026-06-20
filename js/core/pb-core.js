/* ============================================================
   pb-core.js  —  shared foundation, load FIRST (before system.js)
     <script src="supabase-config.js"></script>
     <script src="pb-core.js"></script>
     <script src="system.js"></script>
     ...

   Provides, on window.PB:
   - FIELDS   : the single source of truth for every cross-file element id
   - escapeHtml(s)               : HTML-escape for any innerHTML sink
   - fmtApiError(err, ctx)       : friendly, specific API error strings
   - blobStore                   : IndexedDB key/value for large base64 images
   - VERSION / BUILD             : stamped into the footer

   Nothing here touches the DOM on load; it's pure utilities + constants.
   ============================================================ */
(function () {
  var PB = (window.PB = window.PB || {});

  /* ---- version stamp (#9) -------------------------------------------------
     BUILD is replaced at deploy time by stamp-build.sh; if it still shows the
     placeholder, the footer falls back to "dev". ----------------------------*/
  PB.VERSION = 'v2.1';
  PB.BUILD = '__BUILD__'; // e.g. 2026-06-20 a1b2c3d  (set by stamp-build.sh)
  PB.buildLabel = function () {
    return (PB.BUILD && PB.BUILD.indexOf('__') !== 0) ? PB.BUILD : 'dev';
  };

  /* ---- field-id contract (#3) ---------------------------------------------
     Every id that JS reaches into lives here. Rename a field in the HTML →
     change it in ONE place. Reference as PB.FIELDS.character, etc.
     (Hook person fields are templated: PB.hk('Ref','A') -> 'hkRefA'.) --------*/
  PB.FIELDS = {
    // mode
    modeSelect: 'modeSelect',
    // character / voice / clip (shared by the unified Clip mode)
    character: 'character',
    imgRef: 'imgRef',
    scriptText: 'scriptText',
    clipType: 'clipType', // 'multi' (auto-split script) | 'single' (one line) — replaces the old standalone 'single' mode + scriptOne field
    // hook (A/B base; C–F are derived via PB.hk)
    hkNameA: 'hkNameA', hkNameB: 'hkNameB',
    hkCharA: 'hkCharA', hkCharB: 'hkCharB',
    hkRefA: 'hkRefA', hkRefB: 'hkRefB',
    hkTurns: 'hkTurns',
    // image
    imgCompChips: 'imgCompChips',
    imgJsonPreview: 'imgJsonPreview',
    // product
    pdRef: 'pdRef', pdProduct: 'pdProduct', pdProductChips: 'pdProductChips',
    // presets (#7)
    presetBar: 'pbPresetBar'
  };
  // hook helper: PB.hk('Ref','C') => 'hkRefC'
  PB.hk = function (part, letter) { return 'hk' + part + letter; };
  // tiny getter that mirrors system.js vbG but is safe to call anywhere
  PB.val = function (id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; };

  /* ---- HTML escaping (#6) --------------------------------------------------
     One canonical escaper. Any code building innerHTML from user/synced
     content must run the dynamic parts through this. ------------------------*/
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  PB.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  };

  /* ---- friendly API errors (#4) -------------------------------------------
     Turns raw fetch/Gemini failures into specific, actionable messages.
     Pass the HTTP status when you have it for the sharpest result. ----------*/
  PB.fmtApiError = function (err, status) {
    var msg = (err && err.message) || String(err || '');
    if (msg === 'NO_KEY') return 'Add your free Gemini API key first (key icon, top of the panel).';
    var code = status || (/\b(\d{3})\b/.exec(msg) || [])[1];
    code = code ? +code : 0;
    var low = msg.toLowerCase();

    if (code === 429 || low.indexOf('quota') > -1 || low.indexOf('rate') > -1)
      return 'Gemini is rate-limited or out of free quota for now. Wait a minute and try again, or use a different key.';
    if (code === 400 && (low.indexOf('api key') > -1 || low.indexOf('api_key') > -1))
      return 'That Gemini API key looks invalid. Re-paste it (key icon) — copy the whole thing, no spaces.';
    if (code === 401 || code === 403)
      return 'Gemini rejected the key (unauthorized). Check the key is active at aistudio.google.com/apikey.';
    if (code === 404)
      return 'The Gemini model endpoint was not found. The model name may have changed — update MODEL in gemini.js.';
    if (code >= 500)
      return 'Gemini had a server error. This is on Google\u2019s side — try again shortly.';
    if (low.indexOf('failed to fetch') > -1 || low.indexOf('networkerror') > -1 || low.indexOf('load failed') > -1)
      return 'Network problem reaching Gemini. Check your connection and try again.';
    if (low.indexOf('could not read image') > -1)
      return 'That image could not be read. Try a different photo (JPG or PNG).';
    return 'Something went wrong: ' + msg;
  };

  /* ---- IndexedDB blob store (#5) ------------------------------------------
     Large base64 images (e.g. the Recreate person photo) belong here, not in
     localStorage's ~5MB shared budget. Promise-based get/set/del. -----------*/
  PB.blobStore = (function () {
    var DB = 'pb_blobs', STORE = 'kv', _db = null;
    function open() {
      return new Promise(function (res, rej) {
        if (_db) return res(_db);
        if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
        var rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = function () {
          if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE);
        };
        rq.onsuccess = function () { _db = rq.result; res(_db); };
        rq.onerror = function () { rej(rq.error || new Error('IndexedDB open failed')); };
      });
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out;
          var rq = fn(st);
          if (rq) rq.onsuccess = function () { out = rq.result; };
          t.oncomplete = function () { res(out); };
          t.onerror = function () { rej(t.error); };
          t.onabort = function () { rej(t.error); };
        });
      });
    }
    return {
      get: function (key) { return tx('readonly', function (st) { return st.get(key); }).catch(function () { return null; }); },
      set: function (key, val) { return tx('readwrite', function (st) { return st.put(val, key); }); },
      del: function (key) { return tx('readwrite', function (st) { return st.delete(key); }).catch(function () {}); }
    };
  })();

  /* one-time migration: if an old base64 person photo is in localStorage,
     move it into IndexedDB and clear the localStorage copy. ------------------*/
  PB.migrateLegacyRecreatePhoto = function () {
    var raw = null;
    try { raw = localStorage.getItem('pb_recreate_person'); } catch (e) { return Promise.resolve(null); }
    if (!raw) return Promise.resolve(null);
    var obj = null; try { obj = JSON.parse(raw); } catch (e) {}
    if (!obj || !obj.b64) { try { localStorage.removeItem('pb_recreate_person'); } catch (e) {} return Promise.resolve(null); }
    return PB.blobStore.set('recreate_person', obj).then(function () {
      try { localStorage.removeItem('pb_recreate_person'); } catch (e) {}
      return obj;
    }).catch(function () { return obj; });
  };
})();
