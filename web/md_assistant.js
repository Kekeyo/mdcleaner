/*
 * md_assistant.js —— 清洗页里的悬浮 AI 助手
 * 样式、模型设置、用量沿用切题工作台里的“AI 陪伴”；这里的助手还能操作本页（跳转到某题、改题、查找、打勾……）。
 * 依赖本页的全局：$ / run / show / openEditor / blockRange / normText / setFixed / fixedSet / issueMap / lastReport / edHead /
 *               MdCleaner / katex / preview / cleanOpts
 */
(() => {
  const g = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = n => (n || 0).toLocaleString('en-US');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  // ---------------------------------------------------------------- 样式 + DOM
  const css = `
  #maiBtn{position:fixed;right:22px;bottom:80px;z-index:60;width:46px;height:46px;border-radius:50%;border:0;cursor:grab;font-size:22px;touch-action:none;
    background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;box-shadow:0 6px 18px rgba(79,70,229,.35);transition:transform .15s}
  #maiBtn:hover{transform:scale(1.1)} #maiBtn.drag{cursor:grabbing;transition:none}
  /* 面板收起后仍在工作：按钮呼吸 + 旁边显示当前步骤；做完亮红点并弹出提示 */
  #maiBtn.busy{animation:maiPulse 1.3s ease-in-out infinite}
  @keyframes maiPulse{0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,.55),0 6px 18px rgba(79,70,229,.35)}50%{box-shadow:0 0 0 12px rgba(99,102,241,0),0 6px 18px rgba(79,70,229,.35)}}
  #maiBtn .pill{position:absolute;right:56px;top:50%;transform:translateY(-50%);white-space:nowrap;font-size:12px;line-height:1;padding:7px 11px;border-radius:14px;background:#312e81;color:#fff;
    box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;display:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis}
  #maiBtn.busy .pill{display:block} body.mai-open #maiBtn .pill{display:none}
  #maiBtn .dot{position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}
  #maiBtn.unread .dot{display:block} #maiBtn.unread.err .dot{background:#f59e0b}
  #maiToast{position:fixed;z-index:90;max-width:min(340px,70vw);background:#fff;color:#1e293b;border:1px solid #c7d2fe;border-left:4px solid #6366f1;border-radius:10px;padding:9px 12px;font-size:13px;line-height:1.5;
    box-shadow:0 10px 30px rgba(0,0,0,.22);cursor:pointer;display:none} #maiToast.err{border-left-color:#ef4444} #maiToast b{display:block;margin-bottom:2px}
  #maiPanel{position:fixed;top:0;right:0;bottom:0;width:min(var(--mw,50vw),100vw);z-index:75;background:#fff;color:#1e293b;border-left:1px solid #e2e8f0;
    box-shadow:-8px 0 28px rgba(0,0,0,.12);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .2s;font-size:13px}
  body.mai-open #maiPanel{transform:none} body.mai-drag #maiPanel{transition:none} body.mai-drag{user-select:none;cursor:ew-resize}
  #maiResize{position:absolute;left:-4px;top:0;bottom:0;width:9px;cursor:ew-resize;z-index:5;touch-action:none}
  #maiResize:hover,body.mai-drag #maiResize{background:linear-gradient(90deg,transparent,rgba(99,102,241,.35),transparent)}
  #maiPanel button,#maiPanel input,#maiPanel textarea,#maiPanel select{font-family:inherit}
  #maiPanel .ch{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700}
  #maiPanel .ch .sp{flex:1}
  #maiPanel .ch button{font-size:12px;padding:3px 9px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;color:#334155}
  #maiPanel .ch .x{border:0;background:none;font-size:16px;opacity:.6}
  #maiPanel .ch #maiModel{max-width:min(200px,28vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #maiPanel .ch>span:first-child,#maiPanel .ch button{white-space:nowrap}
  #maiMsgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}
  #maiMsgs .m{max-width:94%;padding:8px 11px;border-radius:12px;line-height:1.65;word-break:break-word}
  #maiMsgs .u{align-self:flex-end;background:#4f46e5;color:#fff;border-bottom-right-radius:4px;white-space:pre-wrap}
  #maiMsgs .a{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px;white-space:pre-wrap}
  #maiMsgs .a pre{white-space:pre-wrap;background:#f1f5f9;padding:6px 8px;border-radius:6px;font-size:12px;overflow:auto}
  #maiMsgs .e{align-self:flex-start;background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
  #maiMsgs .thumbs{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px} #maiMsgs .thumbs img{max-height:90px;border-radius:6px;border:1px solid rgba(255,255,255,.4)}
  #maiMsgs .tc{align-self:stretch;font-size:12px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:4px 8px;color:#475569}
  #maiMsgs .tc.bad{border-color:#fecaca;color:#991b1b} #maiMsgs .tc summary{cursor:pointer;word-break:break-all}
  #maiMsgs .tc pre{margin:6px 0 2px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;font-size:11px;background:#f8fafc;padding:6px;border-radius:6px}
  #maiMsgs .chips{display:flex;flex-wrap:wrap;gap:6px}
  #maiMsgs .chips button{font-size:12px;padding:4px 10px;border-radius:14px;border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;cursor:pointer}
  #maiMsgs .typing{color:#64748b;font-size:12px;align-self:flex-start}
  #maiAtt{display:none;gap:6px;padding:6px 10px 0;flex-wrap:wrap;border-top:1px solid #e2e8f0} #maiAtt.on{display:flex}
  #maiAtt .th{position:relative} #maiAtt img{height:56px;border-radius:6px;border:1px solid #cbd5e1}
  #maiAtt .th b{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#334155;color:#fff;font-size:12px;line-height:18px;text-align:center;cursor:pointer}
  #maiIn{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;align-items:flex-end}
  #maiIn textarea{flex:1;resize:none;height:42px;min-height:42px!important;max-height:140px;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.4;box-sizing:border-box}
  #maiIn button{border:0;border-radius:10px;background:#4f46e5;color:#fff;padding:0 14px;height:42px;cursor:pointer}
  #maiIn button.ghost{background:#eef2ff;color:#3730a3;padding:0 10px} #maiIn button:disabled{opacity:.5;cursor:default}
  #maiDrop{display:none;position:absolute;inset:0;background:rgba(99,102,241,.12);border:3px dashed #6366f1;z-index:6;align-items:center;justify-content:center;font-size:15px;color:#3730a3;font-weight:700;pointer-events:none}
  #maiPanel.over #maiDrop{display:flex}
  #maiUse,#maiSet{display:none;flex:1;overflow:auto;padding:12px 14px}
  #maiPanel.usage #maiUse,#maiPanel.setting #maiSet{display:block}
  #maiPanel.usage #maiMsgs,#maiPanel.usage #maiIn,#maiPanel.usage #maiAtt,#maiPanel.setting #maiMsgs,#maiPanel.setting #maiIn,#maiPanel.setting #maiAtt{display:none}
  #maiUse .seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;margin-bottom:10px}
  #maiUse .seg button{border:0;background:#fff;padding:5px 14px;cursor:pointer;font-size:12px} #maiUse .seg button.on{background:#4f46e5;color:#fff}
  #maiUse .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
  #maiUse .card2{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px} #maiUse .card2 b{display:block;font-size:18px} #maiUse .card2 span{font-size:11px;color:#64748b}
  #maiUse h4{margin:14px 0 6px;font-size:12px;color:#475569}
  #maiUse table{width:100%;border-collapse:collapse;font-size:12px} #maiUse th,#maiUse td{text-align:right;padding:4px 6px;border-bottom:1px solid #f1f5f9} #maiUse th:first-child,#maiUse td:first-child{text-align:left}
  #maiUse .muted{color:#94a3b8}
  #maiSet label{display:block;margin:10px 0 4px;color:#475569;font-weight:600}
  #maiSet select,#maiSet input{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px}
  #maiSet .row{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap} #maiSet .row button{padding:6px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;cursor:pointer;white-space:nowrap}
  #maiSet .row .pri{background:#4f46e5;border-color:#4f46e5;color:#fff} #maiSet .st{font-size:12px;color:#64748b;min-height:16px;flex-basis:100%} #maiSet .st.err{color:#b91c1c} #maiSet .st.ok{color:#15803d}
  #maiModels{margin-top:8px;max-height:280px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px}
  #maiModels div{padding:7px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9} #maiModels div:hover{background:#f1f5f9} #maiModels div.sel{background:#e0e7ff;font-weight:700;color:#3730a3}
  @media (prefers-color-scheme: dark){ #maiPanel{background:#1d222a;color:#e6e9ef;border-color:#2e3541} #maiMsgs{background:#14171c} #maiMsgs .a,#maiMsgs .tc{background:#1d222a;border-color:#2e3541;color:#e6e9ef}
    #maiIn textarea,#maiSet input,#maiSet select{background:#14171c;color:#e6e9ef;border-color:#2e3541} #maiPanel .ch button{background:#14171c;color:#e6e9ef;border-color:#2e3541} #maiMsgs .a pre,#maiMsgs .tc pre{background:#14171c} }
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const root = document.createElement('div');
  root.innerHTML = `
  <button id="maiBtn" title="AI 助手：可以直接问，也能替你操作本页（可拖动位置）">🤖<span class="pill"></span><span class="dot"></span></button><div id="maiToast"></div>
  <div id="maiPanel">
    <div id="maiResize" title="拖动调整宽度，双击恢复一半宽度"></div><div id="maiDrop">松开，把截图交给助手</div>
    <div class="ch"><span>🤖 AI 助手</span><span class="sp"></span><button id="maiModel">未设置模型</button><button id="maiUseBtn" title="token 与模型用量">用量</button><button id="maiPin" title="固定：开启后，点页面其它地方不会自动收起助手">📌</button><button id="maiUndo" title="撤销助手对全文做的上一次修改" disabled>撤销</button><button id="maiClear" title="清空对话">清空</button><button class="x" id="maiClose">✕</button></div>
    <div id="maiMsgs"></div>
    <div id="maiAtt"></div>
    <div id="maiIn"><button class="ghost" id="maiPick" title="附图（也可以直接粘贴或拖入截图）">📎</button><input type="file" id="maiFile" accept="image/*" multiple hidden>
      <textarea id="maiText" placeholder="问我，或让我操作：如“带我去 10.12”“按这张截图把选中的那段重写”。Enter 发送，Shift+Enter 换行"></textarea>
      <button id="maiSend">发送</button><button id="maiStop" style="display:none;background:#b91c1c">停止</button></div>
    <div id="maiUse"></div>
    <div id="maiSet">
      <label>模型厂商</label><select id="ma-prov"></select>
      <div id="ma-keyblk"><label>API Key <span id="ma-keyhint" style="font-weight:400;color:#94a3b8"></span></label><input id="ma-key" type="password" autocomplete="off" placeholder="填写后点“获取模型”">
        <label>接口地址（一般不用改）</label><input id="ma-base" placeholder="https://…"></div>
      <div id="ma-vtxblk" style="display:none"><div class="st" id="ma-adc" style="margin-top:10px"></div>
        <label>项目 ID（Project）</label><input id="ma-proj" placeholder="GCP 项目 ID"><label>区域（Location）</label><input id="ma-loc" placeholder="global"></div>
      <div class="row"><button class="pri" id="ma-fetch">获取模型</button><span class="st" id="ma-st"></span></div>
      <label>模型（点下面的列表选择，会自动填到这里；也可以直接输入模型名）</label><input id="ma-filter" placeholder="模型名" autocomplete="off"><div id="maiModels"></div>
      <div class="row"><button class="pri" id="ma-save">保存并使用</button><button id="ma-test">测试连接</button><button id="ma-back">返回</button><span class="st" id="ma-st2"></span></div>
    </div>
  </div>`;
  document.body.appendChild(root);
  const panel = g('maiPanel'), msgs = g('maiMsgs');

  // ---------------------------------------------------------------- 悬浮按钮：可拖动，点击开关
  (() => {
    const b = g('maiBtn'); const pos = store.get('mai_btn', null);
    const place = (x, y) => { b.style.left = Math.max(4, Math.min(x, innerWidth - 50)) + 'px'; b.style.top = Math.max(4, Math.min(y, innerHeight - 50)) + 'px'; b.style.right = 'auto'; b.style.bottom = 'auto'; };
    if (pos) place(pos.x, pos.y);
    b.addEventListener('pointerdown', e => {
      const sx = e.clientX, sy = e.clientY, r = b.getBoundingClientRect(); let moved = false; b.setPointerCapture(e.pointerId);
      const mv = ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 5) { moved = true; b.classList.add('drag'); place(r.left + ev.clientX - sx, r.top + ev.clientY - sy); } };
      const up = () => { b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); b.classList.remove('drag');
        if (moved) { const q = b.getBoundingClientRect(); store.set('mai_btn', { x: q.left, y: q.top }); } else toggle(); };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up);
    });
  })();
  (() => {   // 拖左边缘调宽度（默认 50vw 一半，双击恢复一半）
    const bar = g('maiResize'); const clamp = w => Math.max(340, Math.min(w, innerWidth - 80));
    const w0 = store.get('mai_w_half', 0); if (w0) panel.style.setProperty('--mw', clamp(w0) + 'px');
    bar.addEventListener('pointerdown', e => { e.preventDefault(); bar.setPointerCapture(e.pointerId); document.body.classList.add('mai-drag');
      const mv = ev => { const w = clamp(innerWidth - ev.clientX); panel.style.setProperty('--mw', w + 'px'); store.set('mai_w_half', w); };
      const up = () => { document.body.classList.remove('mai-drag'); bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); });
    bar.addEventListener('dblclick', () => { panel.style.removeProperty('--mw'); store.set('mai_w_half', 0); });
  })();

  let ready = false, llmCfg = null;
  function toggle(on) {
    const open = on === undefined ? !document.body.classList.contains('mai-open') : on;
    document.body.classList.toggle('mai-open', open);
    if (open) { init(); loadLlm(); setTimeout(() => g('maiText').focus(), 250); }
  }
  g('maiClose').onclick = () => toggle(false);
  // 点页面上非助手的地方，就收起助手（任务继续在后台跑）。例外：助手自己、悬浮按钮、提示、☰ 导航、源码编辑区（要在那里选中文字再交给助手）。
  // 📌 固定后不自动收起。
  let pinned = store.get('mai_pin', false);
  const pinBtn = g('maiPin'); const paintPin = () => { pinBtn.style.background = pinned ? '#e0e7ff' : ''; pinBtn.style.borderColor = pinned ? '#6366f1' : ''; pinBtn.title = pinned ? '已固定：点页面其它地方不会收起助手（再点取消）' : '固定：开启后，点页面其它地方不会自动收起助手'; };
  paintPin(); pinBtn.onclick = () => { pinned = !pinned; store.set('mai_pin', pinned); paintPin(); };
  document.addEventListener('pointerdown', e => {
    if (pinned || !document.body.classList.contains('mai-open')) return;
    if (e.target.closest && e.target.closest('#maiPanel,#maiBtn,#maiToast,#navBtn,#navMenu,#topBtn,#edSrc')) return;
    toggle(false);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('mai-open') && !panel.classList.contains('setting')) toggle(false); });

  // ---------------------------------------------------------------- 令牌 / 请求
  let tok = '';
  async function api(url, body) {
    const r = await mdFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }

  // ---------------------------------------------------------------- 渲染助手回复 (Markdown 子集 + KaTeX)
  function renderText(src) {
    const tex = (s, disp) => { try { return katex.renderToString(s, { displayMode: disp, throwOnError: false, strict: 'ignore' }); } catch (_) { return esc(s); } };
    const inline = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
    const fence = src.split(/```[a-zA-Z]*\n([\s\S]*?)```/);      // 奇数下标是代码块内容
    return fence.map((part, i) => {
      if (i % 2) return '<pre>' + esc(part.replace(/\n$/, '')) + '</pre>';
      const { segs } = MdCleaner.tokenize(part);
      return segs.map(s => s.t === 'text' ? inline(s.s) : s.t === 'disp' ? '<div style="text-align:center;overflow:auto">' + tex(s.s, true) + '</div>' : tex(s.s, false)).join('');
    }).join('');
  }
  const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
  function addMsg(cls, html) { const d = document.createElement('div'); d.className = 'm ' + cls; d.innerHTML = html; msgs.appendChild(d); scroll(); return d; }
  function addTool(summary, detail, bad) {
    const d = document.createElement('details'); d.className = 'tc' + (bad ? ' bad' : '');
    d.innerHTML = `<summary>${bad ? '✗ ' : '🔧 '}${esc(summary)}</summary><pre>${esc(detail)}</pre>`; msgs.appendChild(d); scroll();
  }

  // ---------------------------------------------------------------- 页面状态 & 工具
  const snapshots = [];            // 助手改动全文前的快照，用于“撤销”
  const undoBtn = g('maiUndo');
  function snap() { if (typeof window.recordUndo === 'function') window.recordUndo('AI 助手修改'); snapshots.push(g('dst').value); if (snapshots.length > 30) snapshots.shift(); undoBtn.disabled = false; }
  undoBtn.onclick = () => {
    if (!snapshots.length) return; setDst(snapshots.pop()); undoBtn.disabled = !snapshots.length;
    addMsg('a', '已撤销上一次修改。'); refreshEditorBlock();
  };
  function setDst(text) {
    g('dst').value = text; last = text; g('dl').disabled = g('copy').disabled = g('save').disabled = false;
    if (typeof window.syncUndoBase === 'function') window.syncUndoBase();
    if (typeof window.triggerProjectAutoSave === 'function') window.triggerProjectAutoSave();
    clearTimeout(setDst.t); setDst.t = setTimeout(() => preview(last, typeof katex !== 'undefined' ? katex : null), 1200);
  }
  function refreshEditorBlock() {
    if (!edHead) return; const a = blockRange(normText(), edHead); if (!a) return;
    g('edSrc').value = normText().slice(a[0], a[1]).replace(/\n+$/, ''); edRender(); edCheck(false);
  }
  const lightClean = md => MdCleaner.clean(md + '\n', { reorder: false, noise: false, tag: true, ids: false }, typeof katex !== 'undefined' ? katex : null);
  function checkBlock(head) {
    const a = blockRange(normText(), head); if (!a) return { ok: false, problems: ['找不到这一题'] };
    const text = normText().slice(a[0], a[1]), r = lightClean(text).report;
    const probs = [...r.unbalanced, ...r.remaining.filter(x => !/^有 \d+ 行的/.test(x))].map(x => x.replace(/^### \S+?:?\s/, '')).slice(0, 4);
    const marked = /<!--\s*待核对/.test(text);
    return { ok: !probs.length && !marked, problems: probs, still_marked_for_review: marked };
  }
  function buildState() {
    const ed = g('edSrc'), sel = ed ? ed.value.slice(ed.selectionStart, ed.selectionEnd) : '';
    const issues = (window.issueMap ? [...window.issueMap.entries()] : []).slice(0, 50).map(([h, why]) => ({ head: h, fixed: fixedSet.has(h), why: why.slice(0, 2) }));
    return JSON.stringify({
      file: g('fname').innerText || '(未载入文件)', cleaned: !!last, chars: (g('dst').value || '').length,
      question_count: ((g('dst').value || '').match(/^### /gm) || []).length,
      need_review: issues.length, fixed_count: issues.filter(x => x.fixed).length, issues,
      editor: edHead ? { head: edHead, selection: sel.slice(0, 1500), text: ed.value.slice(0, 3500) } : null,
      stats: lastReport ? lastReport.fixed : null,
    });
  }
  const TOOLS = {
    goto: ({ head }) => { if (!blockRange(normText(), head)) throw new Error('找不到 ' + head + ' 题'); openEditor(head); return { ok: true, opened: head }; },
    get_question: ({ head }) => { const a = blockRange(normText(), head); if (!a) throw new Error('找不到 ' + head + ' 题'); return normText().slice(a[0], a[1]).slice(0, 5000); },
    edit_question: ({ head, markdown }) => {
      const t = normText(), a = blockRange(t, head); if (!a) throw new Error('找不到 ' + head + ' 题');
      const headLine = t.slice(a[0], t.indexOf('\n', a[0]));
      const body = lightClean(String(markdown)).result.trim();
      snap(); const crlf = /\r\n/.test(g('dst').value);
      const nt = (t.slice(0, a[0]) + headLine + '\n' + body + '\n\n' + t.slice(a[1])).replace(/\n{3,}/g, '\n\n');
      setDst(crlf ? nt.replace(/\n/g, '\r\n') : nt); refreshEditorBlock();
      const c = checkBlock(head); if (c.ok) setFixed(head, true);
      return { ok: true, edited: head, check: c };
    },
    edit_selection: ({ mode, markdown }) => {
      if (!edHead) throw new Error('编辑器里还没有打开任何题，请先 goto');
      const ed = g('edSrc'), a = ed.selectionStart, b = ed.selectionEnd, v = ed.value, out = lightClean(String(markdown)).result.trim();
      snap(); ed.value = mode === 'insert' ? v.slice(0, a) + out + v.slice(a) : v.slice(0, a) + out + v.slice(b);
      ed.dispatchEvent(new Event('input'));       // 触发：预览、检查、写回全文
      return { ok: true, mode: mode === 'insert' ? 'insert' : 'replace', head: edHead };
    },
    replace_text: ({ find, replace, head }) => {
      if (!find) throw new Error('find 不能为空');
      let t = normText(), n = 0; const rep = s => s.split(find).join(replace ?? '');
      snap(); const crlf = /\r\n/.test(g('dst').value);
      if (head) { const a = blockRange(t, head); if (!a) throw new Error('找不到 ' + head + ' 题'); const seg = t.slice(a[0], a[1]); n = seg.split(find).length - 1; t = t.slice(0, a[0]) + rep(seg) + t.slice(a[1]); }
      else { n = t.split(find).length - 1; t = rep(t); }
      if (!n) { snapshots.pop(); return { ok: true, replaced: 0, note: '没有找到这段文字' }; }
      setDst(crlf ? t.replace(/\n/g, '\r\n') : t); refreshEditorBlock(); return { ok: true, replaced: n };
    },
    search: ({ query }) => {
      const blocks = normText().split(/^(?=### )/m).filter(b => b.startsWith('### ')), hits = [];
      blocks.forEach(b => { if (b.includes(query)) hits.push(b.split('\n')[0].replace('### ', '').trim()); });
      return { count: hits.length, heads: hits.slice(0, 40) };
    },
    list_issues: () => (window.issueMap ? [...window.issueMap.entries()] : []).map(([h, why]) => ({ head: h, fixed: fixedSet.has(h), why: why.slice(0, 3) })),
    recheck: () => {
      if (!g('dst').value.trim()) throw new Error('还没有清洗结果');
      const crlf = /\r\n/.test(g('dst').value), again = MdCleaner.clean(normText(), cleanOpts(), typeof katex !== 'undefined' ? katex : null);
      show(crlf ? again.result.replace(/\n/g, '\r\n') : again.result, again.report); refreshEditorBlock();
      return { ok: true, need_review: window.issueMap ? window.issueMap.size : 0, remaining: again.report.remaining.length };
    },
    mark_fixed: ({ head, value }) => { setFixed(head, value !== false); return { ok: true, head, fixed: value !== false }; },
  };
  function parseActions(reply) {
    const acts = [], re = /```action\s*\n([\s\S]*?)```/g; let m;
    while ((m = re.exec(reply))) { try { acts.push(JSON.parse(m[1])); } catch (e) { acts.push({ name: '(无法解析)', args: {}, _err: e.message }); } }
    return acts;
  }
  const stripActions = reply => reply.replace(/```action\s*\n[\s\S]*?```/g, '').trim();

  // ---------------------------------------------------------------- 对话
  const hist = store.get('mai_hist', []);       // [{role,text}]，不存图片
  let attached = [], busy = false, abort = false;
  function renderHist() {
    msgs.innerHTML = '';
    hist.forEach(m => { if (m.role === 'user') addMsg('u', esc(m.text)); else if (m.role === 'assistant') { const t = stripActions(m.text); if (t) addMsg('a', renderText(t)); } });
    if (!hist.length) {
      addMsg('a', '你好，我是清洗页里的助手。可以直接问，也能替你操作：<br>· 看懂页面上哪些题要核对、原因是什么<br>· 带你跳到某一题，或者查找某段文字在哪几题<br>· 把<b>截图</b>（粘贴 / 拖进来 / 点 📎）里的内容转成 Markdown，替换你选中的那段或整题<br>· 修好后给题打勾，改错了可以点“撤销”');
      const c = document.createElement('div'); c.className = 'chips';
      ['还有哪些题需要核对？', '带我去第一个需要核对的题', '帮我检查当前这题有什么问题'].forEach(t => { const b = document.createElement('button'); b.textContent = t; b.onclick = () => { g('maiText').value = t; send(); }; c.appendChild(b); });
      msgs.appendChild(c);
    }
    scroll();
  }
  function init() { if (ready) return; ready = true; renderHist(); }
  function persist() { store.set('mai_hist', hist.slice(-40)); }
  g('maiClear').onclick = () => { if (busy) return; hist.length = 0; persist(); renderHist(); };

  // 附图
  function shrink(dataUrl) {
    return new Promise(res => { const im = new Image(); im.onload = () => { const m = 1800, k = Math.min(1, m / Math.max(im.width, im.height)); if (k === 1) return res(dataUrl);
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; im.onerror = () => res(dataUrl); im.src = dataUrl; });
  }
  function attach(file) {
    if (!file || !/^image\//.test(file.type)) return; if (attached.length >= 4) { alert('一次最多附 4 张图'); return; }
    const r = new FileReader(); r.onload = async () => { attached.push(await shrink(r.result)); renderAtt(); toggle(true); }; r.readAsDataURL(file);
  }
  window.assistantAttach = attach;
  function renderAtt() {
    const box = g('maiAtt'); box.className = attached.length ? 'on' : ''; box.innerHTML = '';
    attached.forEach((u, i) => { const d = document.createElement('div'); d.className = 'th'; d.innerHTML = `<img src="${u}"><b title="移除">×</b>`; d.querySelector('b').onclick = () => { attached.splice(i, 1); renderAtt(); }; box.appendChild(d); });
  }
  g('maiPick').onclick = () => g('maiFile').click();
  g('maiFile').onchange = e => { [...e.target.files].forEach(attach); e.target.value = ''; };
  document.addEventListener('paste', e => { const its = [...(e.clipboardData?.items || [])].filter(x => x.type.startsWith('image/')); if (its.length) { e.preventDefault(); its.forEach(x => attach(x.getAsFile())); } });
  ['dragover', 'dragenter'].forEach(t => panel.addEventListener(t, e => { e.preventDefault(); panel.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => panel.addEventListener(t, e => { e.preventDefault(); panel.classList.remove('over'); }));
  panel.addEventListener('drop', e => { e.stopPropagation(); [...e.dataTransfer.files].forEach(attach); });

  async function ask(extraImages) {
    const r = await api('/api/md/chat', { messages: hist.slice(-24), images: extraImages || [], state: buildState() });
    return r.reply || '';
  }
  async function send(fixText) {                                          // fixText：点“继续”时直接传文字进来
    const text = (typeof fixText === 'string' ? fixText : g('maiText').value).trim();
    if ((!text && !attached.length) || busy) return;
    if (!ready) init(); if (!llmCfg) await loadLlm();
    const imgs = attached.slice(); attached = []; renderAtt(); g('maiText').value = '';
    g('maiText').style.height = '42px';
    const shown = (text || '（见附图）') + (imgs.length ? `\n[附图 ${imgs.length} 张]` : '');
    const um = addMsg('u', esc(shown)); if (imgs.length) { const t = document.createElement('div'); t.className = 'thumbs'; imgs.forEach(u => { const i = document.createElement('img'); i.src = u; t.appendChild(i); }); um.appendChild(t); }
    hist.push({ role: 'user', text: shown }); persist();
    setBusy(true); abort = false;
    let imagesForTurn = imgs, step = 0;
    try {
      for (; step < 6 && !abort; step++) {
        setStatus(`第 ${step + 1} 步：思考中…`);
        const typing = addMsg('typing', '思考中…');
        let reply; try { reply = await ask(imagesForTurn); } finally { typing.remove(); }
        imagesForTurn = [];                                       // 图片只随第一轮发
        hist.push({ role: 'assistant', text: reply }); persist();
        const t = stripActions(reply); if (t) addMsg('a', renderText(t));
        const acts = parseActions(reply); if (!acts.length) break;
        const results = [];
        for (const a of acts) {
          setStatus(`第 ${step + 1} 步：执行 ${a.name}${a.args && a.args.head ? ' ' + a.args.head : ''}`);
          const fn = TOOLS[a.name]; let res, bad = false;
          try { if (!fn) throw new Error('没有这个操作：' + a.name); res = fn(a.args || {}); if (a._err) throw new Error(a._err); } catch (e) { res = { ok: false, error: e.message }; bad = true; }
          const s = typeof res === 'string' ? res : JSON.stringify(res);
          addTool(`${a.name} ${a.args ? JSON.stringify(a.args).slice(0, 80) : ''}`, s.slice(0, 1500), bad);
          results.push(`${a.name} → ${s.slice(0, 3000)}`);
        }
        hist.push({ role: 'tool', text: results.join('\n') }); persist();
      }
    } catch (e) { addMsg('e', '出错：' + esc(e.message)); setBusy(false); notifyDone(e.message, true); return; }
    setBusy(false);
    const lastA = [...hist].reverse().find(m => m.role === 'assistant');
    const tail = lastA ? stripActions(lastA.text).trim() : '';
    const capped = step >= 6 && !abort;                                     // 连着做满 6 步还没收尾
    const cutOff = !!tail && !/[。！？；：.!?;:)"'”’）】」』\]]$/.test(tail);   // 结尾没有句末标点，多半是说一半被截断
    if (!abort && (capped || cutOff)) showContinue();
    notifyDone(abort ? '已按你的要求停止' : (tail || '操作已完成'));
  }
  function showContinue() {                                                // 让模型接着上一条继续写
    if (msgs.querySelector('.cont')) return;
    const d = document.createElement('div'); d.className = 'm chips cont';
    const b = document.createElement('button'); b.textContent = '继续'; b.title = '让助手接着上一条继续写（说一半被截断时用）';
    b.onclick = () => { d.remove(); send('继续'); };
    d.appendChild(b); msgs.appendChild(d); scroll();
  }
  const btnEl = g('maiBtn'), pill = btnEl.querySelector('.pill'), toastEl = g('maiToast');
  const panelOpen = () => document.body.classList.contains('mai-open');
  function setBusy(b) {
    busy = b; g('maiSend').style.display = b ? 'none' : ''; g('maiStop').style.display = b ? '' : 'none';
    btnEl.classList.toggle('busy', b); if (b) { btnEl.classList.remove('unread', 'err'); pill.textContent = '助手工作中…'; }
  }
  const setStatus = t => { pill.textContent = t; btnEl.title = 'AI 助手：' + t; };       // 面板收起时，按钮旁边显示当前在做什么
  let toastT = 0;
  function notifyDone(text, isErr) {                                                   // 面板收起时做完了：亮红点 + 弹出提示，点一下打开面板
    if (panelOpen()) return;
    btnEl.classList.add('unread'); btnEl.classList.toggle('err', !!isErr);
    const r = btnEl.getBoundingClientRect();
    toastEl.className = isErr ? 'err' : ''; toastEl.innerHTML = `<b>${isErr ? '⚠ 助手出错了' : '✓ 助手做完了'}</b>${esc(text.slice(0, 90))}<div style="color:#64748b;font-size:12px;margin-top:2px">点击查看</div>`;
    toastEl.style.display = 'block'; toastEl.style.right = (innerWidth - r.left + 10) + 'px'; toastEl.style.bottom = Math.max(10, innerHeight - r.bottom) + 'px';
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.display = 'none'; }, 9000);
  }
  toastEl.onclick = () => { toastEl.style.display = 'none'; toggle(true); };
  new MutationObserver(() => { if (panelOpen()) { btnEl.classList.remove('unread', 'err'); toastEl.style.display = 'none'; } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('beforeunload', e => { if (busy) { e.preventDefault(); e.returnValue = ''; } });   // 助手还在干活时，别不小心刷新掉
  g('maiSend').onclick = () => send(); g('maiStop').onclick = () => { abort = true; };
  g('maiText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  g('maiText').addEventListener('input', () => {
    const el = g('maiText'); if (!el) return;
    el.style.height = '42px';
    if (el.scrollHeight > 42) el.style.height = Math.min(140, el.scrollHeight) + 'px';
  });

  // ---------------------------------------------------------------- 模型设置 / 用量（沿用切题工作台的接口）
  let cModels = [], cSel = '', cFilter = '', cOpen = false;
  async function loadLlm() {
    try { llmCfg = await (await fetch('/api/llm/settings')).json(); const p = llmCfg.providers[llmCfg.provider]; g('maiModel').innerText = p && p.has_key ? `${p.label} · ${llmCfg.model}` : '先设置模型'; }
    catch (_) { g('maiModel').innerText = '服务不可用'; }
  }
  g('maiModel').onclick = async () => {
    await loadLlm(); if (!llmCfg) return; panel.classList.remove('usage'); panel.classList.add('setting');
    const sel = g('ma-prov'); sel.innerHTML = Object.entries(llmCfg.providers).map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join('');
    sel.value = llmCfg.provider; cSel = llmCfg.model; cModels = []; onProv(true);
  };
  g('ma-back').onclick = () => panel.classList.remove('setting');
  g('ma-prov').onchange = () => onProv();
  function onProv(keep) {
    const id = g('ma-prov').value, p = llmCfg.providers[id];
    g('ma-keyblk').style.display = p.vertex ? 'none' : 'block'; g('ma-vtxblk').style.display = p.vertex ? 'block' : 'none';
    if (p.vertex) { const a = p.adc || {}; const el = g('ma-adc'); el.className = 'st' + (a.ok ? '' : ' err');
      el.innerText = a.ok ? `✓ 已检测到本地 ADC 凭证（${a.type || '未知类型'}，来源：${a.source}）` : '✗ 没有检测到本地 ADC 凭证。请在终端运行：gcloud auth application-default login';
      g('ma-proj').value = p.project || ''; g('ma-loc').value = p.location || 'global'; }
    g('ma-key').value = ''; g('ma-key').placeholder = p.has_key ? (p.key_from_env ? '已通过环境变量配置' : '已保存 ' + p.key_mask + '（不改就留空）') : '填写后点“获取模型”或直接保存';
    g('ma-keyhint').innerText = llmCfg.browser_mode ? '（仅保存在您当前浏览器本地，安全直连）' : (id === 'gemini' ? '（不填则沿用原来的 Vertex 方式）' : ''); g('ma-base').value = p.base_url || '';
    g('ma-st').innerText = ''; g('ma-st2').innerText = ''; if (!keep) { cSel = ''; cModels = []; } if (id !== llmCfg.provider) cSel = '';
    if (!cModels.length && Array.isArray(p.builtin_models) && p.builtin_models.length) cModels = p.builtin_models.slice();
    if (!cSel && p.default_model) cSel = p.default_model;
    cFilter = ''; cOpen = Boolean(!keep && cModels.length); g('ma-filter').value = cSel; renderModels();
  }
  const form = () => ({ provider: g('ma-prov').value, api_key: g('ma-key').value.trim(), base_url: g('ma-base').value.trim(), project: g('ma-proj').value.trim(), location: g('ma-loc').value.trim() });
  g('ma-fetch').onclick = async () => {
    const el = g('ma-st'); el.className = 'st'; el.innerText = '正在获取…';
    const r = await (await fetch('/api/llm/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form()) })).json();
    if (!r.ok) { el.className = 'st err'; el.innerText = '获取失败：' + (r.error || ''); return; }
    cModels = r.models; cOpen = true; el.innerText = `获取到 ${cModels.length} 个模型，点一下选用`; renderModels();
  };
  function renderModels() {
    const box = g('maiModels');
    if (!cOpen && cSel) { box.innerHTML = `<div class="sel" id="ma-expand">✓ ${esc(cSel)} <span style="color:#6366f1;font-weight:400">· 点这里重新选择</span></div>`; g('ma-expand').onclick = () => { cOpen = true; cFilter = ''; renderModels(); }; return; }
    const f = (cFilter || '').toLowerCase(), list = cModels.filter(m => !f || (m.id + m.name).toLowerCase().includes(f));
    box.innerHTML = list.length ? list.map(m => `<div data-id="${esc(m.id)}" class="${m.id === cSel ? 'sel' : ''}">${m.id === cSel ? '✓ ' : ''}${esc(m.id)}${m.name && m.name !== m.id ? ' <span style="color:#94a3b8;font-weight:400">· ' + esc(m.name) + '</span>' : ''}</div>`).join('')
      : `<div style="cursor:default;color:#94a3b8">${cSel ? '当前选用：' + esc(cSel) + '（点“获取模型”查看全部）' : '填好凭证，点“获取模型”'}</div>`;
    box.querySelectorAll('[data-id]').forEach(d => d.onclick = () => { cSel = d.dataset.id; cFilter = ''; cOpen = false; g('ma-filter').value = cSel; renderModels();
      const el = g('ma-st2'); el.className = 'st ok'; el.innerText = `已选中 ${cSel}，点“保存并使用”生效（可先点“测试连接”）`; });
  }
  g('ma-filter').oninput = () => { const v = g('ma-filter').value.trim(); cSel = v; cFilter = v; cOpen = true; renderModels(); };
  g('ma-test').onclick = async () => {
    const el = g('ma-st2'); el.className = 'st'; el.innerText = '正在测试连接…';
    const r = await (await fetch('/api/llm/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form(), model: cSel }) })).json();
    if (r.ok) { el.className = 'st ok'; el.innerText = `✓ 连接成功 · ${r.model} · 用时 ${r.seconds}s · 回复：${r.reply}`; } else { el.className = 'st err'; el.innerText = '✗ ' + (r.error || '连接失败'); }
  };
  g('ma-save').onclick = async () => {
    const f = form(), el = g('ma-st2'); if (!cSel) { el.className = 'st err'; el.innerText = '请先选一个模型'; return; }
    const ent = llmCfg.providers[f.provider].vertex ? { project: f.project, location: f.location } : { base_url: f.base_url }; if (f.api_key) ent.api_key = f.api_key;
    const r = await (await fetch('/api/llm/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: f.provider, model: cSel, providers: { [f.provider]: ent } }) })).json();
    if (!r.ok) { el.className = 'st err'; el.innerText = '保存失败'; return; } llmCfg = r; await loadLlm(); panel.classList.remove('setting');
  };
  let usageScope = 'all';
  async function openUsage(scope) {
    if (scope) usageScope = scope; panel.classList.remove('setting'); panel.classList.add('usage');
    const box = g('maiUse'); box.innerHTML = '<div class="muted">加载中…</div>';
    const d = await (await fetch(`/api/llm/usage?scope=${usageScope}`)).json().catch(() => ({ ok: false, error: '服务不可用' }));
    if (!d.ok) { box.innerHTML = '<div class="muted">读取失败：' + esc(d.error || '') + '</div><button id="ma-ub">返回</button>'; g('ma-ub').onclick = () => panel.classList.remove('usage'); return; }
    const t = d.totals, td = d.today, card = (v, l) => `<div class="card2"><b>${fmtN(v)}</b><span>${l}</span></div>`;
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div class="seg"><button class="${usageScope === 'all' ? 'on' : ''}" id="ma-u1">全部</button></div><button id="ma-ub" style="border:1px solid #cbd5e1;background:#f8fafc;border-radius:8px;padding:4px 12px;cursor:pointer">返回</button></div>
      <div class="cards">${card(t.total, '累计 token')}${card(t.in, '输入')}${card(t.out, '输出')}${card(t.think, '思考')}${card(t.calls, '调用次数' + (t.failed ? `（失败 ${t.failed}）` : ''))}${card(td.total, '今天 token')}</div>
      <h4>按环节</h4><table><tr><th>环节</th><th>次数</th><th>合计</th></tr>${d.by_stage.map(m => `<tr><td>${esc(m.stage)}</td><td>${m.calls}</td><td><b>${fmtN(m.total)}</b></td></tr>`).join('') || '<tr><td class="muted" colspan="3">—</td></tr>'}</table>
      <h4>按模型</h4><table><tr><th>模型</th><th>次数</th><th>合计</th></tr>${d.by_model.map(m => `<tr><td>${esc(m.model)}</td><td>${m.calls}</td><td><b>${fmtN(m.total)}</b></td></tr>`).join('') || '<tr><td class="muted" colspan="3">—</td></tr>'}</table>`;
    g('ma-ub').onclick = () => panel.classList.remove('usage');
  }
  g('maiUseBtn').onclick = () => openUsage();
})();
