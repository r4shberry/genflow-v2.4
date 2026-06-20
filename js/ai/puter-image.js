/* ============================================================
   puter-image.js  —  free, key-less image generation via Puter.js
   Install in index.html AFTER system.js (anywhere before perf.js):
       <script src="system.js"></script>
       ...
       <script src="lightroom.js"></script>
       <script src="puter-image.js"></script>   <!-- add this -->
       <script src="sync.js"></script>
       <script src="perf.js"></script>

   What it does
   - Loads the Puter SDK on its own (no separate <script> needed).
   - Adds a "Generate image (free)" panel under the Image-mode JSON
     preview: model picker + an editable prompt (seeded from your
     current image spec) + Generate + result with Download.
   - Uses Puter's "User-Pays" model: free for you; each user signs into
     Puter on first generate and covers their own usage. The Gemini key
     is NOT involved here.
   - Exposes window.PBPuter = { generate, describe, ensurePuter, MODELS }
     so Night Chat / other code can call it too.

   Note: photoreal work (Cassidy) is best on the Nano Banana model
   (gemini-2.5-flash-image-preview) — it's the default below.
   ============================================================ */
(function () {
  var SDK = 'https://js.puter.com/v2/';

  // curated subset of Puter's txt2img models (full list is ~30).
  // value = Puter model id, label = what the user sees.
  var MODELS = [
    { v: 'gemini-2.5-flash-image-preview',            l: 'Nano Banana — photoreal, consistent (recommended)' },
    { v: 'black-forest-labs/flux-schnell',            l: 'Flux.1 Schnell — fast' },
    { v: 'google/imagen-4.0-fast',                    l: 'Imagen 4 Fast' },
    { v: 'stabilityai/stable-diffusion-xl-base-1.0',  l: 'Stable Diffusion XL' },
    { v: 'dall-e-3',                                  l: 'DALL·E 3' }
  ];
  var DEFAULT_MODEL = MODELS[0].v;

  var esc = (window.PB && PB.escapeHtml) ? PB.escapeHtml : function (s) { return String(s == null ? '' : s); };

  /* ---- load the Puter SDK once, resolve when window.puter is ready ---- */
  var _ready = null;
  function ensurePuter() {
    if (_ready) return _ready;
    _ready = new Promise(function (resolve, reject) {
      if (window.puter && window.puter.ai) return resolve(window.puter);
      var s = document.createElement('script');
      s.src = SDK; s.async = true;
      s.onload = function () {
        // puter attaches synchronously on load, but guard just in case
        var tries = 0;
        (function wait() {
          if (window.puter && window.puter.ai) return resolve(window.puter);
          if (++tries > 50) return reject(new Error('Puter SDK loaded but puter.ai is unavailable.'));
          setTimeout(wait, 100);
        })();
      };
      s.onerror = function () { reject(new Error('Could not load the Puter SDK (network/CDN blocked).')); };
      document.head.appendChild(s);
    });
    return _ready;
  }

  /* ---- friendly errors (reuse PB.fmtApiError shape, add Puter cases) ---- */
  function errMsg(e) {
    var m = (e && (e.message || e.error || e)) + '';
    var low = m.toLowerCase();
    if (low.indexOf('puter sdk') > -1 || low.indexOf('network') > -1 || low.indexOf('failed to fetch') > -1)
      return 'Could not reach Puter. Check your connection (or an ad-blocker blocking js.puter.com) and try again.';
    if (low.indexOf('auth') > -1 || low.indexOf('sign') > -1 || low.indexOf('permission') > -1)
      return 'Puter needs you to sign in (a popup opens on first use). Allow it, then press Generate again.';
    if (low.indexOf('usage') > -1 || low.indexOf('limit') > -1 || low.indexOf('quota') > -1 || low.indexOf('credit') > -1)
      return 'This Puter account hit its free usage limit. Wait, or top up the Puter account.';
    if (low.indexOf('content') > -1 || low.indexOf('policy') > -1 || low.indexOf('safety') > -1)
      return 'The model refused that prompt (content policy). Soften the wording and try again.';
    return 'Image generation failed: ' + m;
  }

  /* ---- build a txt2img prompt from the current Image-mode spec ----
     Flattens vbImgJsonObj() to readable phrases: keeps string values and
     string arrays, drops booleans/numbers and lock/rules boilerplate. ----*/
  var SKIP_KEYS = { rules: 1, editing: 1, behavior: 1, image_reference: 1, dialogue: 1, voice: 1 };
  function flatten(obj, out) {
    out = out || [];
    if (obj == null) return out;
    if (typeof obj === 'string') { var t = obj.trim(); if (t) out.push(t); return out; }
    if (Array.isArray(obj)) { obj.forEach(function (v) { if (typeof v === 'string') flatten(v, out); }); return out; }
    if (typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) {
        if (SKIP_KEYS[k]) return;
        flatten(obj[k], out);
      });
    }
    return out;
  }
  function seedPrompt() {
    var parts = [];
    if (typeof vbImgJsonObj === 'function') {
      try { parts = flatten(vbImgJsonObj()); } catch (e) {}
    }
    if (!parts.length) {
      // fallback: read the rendered preview text
      var pv = document.getElementById('imgJsonPreview');
      if (pv && pv.textContent && pv.textContent !== '—') parts = [pv.textContent.trim()];
    }
    // de-dupe while preserving order, drop pure lock-instruction noise
    var seen = {}, clean = [];
    parts.forEach(function (p) {
      var key = p.toLowerCase();
      if (seen[key]) return; seen[key] = 1;
      if (/^use .*reference|exact|locked|preserve|never |^no /i.test(p)) return;
      clean.push(p);
    });
    return clean.join(', ');
  }

  /* ---- core: generate an <img> from a prompt ---- */
  function generate(prompt, model) {
    return ensurePuter().then(function (puter) {
      var opts = { model: model || DEFAULT_MODEL };
      return puter.ai.txt2img(prompt, opts);
    });
  }

  /* ---- bonus: describe/analyze an image file via Puter (free) ---- */
  function describe(file, question) {
    return ensurePuter().then(function (puter) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(new Error('Could not read image')); };
        r.readAsDataURL(file);
      }).then(function (dataUrl) {
        return puter.ai.chat(question || 'Describe this image in detail for use as a video character reference.', dataUrl);
      }).then(function (resp) {
        return (resp && resp.message && resp.message.content) || (resp && resp.text) || String(resp);
      });
    });
  }

  /* ---- UI: a card that lives in the right column, Image mode only ---- */
  function injectCard() {
    if (document.getElementById('puterGenCard')) return;
    var anchor = document.getElementById('imgJsonPreview');
    var host = anchor ? anchor.closest('.vb-card') : null;
    var parent = host ? host.parentNode
               : (document.querySelector('.vb-col-right') || document.querySelector('.vb-wrap'));
    if (!parent) return;

    var card = document.createElement('div');
    card.className = 'vb-card vbm m-image';
    card.id = 'puterGenCard';
    card.innerHTML =
      '<div class="vb-st"><i class="ti ti-sparkles" style="font-size:18px"></i> Generate image (free) <span class="vb-badge">Puter · no key</span></div>' +
      '<div class="vb-fr"><label>Model</label><select id="puterModel">' +
        MODELS.map(function (m) { return '<option value="' + esc(m.v) + '">' + esc(m.l) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="vb-fr" style="margin-top:8px"><label>Prompt (editable — seeded from your image spec) ' +
        '<button type="button" class="vb-mini" id="puterReseed" style="margin-left:6px"><i class="ti ti-refresh"></i> Re-seed</button></label>' +
        '<textarea id="puterPrompt" rows="4" style="width:100%;box-sizing:border-box;resize:vertical" ' +
        'placeholder="Describe the image to generate…"></textarea></div>' +
      '<button type="button" class="vb-send" id="puterGo" style="width:100%;margin-top:10px"><i class="ti ti-wand"></i> Generate</button>' +
      '<div id="puterStatus" style="margin-top:8px;font-size:12px;color:#9a9aa6;min-height:16px"></div>' +
      '<div id="puterResult" style="margin-top:10px"></div>';
    if (host && host.nextSibling) parent.insertBefore(card, host.nextSibling);
    else parent.appendChild(card);

    // show only in Image mode (matches how vbSetMode toggles .vbm cards)
    card.style.display = (typeof vbModes !== 'undefined' && vbModes.mode === 'image') ? '' : 'none';

    var ta = card.querySelector('#puterPrompt');
    var statusEl = card.querySelector('#puterStatus');
    var resultEl = card.querySelector('#puterResult');
    var goBtn = card.querySelector('#puterGo');

    function setStatus(t) { statusEl.textContent = t || ''; }
    function reseed() { ta.value = seedPrompt(); }
    reseed(); // initial fill

    card.querySelector('#puterReseed').onclick = reseed;

    goBtn.onclick = function () {
      var prompt = (ta.value || '').trim();
      if (!prompt) { setStatus('Type or re-seed a prompt first.'); return; }
      var model = card.querySelector('#puterModel').value;
      resultEl.innerHTML = '';
      goBtn.disabled = true;
      setStatus('Generating… (first run opens a Puter sign-in popup — allow it)');
      generate(prompt, model).then(function (img) {
        img.style.cssText = 'max-width:100%;border-radius:10px;border:1px solid #333;display:block';
        resultEl.appendChild(img);
        var a = document.createElement('a');
        a.href = img.src; a.download = 'generated.png';
        a.className = 'vb-mini';
        a.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-top:8px;text-decoration:none';
        a.innerHTML = '<i class="ti ti-download"></i> Download';
        resultEl.appendChild(a);
        setStatus('Done.');
      }).catch(function (e) {
        setStatus(errMsg(e));
      }).then(function () { goBtn.disabled = false; });
    };
  }

  /* ---- init: run after system.js has defined vbModes/vbSetMode ---- */
  function init() {
    if (!document.getElementById('imgJsonPreview') && !document.querySelector('.vb-col-right')) return;
    injectCard();
    window.PBPuter = { generate: generate, describe: describe, ensurePuter: ensurePuter, MODELS: MODELS };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
