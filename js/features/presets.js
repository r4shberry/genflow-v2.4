/* ============================================================
   presets.js  —  named presets (save/switch full builder configs)
   Load AFTER system.js (uses vbCollect / vbApply), BEFORE sync.js
   so the preset library is part of pb_state when sync pushes:
       <script src="system.js"></script>
       <script src="gemini.js"></script>
       <script src="recreate.js"></script>
       <script src="hook-people.js"></script>
       <script src="presets.js"></script>
       <script src="sync.js"></script>

   A preset is a full snapshot from vbCollect() (every field, check,
   companion chip, product preset, and hook line). Presets are stored
   under localStorage 'pb_presets' AND mirrored into pb_state.__presets
   so they ride the existing cross-device sync with no schema change.

   For the Iron Paws workflow this is the core loop: pick "Cassidy",
   "Darius", or "Dorian" and the whole locked character/voice/scene
   config loads in one tap.
   ============================================================ */
(function () {
  var LS = 'pb_presets', STATE = 'pb_state';
  var esc = (window.PB && PB.escapeHtml) ? PB.escapeHtml : function (s) { return String(s == null ? '' : s); };

  function load() {
    var raw = null; try { raw = localStorage.getItem(LS); } catch (e) {}
    var lib = null; if (raw) { try { lib = JSON.parse(raw); } catch (e) {} }
    if (!lib || typeof lib !== 'object') {
      // fall back to anything sync pulled into pb_state.__presets
      try { var st = JSON.parse(localStorage.getItem(STATE) || '{}'); if (st && st.__presets) lib = st.__presets; } catch (e) {}
    }
    return lib && typeof lib === 'object' ? lib : {};
  }
  function persist(lib) {
    try { localStorage.setItem(LS, JSON.stringify(lib)); } catch (e) {}
    // mirror into pb_state so sync carries it
    try {
      var st = JSON.parse(localStorage.getItem(STATE) || '{}');
      st.__presets = lib;
      localStorage.setItem(STATE, JSON.stringify(st));
    } catch (e) {}
    // nudge cloud push if sync is live
    if (typeof window.vbSave === 'function') { try { window.vbSave(); } catch (e) {} }
  }

  function snapshot() {
    if (typeof vbCollect !== 'function') return null;
    try { return vbCollect(); } catch (e) { return null; }
  }
  function applySnapshot(snap) {
    if (snap && typeof vbApply === 'function') { try { vbApply(snap); } catch (e) {} }
  }

  /* ---- actions ---- */
  function saveAs(name) {
    name = (name || '').trim(); if (!name) return;
    var snap = snapshot(); if (!snap) { toast('Nothing to save yet.'); return; }
    var lib = load(); lib[name] = { state: snap, savedAt: Date.now() };
    persist(lib); render(); toast('Saved preset \u201C' + name + '\u201D');
    setSelected(name);
  }
  function applyPreset(name) {
    var lib = load(), p = lib[name]; if (!p) return;
    applySnapshot(p.state); render(); setSelected(name); toast('Loaded \u201C' + name + '\u201D');
  }
  function update(name) {
    var lib = load(); if (!lib[name]) return;
    var snap = snapshot(); if (!snap) return;
    lib[name] = { state: snap, savedAt: Date.now() };
    persist(lib); toast('Updated \u201C' + name + '\u201D');
  }
  function remove(name) {
    var lib = load(); if (!lib[name]) return;
    delete lib[name]; persist(lib); render(); toast('Deleted \u201C' + name + '\u201D');
  }
  function rename(oldName, newName) {
    newName = (newName || '').trim(); if (!newName || newName === oldName) return;
    var lib = load(); if (!lib[oldName]) return;
    if (lib[newName] && !confirm('Overwrite existing preset \u201C' + newName + '\u201D?')) return;
    lib[newName] = lib[oldName]; delete lib[oldName];
    persist(lib); render(); setSelected(newName);
  }

  var selected = '';
  function setSelected(name) {
    selected = name || '';
    var sel = document.getElementById('pbPresetSelect');
    if (sel) sel.value = selected;
    var has = !!selected;
    ['pbPresetUpdate', 'pbPresetRename', 'pbPresetDelete'].forEach(function (id) {
      var b = document.getElementById(id); if (b) b.disabled = !has;
    });
  }

  function toast(m) { if (typeof vbToast === 'function') vbToast(m); }

  /* ---- UI ---- */
  function render() {
    var sel = document.getElementById('pbPresetSelect'); if (!sel) return;
    var lib = load();
    var names = Object.keys(lib).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    sel.innerHTML = '<option value="">Presets\u2026</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if (selected && names.indexOf(selected) > -1) sel.value = selected; else { selected = ''; sel.value = ''; }
    setSelected(sel.value);
  }

  function buildBar() {
    if (document.getElementById('pbPresetBar')) return;
    var header = document.querySelector('.vb-header-inner') || document.body;
    var bar = document.createElement('div');
    bar.id = 'pbPresetBar';
    bar.className = 'pb-preset-bar';
    bar.innerHTML =
      '<div class="pb-preset-select"><select id="pbPresetSelect" title="Load a saved preset"><option value="">Presets\u2026</option></select></div>' +
      '<button class="vb-mini" id="pbPresetSave"   title="Save current settings as a new preset"><i class="ti ti-device-floppy"></i><span>Save</span></button>' +
      '<button class="vb-mini" id="pbPresetUpdate" title="Overwrite the selected preset with current settings" disabled><i class="ti ti-refresh"></i></button>' +
      '<button class="vb-mini" id="pbPresetRename" title="Rename the selected preset" disabled><i class="ti ti-pencil"></i></button>' +
      '<button class="vb-mini" id="pbPresetDelete" title="Delete the selected preset" disabled><i class="ti ti-trash"></i></button>';
    // place it on its own row under the header bar
    var host = document.querySelector('.vb-header') || header;
    host.appendChild(bar);

    document.getElementById('pbPresetSelect').addEventListener('change', function () {
      if (this.value) applyPreset(this.value); else setSelected('');
    });
    document.getElementById('pbPresetSave').onclick = function () {
      var def = selected || '';
      var name = prompt('Name this preset (e.g. Cassidy, Darius, Dorian):', def);
      if (name) saveAs(name);
    };
    document.getElementById('pbPresetUpdate').onclick = function () { if (selected && confirm('Overwrite \u201C' + selected + '\u201D with the current settings?')) update(selected); };
    document.getElementById('pbPresetRename').onclick = function () { if (!selected) return; var n = prompt('Rename preset:', selected); if (n) rename(selected, n); };
    document.getElementById('pbPresetDelete').onclick = function () { if (selected && confirm('Delete preset \u201C' + selected + '\u201D?')) remove(selected); };
  }

  function init() {
    if (!document.querySelector('.vb-header')) { return; }
    buildBar();
    render();
    // re-render if sync pulls new presets in (it reloads the page, so this also covers fresh loads)
    window.addEventListener('storage', function (e) { if (e.key === LS || e.key === STATE) render(); });
    // expose a tiny API
    window.PBPresets = { saveAs: saveAs, apply: applyPreset, remove: remove, list: function () { return Object.keys(load()); } };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
