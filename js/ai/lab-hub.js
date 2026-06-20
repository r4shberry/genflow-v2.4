/* ============================================================
   lab-hub.js  —  one launcher to rule the three panels.
   Replaces the stacked Night Chat / Puter Lab / Gemini Lab
   buttons with a single "AI Labs" launcher + a pick menu.

   Load LAST among the panel files, so all three launchers exist
   before this hides them:
       <script src="gemini.js"></script>     <!-- Night Chat -->
       <script src="puter-chat.js"></script> <!-- Puter Lab -->
       <script src="gemini-lab.js"></script> <!-- Gemini Lab -->
       <script src="lab-hub.js"></script>
       <script src="perf.js"></script>

   It doesn't touch those files — it finds each one's launcher and
   opens the chosen panel by triggering it. Remove this one line to
   get the three separate buttons back.
   ============================================================ */
(function () {
  // each entry: the panel's launcher button text + how to open it.
  var DEFS = [
    { name: 'Night Chat', icon: 'ti-moon-stars', color: '#6c5ce7',
      open: function (el) { if (window.PBGemini && PBGemini.openPanel) PBGemini.openPanel(); else if (el) el.click(); } },
    { name: 'Puter Lab',  icon: 'ti-sparkles',   color: '#2dd4bf',
      open: function (el) { if (el) el.click(); } },
    { name: 'Gemini Lab', icon: 'ti-photo-ai',   color: '#a99bff',
      open: function (el) { if (el) el.click(); } }
  ];

  var hubBtn, menu, hiddenCss;

  function findLauncher(text) {
    var bs = document.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      // launchers are fixed-position pills whose label contains the name
      if ((bs[i].textContent || '').indexOf(text) > -1 &&
          bs[i].id !== 'pbLabHub' &&
          (bs[i].style.position === 'fixed' || getComputedStyle(bs[i]).position === 'fixed')) {
        return bs[i];
      }
    }
    return null;
  }

  function hideOriginals() {
    DEFS.forEach(function (d) {
      var el = findLauncher(d.name);
      if (el) { el.classList.add('lab-hidden'); d._el = el; }
    });
  }

  function build() {
    if (document.getElementById('pbLabHub')) return;

    hiddenCss = document.createElement('style');
    // !important so it beats the panels' inline display:flex on close()
    hiddenCss.textContent =
      '.lab-hidden{display:none !important}' +
      '#pbLabMenu{position:fixed;left:16px;bottom:64px;z-index:9998;display:none;flex-direction:column;gap:6px}' +
      '#pbLabMenu.open{display:flex}' +
      '.pb-lab-item{display:flex;align-items:center;gap:8px;padding:9px 14px;border:none;border-radius:999px;cursor:pointer;' +
        'color:#fff;font:600 13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.45);background:#1d1d25}' +
      '.pb-lab-item:hover{filter:brightness(1.12)}';
    document.head.appendChild(hiddenCss);

    hideOriginals();

    // the menu (built once, populated from DEFS)
    menu = document.createElement('div');
    menu.id = 'pbLabMenu';
    DEFS.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pb-lab-item';
      b.style.background = 'linear-gradient(135deg,' + d.color + ',#222)';
      b.innerHTML = '<i class="ti ' + d.icon + '"></i> ' + d.name;
      b.onclick = function () {
        closeMenu();
        if (!d._el) d._el = findLauncher(d.name); // late-load safety
        d.open(d._el);
      };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);

    // the single launcher
    hubBtn = document.createElement('button');
    hubBtn.type = 'button'; hubBtn.id = 'pbLabHub'; hubBtn.title = 'AI Labs';
    hubBtn.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:9998;display:flex;align-items:center;gap:8px;' +
      'padding:10px 14px;border:none;border-radius:999px;cursor:pointer;color:#fff;' +
      'background:linear-gradient(135deg,#6c5ce7,#0f766e);box-shadow:0 8px 24px rgba(0,0,0,.45);font:600 14px system-ui';
    hubBtn.innerHTML = '<i class="ti ti-stack-2"></i> AI Labs <i class="ti ti-chevron-up" style="font-size:13px;opacity:.8"></i>';
    hubBtn.onclick = function (e) { e.stopPropagation(); toggleMenu(); };
    document.body.appendChild(hubBtn);

    // close menu on outside click / escape
    document.addEventListener('click', function (e) {
      if (menu.classList.contains('open') && !menu.contains(e.target) && e.target !== hubBtn) closeMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

    // re-hide originals a moment later in case a panel script initialized after us
    setTimeout(hideOriginals, 300);
    setTimeout(hideOriginals, 1200);
  }

  function toggleMenu() { menu.classList.toggle('open'); }
  function closeMenu() { menu.classList.remove('open'); }

  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
