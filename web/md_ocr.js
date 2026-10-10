/*
 * md_ocr.js —— 编辑区右边的“截图 / 图片识别区”（SimpleTex 式）：
 *   图一放进来（拖入 / Ctrl+V 粘贴 / 点击选图 / 点“截图”框选屏幕）就自动识别，结果直接出现在左边源码里。
 *   标题行右边三个图标：截图、刷新（重新识别，原地重来不叠加）、清除。撤销用文本框自带的 Ctrl+Z。
 *   左边选中了一段 = 只重写这一段（并把这段原文交给模型对照）；没选中 = 插入到光标处。成功不提示，失败才提示。
 * 依赖本页全局：edHead / MdCleaner / katex。接口：POST /api/md/recognize。没有这个接口（单机版页面）时，整块自动变灰。
 */
(() => {
  const g = id => document.getElementById(id);
  const col = g('edImgCol'); if (!col) return;
  let tok = '', ok = false, data = '', busy = false;
  let last = null;      // 上一次放进源码的内容：{ from, text, orig }  —— 重新识别时在原地替换，不叠加
  const err = t => { g('edImgState').textContent = t || ''; };

  (async () => {
    try {
      const s = await fetch('/api/llm/settings'); if (!s.ok) throw 0;
      tok = (await (await fetch('/api/agent/token')).json()).token || ''; if (!tok) throw 0; ok = true;
    } catch (_) { ok = false; col.style.opacity = .55; err('不可用：请通过切题工作台服务打开本页'); }
    refresh();
  })();

  function refresh() {
    g('edImgGo').disabled = !(ok && data && !busy); g('edImgGo').classList.toggle('busy', busy);
    g('edImgClear').disabled = !data || busy; g('edImgShot').disabled = !ok || busy;
    g('edImg').classList.toggle('has', !!data);
  }
  function setImage(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const r = new FileReader();
    r.onload = async () => {
      data = await shrink(r.result); g('edImgPrev').src = data; g('edImgPrev').style.display = 'block';
      last = null; err(''); refresh();
      go();                                                       // 放进来就识别
    };
    r.readAsDataURL(file);
  }
  window.edImgSet = setImage;
  function shrink(u) {                                            // 太大的截图缩到 1800px：省流量，公式照样看得清
    return new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1800 / Math.max(im.width, im.height)); if (k === 1) return res(u);
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; im.onerror = () => res(u); im.src = u; });
  }

  // ---------------- 放入图片：点击 / 拖入 / 粘贴 ----------------
  const zone = g('edImg'), file = g('edImgFile');
  zone.onclick = () => file.click();                              // 同步弹出，不要先 await
  file.onchange = e => { setImage(e.target.files[0]); e.target.value = ''; };
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  ['dragover', 'dragenter'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', e => { e.stopPropagation(); const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type)); if (f) setImage(f); });
  // Ctrl+V：若公式快修弹窗打开则优先交给公式弹窗；焦点在编辑区里时给识别区；其它地方仍然交给悬浮的 AI 助手
  document.addEventListener('paste', e => {
    const it = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith('image/')); if (!it) return;
    const fmlMask = document.getElementById('fmlModalMask');
    if (fmlMask && fmlMask.classList.contains('on') && typeof window.fmlModalSetImage === 'function') {
      e.preventDefault(); e.stopImmediatePropagation(); window.fmlModalSetImage(it.getAsFile()); return;
    }
    if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#editor'))) return;
    e.preventDefault(); e.stopImmediatePropagation(); setImage(it.getAsFile());
  }, true);

  function clearImg() { data = ''; last = null; g('edImgPrev').removeAttribute('src'); g('edImgPrev').style.display = 'none'; err(''); refresh(); }
  g('edImgClear').onclick = clearImg;
  window.edImgClear = clearImg;
  g('edImgGo').onclick = () => go();

  // ---------------- 截图：选一个窗口 / 屏幕 → 框选区域 → 识别 ----------------
  // 备用路径：浏览器屏幕共享被环境拦掉（如 Claude 内置的浏览器窗格）时，倒计时几秒让你切到原书窗口，由本机服务抓整块屏幕，再框选
  async function serverShotToFile() {
    const tip = document.createElement('div'); tip.id = 'shotCount';
    tip.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:260;background:#111827;color:#fff;padding:10px 18px;border-radius:20px;font-size:14px;box-shadow:0 8px 28px rgba(0,0,0,.4)';
    document.body.appendChild(tip); let cancelled = false;
    const esc = e => { if (e.key === 'Escape') { cancelled = true; } }; addEventListener('keydown', esc, true);
    for (let n = 3; n > 0 && !cancelled; n--) { tip.textContent = `${n} 秒后截取整个屏幕 —— 请把原书窗口切到最前面（Esc 取消）`; await new Promise(r => setTimeout(r, 1000)); }
    removeEventListener('keydown', esc, true); tip.remove(); if (cancelled) return null;
    const r = await mdFetch('/api/md/screengrab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delay: 0 }) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status);
    const im = new Image(); await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('截图数据无法显示')); im.src = j.image; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0);
    window.focus(); const blob = await pickRegion(c);
    return blob ? new File([blob], 'shot.png', { type: 'image/png' }) : null;
  }
  async function serverShot() {
    try {
      const f = await serverShotToFile();
      if (f) setImage(f);
    } catch (e) { err('截图失败：' + e.message); }
  }
  // 默认：直接调起 Windows 自带的截图（和 Win+Shift+S 同一个）。你在屏幕上拖框，截图进剪贴板，由本机服务取回来。
  // 只有这条走不通（不是 Windows / 没有截图工具）时，才退回下面的浏览器屏幕共享。
  // 给别处复用（比如“核对”列表每行的截图按钮、公式快修弹窗右上角截图按钮）：调起系统截图并把图取回来。
  // 成功返回 File；取消/超时返回 null；系统截图不可用返回 'na'
  async function snipToFile() {
    if (!ok) return 'na';
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:260;background:#111827;color:#fff;padding:8px 10px 8px 18px;border-radius:20px;font-size:14px;box-shadow:0 8px 28px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center';
    tip.innerHTML = '<span>请在屏幕上拖动框选要识别的区域；不想截了就点右边的取消</span><button style="font:inherit;font-size:13px;padding:3px 12px;border-radius:12px;border:0;background:#374151;color:#fff;cursor:pointer">取消</button>';
    document.body.appendChild(tip);
    const ctl = new AbortController(); let cancelled = false;
    tip.querySelector('button').onclick = () => { cancelled = true; ctl.abort(); };
    try {
      const r = await mdFetch('/api/md/snip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (r.status === 408) { alert('没有等到截图，请再试一次'); return null; }
      if (!r.ok || j.ok === false) return 'na';
      const blob = await (await fetch(j.image)).blob();
      return new File([blob], 'shot.png', { type: 'image/png' });
    } catch (e) { return cancelled ? null : 'na'; }
    finally { tip.remove(); }
  }
  window.mdSnipToFile = snipToFile;

  // 通用完整桌面截图获取 File（优先系统截图 -> 退回屏幕共享框选 -> 退回服务端抓屏框选）
  async function captureScreenToFile() {
    if (!ok) return 'na';
    const f = await snipToFile();
    if (f !== 'na') {
      if (f) window.focus();
      return f;
    }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) {
      return await serverShotToFile();
    }
    let stream; const t0 = performance.now();
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
    catch (e) {
      if (e && e.name === 'NotAllowedError' && performance.now() - t0 > 300) return null;
      return await serverShotToFile();
    }
    try {
      const v = document.createElement('video'); v.srcObject = stream; v.muted = true; await Promise.race([v.play().catch(() => {}), new Promise(r => setTimeout(r, 2000))]);
      for (let i = 0; i < 30 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 50));
      if (!v.videoWidth) { stream.getTracks().forEach(t => t.stop()); throw new Error('没有拿到屏幕画面，请再点一次截图'); }
      await new Promise(r => setTimeout(r, 250));
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      stream.getTracks().forEach(t => t.stop());
      const blob = await pickRegion(c);
      return blob ? new File([blob], 'shot.png', { type: 'image/png' }) : null;
    } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
  }
  window.mdCaptureScreenFile = captureScreenToFile;

  async function systemSnip() {
    busy = true; refresh();
    try {
      const f = await snipToFile();
      if (f === 'na') return 'fallback';                       // 系统截图不可用：退回浏览器屏幕共享
      if (f) { window.focus(); setImage(f); }
      return 'done';
    } finally { busy = false; refresh(); }
  }

  g('edImgShot').onclick = async () => {
    if (await systemSnip() === 'done') return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) return serverShot();
    let stream; const t0 = performance.now();
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
    catch (e) {
      if (e && e.name === 'NotAllowedError' && performance.now() - t0 > 300) return;                 // 你自己在选窗口对话框里点了取消：不提示
      return serverShot();                                                                           // 一瞬间就被拒绝 = 环境不让用屏幕共享：走备用路径
    }
    try {
      const v = document.createElement('video'); v.srcObject = stream; v.muted = true; await Promise.race([v.play().catch(() => {}), new Promise(r => setTimeout(r, 2000))]);
      for (let i = 0; i < 30 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 50));
      if (!v.videoWidth) { stream.getTracks().forEach(t => t.stop()); err('没有拿到屏幕画面，请再点一次截图'); return; }
      await new Promise(r => setTimeout(r, 250));                                                   // 等共享提示条消失，别截进去
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      stream.getTracks().forEach(t => t.stop());
      const blob = await pickRegion(c); if (blob) setImage(new File([blob], 'shot.png', { type: 'image/png' }));
    } catch (e) { stream.getTracks().forEach(t => t.stop()); err('截图失败：' + e.message); }
  };
  function pickRegion(src) {                                                                         // 全屏遮罩里拖框选区；双击 = 整张；Esc = 取消
    return new Promise(res => {
      const mask = document.createElement('div'); mask.id = 'shotMask';
      const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; const cx = cv.getContext('2d');
      mask.appendChild(cv); mask.insertAdjacentHTML('beforeend', '<div class="tip">拖动框选要识别的区域　·　双击使用整张　·　Esc 取消</div>'); document.body.appendChild(mask);
      let sel = null, drag = null;
      const draw = () => { cx.drawImage(src, 0, 0); if (sel) { cx.fillStyle = 'rgba(15,23,42,.45)'; cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(src, sel.x, sel.y, sel.w, sel.h, sel.x, sel.y, sel.w, sel.h); cx.strokeStyle = '#6366f1'; cx.lineWidth = Math.max(2, cv.width / 600); cx.strokeRect(sel.x, sel.y, sel.w, sel.h); } };
      const pt = e => { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(cv.width, (e.clientX - r.left) * cv.width / r.width)), y: Math.max(0, Math.min(cv.height, (e.clientY - r.top) * cv.height / r.height)) }; };
      const done = blob => { removeEventListener('keydown', key, true); mask.remove(); res(blob); };
      const crop = r => { const o = document.createElement('canvas'); o.width = Math.round(r.w); o.height = Math.round(r.h); o.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, o.width, o.height); o.toBlob(b => done(b), 'image/png'); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      addEventListener('keydown', key, true);
      cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = pt(e); sel = { x: drag.x, y: drag.y, w: 0, h: 0 }; });
      cv.addEventListener('pointermove', e => { if (!drag) return; const p = pt(e); sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; draw(); });
      cv.addEventListener('pointerup', () => { if (!drag) return; drag = null; if (sel && sel.w > 8 && sel.h > 8) crop(sel); else { sel = null; draw(); } });
      cv.addEventListener('dblclick', () => crop({ x: 0, y: 0, w: cv.width, h: cv.height }));
      mask.addEventListener('pointerdown', e => { if (e.target === mask) done(null); });            // 点遮罩空白处取消
      draw();
    });
  }

  // ---------------- 识别 ----------------
  async function go() {
    if (!ok || !data || busy) return;
    if (!edHead) { err('先在上面选一题（点“转到”）'); return; }
    const ed = g('edSrc');
    // 三种情况：① 选中了一段 → 只改这一段；② 点过刷新 → 在上次的位置原地重来；③ 什么都没选 → 替换整题（保留第一行 “### 题号”）
    let a = ed.selectionStart, b = ed.selectionEnd, selText = b > a ? ed.value.slice(a, b).trim() : '', whole = false;
    if (last && ed.value.slice(last.from, last.from + last.text.length) === last.text) { a = last.from; b = last.from + last.text.length; selText = last.orig; }
    else if (!selText) { const nl = ed.value.indexOf('\n'); a = nl < 0 ? ed.value.length : nl + 1; b = ed.value.length; whole = true; }
    busy = true; err(''); refresh();
    try {
      const r = await mdFetch('/api/md/recognize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: data, context: ed.value, selection: selText }) });
      const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status);
      const out = MdCleaner.clean(j.markdown + '\n', { reorder: false, noise: false, tag: true, ids: false }, typeof katex !== 'undefined' ? katex : null).result.trim();
      if (!out) throw new Error('模型没有返回内容');
      if (typeof window.recordUndo === 'function') window.recordUndo('截图识别 ' + (edHead || ''));
      const v = ed.value, text = (whole ? '\n' : '') + out;                  // 替换整题时，标题行后面留一个空行
      ed.focus(); ed.setSelectionRange(a, b);
      if (!document.execCommand('insertText', false, text)) { ed.value = v.slice(0, a) + text + v.slice(b); ed.dispatchEvent(new Event('input')); }   // insertText 可以被 Ctrl+Z 撤销
      last = { from: a + (whole ? 1 : 0), text: out, orig: selText };
      ed.setSelectionRange(last.from, last.from + out.length);                                         // 选中刚放进去的内容，一眼看到放在哪
    } catch (e) { err('识别失败：' + e.message); }
    busy = false; refresh();
  }
  refresh();
})();
