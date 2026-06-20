/* ============================================================
   camera-angle.js  —  a shared "Camera angle" control for the
   video clip modes (Clip / Multi clip / Hook) and Image mode.

   Load AFTER system.js and hook-people.js (it wraps their JSON
   builders), e.g. right before mode-router.js:
       <script src="system.js"></script>
       ...
       <script src="hook-people.js"></script>
       <script src="camera-angle.js"></script>
       <script src="mode-router.js"></script>

   - Injects one "Camera angle" dropdown into the Clip card, the
     Hook card, and next to Image mode's Shot/angle field. All
     copies share a single value.
   - Folds the chosen angle into:
       vbJsonObj()    -> camera.angle           (Clip / Multi clip)
       vbHookClips()  -> each clip.camera.angle  (Hook)
       vbImgJsonObj() -> camera_angle + prompt   (Image)
   - "Default" leaves every builder untouched (no angle added).
   - Value persists in localStorage ('pb_cam_angle').
   ============================================================ */
(function () {
  var LS = 'pb_cam_angle';
  var esc = (window.PB && PB.escapeHtml) ? PB.escapeHtml : function (s) { return String(s == null ? '' : s); };

  var ANGLES = [
    'Default',
    'Eye-level',
    'Low angle',
    'High angle',
    'Overhead (top-down)',
    'Dutch angle (tilted)',
    "Bird's-eye",
    "Worm's-eye",
    'Three-quarter (45°)',
    'Over-the-shoulder'
  ];
  var PHRASE = {
    'Eye-level': 'eye-level',
    'Low angle': 'low-angle',
    'High angle': 'high-angle',
    'Overhead (top-down)': 'overhead top-down',
    'Dutch angle (tilted)': 'dutch tilted',
    "Bird's-eye": "bird's-eye",
    "Worm's-eye": "worm's-eye",
    'Three-quarter (45°)': 'three-quarter 45-degree',
    'Over-the-shoulder': 'over-the-shoulder'
  };
  function phrase(v) { return PHRASE[v] || String(v || '').toLowerCase(); }

  var ANGLE = 'Default';
  try { var s = localStorage.getItem(LS); if (s) ANGLE = s; } catch (e) {}

  /* ---- a labeled <select> field, all instances share the value ---- */
  function makeFR(idSuffix, labelText) {
    var fr = document.createElement('div');
    fr.className = 'vb-fr'; fr.style.marginTop = '8px';
    fr.innerHTML = '<label>' + esc(labelText || 'Camera angle') + '</label>' +
      '<select class="ca-angle" id="caAngle_' + idSuffix + '">' +
      ANGLES.map(function (a) { return '<option value="' + esc(a) + '"' + (a === ANGLE ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') +
      '</select>';
    fr.querySelector('select').addEventListener('change', function () { setAngle(this.value); });
    return fr;
  }

  function setAngle(v) {
    ANGLE = v || 'Default';
    try { localStorage.setItem(LS, ANGLE); } catch (e) {}
    document.querySelectorAll('.ca-angle').forEach(function (sel) { if (sel.value !== ANGLE) sel.value = ANGLE; });
    rerender();
  }

  function rerender() {
    ['vbImgUI', 'vbJsonUI', 'vbSeg', 'vbHookUI'].forEach(function (fn) {
      if (typeof window[fn] === 'function') { try { (window[fn].now || window[fn])(); } catch (e) {} }
    });
    if (typeof window.vbSaveDebounced === 'function') { try { window.vbSaveDebounced(); } catch (e) {} }
  }

  /* ---- wrap a global builder so its output carries the angle ---- */
  function wrap(name, transform) {
    if (typeof window[name] !== 'function' || window[name]._caWrapped) return;
    var orig = window[name];
    window[name] = function () {
      var out = orig.apply(this, arguments);
      try { return transform(out); } catch (e) { return out; }
    };
    window[name]._caWrapped = true;
  }

  function applyWraps() {
    // Clip / Multi clip — the per-clip video JSON
    wrap('vbJsonObj', function (obj) {
      if (ANGLE !== 'Default' && obj && obj.camera) obj.camera.angle = phrase(ANGLE);
      return obj;
    });
    // Hook — array of clip objects (hook-people.js sets window.vbHookClips)
    wrap('vbHookClips', function (arr) {
      if (ANGLE !== 'Default' && Array.isArray(arr)) {
        arr.forEach(function (c) { if (c && c.camera) c.camera.angle = phrase(ANGLE); });
      }
      return arr;
    });
    // Image — scene JSON: add a key + bake it into the prompt text
    wrap('vbImgJsonObj', function (obj) {
      if (ANGLE !== 'Default' && obj) {
        obj.camera_angle = phrase(ANGLE);
        if (obj.prompt) obj.prompt = 'Shot from a ' + phrase(ANGLE) + ' camera angle. ' + obj.prompt;
      }
      return obj;
    });
  }

  /* ---- inject the control into the three places ---- */
  function injectUI() {
    // Clip / Multi clip card
    var scriptCard = document.getElementById('scriptCard');
    if (scriptCard && !scriptCard.querySelector('.ca-angle')) scriptCard.appendChild(makeFR('clip'));

    // Hook card (one global angle for all lines; per-line framing already exists)
    var hookCard = document.getElementById('hookCard');
    if (hookCard && !hookCard.querySelector('.ca-angle')) {
      var ctrls = document.getElementById('hkPeopleCtrls');
      var fr = makeFR('hook', 'Camera angle (all lines)');
      if (ctrls && ctrls.parentNode === hookCard) hookCard.insertBefore(fr, ctrls);
      else hookCard.appendChild(fr);
    }

    // Image mode — right after the existing Shot/angle field
    var shot = document.getElementById('imgShot');
    if (shot && !document.getElementById('caAngle_img')) {
      var row = shot.closest('.vb-fr');
      var node = makeFR('img');
      if (row && row.parentNode) row.parentNode.insertBefore(node, row.nextSibling);
      else if (document.getElementById('imageCard')) document.getElementById('imageCard').appendChild(node);
    }
  }

  function init() {
    injectUI();
    applyWraps();
    rerender(); // reflect a persisted angle on load
    window.PBCamera = { get: function () { return ANGLE; }, set: setAngle, angles: ANGLES };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
