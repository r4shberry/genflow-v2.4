/* ============================================================
   characters.js  —  Character Library (image + name + description)
   Load AFTER gemini.js (uses window.PBGemini for "Describe from photo")
   and system.js; BEFORE sync.js (so the roster rides cross-device sync):
       <script src="gemini.js"></script>
       <script src="recreate.js"></script>
       <script src="hook-people.js"></script>
       <script src="presets.js"></script>
       <script src="characters.js"></script>
       <script src="sync.js"></script>

   A character = { id, name, charLabel, description } + a thumbnail image
   stored in IndexedDB (PB.blobStore, key 'char_img_<id>'). Picking one fills
   the identity fields for whatever mode you're in and then "follows" you when
   you switch modes. The raw image is a separate upload to Flow/Veo — the JSON
   carries the text identity (name → character key, description → image_reference
   / Description field).
   ============================================================ */
(function () {
  var LS = 'pb_characters', STATE = 'pb_state', ACTIVE = 'pb_active_char';
  var PBx = window.PB || {};
  var esc = PBx.escapeHtml || function (s) { return String(s == null ? '' : s); };
  var store = PBx.blobStore || null;
  var F = PBx.FIELDS || { character: 'character', imgRef: 'imgRef', hkCharA: 'hkCharA', hkRefA: 'hkRefA', pdRef: 'pdRef', modeSelect: 'modeSelect' };
  var errMsg = PBx.fmtApiError || function (e) { return 'Error: ' + (e && e.message || e); };

  var thumbs = {};   // id -> dataURL (loaded from IDB for the roster)
  var active = '';   // active character id

  /* ---- storage ---- */
  function load() {
    var raw = null; try { raw = localStorage.getItem(LS); } catch (e) {}
    var lib = null; if (raw) { try { lib = JSON.parse(raw); } catch (e) {} }
    if (!lib) { try { var st = JSON.parse(localStorage.getItem(STATE) || '{}'); if (st && st.__characters) lib = st.__characters; } catch (e) {} }
    return (lib && typeof lib === 'object') ? lib : {};
  }
  function persist(lib) {
    try { localStorage.setItem(LS, JSON.stringify(lib)); } catch (e) {}
    try { var st = JSON.parse(localStorage.getItem(STATE) || '{}'); st.__characters = lib; localStorage.setItem(STATE, JSON.stringify(st)); } catch (e) {}
    if (typeof window.vbSave === 'function') { try { window.vbSave(); } catch (e) {} }
  }
  function getActive() { try { return localStorage.getItem(ACTIVE) || ''; } catch (e) { return ''; } }
  function setActive(id) { active = id || ''; try { id ? localStorage.setItem(ACTIVE, id) : localStorage.removeItem(ACTIVE); } catch (e) {} }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* read current mode reliably (vbModes is a const global, NOT on window) */
  function currentMode() {
    if (typeof vbModes !== 'undefined' && vbModes && vbModes.mode) return vbModes.mode;
    var sel = document.getElementById(F.modeSelect);
    return (sel && sel.value) || 'script';
  }
  /* call a render fn immediately, bypassing perf.js debounce when possible */
  function refresh(name) { var f = window[name]; if (typeof f === 'function') { try { (f.now || f)(); } catch (e) {} } }

  /* ---- inject identity into the current mode ---- */
  function setVal(id, val) { var el = document.getElementById(id); if (el && val != null && val !== '') { el.value = val; } }
  function applyToMode(c, silent) {
    if (!c) return;
    var m = currentMode();
    var label = c.charLabel || c.name || '';
    if (m === 'hook') {
      setVal(F.hkCharA, label); setVal(F.hkRefA, c.description);
      refresh('vbHookUI');
    } else if (m === 'product') {
      setVal(F.pdRef, c.description);
      refresh('vbProductUI');
    } else { // script (Clip — covers both single and multi clip types), image, fixer, recreate
      setVal(F.character, label); setVal(F.imgRef, c.description);
      refresh('vbJsonUI'); refresh('vbImgUI');
    }
    if (typeof vbSaveDebounced === 'function') vbSaveDebounced();
    if (!silent && typeof vbToast === 'function') vbToast('Loaded \u201C' + (c.name || 'character') + '\u201D into ' + modeLabel(m));
  }
  function modeLabel(m) {
    return ({ script: 'Clip', hook: 'Hook (Person A)', image: 'Image', fixer: 'Image Fixer', product: 'Product', recreate: 'Recreate' })[m] || m;
  }
  function pick(id) {
    var lib = load(), c = lib[id]; if (!c) return;
    setActive(id); applyToMode(c); renderRoster();
  }

  /* ---- "follow me" across mode switches ---- */
  function hookModeSwitch() {
    if (typeof window.vbSetMode !== 'function' || window.vbSetMode._charWrapped) return;
    var orig = window.vbSetMode;
    window.vbSetMode = function (m) {
      var r = orig.apply(this, arguments);
      if (active) { var c = load()[active]; if (c) applyToMode(c, true); }
      return r;
    };
    window.vbSetMode._charWrapped = true;
  }

  /* ---- describe from photo (optional, needs Gemini) ---- */
  function describePhoto(file) {
    var g = window.PBGemini; if (!g) return Promise.reject(new Error('Night Chat (Gemini) not available'));
    return g.fileToScaledB64(file).then(function (s) {
      return g.apiCall([{ role: 'user', parts: [g.imgPart(s.b64, s.mime), { text:
        'Look at this photo of a person. Write ONE concise but vivid physical description (about 25-40 words) usable as a video character reference: approximate age, gender, ethnicity cues, face shape, hair, facial hair, skin, build, and any distinctive features. Plain text only, no preamble, no quotes.' }] }],
        'You describe people for casting/reference. Output one plain-text line only.');
    });
  }

  /* ---- editor modal ---- */
  var editingId = null, pendingImg = null;
  function openEditor(id) {
    editingId = id || null; pendingImg = null;
    var lib = load(), c = (id && lib[id]) || { name: '', charLabel: '', description: '' };
    var ov = document.getElementById('pbCharModal');
    if (!ov) { ov = buildModal(); }
    document.getElementById('pbCharName').value = c.name || '';
    document.getElementById('pbCharLabel').value = c.charLabel || '';
    document.getElementById('pbCharDesc').value = c.description || '';
    var prev = document.getElementById('pbCharPreview');
    prev.style.backgroundImage = (id && thumbs[id]) ? ('url(' + thumbs[id] + ')') : 'none';
    prev.classList.toggle('has-img', !!(id && thumbs[id]));
    document.getElementById('pbCharModalTitle').textContent = id ? 'Edit character' : 'New character';
    document.getElementById('pbCharDelete').style.display = id ? '' : 'none';
    // refresh word counter + label placeholder for this open
    var dEl = document.getElementById('pbCharDesc'), cEl = document.getElementById('pbCharCount');
    var w = (dEl.value || '').trim() ? dEl.value.trim().split(/\s+/).length : 0;
    cEl.textContent = w + (w === 1 ? ' word' : ' words'); cEl.classList.toggle('over', w > 60);
    document.getElementById('pbCharLabel').setAttribute('placeholder', (c.name || '').trim() ? (c.name || '').trim() : 'auto-fills from avatar name');
    ov.classList.add('show');
  }
  function closeEditor() { var ov = document.getElementById('pbCharModal'); if (ov) ov.classList.remove('show'); editingId = null; pendingImg = null; }

  function buildModal() {
    var ov = document.createElement('div');
    ov.id = 'pbCharModal'; ov.className = 'pb-char-modal';
    ov.innerHTML =
      '<div class="pb-char-dialog" role="dialog" aria-modal="true" aria-labelledby="pbCharModalTitle">' +
        '<div class="pb-char-head"><strong id="pbCharModalTitle">New character</strong>' +
          '<button class="pb-char-x" id="pbCharClose" aria-label="Close"><i class="ti ti-x"></i></button></div>' +
        '<div class="pb-char-body">' +
          '<div class="pb-char-photo">' +
            '<div id="pbCharPreview" class="pb-char-preview"><i class="ti ti-user"></i></div>' +
            '<button class="vb-mini" id="pbCharUpload"><i class="ti ti-upload"></i> Photo</button>' +
            '<button class="vb-mini" id="pbCharDescribe" title="Use Night Chat to write the description from the photo"><i class="ti ti-camera"></i> Describe</button>' +
          '</div>' +
          '<div class="pb-char-fields">' +
            '<label>Avatar name</label><input type="text" id="pbCharName" placeholder="e.g. Cassidy">' +
            '<label>Character label <span class="pb-hint">(short \u2014 JSON \u201Ccharacter\u201D key; blank = use avatar name)</span></label>' +
            '<input type="text" id="pbCharLabel" placeholder="auto-fills from avatar name">' +
            '<label>Description <span class="pb-hint">(detailed likeness)</span>' +
              '<button type="button" class="pb-char-tighten" id="pbCharTighten" title="Rewrite to ~40 words with Night Chat"><i class="ti ti-wand"></i> ~40 words</button>' +
              '<span class="pb-char-count" id="pbCharCount">0 words</span>' +
            '</label>' +
            '<textarea id="pbCharDesc" rows="5" placeholder="Physical description used as the locked reference\u2026"></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="pb-char-foot">' +
          '<button class="vb-mini pb-danger" id="pbCharDelete"><i class="ti ti-trash"></i> Delete</button>' +
          '<div style="flex:1"></div>' +
          '<button class="vb-mini" id="pbCharCancel">Cancel</button>' +
          '<button class="vb-send" id="pbCharSave" style="margin:0;width:auto;padding:8px 16px"><i class="ti ti-check"></i> Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    ov.appendChild(fileInput);

    ov.addEventListener('click', function (e) { if (e.target === ov) closeEditor(); });
    document.getElementById('pbCharClose').onclick = closeEditor;
    document.getElementById('pbCharCancel').onclick = closeEditor;
    document.getElementById('pbCharUpload').onclick = function () { fileInput.click(); };
    fileInput.addEventListener('change', async function () {
      if (!fileInput.files || !fileInput.files[0]) return;
      var f = fileInput.files[0]; fileInput.value = '';
      try {
        var g = window.PBGemini;
        var scaled = g ? await g.fileToScaledB64(f) : await fallbackScale(f);
        pendingImg = scaled;
        var dataUrl = 'data:' + scaled.mime + ';base64,' + scaled.b64;
        var prev = document.getElementById('pbCharPreview');
        prev.style.backgroundImage = 'url(' + dataUrl + ')'; prev.classList.add('has-img');
      } catch (e) { if (typeof vbToast === 'function') vbToast(errMsg(e)); }
    });
    document.getElementById('pbCharDescribe').onclick = async function () {
      var btn = this;
      if (!window.PBGemini) { if (typeof vbToast === 'function') vbToast('Open Night Chat and add a Gemini key first.'); return; }
      if (!pendingImg && !(editingId && thumbs[editingId])) { fileInput.click(); return; }
      var old = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader"></i> Reading\u2026'; btn.disabled = true;
      try {
        var src = pendingImg ? blobFromScaled(pendingImg) : dataUrlToFile(thumbs[editingId]);
        var desc = (await describePhoto(src)).trim();
        if (desc) { document.getElementById('pbCharDesc').value = desc; updateCount(); }
      } catch (e) { if (typeof vbToast === 'function') vbToast(errMsg(e, e && e.status)); }
      btn.innerHTML = old; btn.disabled = false;
    };

    // live word counter + label autofill hint
    var descEl = document.getElementById('pbCharDesc');
    function wordCount(s) { s = (s || '').trim(); return s ? s.split(/\s+/).length : 0; }
    function updateCount() {
      var n = wordCount(descEl.value), el = document.getElementById('pbCharCount');
      el.textContent = n + (n === 1 ? ' word' : ' words');
      el.classList.toggle('over', n > 60);
    }
    descEl.addEventListener('input', updateCount);
    document.getElementById('pbCharName').addEventListener('input', function () {
      var lab = document.getElementById('pbCharLabel');
      lab.setAttribute('placeholder', this.value.trim() ? this.value.trim() : 'auto-fills from avatar name');
    });

    // ~40-word tighten (needs Gemini)
    document.getElementById('pbCharTighten').onclick = async function () {
      var btn = this, g = window.PBGemini;
      var text = descEl.value.trim();
      if (!text) { if (typeof vbToast === 'function') vbToast('Write or generate a description first.'); return; }
      if (!g) { if (typeof vbToast === 'function') vbToast('Open Night Chat and add a Gemini key first.'); return; }
      var old = btn.innerHTML; btn.innerHTML = '<i class="ti ti-loader"></i>'; btn.disabled = true;
      try {
        var out = await g.apiCall(
          [{ role: 'user', parts: [{ text: 'Rewrite this character description into one tight, vivid line of about 40 words (max 45). Keep every concrete physical detail; cut filler. Plain text only, no preamble, no quotes.\n\n' + text }] }],
          'You compress character descriptions for video prompts. Output one plain-text line only.');
        var clean = g.stripFences(out).trim();
        if (clean) { descEl.value = clean; updateCount(); }
      } catch (e) { if (typeof vbToast === 'function') vbToast(errMsg(e, e && e.status)); }
      btn.innerHTML = old; btn.disabled = false;
    };
    document.getElementById('pbCharDelete').onclick = function () {
      if (!editingId) return;
      if (!confirm('Delete this character?')) return;
      var lib = load(); delete lib[editingId]; persist(lib);
      if (store) store.del('char_img_' + editingId);
      delete thumbs[editingId];
      if (active === editingId) setActive('');
      closeEditor(); renderRoster();
    };
    document.getElementById('pbCharSave').onclick = async function () {
      var name = document.getElementById('pbCharName').value.trim();
      if (!name) { document.getElementById('pbCharName').focus(); return; }
      var lib = load();
      var id = editingId || uid();
      lib[id] = {
        id: id, name: name,
        charLabel: document.getElementById('pbCharLabel').value.trim() || name,
        description: document.getElementById('pbCharDesc').value.trim(),
        savedAt: Date.now()
      };
      persist(lib);
      if (pendingImg && store) {
        try { await store.set('char_img_' + id, pendingImg); thumbs[id] = 'data:' + pendingImg.mime + ';base64,' + pendingImg.b64; } catch (e) {}
      }
      setActive(id);            // make the saved character active
      applyToMode(lib[id]);     // and drop it into the JSON preview right away
      closeEditor(); renderRoster();
      if (typeof vbToast === 'function') vbToast('Saved \u201C' + name + '\u201D \u2014 loaded into ' + modeLabel(currentMode()));
    };
    return ov;
  }

  /* image helpers for the Describe button */
  function blobFromScaled(s) { var bin = atob(s.b64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new File([arr], 'photo.jpg', { type: s.mime }); }
  function dataUrlToFile(d) { var parts = d.split(','), mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg', bin = atob(parts[1]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new File([arr], 'photo.jpg', { type: mime }); }
  function fallbackScale(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res({ b64: String(r.result).split(',')[1], mime: file.type || 'image/jpeg' }); }; r.onerror = function () { rej(new Error('Could not read image')); }; r.readAsDataURL(file); }); }

  /* ---- roster ---- */
  function renderRoster() {
    var wrap = document.getElementById('pbCharRoster'); if (!wrap) return;
    var lib = load();
    var ids = orderedIds(lib);
    active = getActive();
    var cards = ids.map(function (id) {
      var c = lib[id], isOn = id === active, t = thumbs[id];
      return '<div class="pb-char-card' + (isOn ? ' on' : '') + '" draggable="true" data-id="' + esc(id) + '" title="Load ' + esc(c.name) + ' into the current mode (drag to reorder)">' +
        '<div class="pb-char-av"' + (t ? ' style="background-image:url(' + t + ')"' : '') + '>' + (t ? '' : '<i class="ti ti-user"></i>') + '</div>' +
        '<div class="pb-char-name">' + esc(c.name) + '</div>' +
        '<button class="pb-char-edit" data-edit="' + esc(id) + '" aria-label="Edit ' + esc(c.name) + '"><i class="ti ti-dots"></i></button>' +
        (isOn ? '<span class="pb-char-dot" aria-hidden="true"></span>' : '') +
      '</div>';
    }).join('');
    wrap.innerHTML = cards +
      '<button class="pb-char-add" id="pbCharAdd" title="Create a character"><i class="ti ti-plus"></i><span>Add</span></button>';

    Array.prototype.forEach.call(wrap.querySelectorAll('.pb-char-card'), function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-edit]')) { openEditor(el.getAttribute('data-id')); return; }
        pick(el.getAttribute('data-id'));
      });
      // drag-to-reorder
      el.addEventListener('dragstart', function (e) { dragId = el.getAttribute('data-id'); el.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); dragId = null; });
      el.addEventListener('dragover', function (e) { e.preventDefault(); });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        var target = el.getAttribute('data-id');
        if (dragId && target && dragId !== target) reorder(dragId, target);
      });
    });
    document.getElementById('pbCharAdd').onclick = function () { openEditor(null); };
  }

  /* ---- order persistence + drag reorder ---- */
  var dragId = null;
  function getOrder() { try { var st = JSON.parse(localStorage.getItem(STATE) || '{}'); return Array.isArray(st.__charOrder) ? st.__charOrder.slice() : []; } catch (e) { return []; } }
  function setOrder(arr) {
    try { var st = JSON.parse(localStorage.getItem(STATE) || '{}'); st.__charOrder = arr; localStorage.setItem(STATE, JSON.stringify(st)); } catch (e) {}
    if (typeof window.vbSave === 'function') { try { window.vbSave(); } catch (e) {} }
  }
  function orderedIds(lib) {
    var keys = Object.keys(lib);
    var ord = getOrder().filter(function (id) { return lib[id]; });
    // append any new ids not yet in the order (alphabetical) to the end
    keys.filter(function (id) { return ord.indexOf(id) === -1; })
        .sort(function (a, b) { return (lib[a].name || '').toLowerCase() < (lib[b].name || '').toLowerCase() ? -1 : 1; })
        .forEach(function (id) { ord.push(id); });
    return ord;
  }
  function reorder(fromId, toId) {
    var lib = load(), ord = orderedIds(lib);
    var fi = ord.indexOf(fromId), ti = ord.indexOf(toId);
    if (fi < 0 || ti < 0) return;
    ord.splice(fi, 1); ord.splice(ti, 0, fromId);
    setOrder(ord); renderRoster();
  }

  function loadThumbs() {
    if (!store) { renderRoster(); return; }
    var lib = load(), ids = Object.keys(lib), pending = ids.length;
    if (!pending) { renderRoster(); return; }
    ids.forEach(function (id) {
      store.get('char_img_' + id).then(function (s) {
        if (s && s.b64) thumbs[id] = 'data:' + s.mime + ';base64,' + s.b64;
      }).catch(function () {}).then(function () { if (--pending <= 0) renderRoster(); });
    });
  }

  function buildBar() {
    if (document.getElementById('pbCharBar')) return;
    var wrap = document.querySelector('.vb-col-left') || document.querySelector('.vb-wrap'); if (!wrap) return;
    var bar = document.createElement('div');
    bar.id = 'pbCharBar'; bar.className = 'vb-card pb-char-bar';
    bar.innerHTML =
      '<div class="pb-char-bar-head"><i class="ti ti-users"></i> Characters ' +
        '<span class="vb-badge">loads into any mode</span></div>' +
      '<div class="pb-char-roster" id="pbCharRoster"></div>';
    wrap.insertBefore(bar, wrap.firstChild);
  }

  function init() {
    if (!document.querySelector('.vb-wrap')) return;
    buildBar();
    active = getActive();
    loadThumbs();
    hookModeSwitch();
    window.addEventListener('storage', function (e) { if (e.key === LS || e.key === STATE) { loadThumbs(); } });
    window.PBCharacters = {
      list: function () { return Object.values(load()); },
      apply: function (id) { pick(id); },
      add: function (name, desc, label) { var lib = load(), id = uid(); lib[id] = { id: id, name: name, description: desc || '', charLabel: label || '', savedAt: Date.now() }; persist(lib); renderRoster(); return id; }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
