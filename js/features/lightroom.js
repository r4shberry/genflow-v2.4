/* ============================================================
   lightroom.js  —  in-browser photo editor (no AI, no server)
   Load after system.js (uses vbToast if present). Self-contained:
       <script src="characters.js"></script>
       <script src="lightroom.js"></script>
       <script src="sync.js"></script>

   Bottom-right launcher opens a full-screen editor. Adjustments run live
   on a <canvas> via a single pixel pass; crop/rotate via canvas transform.
   Hold the canvas to see the original (before/after). Download exports the
   full-resolution edited image as PNG or JPEG. Nothing leaves the browser.
   ============================================================ */
(function () {
  function toast(m) { if (typeof vbToast === 'function') vbToast(m); }

  // adjustment state (neutral defaults)
  var DEFAULTS = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, saturation: 0, vibrance: 0, clarity: 0, sharpen: 0,
    vignette: 0, rotate: 0, flipH: false, flipV: false, filter: 'none'
  };
  // HSL: 8 bands, each { h, s, l } in -100..100
  var HSL_BANDS = [
    ['red', 'Red', 0], ['orange', 'Orange', 30], ['yellow', 'Yellow', 60],
    ['green', 'Green', 120], ['aqua', 'Aqua', 180], ['blue', 'Blue', 240],
    ['purple', 'Purple', 270], ['magenta', 'Magenta', 315]
  ];
  function freshHSL() { var o = {}; HSL_BANDS.forEach(function (b) { o[b[0]] = { h: 0, s: 0, l: 0 }; }); return o; }
  // Curves: arrays of {x,y} control points in 0..255; straight line by default
  function freshCurve() { return [{ x: 0, y: 0 }, { x: 255, y: 255 }]; }
  function freshCurves() { return { rgb: freshCurve(), r: freshCurve(), g: freshCurve(), b: freshCurve() }; }
  // Color balance: shadows / mids / highlights, each R/G/B in -100..100 (cyan-red, magenta-green, yellow-blue)
  function freshGrade() { return { sh: { r: 0, g: 0, b: 0 }, mid: { r: 0, g: 0, b: 0 }, hi: { r: 0, g: 0, b: 0 } }; }

  var adj = Object.assign({}, DEFAULTS, { hsl: freshHSL(), curves: freshCurves(), grade: freshGrade() });
  function resetAdj() { adj = Object.assign({}, DEFAULTS, { hsl: freshHSL(), curves: freshCurves(), grade: freshGrade() }); }

  var SLIDERS = [
    ['exposure', 'Exposure', -100, 100], ['contrast', 'Contrast', -100, 100],
    ['highlights', 'Highlights', -100, 100], ['shadows', 'Shadows', -100, 100],
    ['whites', 'Whites', -100, 100], ['blacks', 'Blacks', -100, 100],
    ['temp', 'Temperature', -100, 100], ['tint', 'Tint', -100, 100],
    ['saturation', 'Saturation', -100, 100], ['vibrance', 'Vibrance', -100, 100],
    ['clarity', 'Clarity', 0, 100], ['sharpen', 'Sharpen', 0, 100],
    ['vignette', 'Vignette', 0, 100]
  ];
  var FILTERS = [
    ['none', 'Original'], ['bw', 'B&W'], ['warm', 'Warm'], ['cool', 'Cool'],
    ['film', 'Film'], ['vivid', 'Vivid'], ['matte', 'Matte'], ['noir', 'Noir']
  ];
  // filters are just preset adjustment overlays applied on top of manual sliders
  var FILTER_PRESETS = {
    none: {},
    bw: { saturation: -100, contrast: 10, clarity: 8 },
    warm: { temp: 28, vibrance: 12, contrast: 6 },
    cool: { temp: -26, tint: 6, vibrance: 8 },
    film: { contrast: -8, blacks: 12, vibrance: 10, vignette: 14, temp: 8 },
    vivid: { saturation: 22, vibrance: 18, contrast: 14, clarity: 10 },
    matte: { contrast: -16, blacks: 22, highlights: -10, saturation: -8 },
    noir: { saturation: -100, contrast: 28, blacks: 18, vignette: 26, clarity: 12 }
  };

  var launcher, panel, srcImg = null, srcCanvas = null, viewCanvas = null, vctx = null;
  var fileInput, fname = 'edited';

  function build() {
    if (panel) return;
    launcher = document.createElement('button');
    launcher.type = 'button'; launcher.title = 'Photo editor';
    launcher.className = 'lr-launcher';
    launcher.innerHTML = '<i class="ti ti-adjustments"></i> Edit photo';
    launcher.onclick = open;
    document.body.appendChild(launcher);

    panel = document.createElement('div');
    panel.className = 'lr-panel';
    panel.innerHTML =
      '<div class="lr-top">' +
        '<strong><i class="ti ti-adjustments"></i> Photo editor</strong>' +
        '<span class="lr-hint">Hold the image to compare</span>' +
        '<div style="flex:1"></div>' +
        '<button class="vb-mini" data-act="open"><i class="ti ti-photo"></i> Open</button>' +
        '<button class="vb-mini" data-act="reset"><i class="ti ti-rotate"></i> Reset</button>' +
        '<select class="lr-fmt" data-fmt><option value="png">PNG</option><option value="jpeg">JPG</option></select>' +
        '<button class="vb-send lr-dl" data-act="download" style="margin:0;width:auto;padding:8px 14px"><i class="ti ti-download"></i> Download</button>' +
        '<button class="vb-mini" data-act="close"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="lr-main">' +
        '<div class="lr-stage" data-stage>' +
          '<div class="lr-drop" data-drop><i class="ti ti-photo-up"></i><div>Open or drop a photo</div></div>' +
          '<canvas class="lr-canvas" data-canvas style="display:none"></canvas>' +
        '</div>' +
        '<div class="lr-rail">' +
          '<div class="lr-tabs">' +
            '<button class="lr-tab on" data-tab="light">Light</button>' +
            '<button class="lr-tab" data-tab="color">Color</button>' +
            '<button class="lr-tab" data-tab="curve">Curve</button>' +
            '<button class="lr-tab" data-tab="hsl">HSL</button>' +
            '<button class="lr-tab" data-tab="grade">Grade</button>' +
            '<button class="lr-tab" data-tab="detail">Detail</button>' +
            '<button class="lr-tab" data-tab="filters">Filters</button>' +
          '</div>' +
          '<div class="lr-controls" data-controls></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);

    fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    panel.appendChild(fileInput);
    fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) { loadFile(fileInput.files[0]); fileInput.value = ''; } });

    viewCanvas = panel.querySelector('[data-canvas]'); vctx = viewCanvas.getContext('2d', { willReadFrequently: true });

    panel.addEventListener('click', function (e) {
      var hit = e.target.closest('[data-act],[data-tab]'); if (!hit) return;
      if (hit.dataset.act === 'close') close();
      if (hit.dataset.act === 'open') fileInput.click();
      if (hit.dataset.act === 'reset') { resetAdj(); renderControls(); apply(); toast('Reset adjustments'); }
      if (hit.dataset.act === 'download') download();
      if (hit.dataset.tab) { panel.querySelectorAll('.lr-tab').forEach(function (t) { t.classList.toggle('on', t === hit); }); curTab = hit.dataset.tab; renderControls(); }
    });

    // drag & drop + before/after
    var stage = panel.querySelector('[data-stage]'), drop = panel.querySelector('[data-drop]');
    ['dragover', 'dragenter'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('hot'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('hot'); }); });
    stage.addEventListener('drop', function (e) { var f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
    drop.addEventListener('click', function () { fileInput.click(); });
    // press-and-hold to show original
    var showOrig = function (on) { if (!srcImg) return; if (on) drawOriginal(); else apply(); };
    viewCanvas.addEventListener('mousedown', function () { showOrig(true); });
    window.addEventListener('mouseup', function () { showOrig(false); });
    viewCanvas.addEventListener('touchstart', function (e) { e.preventDefault(); showOrig(true); }, { passive: false });
    viewCanvas.addEventListener('touchend', function () { showOrig(false); });

    renderControls();
  }

  var curTab = 'light';
  var TAB_KEYS = {
    light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
    color: ['temp', 'tint', 'saturation', 'vibrance'],
    detail: ['clarity', 'sharpen', 'vignette']
  };

  function renderControls() {
    var box = panel.querySelector('[data-controls]'); if (!box) return;
    if (curTab === 'filters') {
      box.innerHTML = '<div class="lr-filters">' + FILTERS.map(function (f) {
        return '<button class="lr-filter' + (adj.filter === f[0] ? ' on' : '') + '" data-filter="' + f[0] + '">' +
          '<span class="lr-filter-sw lr-sw-' + f[0] + '"></span>' + f[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="lr-rotrow">' +
        '<button class="vb-mini" data-rot="-90"><i class="ti ti-rotate-2"></i> Left</button>' +
        '<button class="vb-mini" data-rot="90"><i class="ti ti-rotate-clockwise-2"></i> Right</button>' +
        '<button class="vb-mini" data-flip="h"><i class="ti ti-flip-horizontal"></i> Flip</button>' +
        '<button class="vb-mini" data-flip="v"><i class="ti ti-flip-vertical"></i> Flip</button>' +
      '</div>';
      box.querySelectorAll('[data-filter]').forEach(function (b) { b.onclick = function () { adj.filter = b.dataset.filter; renderControls(); apply(); }; });
      box.querySelectorAll('[data-rot]').forEach(function (b) { b.onclick = function () { adj.rotate = (adj.rotate + (+b.dataset.rot) + 360) % 360; apply(); }; });
      box.querySelectorAll('[data-flip]').forEach(function (b) { b.onclick = function () { if (b.dataset.flip === 'h') adj.flipH = !adj.flipH; else adj.flipV = !adj.flipV; apply(); }; });
      return;
    }
    if (curTab === 'hsl') { renderHSL(box); return; }
    if (curTab === 'grade') { renderGrade(box); return; }
    if (curTab === 'curve') { renderCurve(box); return; }
    var keys = TAB_KEYS[curTab] || [];
    box.innerHTML = keys.map(function (k) {
      var def = SLIDERS.filter(function (s) { return s[0] === k; })[0];
      var min = def[2], max = def[3], v = adj[k];
      return '<div class="lr-row"><div class="lr-row-top"><label>' + def[1] + '</label>' +
        '<span class="lr-val" data-val="' + k + '">' + v + '</span></div>' +
        '<input type="range" class="lr-range" data-k="' + k + '" min="' + min + '" max="' + max + '" step="1" value="' + v + '"></div>';
    }).join('');
    box.querySelectorAll('.lr-range').forEach(function (r) {
      r.addEventListener('input', function () {
        adj[r.dataset.k] = +r.value;
        var vEl = box.querySelector('[data-val="' + r.dataset.k + '"]'); if (vEl) vEl.textContent = r.value;
        apply();
      });
      // double-click resets that slider
      r.addEventListener('dblclick', function () { adj[r.dataset.k] = DEFAULTS[r.dataset.k]; renderControls(); apply(); });
    });
  }

  /* ---- HSL panel: 8 bands × H/S/L ---- */
  var hslBand = 'red';
  function renderHSL(box) {
    box.innerHTML =
      '<div class="lr-bandrow">' + HSL_BANDS.map(function (b) {
        return '<button class="lr-band lr-band-' + b[0] + (hslBand === b[0] ? ' on' : '') + '" data-band="' + b[0] + '" title="' + b[1] + '"></button>';
      }).join('') + '</div>' +
      '<div class="lr-bandname" id="lrBandName"></div>' +
      ['h', 's', 'l'].map(function (k) {
        var lab = { h: 'Hue', s: 'Saturation', l: 'Luminance' }[k];
        var v = adj.hsl[hslBand][k];
        return '<div class="lr-row"><div class="lr-row-top"><label>' + lab + '</label><span class="lr-val" data-hsl="' + k + '">' + v + '</span></div>' +
          '<input type="range" class="lr-range" data-hslk="' + k + '" min="-100" max="100" step="1" value="' + v + '"></div>';
      }).join('');
    document.getElementById('lrBandName').textContent = HSL_BANDS.filter(function (b) { return b[0] === hslBand; })[0][1];
    box.querySelectorAll('[data-band]').forEach(function (b) { b.onclick = function () { hslBand = b.dataset.band; renderHSL(box); }; });
    box.querySelectorAll('[data-hslk]').forEach(function (r) {
      r.addEventListener('input', function () {
        adj.hsl[hslBand][r.dataset.hslk] = +r.value;
        var vEl = box.querySelector('[data-hsl="' + r.dataset.hslk + '"]'); if (vEl) vEl.textContent = r.value;
        apply();
      });
      r.addEventListener('dblclick', function () { adj.hsl[hslBand][r.dataset.hslk] = 0; renderHSL(box); apply(); });
    });
  }

  /* ---- Grade panel: shadows / mids / highlights color balance ---- */
  function renderGrade(box) {
    var zones = [['sh', 'Shadows'], ['mid', 'Midtones'], ['hi', 'Highlights']];
    var chans = [['r', 'Cyan', 'Red'], ['g', 'Magenta', 'Green'], ['b', 'Yellow', 'Blue']];
    box.innerHTML = zones.map(function (z) {
      return '<div class="lr-gradezone"><div class="lr-zonehd">' + z[1] + '</div>' +
        chans.map(function (ch) {
          var v = adj.grade[z[0]][ch[0]];
          return '<div class="lr-row lr-tight"><div class="lr-row-top"><label><span class="lr-cl">' + ch[1] + '</span> \u2013 <span class="lr-cr">' + ch[2] + '</span></label>' +
            '<span class="lr-val" data-gv="' + z[0] + ch[0] + '">' + v + '</span></div>' +
            '<input type="range" class="lr-range lr-grade-' + ch[0] + '" data-gz="' + z[0] + '" data-gc="' + ch[0] + '" min="-100" max="100" step="1" value="' + v + '"></div>';
        }).join('') + '</div>';
    }).join('');
    box.querySelectorAll('[data-gz]').forEach(function (r) {
      r.addEventListener('input', function () {
        adj.grade[r.dataset.gz][r.dataset.gc] = +r.value;
        var vEl = box.querySelector('[data-gv="' + r.dataset.gz + r.dataset.gc + '"]'); if (vEl) vEl.textContent = r.value;
        apply();
      });
      r.addEventListener('dblclick', function () { adj.grade[r.dataset.gz][r.dataset.gc] = 0; renderGrade(box); apply(); });
    });
  }

  /* ---- Curve panel: draggable RGB + R/G/B ---- */
  var curveChan = 'rgb';
  function renderCurve(box) {
    box.innerHTML =
      '<div class="lr-curvechans">' +
        ['rgb', 'r', 'g', 'b'].map(function (c) {
          return '<button class="lr-cc lr-cc-' + c + (curveChan === c ? ' on' : '') + '" data-cc="' + c + '">' + (c === 'rgb' ? 'RGB' : c.toUpperCase()) + '</button>';
        }).join('') +
        '<button class="vb-mini" data-curve-reset style="margin-left:auto"><i class="ti ti-rotate"></i></button>' +
      '</div>' +
      '<canvas class="lr-curve" id="lrCurve" width="248" height="248"></canvas>' +
      '<div class="lr-curvehint">Click to add a point \u00B7 drag to move \u00B7 drag off to remove</div>';
    box.querySelectorAll('[data-cc]').forEach(function (b) { b.onclick = function () { curveChan = b.dataset.cc; renderCurve(box); }; });
    box.querySelector('[data-curve-reset]').onclick = function () { adj.curves[curveChan] = freshCurve(); renderCurve(box); apply(); };
    setupCurveCanvas(document.getElementById('lrCurve'));
  }

  function setupCurveCanvas(cv) {
    var ctx = cv.getContext('2d'), W = cv.width, H = cv.height, drag = -1;
    function toCanvas(p) { return { x: (p.x / 255) * W, y: H - (p.y / 255) * H }; }
    function fromCanvas(x, y) { return { x: Math.max(0, Math.min(255, Math.round(x / W * 255))), y: Math.max(0, Math.min(255, Math.round((H - y) / H * 255))) }; }
    function pts() { return adj.curves[curveChan]; }
    function drawCurve() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#16161c'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
      for (var i = 1; i < 4; i++) { var g = i / 4; ctx.beginPath(); ctx.moveTo(g * W, 0); ctx.lineTo(g * W, H); ctx.moveTo(0, g * H); ctx.lineTo(W, g * H); ctx.stroke(); }
      var lut = buildLUT(pts());
      var col = { rgb: '#dfe', r: '#ff6b6b', g: '#5fd07a', b: '#5aa8ff' }[curveChan];
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      for (var x = 0; x <= 255; x++) { var cx = x / 255 * W, cy = H - lut[x] / 255 * H; x === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy); }
      ctx.stroke();
      pts().forEach(function (p) { var c = toCanvas(p); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, 7); ctx.fill(); ctx.strokeStyle = '#0c0c10'; ctx.lineWidth = 1.5; ctx.stroke(); });
    }
    function nearest(x, y) { var P = pts(), best = -1, bd = 14; P.forEach(function (p, i) { var c = toCanvas(p), dd = Math.hypot(c.x - x, c.y - y); if (dd < bd) { bd = dd; best = i; } }); return best; }
    function pos(e) { var rect = cv.getBoundingClientRect(), t = e.touches && e.touches[0]; var cx = (t ? t.clientX : e.clientX) - rect.left, cy = (t ? t.clientY : e.clientY) - rect.top; return { x: cx * W / rect.width, y: cy * H / rect.height }; }
    function down(e) {
      e.preventDefault(); var p = pos(e); var idx = nearest(p.x, p.y);
      if (idx < 0) { var np = fromCanvas(p.x, p.y); var P = pts(); P.push(np); P.sort(function (a, b) { return a.x - b.x; }); idx = P.indexOf(np); }
      drag = idx; drawCurve();
    }
    function move(e) {
      if (drag < 0) return; e.preventDefault(); var p = pos(e); var P = pts();
      var isEnd = (drag === 0 || drag === P.length - 1);
      // drag far below/above the box removes interior points
      if (!isEnd && (p.y < -20 || p.y > H + 20)) { P.splice(drag, 1); drag = -1; drawCurve(); apply(); return; }
      var np = fromCanvas(p.x, p.y);
      if (drag === 0) np.x = 0; else if (drag === P.length - 1) np.x = 255;
      else { var lo = P[drag - 1].x + 1, hi = P[drag + 1].x - 1; np.x = Math.max(lo, Math.min(hi, np.x)); }
      P[drag] = np; drawCurve(); apply();
    }
    function up() { drag = -1; }
    cv.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', up);
    drawCurve();
  }

  function loadFile(file) {
    if (!/^image\//.test(file.type)) { toast('Please choose an image file.'); return; }
    var url = URL.createObjectURL(file), img = new Image();
    fname = (file.name || 'edited').replace(/\.[^.]+$/, '') || 'edited';
    img.onload = function () {
      URL.revokeObjectURL(url);
      srcImg = img;
      // bake source into an offscreen canvas at native size
      srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.naturalWidth; srcCanvas.height = img.naturalHeight;
      srcCanvas.getContext('2d').drawImage(img, 0, 0);
      resetAdj();
      panel.querySelector('[data-drop]').style.display = 'none';
      viewCanvas.style.display = 'block';
      renderControls();
      apply();
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('Could not open that image.'); };
    img.src = url;
  }

  /* ---- curve LUT (monotone cubic Hermite, Fritsch–Carlson) ---- */
  function buildLUT(points) {
    var lut = new Uint8ClampedArray(256);
    var P = points.slice().sort(function (a, b) { return a.x - b.x; });
    var n = P.length;
    if (n < 2) { for (var z = 0; z < 256; z++) lut[z] = z; return lut; }
    // secant slopes
    var dx = [], dy = [], m = [];
    for (var i = 0; i < n - 1; i++) { dx[i] = P[i + 1].x - P[i].x; dy[i] = P[i + 1].y - P[i].y; m[i] = dy[i] / (dx[i] || 1); }
    var t = [m[0]];
    for (i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) t[i] = 0;
      else { var w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1]; t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]); }
    }
    t[n - 1] = m[n - 2];
    var seg = 0;
    for (var x = 0; x < 256; x++) {
      while (seg < n - 2 && x > P[seg + 1].x) seg++;
      var h = dx[seg] || 1, s = (x - P[seg].x) / h;
      var h00 = (1 + 2 * s) * (1 - s) * (1 - s), h10 = s * (1 - s) * (1 - s),
          h01 = s * s * (3 - 2 * s), h11 = s * s * (s - 1);
      var y = h00 * P[seg].y + h10 * h * t[seg] + h01 * P[seg + 1].y + h11 * h * t[seg + 1];
      lut[x] = y;
    }
    return lut;
  }
  function isIdentityCurve(p) { return p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255; }

  /* ---- RGB <-> HSL (h 0..360, s/l 0..1) ---- */
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hue2rgb(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s <= 0) { var v = l * 255; return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  }
  // smooth weight of a hue to a band center (triangular, wraps at 360)
  function bandWeight(hue, center, width) {
    var d = Math.abs(hue - center); if (d > 180) d = 360 - d;
    return d < width ? (1 - d / width) : 0;
  }

  /* ---- geometry: produce a (rotated/flipped) base canvas ---- */
  function baseCanvas() {
    var w = srcCanvas.width, h = srcCanvas.height, rot = adj.rotate % 360;
    var swap = (rot === 90 || rot === 270);
    var c = document.createElement('canvas');
    c.width = swap ? h : w; c.height = swap ? w : h;
    var ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(adj.flipH ? -1 : 1, adj.flipV ? -1 : 1);
    ctx.drawImage(srcCanvas, -w / 2, -h / 2);
    ctx.restore();
    return c;
  }

  /* ---- the pixel pass: all tonal/color math in one loop ---- */
  function processInto(targetCanvas, maxDim) {
    var base = baseCanvas();
    var scale = maxDim ? Math.min(1, maxDim / Math.max(base.width, base.height)) : 1;
    var w = Math.max(1, Math.round(base.width * scale)), h = Math.max(1, Math.round(base.height * scale));
    targetCanvas.width = w; targetCanvas.height = h;
    var ctx = targetCanvas.getContext('2d');
    ctx.drawImage(base, 0, 0, w, h);

    // merged adjustments = manual sliders + active filter preset
    var fp = FILTER_PRESETS[adj.filter] || {};
    function A(k) { return (adj[k] || 0) + (fp[k] || 0); }

    var exposure = A('exposure') / 100, contrast = A('contrast') / 100,
        highlights = A('highlights') / 100, shadows = A('shadows') / 100,
        whites = A('whites') / 100, blacks = A('blacks') / 100,
        temp = A('temp') / 100, tint = A('tint') / 100,
        saturation = A('saturation') / 100, vibrance = A('vibrance') / 100,
        clarity = A('clarity') / 100;

    var img = ctx.getImageData(0, 0, w, h), d = img.data;
    var cF = (contrast) * 0.6;                  // contrast factor
    var ctF = (259 * (cF * 255 + 255)) / (255 * (259 - cF * 255));
    var expMul = Math.pow(2, exposure);          // stops-ish
    var tempR = temp * 40, tempB = -temp * 40, tintG = tint * 30;

    // ---- tone curves: precompute LUTs once ----
    var cv = adj.curves;
    var useRGB = !isIdentityCurve(cv.rgb), useR = !isIdentityCurve(cv.r), useG = !isIdentityCurve(cv.g), useB = !isIdentityCurve(cv.b);
    var lutRGB = useRGB ? buildLUT(cv.rgb) : null, lutR = useR ? buildLUT(cv.r) : null, lutG = useG ? buildLUT(cv.g) : null, lutB = useB ? buildLUT(cv.b) : null;
    var anyCurve = useRGB || useR || useG || useB;

    // ---- color balance (shadows/mids/highlights tint) ----
    var gr = adj.grade, useGrade = false;
    ['sh', 'mid', 'hi'].forEach(function (z) { if (gr[z].r || gr[z].g || gr[z].b) useGrade = true; });

    // ---- HSL bands ----
    var hslOn = false;
    HSL_BANDS.forEach(function (bd) { var x = adj.hsl[bd[0]]; if (x.h || x.s || x.l) hslOn = true; });
    var bandC = HSL_BANDS.map(function (bd) { return bd[2]; });
    var bandKeys = HSL_BANDS.map(function (bd) { return bd[0]; });

    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];

      // exposure
      r *= expMul; g *= expMul; b *= expMul;

      // temperature / tint
      r += tempR; b += tempB; g += tintG;

      // luminance for tone-zone masks
      var L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      // highlights / shadows / whites / blacks (zone-weighted lifts)
      if (highlights) { var hw = Math.max(0, L - 0.5) * 2; var hf = 1 + highlights * hw * 0.6; r *= hf; g *= hf; b *= hf; }
      if (shadows) { var sw = Math.max(0, 0.5 - L) * 2; var sf = 1 + shadows * sw * 0.7; r *= sf; g *= sf; b *= sf; }
      if (whites) { var ww = L * L; var wf = 1 + whites * ww * 0.5; r *= wf; g *= wf; b *= wf; }
      if (blacks) { var bw = (1 - L) * (1 - L); var bf = 1 + blacks * bw * 0.5; r += blacks * 40 * bw; g += blacks * 40 * bw; b += blacks * 40 * bw; }

      // contrast around mid-grey
      if (cF) { r = ctF * (r - 128) + 128; g = ctF * (g - 128) + 128; b = ctF * (b - 128) + 128; }

      // tone curves (clamp index, master then per-channel)
      if (anyCurve) {
        var ri = r < 0 ? 0 : r > 255 ? 255 : r | 0, gi = g < 0 ? 0 : g > 255 ? 255 : g | 0, bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
        if (useRGB) { r = lutRGB[ri]; g = lutRGB[gi]; b = lutRGB[bi]; ri = r | 0; gi = g | 0; bi = b | 0; }
        if (useR) r = lutR[ri]; if (useG) g = lutG[gi]; if (useB) b = lutB[bi];
      }

      // color balance: additive tint weighted by tone zone
      if (useGrade) {
        var Lg = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        var wSh = Math.max(0, 1 - Lg * 2), wHi = Math.max(0, (Lg - 0.5) * 2), wMid = 1 - wSh - wHi; if (wMid < 0) wMid = 0;
        r += (gr.sh.r * wSh + gr.mid.r * wMid + gr.hi.r * wHi) * 0.6;
        g += (gr.sh.g * wSh + gr.mid.g * wMid + gr.hi.g * wHi) * 0.6;
        b += (gr.sh.b * wSh + gr.mid.b * wMid + gr.hi.b * wHi) * 0.6;
      }

      // HSL per-band (skip near-grey pixels for hue/sat stability)
      if (hslOn) {
        var hsl = rgb2hsl(r, g, b), hh = hsl[0], ss = hsl[1], ll = hsl[2];
        if (ss > 0.04) {
          var dH = 0, mS = 0, dL = 0, wsum = 0;
          for (var bI = 0; bI < bandC.length; bI++) {
            var wt = bandWeight(hh, bandC[bI], 50);
            if (wt) { var ad = adj.hsl[bandKeys[bI]]; dH += wt * ad.h; mS += wt * ad.s; dL += wt * ad.l; wsum += wt; }
          }
          if (wsum) {
            hh += (dH / wsum) * 0.6;                 // up to ~60° shift at full
            ss *= (1 + (mS / wsum) / 100);
            ll += (dL / wsum) / 100 * 0.5;
            ss = ss < 0 ? 0 : ss > 1 ? 1 : ss; ll = ll < 0 ? 0 : ll > 1 ? 1 : ll;
            var rgb = hsl2rgb(hh, ss, ll); r = rgb[0]; g = rgb[1]; b = rgb[2];
          }
        }
      }

      // saturation + vibrance (vibrance protects already-saturated px)
      if (saturation || vibrance) {
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var sat = mx ? (mx - mn) / mx : 0;
        var gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        var amt = saturation + vibrance * (1 - sat);
        r = gray + (r - gray) * (1 + amt);
        g = gray + (g - gray) * (1 + amt);
        b = gray + (b - gray) * (1 + amt);
      }

      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ctx.putImageData(img, 0, 0);

    // clarity / sharpen: light unsharp-mask style local contrast
    var sharpAmt = (A('sharpen') / 100) * 0.8 + clarity * 0.5;
    if (sharpAmt > 0.01) unsharp(ctx, w, h, sharpAmt);

    // vignette
    var vig = A('vignette') / 100;
    if (vig > 0.01) {
      var g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
      g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,' + (vig * 0.7).toFixed(3) + ')');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
    }
    return targetCanvas;
  }

  // simple separable-ish unsharp mask via a blurred copy
  function unsharp(ctx, w, h, amt) {
    var orig = ctx.getImageData(0, 0, w, h);
    var tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    var tctx = tmp.getContext('2d');
    tctx.putImageData(orig, 0, 0);
    // cheap blur: draw scaled down then up
    var bc = document.createElement('canvas'); bc.width = Math.max(1, w >> 1); bc.height = Math.max(1, h >> 1);
    var bctx = bc.getContext('2d'); bctx.drawImage(tmp, 0, 0, bc.width, bc.height);
    tctx.clearRect(0, 0, w, h); tctx.imageSmoothingEnabled = true; tctx.drawImage(bc, 0, 0, w, h);
    var blur = tctx.getImageData(0, 0, w, h).data, od = orig.data;
    for (var i = 0; i < od.length; i += 4) {
      od[i] += (od[i] - blur[i]) * amt;
      od[i + 1] += (od[i + 1] - blur[i + 1]) * amt;
      od[i + 2] += (od[i + 2] - blur[i + 2]) * amt;
    }
    ctx.putImageData(orig, 0, 0);
  }

  /* ---- live preview (downscaled for speed) ---- */
  var rafPending = false;
  function apply() {
    if (!srcCanvas) return;
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      processInto(viewCanvas, 1400);
      fitStage();
    });
  }
  function drawOriginal() {
    if (!srcCanvas) return;
    var base = baseCanvas();
    var scale = Math.min(1, 1400 / Math.max(base.width, base.height));
    viewCanvas.width = Math.round(base.width * scale); viewCanvas.height = Math.round(base.height * scale);
    viewCanvas.getContext('2d').drawImage(base, 0, 0, viewCanvas.width, viewCanvas.height);
    fitStage();
  }
  function fitStage() {
    var stage = panel.querySelector('[data-stage]');
    var maxW = stage.clientWidth - 32, maxH = stage.clientHeight - 32;
    var r = Math.min(maxW / viewCanvas.width, maxH / viewCanvas.height, 1);
    viewCanvas.style.width = Math.round(viewCanvas.width * r) + 'px';
    viewCanvas.style.height = Math.round(viewCanvas.height * r) + 'px';
  }

  /* ---- export at full resolution ---- */
  function download() {
    if (!srcCanvas) { toast('Open a photo first.'); return; }
    var fmt = (panel.querySelector('[data-fmt]') || {}).value || 'png';
    var out = document.createElement('canvas');
    processInto(out, null); // full res
    var mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
    var url = out.toDataURL(mime, fmt === 'jpeg' ? 0.95 : undefined);
    var a = document.createElement('a');
    a.href = url; a.download = fname + '-edited.' + (fmt === 'jpeg' ? 'jpg' : 'png');
    document.body.appendChild(a); a.click(); a.remove();
    toast('Saved ' + a.download);
  }

  function open() { build(); panel.classList.add('show'); launcher.style.display = 'none'; if (srcCanvas) { apply(); } }
  function close() { if (panel) panel.classList.remove('show'); if (launcher) launcher.style.display = ''; }
  window.addEventListener('resize', function () { if (panel && panel.classList.contains('show') && srcCanvas) fitStage(); });

  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
