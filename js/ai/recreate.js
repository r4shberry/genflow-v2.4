/* ============================================================
   recreate.js  —  "Recreate from reference" mode (split out of gemini.js)
   Load AFTER gemini.js:
       <script src="gemini.js"></script>
       <script src="recreate.js"></script>

   Depends on the small bridge gemini.js exposes as window.PBGemini:
     ensureKey(), openPanel(), addMsg(role,text),
     apiCall(contents, sysText, useSearch),
     fileToScaledB64(file), imgPart(b64,mime), stripFences(s)

   The Recreate person photo is stored in IndexedDB (PB.blobStore), not
   localStorage, so big images can't blow the synced-state budget.
   ============================================================ */
(function () {
  function G() { return window.PBGemini || null; }
  var FIELDS = (window.PB && PB.FIELDS) || { modeSelect: 'modeSelect', character: 'character' };
  var errMsg = (window.PB && PB.fmtApiError) ? PB.fmtApiError : function (e) { return 'Error: ' + (e && e.message || e); };
  var store = (window.PB && PB.blobStore) || null;

  var recImg = null, recPersonImg = null;

  function injectRecreateMode() {
    var g = G(); if (!g) return;
    var sel = document.getElementById(FIELDS.modeSelect), wrap = document.querySelector('.vb-col-left') || document.querySelector('.vb-wrap');
    if (!sel || !wrap || document.getElementById('recreateCard')) return;
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === 'recreate'; })) {
      var opt = document.createElement('option'); opt.value = 'recreate'; opt.textContent = 'Recreate'; sel.appendChild(opt);
    }
    var card = document.createElement('div');
    card.className = 'vb-card vbm m-recreate'; card.id = 'recreateCard'; card.style.display = 'none';
    card.innerHTML =
      '<div class="vb-st"><i class="ti ti-copy" style="font-size:18px"></i> Recreate from reference <span class="vb-badge">plain-text Flow prompt</span></div>' +
      '<div class="vb-fr"><label>Scene to recreate</label><button type="button" class="vb-send" id="recPick" style="width:100%"><i class="ti ti-upload"></i> Upload scene reference</button></div>' +
      '<div id="recThumbWrap" style="display:none;margin-top:8px"><img id="recThumb" alt="scene reference" style="max-width:140px;border-radius:10px;border:1px solid #333"></div>' +
      '<div class="vb-fr" style="margin-top:10px"><label>Person to feature (their reference photo)</label><button type="button" class="vb-send" id="recPersonPick" style="width:100%"><i class="ti ti-user"></i> Upload person photo</button></div>' +
      '<div id="recPersonThumbWrap" style="display:none;margin-top:8px"><img id="recPersonThumb" alt="person" style="max-width:140px;border-radius:10px;border:1px solid #333"></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="vb-mini" id="recSwap"><i class="ti ti-arrows-exchange"></i> Swap images</button><button type="button" class="vb-mini" id="recClearPerson"><i class="ti ti-x"></i> Clear person</button></div>' +
      '<div class="vb-lbl" style="margin-top:12px">Options</div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="recOntoChar" checked> No person photo? Recreate onto my locked character</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="recOverlay"> Recreate on-screen text / graphics</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="recRemoveUI" checked> Strip app / phone UI, captions, watermarks</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" id="recKeepFraming" checked> Keep original framing, pose &amp; lighting</label>' +
      '<div class="vb-grid2" style="margin-top:10px"><div class="vb-fr"><label>Aspect ratio</label><select id="recAspect"><option>9:16</option><option>16:9</option><option>1:1</option><option>4:5</option><option>3:4</option></select></div></div>' +
      '<button type="button" class="vb-send" id="recGo" style="width:100%;margin-top:12px"><i class="ti ti-wand"></i> Generate recreate prompt</button>' +
      '<div class="vb-prev" style="margin-top:12px"><div class="vb-plain" id="recOut" style="white-space:pre-wrap">Upload a scene, then generate.</div><button type="button" class="vb-mini" id="recCopy" style="margin-top:8px"><i class="ti ti-copy"></i> Copy prompt</button></div>';
    wrap.appendChild(card);

    function showScene() {
      var w = card.querySelector('#recThumbWrap');
      if (!recImg) { w.style.display = 'none'; return; }
      card.querySelector('#recThumb').src = 'data:' + recImg.mime + ';base64,' + recImg.b64;
      w.style.display = 'block';
    }
    function showPerson() {
      var w = card.querySelector('#recPersonThumbWrap');
      if (!recPersonImg) { w.style.display = 'none'; return; }
      card.querySelector('#recPersonThumb').src = 'data:' + recPersonImg.mime + ';base64,' + recPersonImg.b64;
      w.style.display = 'block';
    }

    var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none'; card.appendChild(fi);
    card.querySelector('#recPick').onclick = function () { fi.click(); };
    fi.addEventListener('change', async function () {
      if (!fi.files || !fi.files[0]) return;
      var f = fi.files[0]; fi.value = '';
      try { recImg = await g.fileToScaledB64(f); showScene(); }
      catch (e) { card.querySelector('#recOut').textContent = errMsg(e); }
    });

    var fiP = document.createElement('input'); fiP.type = 'file'; fiP.accept = 'image/*'; fiP.style.display = 'none'; card.appendChild(fiP);
    card.querySelector('#recPersonPick').onclick = function () { fiP.click(); };
    fiP.addEventListener('change', async function () {
      if (!fiP.files || !fiP.files[0]) return;
      var f = fiP.files[0]; fiP.value = '';
      try {
        recPersonImg = await g.fileToScaledB64(f);
        if (store) store.set('recreate_person', recPersonImg).catch(function () {}); // remember across reloads, off the localStorage budget
        showPerson();
      } catch (e) { card.querySelector('#recOut').textContent = errMsg(e); }
    });

    // restore remembered person photo from IndexedDB (with one-time migration from old localStorage)
    (window.PB && PB.migrateLegacyRecreatePhoto ? PB.migrateLegacyRecreatePhoto() : Promise.resolve(null))
      .then(function () { return store ? store.get('recreate_person') : null; })
      .then(function (saved) { if (saved && saved.b64) { recPersonImg = saved; showPerson(); } })
      .catch(function () {});

    card.querySelector('#recSwap').onclick = function () { var t = recImg; recImg = recPersonImg; recPersonImg = t; showScene(); showPerson(); };
    card.querySelector('#recClearPerson').onclick = function () { recPersonImg = null; if (store) store.del('recreate_person'); showPerson(); };
    card.querySelector('#recGo').onclick = recreateGo;
    card.querySelector('#recCopy').onclick = function () {
      var t = card.querySelector('#recOut').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(t);
    };

    // keep the main Send button from firing while in recreate mode
    if (typeof window.vbSend === 'function' && !window.vbSend._recWrapped) {
      var origSend = window.vbSend;
      window.vbSend = function () { if (typeof vbModes !== 'undefined' && vbModes.mode === 'recreate') return; return origSend.apply(this, arguments); };
      window.vbSend._recWrapped = true;
    }
  }

  async function recreateGo() {
    var g = G(); if (!g || !g.ensureKey()) return;
    var card = document.getElementById('recreateCard'), out = card.querySelector('#recOut');
    if (!recImg) { out.textContent = 'Upload a scene reference first.'; return; }
    out.textContent = 'Generating\u2026';
    try {
      var onto = card.querySelector('#recOntoChar').checked, overlay = card.querySelector('#recOverlay').checked,
          removeUI = card.querySelector('#recRemoveUI').checked, keep = card.querySelector('#recKeepFraming').checked,
          aspect = card.querySelector('#recAspect').value,
          charDesc = (document.getElementById(FIELDS.character) || {}).value || 'my locked reference character',
          hasPerson = !!recPersonImg;
      var lines = [];
      if (hasPerson) {
        lines.push('You are given TWO images. The FIRST image is the SCENE to recreate. The SECOND image is the PERSON who must appear in it.');
        lines.push('Write a SINGLE plain-text prompt for Google Flow / Veo that recreates the FIRST image as a video shot, but featuring the PERSON from the SECOND image instead of whoever appears in the first.');
        lines.push('Describe the person from the second image in detail (age, gender, ethnicity cues, face, hair, facial hair, skin, build, distinctive features) so their identity is preserved, and state that their likeness is locked to the provided person reference.');
      } else {
        lines.push('Analyze the attached reference image and write a SINGLE plain-text prompt for Google Flow / Veo that recreates it as a video shot.');
        if (onto) lines.push('The subject must be MY character, identity locked to my uploaded reference: ' + charDesc + '. Replace the person in the reference with my character while keeping the scene.');
        else lines.push('Recreate the subject as shown in the reference.');
      }
      lines.push('Describe the setting, wardrobe, pose, action, composition, camera angle/shot and lighting from the scene reference faithfully.');
      if (keep) lines.push('Match the original framing, pose and lighting closely.');
      if (overlay) lines.push('Recreate any on-screen text or graphic overlays visible in the scene reference, faithfully.');
      else lines.push('Do not add any on-screen text, captions or graphic overlays.');
      if (removeUI) lines.push('The scene reference may be a screenshot: ignore and EXCLUDE all app/phone UI, buttons, status bars, platform captions, watermarks and interface chrome. Recreate only the real photographed scene.');
      lines.push('Aspect ratio: ' + aspect + '. Photoreal, single continuous shot, no cuts. Output ONLY the prompt text - no preamble, no JSON, no markdown.');

      var parts = [g.imgPart(recImg.b64, recImg.mime)];
      if (hasPerson) parts.push(g.imgPart(recPersonImg.b64, recPersonImg.mime));
      parts.push({ text: lines.join('\n') });

      var txt = await g.apiCall([{ role: 'user', parts: parts }],
        'You write concise, vivid plain-text prompts for Google Flow / Veo video generation. Output only the prompt text.');
      out.textContent = g.stripFences(txt).trim() || '(no prompt returned)';
    } catch (e) { out.textContent = errMsg(e); }
  }

  function init() {
    if (!G()) { return; } // gemini.js not present/disabled
    injectRecreateMode();
    if (typeof vbSetMode === 'function' && document.getElementById(FIELDS.modeSelect)) {
      vbSetMode(document.getElementById(FIELDS.modeSelect).value || 'script');
    }
  }
  // gemini.js builds its panel on DOMContentLoaded; run just after.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
