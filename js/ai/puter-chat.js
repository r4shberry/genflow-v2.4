/* ============================================================
   puter-chat.js  —  "Puter Lab": a test panel for Puter.js
   Generate images and describe images, key-less, in one place.

   Install in index.html AFTER system.js (after puter-image.js if you
   have it, but it also works on its own):
       <script src="puter-image.js"></script>   <!-- optional -->
       <script src="puter-chat.js"></script>
       <script src="perf.js"></script>

   - Its own launcher (bottom-left, stacked above Night Chat).
   - Mode toggle: Generate (prompt -> image) | Describe (image -> text).
   - Uses window.PBPuter if present; otherwise loads the Puter SDK itself.
   - Completely separate from gemini.js / Night Chat — nothing is replaced,
     so your Gemini chat keeps working. Remove the one <script> line to undo.
   ============================================================ */
(function () {
  var SDK = 'https://js.puter.com/v2/';
  var MODELS = (window.PBPuter && PBPuter.MODELS) || [
    { v: 'gemini-2.5-flash-image-preview',           l: 'Nano Banana — photoreal (recommended)' },
    { v: 'black-forest-labs/flux-schnell',           l: 'Flux.1 Schnell — fast' },
    { v: 'google/imagen-4.0-fast',                   l: 'Imagen 4 Fast' },
    { v: 'stabilityai/stable-diffusion-xl-base-1.0', l: 'Stable Diffusion XL' },
    { v: 'dall-e-3',                                 l: 'DALL·E 3' }
  ];
  // Veo video models for the Video tab. Default to Fast/Lite to stretch the
  // free Puter allowance (video is expensive — only a few clips before it caps).
  var VID_MODELS = [
    { v: 'google/veo-3.1-fast', l: 'Veo 3.1 Fast — ~2× faster, cheaper (recommended)' },
    { v: 'google/veo-3.1-lite', l: 'Veo 3.1 Lite — cheapest, silent (no audio)' },
    { v: 'google/veo-3.1',      l: 'Veo 3.1 — best quality, uses the most' },
    { v: 'google/veo-3.0-fast', l: 'Veo 3.0 Fast' }
  ];
  var esc = (window.PB && PB.escapeHtml) ? PB.escapeHtml : function (s) { return String(s == null ? '' : s); };

  /* ---- SDK loader (reuse PBPuter's if available) ---- */
  var _ready = null;
  function ensurePuter() {
    if (window.PBPuter && PBPuter.ensurePuter) return PBPuter.ensurePuter();
    if (_ready) return _ready;
    _ready = new Promise(function (resolve, reject) {
      if (window.puter && window.puter.ai) return resolve(window.puter);
      var s = document.createElement('script'); s.src = SDK; s.async = true;
      s.onload = function () {
        var n = 0; (function w() {
          if (window.puter && window.puter.ai) return resolve(window.puter);
          if (++n > 50) return reject(new Error('Puter SDK loaded but puter.ai is unavailable.'));
          setTimeout(w, 100);
        })();
      };
      s.onerror = function () { reject(new Error('Could not load the Puter SDK (network/CDN blocked).')); };
      document.head.appendChild(s);
    });
    return _ready;
  }

  function errMsg(e) {
    var m = (e && (e.message || e.error || e)) + '', low = m.toLowerCase();
    if (low.indexOf('sdk') > -1 || low.indexOf('network') > -1 || low.indexOf('failed to fetch') > -1)
      return 'Could not reach Puter. Check connection / ad-blocker on js.puter.com.';
    if (low.indexOf('auth') > -1 || low.indexOf('sign') > -1 || low.indexOf('permission') > -1)
      return 'Puter needs a sign-in (popup on first use). Allow it, then try again.';
    if (low.indexOf('usage') > -1 || low.indexOf('limit') > -1 || low.indexOf('quota') > -1 || low.indexOf('credit') > -1)
      return 'This Puter account hit its free usage limit.';
    if (low.indexOf('content') > -1 || low.indexOf('policy') > -1 || low.indexOf('safety') > -1)
      return 'The model refused that input (content policy). Adjust and retry.';
    return 'Puter error: ' + m;
  }

  function genImage(prompt, model) {
    if (window.PBPuter && PBPuter.generate) return PBPuter.generate(prompt, model);
    return ensurePuter().then(function (p) { return p.ai.txt2img(prompt, { model: model }); });
  }
  function describeImage(dataUrl, question) {
    return ensurePuter().then(function (p) {
      return p.ai.chat(question || 'Describe this image in detail for use as a video character reference.', dataUrl);
    }).then(function (resp) {
      return (resp && resp.message && resp.message.content) || (resp && resp.text) || String(resp);
    });
  }

  /* ---- generate a video -> returns a <video> element (Veo via txt2vid) ---- */
  function genVideo(prompt, model) {
    return ensurePuter().then(function (p) {
      return p.ai.txt2vid(prompt, { model: model });
    });
  }

  /* ---- panel ---- */
  var panel, launcher, msgs, mode = 'generate', staged = null;

  function build() {
    if (panel) return;
    launcher = document.createElement('button');
    launcher.type = 'button'; launcher.title = 'Puter Lab';
    launcher.style.cssText =
      'position:fixed;left:16px;bottom:64px;z-index:9998;display:flex;align-items:center;gap:8px;' +
      'padding:10px 14px;border:none;border-radius:999px;cursor:pointer;color:#fff;' +
      'background:linear-gradient(135deg,#2dd4bf,#0f766e);box-shadow:0 8px 24px rgba(0,0,0,.45);font:600 14px system-ui';
    launcher.innerHTML = '<i class="ti ti-sparkles"></i> Puter Lab';
    launcher.onclick = open;
    document.body.appendChild(launcher);

    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;left:0;top:0;height:100vh;width:380px;max-width:90vw;z-index:9999;display:flex;flex-direction:column;' +
      'background:#101516;color:#eee;border-right:1px solid #1f2a29;box-shadow:6px 0 30px rgba(0,0,0,.5);' +
      'transform:translateX(-100%);transition:transform .22s ease;font:14px system-ui';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;padding:12px 14px;border-bottom:1px solid #1f2a29">' +
        '<i class="ti ti-sparkles" style="color:#5eead4"></i><strong style="flex:1">Puter Lab</strong>' +
        '<button data-act="clear" title="Clear" style="background:none;border:none;color:#999;cursor:pointer"><i class="ti ti-trash"></i></button>' +
        '<button data-act="close" title="Close" style="background:none;border:none;color:#999;cursor:pointer"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #1f2a29">' +
        '<button data-mode="generate" class="pl-tab" style="flex:1">Generate</button>' +
        '<button data-mode="describe" class="pl-tab" style="flex:1">Describe</button>' +
        '<button data-mode="video" class="pl-tab" style="flex:1">Video</button>' +
      '</div>' +
      '<div data-msgs style="flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px"></div>' +
      '<div data-controls style="padding:10px 12px;border-top:1px solid #1f2a29"></div>';
    document.body.appendChild(panel);
    msgs = panel.querySelector('[data-msgs]');

    // simple tab styling
    var st = document.createElement('style');
    st.textContent = '.pl-tab{padding:8px;border-radius:8px;border:1px solid #284440;background:#0c1413;color:#bdeee6;cursor:pointer;font:600 13px system-ui}' +
                     '.pl-tab.on{background:#0f766e;color:#fff;border-color:#0f766e}';
    document.head.appendChild(st);

    panel.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-mode]'); if (!t) return;
      if (t.dataset.act === 'close') return close();
      if (t.dataset.act === 'clear') { msgs.innerHTML = ''; return; }
      if (t.dataset.mode) { setMode(t.dataset.mode); }
    });

    setMode('generate');
  }

  function setMode(m) {
    mode = m; staged = null;
    panel.querySelectorAll('.pl-tab').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    var c = panel.querySelector('[data-controls]');
    if (m === 'generate') {
      c.innerHTML =
        '<div style="display:flex;gap:6px;margin-bottom:8px"><select id="plModel" style="flex:1;padding:8px;border-radius:8px;border:1px solid #284440;background:#0c1413;color:#eee">' +
          MODELS.map(function (x) { return '<option value="' + esc(x.v) + '">' + esc(x.l) + '</option>'; }).join('') +
        '</select></div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end">' +
          '<textarea id="plPrompt" rows="2" placeholder="Describe the image to generate…" style="flex:1;resize:none;max-height:120px;padding:9px 10px;border-radius:10px;border:1px solid #284440;background:#0c1413;color:#eee;font:14px system-ui"></textarea>' +
          '<button data-go style="padding:9px 12px;border:none;border-radius:10px;background:#0f766e;color:#fff;cursor:pointer"><i class="ti ti-wand"></i></button>' +
        '</div>';
    } else if (m === 'describe') {
      c.innerHTML =
        '<div data-thumb style="display:none;margin-bottom:8px"></div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end">' +
          '<button data-attach title="Attach image" style="background:none;border:none;color:#9fe7dc;cursor:pointer;padding:8px"><i class="ti ti-paperclip"></i></button>' +
          '<textarea id="plQ" rows="2" placeholder="Optional question (default: describe it)…" style="flex:1;resize:none;max-height:120px;padding:9px 10px;border-radius:10px;border:1px solid #284440;background:#0c1413;color:#eee;font:14px system-ui"></textarea>' +
          '<button data-go style="padding:9px 12px;border:none;border-radius:10px;background:#0f766e;color:#fff;cursor:pointer"><i class="ti ti-eye"></i></button>' +
        '</div>';
      var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
      c.appendChild(fi);
      c.querySelector('[data-attach]').onclick = function () { fi.click(); };
      fi.onchange = function () {
        if (!fi.files || !fi.files[0]) return;
        var r = new FileReader();
        r.onload = function () {
          staged = { dataUrl: r.result, name: fi.files[0].name };
          var th = c.querySelector('[data-thumb]');
          th.style.display = 'block';
          th.innerHTML = '<img src="' + staged.dataUrl + '" style="max-width:120px;border-radius:8px;border:1px solid #333"> <span style="font-size:12px;color:#9a9aa6">' + esc(staged.name) + '</span>';
        };
        r.readAsDataURL(fi.files[0]); fi.value = '';
      };
    } else if (m === 'video') {
      c.innerHTML =
        '<div style="display:flex;gap:6px;margin-bottom:8px"><select id="plVidModel" style="flex:1;padding:8px;border-radius:8px;border:1px solid #284440;background:#0c1413;color:#eee">' +
          VID_MODELS.map(function (x) { return '<option value="' + esc(x.v) + '">' + esc(x.l) + '</option>'; }).join('') +
        '</select></div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end">' +
          '<textarea id="plVidPrompt" rows="2" placeholder="Describe the video clip to generate…" style="flex:1;resize:none;max-height:120px;padding:9px 10px;border-radius:10px;border:1px solid #284440;background:#0c1413;color:#eee;font:14px system-ui"></textarea>' +
          '<button data-go style="padding:9px 12px;border:none;border-radius:10px;background:#0f766e;color:#fff;cursor:pointer"><i class="ti ti-movie"></i></button>' +
        '</div>' +
        '<div style="margin-top:6px;font-size:11px;color:#6f8a86">Veo is slow (30s–2min) and uses a lot of your Puter allowance — only a few clips before it caps.</div>';
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
      (isUser ? 'background:#0f766e;color:#fff' : 'background:#14201f;color:#eee');
    b.innerHTML = html; d.appendChild(b); msgs.scrollTop = msgs.scrollHeight; return b;
  }

  function send() {
    if (mode === 'generate') {
      var prompt = (panel.querySelector('#plPrompt').value || '').trim();
      if (!prompt) return;
      var model = panel.querySelector('#plModel').value;
      bubble(row('user'), esc(prompt), true);
      panel.querySelector('#plPrompt').value = '';
      var b = bubble(row('model'), 'Generating… (first run opens a Puter sign-in)');
      genImage(prompt, model).then(function (img) {
        b.textContent = '';
        img.style.cssText = 'max-width:100%;border-radius:10px;border:1px solid #333;display:block';
        b.appendChild(img);
        var a = document.createElement('a');
        a.href = img.src; a.download = 'generated.png';
        a.style.cssText = 'display:inline-block;margin-top:6px;color:#5eead4;font-size:12px;text-decoration:none';
        a.innerHTML = '<i class="ti ti-download"></i> Download';
        b.appendChild(a);
      }).catch(function (e) { b.textContent = errMsg(e); });
    } else if (mode === 'describe') {
      if (!staged) { bubble(row('model'), 'Attach an image first (paperclip).'); return; }
      var q = (panel.querySelector('#plQ').value || '').trim();
      var u = row('user');
      bubble(u, '<img src="' + staged.dataUrl + '" style="max-width:140px;border-radius:8px;display:block">' + (q ? '<div style="margin-top:4px">' + esc(q) + '</div>' : ''), true);
      panel.querySelector('#plQ').value = '';
      var dataUrl = staged.dataUrl; staged = null;
      var th = panel.querySelector('[data-thumb]'); if (th) { th.style.display = 'none'; th.innerHTML = ''; }
      var b = bubble(row('model'), 'Looking…');
      describeImage(dataUrl, q).then(function (txt) { b.textContent = txt || '(no description returned)'; })
        .catch(function (e) { b.textContent = errMsg(e); });
    } else if (mode === 'video') {
      var vprompt = (panel.querySelector('#plVidPrompt').value || '').trim();
      if (!vprompt) return;
      var vmodel = panel.querySelector('#plVidModel').value;
      bubble(row('user'), esc(vprompt), true);
      panel.querySelector('#plVidPrompt').value = '';
      var vb = bubble(row('model'), 'Rendering video… 0.0s (first run opens a Puter sign-in)');
      var t0 = Date.now();
      var timer = setInterval(function () {
        vb.textContent = 'Rendering video… ' + ((Date.now() - t0) / 1000).toFixed(1) + 's — Veo takes a while, keep this open';
      }, 200);
      genVideo(vprompt, vmodel).then(function (video) {
        clearInterval(timer);
        vb.textContent = 'Done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's';
        video.controls = true; video.playsInline = true;
        video.style.cssText = 'max-width:100%;border-radius:10px;border:1px solid #333;display:block;margin-top:6px';
        vb.appendChild(video);
        video.addEventListener('loadeddata', function () { video.play().catch(function () {}); });
        var a = document.createElement('a');
        a.href = video.src || (video.currentSrc) || '#'; a.download = 'veo-clip.mp4';
        a.style.cssText = 'display:inline-block;margin-top:6px;color:#5eead4;font-size:12px;text-decoration:none';
        a.innerHTML = '<i class="ti ti-download"></i> Download';
        vb.appendChild(a);
      }).catch(function (e) { clearInterval(timer); vb.textContent = errMsg(e); });
    }
  }

  function open()  { build(); panel.style.transform = 'translateX(0)'; launcher.style.display = 'none'; }
  function close() { if (panel) panel.style.transform = 'translateX(-100%)'; if (launcher) launcher.style.display = 'flex'; }

  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
