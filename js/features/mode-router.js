/* ============================================================
   mode-router.js  —  two top-level modes (Video / Image), each
   with its own sub-dropdown. Replaces the flat 5-option Mode
   selector with a grouped one, driving the SAME internal modes.

   Load AFTER the scripts that create the modes it points at —
   i.e. after recreate.js (adds 'recreate') and lightroom.js
   (adds the Edit-photo launcher). Put it right before sync.js:
       <script src="recreate.js"></script>
       ...
       <script src="lightroom.js"></script>
       <script src="mode-router.js"></script>
       <script src="sync.js"></script>
       <script src="perf.js"></script>

   Mapping
     Video → Hook        → vbSetMode('hook')
           → Clip        → vbSetMode('script') + clip type 'single'
           → Multi clip  → vbSetMode('script') + clip type 'multi'
     Image → Image       → vbSetMode('image')
           → Image Fixer → vbSetMode('fixer')
           → Edit photo  → opens the Lightroom editor (modal)
           → Product     → vbSetMode('product')
           → Recreate    → vbSetMode('recreate')

   Nothing in system.js changes; the old #modeSelect stays in the
   DOM (hidden) so existing code/presets keep working.
   ============================================================ */
(function () {
  var GROUPS = {
    video: { label: 'Video', icon: 'ti-movie', subs: [
      { label: 'Hook',       mode: 'hook' },
      { label: 'Clip',       mode: 'script', clip: 'single' },
      { label: 'Multi clip', mode: 'script', clip: 'multi' }
    ] },
    image: { label: 'Image', icon: 'ti-photo', subs: [
      { label: 'Image',       mode: 'image' },
      { label: 'Image Fixer', mode: 'fixer' },
      { label: 'Edit photo',  action: 'lightroom' },
      { label: 'Product',     mode: 'product' },
      { label: 'Recreate',    mode: 'recreate' }
    ] }
  };
  var esc = (window.PB && PB.escapeHtml) ? PB.escapeHtml : function (s) { return String(s == null ? '' : s); };

  var curGroup = 'video';
  var lastIdx = { video: 2, image: 0 };   // remember last real sub per group
  var subSel, tabWrap, building = false;

  /* ---- which group+index reflects the current internal state ---- */
  function currentSel() {
    var m = (typeof vbModes !== 'undefined') ? vbModes.mode : 'script';
    var ct = (typeof vbModes !== 'undefined') ? vbModes.clipType : 'multi';
    if (m === 'hook')     return ['video', 0];
    if (m === 'script')   return ['video', ct === 'single' ? 1 : 2];
    if (m === 'image')    return ['image', 0];
    if (m === 'fixer')    return ['image', 1];
    if (m === 'product')  return ['image', 3];
    if (m === 'recreate') return ['image', 4];
    return ['video', 2];
  }

  /* ---- apply a sub-mode (the actual switch) ---- */
  function applySub(groupKey, idx) {
    var sub = GROUPS[groupKey].subs[idx];
    if (!sub) return;
    if (sub.action === 'lightroom') {
      var b = document.querySelector('.lr-launcher');
      if (b) b.click();
      // Edit photo is a modal, not a persistent mode → revert the dropdown
      setSub(groupKey, lastIdx[groupKey] || 0, false);
      return;
    }
    lastIdx[groupKey] = idx;
    if (typeof vbSetMode === 'function') vbSetMode(sub.mode);
    if (sub.clip) {
      var cs = document.getElementById('clipType');
      if (cs) {
        cs.value = sub.clip;
        if (typeof vbClipTypeChange === 'function') vbClipTypeChange();
        else if (typeof vbClipTypeUI === 'function') { vbClipTypeUI(); if (typeof vbSeg === 'function') vbSeg(); }
      }
    }
  }

  /* ---- populate the sub-dropdown for a group ---- */
  function fillSub(groupKey) {
    subSel.innerHTML = GROUPS[groupKey].subs.map(function (s, i) {
      return '<option value="' + i + '">' + esc(s.label) + '</option>';
    }).join('');
  }

  /* ---- set the visible selection (optionally apply) ---- */
  function setSub(groupKey, idx, doApply) {
    building = true;
    curGroup = groupKey;
    tabWrap.querySelectorAll('.pb-mtab').forEach(function (b) { b.classList.toggle('on', b.dataset.g === groupKey); });
    fillSub(groupKey);
    subSel.value = String(idx);
    building = false;
    if (doApply) applySub(groupKey, idx);
  }

  /* ---- reflect current internal state into the UI (no apply) ---- */
  function reflect() {
    if (building) return;
    var s = currentSel();
    lastIdx[s[0]] = s[1];
    setSub(s[0], s[1], false);
  }

  function build() {
    var host = document.querySelector('.vb-mode');
    if (!host || document.getElementById('pbModeTabs')) return;

    // hide the original select (kept in DOM for system.js / recreate.js / presets)
    var oldWrap = host.querySelector('.vb-mode-select');
    if (oldWrap) oldWrap.style.display = 'none';

    var css = document.createElement('style');
    css.textContent =
      '.pb-mtabs{display:inline-flex;gap:4px;margin-right:8px}' +
      '.pb-mtab{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;border:1px solid #3a3a44;' +
        'background:#1d1d25;color:#cfcadf;cursor:pointer;font:600 13px system-ui}' +
      '.pb-mtab.on{background:#6c5ce7;color:#fff;border-color:#6c5ce7}';
    document.head.appendChild(css);

    tabWrap = document.createElement('div');
    tabWrap.id = 'pbModeTabs'; tabWrap.className = 'pb-mtabs';
    tabWrap.innerHTML = Object.keys(GROUPS).map(function (k) {
      return '<button type="button" class="pb-mtab" data-g="' + k + '"><i class="ti ' + GROUPS[k].icon + '"></i> ' + esc(GROUPS[k].label) + '</button>';
    }).join('');

    var subWrap = document.createElement('div');
    subWrap.className = 'vb-mode-select';
    subWrap.innerHTML = '<select id="pbSubMode" aria-label="Sub-mode"></select>';

    // insert right where the old select was
    if (oldWrap) { host.insertBefore(tabWrap, oldWrap); host.insertBefore(subWrap, oldWrap); }
    else { host.appendChild(tabWrap); host.appendChild(subWrap); }

    subSel = subWrap.querySelector('#pbSubMode');

    tabWrap.querySelectorAll('.pb-mtab').forEach(function (btn) {
      btn.onclick = function () {
        var g = btn.dataset.g;
        setSub(g, lastIdx[g] || 0, true);
      };
    });
    subSel.onchange = function () { if (!building) applySub(curGroup, +this.value); };

    // patch vbSetMode / vbClipTypeChange so the UI stays in sync when presets,
    // characters, or sync change the mode behind our back
    if (typeof window.vbSetMode === 'function' && !window.vbSetMode._mrWrapped) {
      var oset = window.vbSetMode;
      window.vbSetMode = function () { var r = oset.apply(this, arguments); reflect(); return r; };
      window.vbSetMode._mrWrapped = true;
    }
    if (typeof window.vbClipTypeChange === 'function' && !window.vbClipTypeChange._mrWrapped) {
      var oclip = window.vbClipTypeChange;
      window.vbClipTypeChange = function () { var r = oclip.apply(this, arguments); reflect(); return r; };
      window.vbClipTypeChange._mrWrapped = true;
    }

    reflect(); // initial state from whatever system.js already set
  }

  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
