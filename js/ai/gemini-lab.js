/* ============================================================
   gemini-lab.js  —  "Gemini Lab": generate + describe images
   The Brave-proof alternative to Puter Lab. Talks to Google's
   generativelanguage.googleapis.com (NOT js.puter.com), so it is
   not blocked by Brave Shields / ad-blockers.

   Install in index.html AFTER gemini.js (it reuses the same key
   and, for Describe, the window.PBGemini bridge):
       <script src="gemini.js"></script>
       ...
       <script src="gemini-lab.js"></script>
       <script src="perf.js"></script>

   - Its own launcher (bottom-left, stacked above the others).
   - Generate: prompt -> image via gemini-2.5-flash-image (free ~500/day).
   - Describe: attach image -> text, via the Gemini vision model.
   - Uses the SAME key you pasted into Night Chat (localStorage
     'pb_gemini_key'); add it there (key icon) if you haven't.
   - Does not replace or modify Night Chat.
   ============================================================ */
(function () {
  var API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  // Gemini image-output models (free tier favors 2.5-flash-image / Nano Banana)
  var MODELS = [
    { v: 'gemini-2.5-flash-image', l: 'Nano Banana — free ~500/day (recommended)' },
    { v: 'gemini-3.1-flash-image', l: 'Gemini 3.1 Flash Image (may use quota)' }
  ];
  var DESCRIBE_MODEL = 'gemini-2.5-flash';

  var esc = (window.PB && PB.escapeHtml) ? PB.escapeHtml : function (s) { return String(s == null ? '' : s); };
  var fmtErr = (window.PB && PB.fmtApiError) ? PB.fmtApiError : function (e) { return 'Error: ' + (e && e.message || e); };

  /* ============================================================
     KEY POOL  —  paste one or more free Gemini keys here.
     When a key hits its quota/rate limit (or is invalid), the
     request automatically retries on the next key in the list.
     Effective free quota ≈ (number of keys) × 500 images/day.

     Get free keys at aistudio.google.com/apikey (one per Google
     account). A key pasted into Night Chat is tried FIRST, then
     these. Leave the array empty to use only the Night Chat key.

     These ship in client-side JS — anyone viewing the site can
     read them. Fine for local/private use; for a PUBLIC site
     use a serverless proxy instead.
     ============================================================ */
  var KEY_POOL = [
    // 'AIzaSy...key-1...',
    // 'AIzaSy...key-2...',
    // 'AIzaSy...key-3...'
  ];

  // ordered list of keys to try: Night Chat key first, then the pool (de-duped)
  function keyList() {
    var keys = [];
    try { var k = localStorage.getItem('pb_gemini_key'); if (k) keys.push(k); } catch (e) {}
    KEY_POOL.forEach(function (k) { k = (k || '').trim(); if (k && keys.indexOf(k) === -1) keys.push(k); });
    return keys;
  }

  // rotate to the next key only for quota / rate / invalid-key errors
  function shouldRotate(err) {
    var code = err && err.status, m = ((err && err.message) || '').toLowerCase();
    if (code === 429 || code === 401 || code === 403) return true;
    if (code === 400 && (m.indexOf('api key') > -1 || m.indexOf('api_key') > -1 || m.indexOf('invalid') > -1)) return true;
    if (m.indexOf('quota') > -1 || m.indexOf('rate') > -1 || m.indexOf('exhaust') > -1) return true;
    return false;
  }

  /* Run fn(key) across every key, rotating only on quota/rate/invalid.
     fn must be function(key) -> Promise. Rejects NO_KEY if pool empty. */
  function withKeyRotation(fn) {
    var keys = keyList();
    if (!keys.length) return Promise.reject(new Error('NO_KEY'));
    var i = 0, lastErr = null;
    function attempt() {
      if (i >= keys.length) throw (lastErr || new Error('All keys exhausted.'));
      var key = keys[i++];
      return Promise.resolve().then(function () { return fn(key); }).catch(function (e) {
        lastErr = e;
        if (shouldRotate(e) && i < keys.length) return attempt();
        throw e;
      });
    }
    return Promise.resolve().then(attempt);
  }

  /* ---- generate an image -> returns a data: URL (rotates keys) ---- */
  function genImage(prompt, model) {
    return withKeyRotation(function (key) {
      return fetch(API + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { var e = new Error((data.error && data.error.message) || ('HTTP ' + res.status)); e.status = res.status; throw e; }
          var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
          var imgP = null;
          for (var i = 0; i < parts.length; i++) { if (parts[i].inlineData || parts[i].inline_data) { imgP = parts[i]; break; } }
          if (!imgP) {
            var txt = parts.map(function (p) { return p.text; }).filter(Boolean).join(' ');
            throw new Error(txt || 'No image was returned (the model may have refused the prompt).');
          }
          var inl = imgP.inlineData || imgP.inline_data;
          return 'data:' + (inl.mimeType || inl.mime_type || 'image/png') + ';base64,' + inl.data;
        });
      });
    });
  }

  /* ---- describe an image -> text (rotates keys; downscales if PBGemini present) ---- */
  function describe(file, question) {
    var q = question || 'Describe this image in detail for use as a video character reference: age, gender, ethnicity cues, face, hair, skin, build, wardrobe, distinctive features.';
    var g = window.PBGemini;
    // get base64 + mime: reuse PBGemini's downscaler if available, else read raw
    var prep = (g && g.fileToScaledB64)
      ? g.fileToScaledB64(file).then(function (s) { return { b64: s.b64, mime: s.mime || 'image/jpeg' }; })
      : new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function () { resolve({ b64: String(r.result).split(',')[1], mime: 'image/jpeg' }); };
          r.onerror = function () { reject(new Error('Could not read image')); };
          r.readAsDataURL(file);
        });
    return prep.then(function (im) {
      return withKeyRotation(function (key) {
        return fetch(API + DESCRIBE_MODEL + ':generateContent?key=' + encodeURIComponent(key), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: im.mime, data: im.b64 } }, { text: q }] }] })
        }).then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) { var e = new Error((data.error && data.error.message) || ('HTTP ' + res.status)); e.status = res.status; throw e; }
            var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
            return parts.map(function (p) { return p.text; }).filter(Boolean).join('\n') || '(no description returned)';
          });
        });
      });
    });
  }

  /* ---- panel ---- */
  var panel, launcher, msgs, mode = 'generate', staged = null;

  function build() {
    if (panel) return;
    launcher = document.createElement('button');
    launcher.type = 'button'; launcher.title = 'Gemini Lab';
    launcher.style.cssText =
      'position:fixed;left:16px;bottom:112px;z-index:9998;display:flex;align-items:center;gap:8px;' +
      'padding:10px 14px;border:none;border-radius:999px;cursor:pointer;color:#fff;' +
      'background:linear-gradient(135deg,#6c5ce7,#3b2f8f);box-shadow:0 8px 24px rgba(0,0,0,.45);font:600 14px system-ui';
    launcher.innerHTML = '<i class="ti ti-photo-ai"></i> Gemini Lab';
    launcher.onclick = open;
    document.body.appendChild(launcher);

    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;left:0;top:0;height:100vh;width:380px;max-width:90vw;z-index:9999;display:flex;flex-direction:column;' +
      'background:#121218;color:#eee;border-right:1px solid #2a2a33;box-shadow:6px 0 30px rgba(0,0,0,.5);' +
      'transform:translateX(-100%);transition:transform .22s ease;font:14px system-ui';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;padding:12px 14px;border-bottom:1px solid #2a2a33">' +
        '<i class="ti ti-photo-ai" style="color:#a99bff"></i><strong style="flex:1">Gemini Lab</strong>' +
        '<button data-act="clear" title="Clear" style="background:none;border:none;color:#999;cursor:pointer"><i class="ti ti-trash"></i></button>' +
        '<button data-act="close" title="Close" style="background:none;border:none;color:#999;cursor:pointer"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #2a2a33">' +
        '<button data-mode="generate" class="gl-tab" style="flex:1">Generate</button>' +
        '<button data-mode="describe" class="gl-tab" style="flex:1">Describe</button>' +
      '</div>' +
      '<div data-msgs style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px"></div>' +
      '<div data-controls style="padding:10px 12px;border-top:1px solid #2a2a33"></div>';
    document.body.appendChild(panel);
    msgs = panel.querySelector('[data-msgs]');

    var st = document.createElement('style');
    st.textContent = '.gl-tab{padding:8px;border-radius:8px;border:1px solid #3a3a44;background:#0e0e13;color:#bdb6f0;cursor:pointer;font:600 13px system-ui}' +
                     '.gl-tab.on{background:#6c5ce7;color:#fff;border-color:#6c5ce7}';
    document.head.appendChild(st);

    panel.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-mode]'); if (!t) return;
      if (t.dataset.act === 'close') return close();
      if (t.dataset.act === 'clear') { msgs.innerHTML = ''; return; }
      if (t.dataset.mode) setMode(t.dataset.mode);
    });
    setMode('generate');
  }

  function setMode(m) {
    mode = m; staged = null;
    panel.querySelectorAll('.gl-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    var c = panel.querySelector('[data-controls]');
    if (m === 'generate') {
      c.innerHTML =
        '<div style="margin-bottom:8px"><select id="glModel" style="width:100%;padding:8px;border-radius:8px;border:1px solid #3a3a44;background:#0e0e13;color:#eee">' +
          MODELS.map(function (x) { return '<option value="' + esc(x.v) + '">' + esc(x.l) + '</option>'; }).join('') +
        '</select></div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end">' +
          '<textarea id="glPrompt" rows="2" placeholder="Describe the image to generate…" style="flex:1;resize:none;max-height:120px;padding:9px 10px;border-radius:10px;border:1px solid #3a3a44;background:#0e0e13;color:#eee;font:14px system-ui"></textarea>' +
          '<button data-go style="padding:9px 12px;border:none;border-radius:10px;background:#6c5ce7;color:#fff;cursor:pointer"><i class="ti ti-wand"></i></button>' +
        '</div>';
    } else {
      c.innerHTML =
        '<div data-thumb style="display:none;margin-bottom:8px"></div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end">' +
          '<button data-attach title="Attach image" style="background:none;border:none;color:#a99bff;cursor:pointer;padding:8px"><i class="ti ti-paperclip"></i></button>' +
          '<textarea id="glQ" rows="2" placeholder="Optional question (default: describe it)…" style="flex:1;resize:none;max-height:120px;padding:9px 10px;border-radius:10px;border:1px solid #3a3a44;background:#0e0e13;color:#eee;font:14px system-ui"></textarea>' +
          '<button data-go style="padding:9px 12px;border:none;border-radius:10px;background:#6c5ce7;color:#fff;cursor:pointer"><i class="ti ti-eye"></i></button>' +
        '</div>';
      var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none'; c.appendChild(fi);
      c.querySelector('[data-attach]').onclick = function () { fi.click(); };
      fi.onchange = function () {
        if (!fi.files || !fi.files[0]) return;
        staged = fi.files[0];
        var r = new FileReader();
        r.onload = function () {
          var th = c.querySelector('[data-thumb]'); th.style.display = 'block';
          th.innerHTML = '<img src="' + r.result + '" style="max-width:120px;border-radius:8px;border:1px solid #333"> <span style="font-size:12px;color:#9a9aa6">' + esc(staged.name) + '</span>';
        };
        r.readAsDataURL(staged); fi.value = '';
      };
    }
    c.querySelector('[data-go]').onclick = send;
  }

  function row(who) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;max-width:90%;' + (who === 'user' ? 'align-self:flex-end;align-items:flex-end' : 'align-self:flex-start;align-items:flex-start');
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }
  function bubble(d, html, isUser) {
    var b = document.createElement('div');
    b.style.cssText = 'padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.45;' +
      (isUser ? 'background:#6c5ce7;color:#fff' : 'background:#1d1d25;color:#eee');
    b.innerHTML = html; d.appendChild(b); msgs.scrollTop = msgs.scrollHeight; return b;
  }

  function send() {
    if (mode === 'generate') {
      var prompt = (panel.querySelector('#glPrompt').value || '').trim();
      if (!prompt) return;
      var model = panel.querySelector('#glModel').value;
      bubble(row('user'), esc(prompt), true);
      panel.querySelector('#glPrompt').value = '';
      var b = bubble(row('model'), 'Generating…');
      genImage(prompt, model).then(function (dataUrl) {
        b.textContent = '';
        var img = document.createElement('img');
        img.src = dataUrl; img.style.cssText = 'max-width:100%;border-radius:10px;border:1px solid #333;display:block';
        b.appendChild(img);
        var a = document.createElement('a');
        a.href = dataUrl; a.download = 'generated.png';
        a.style.cssText = 'display:inline-block;margin-top:6px;color:#a99bff;font-size:12px;text-decoration:none';
        a.innerHTML = '<i class="ti ti-download"></i> Download';
        b.appendChild(a);
      }).catch(function (e) { b.textContent = e.message === 'NO_KEY' ? 'Add your Gemini key in Night Chat first (key icon).' : fmtErr(e, e.status); });
    } else {
      if (!staged) { bubble(row('model'), 'Attach an image first (paperclip).'); return; }
      var q = (panel.querySelector('#glQ').value || '').trim();
      var rd = new FileReader();
      rd.onload = function () {
        bubble(row('user'), '<img src="' + rd.result + '" style="max-width:140px;border-radius:8px;display:block">' + (q ? '<div style="margin-top:4px">' + esc(q) + '</div>' : ''), true);
      };
      rd.readAsDataURL(staged);
      panel.querySelector('#glQ').value = '';
      var file = staged; staged = null;
      var th = panel.querySelector('[data-thumb]'); if (th) { th.style.display = 'none'; th.innerHTML = ''; }
      var b = bubble(row('model'), 'Looking…');
      describe(file, q).then(function (txt) { b.textContent = txt || '(no description returned)'; })
        .catch(function (e) { b.textContent = e.message === 'NO_KEY' ? 'Add your Gemini key in Night Chat first (key icon).' : fmtErr(e, e.status); });
    }
  }

  function open()  { build(); panel.style.transform = 'translateX(0)'; launcher.style.display = 'none'; }
  function close() { if (panel) panel.style.transform = 'translateX(-100%)'; if (launcher) launcher.style.display = 'flex'; }

  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
