/*
 * md_projects.js —— 项目：一个 md 一个项目，保存在服务端 output/.md清洗/<项目名>/
 *   文件区框头右边：📂 项目 ▾ 下拉，列出已有项目，点一下载入；
 *   文件区按钮栏：💾 保存到项目 + 自动保存。
 * 依赖本页全局：$ / show / cleanOpts / MdCleaner / katex / fixedSet / issueHeads / fileName / curHandle / edHead
 * 没有对应的服务端接口时（单机版页面）自动隐藏，什么都不做。
 */
(() => {
  const g = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let tok = '';
  async function api(url, body) {
    const r = await mdFetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }

  let cur = '', lastKey = '', autoOn = true, saving = false, listCache = [];
  const key = () => g('dst').value + '|' + [...fixedSet].sort().join(',');
  const hasContent = () => !!g('dst').value.trim();
  const dirty = () => hasContent() && key() !== lastKey;
  const stateOf = () => {
    const text = g('dst').value.replace(/\r\n/g, '\n');
    return { original: fileName || '', total: (text.match(/^### /gm) || []).length, need_review: issueHeads.length,
      fixed_count: issueHeads.filter(h => fixedSet.has(h)).length, fixed: [...fixedSet] };
  };

  (async () => {
    let first;
    try { first = await api('/api/md/projects'); } catch (_) { return; }       // 没有这套接口：隐藏功能
    listCache = first.projects;
    const t0 = Date.now();
    while (!document.querySelector('#sec-file > .zh') && Date.now() - t0 < 4000) await new Promise(r => setTimeout(r, 100));
    const head = document.querySelector('#sec-file > .zh'), bar = document.querySelector('#sec-file-in .bar') || document.querySelector('#sec-file .bar');
    if (!head || !bar) return;

    const css = document.createElement('style');
    css.textContent = `
    .pj{position:relative} .pj>button{font:inherit;font-size:13px;padding:4px 12px;border-radius:9px;border:1px solid var(--line,#dde1e8);background:var(--card,#fff);color:var(--ink,#1d2430);cursor:pointer;white-space:nowrap}
    #pjMenu{position:fixed;z-index:85;width:420px;max-width:calc(100vw - 16px);overflow:auto;background:var(--card,#fff);color:var(--ink,#1d2430);border:1px solid var(--line,#dde1e8);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:6px;display:none;cursor:default}
    #pjMenu.on{display:block} #pjMenu .t{padding:5px 10px;font-size:12px;color:var(--mute,#677084)}
    #pjMenu .it{display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:9px;cursor:pointer} #pjMenu .it:hover{background:rgba(99,102,241,.1)} #pjMenu .it.cur{background:rgba(99,102,241,.18)}
    #pjMenu .nm{font-weight:700;font-size:14px;word-break:break-all} #pjMenu .ds{font-size:12px;color:var(--mute,#677084)}
    #pjMenu .pg{margin-left:auto;font-size:11px;padding:2px 8px;border-radius:10px;background:#fee2e2;color:#991b1b;white-space:nowrap} #pjMenu .pg.ok{background:#dcfce7;color:#166534}
    #pjMenu .new{border-top:1px solid var(--line,#dde1e8);margin-top:4px;padding-top:4px}
    #pjState{font-size:12.5px;color:var(--mute,#677084)} #pjState.ok{color:#15803d} #pjState.bad{color:#b91c1c}
    `;
    document.head.appendChild(css);

    // 框头右侧的下拉
    const wrap = document.createElement('span'); wrap.className = 'pj';
    wrap.innerHTML = '<button id="pjBtn" title="已保存的项目：一个 md 一个项目">📂 项目 ▾</button><div id="pjMenu"></div>';
    wrap.onclick = e => e.stopPropagation();                  // 不要触发框头的折叠
    (head.querySelector('.zctl') || head).appendChild(wrap);
    // 编辑区 title 右侧控制栏：保存 + 自动保存 + 状态
    const ctl = document.createElement('span');
    ctl.id = 'pjSaveCtl';
    ctl.innerHTML = '<button id="pjSave" class="zbtn" disabled title="把当前的原文、清洗后的版本、核对进度保存到项目库（在线模式存入浏览器 IndexedDB，本地服务存入 output/）">💾 保存到项目</button> <label class="hint" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="pjAuto" checked style="margin:0"> 自动保存</label> <span id="pjState" title="还没有保存到项目">未保存</span>';
    ctl.onclick = e => e.stopPropagation();
    ctl.onmousedown = e => e.stopPropagation();
    // 放到“编辑区”外框 title 右侧控制区 (.zctl)；找不到才退回按钮栏
    const edZctl = document.querySelector('#zone-editor > .zh .zctl') || document.querySelector('#zone-editor > .zh');
    if (edZctl) {
      ctl.style.cssText = 'display:inline-flex;align-items:center;flex-wrap:nowrap;gap:6px 10px;font-weight:400;font-size:12.5px;white-space:nowrap';
      const sb = ctl.querySelector('#pjSave'); sb.style.cssText = 'padding:4px 10px;font-size:12.5px;white-space:nowrap';
      edZctl.appendChild(ctl);
    } else bar.appendChild(ctl);
    try { autoOn = localStorage.getItem('pj_auto') !== '0'; g('pjAuto').checked = autoOn; } catch (_) {}
    g('pjAuto').onchange = () => { autoOn = g('pjAuto').checked; try { localStorage.setItem('pj_auto', autoOn ? '1' : '0'); } catch (_) {} };

    // 卡片标题栏很窄：屏幕上只显示简短状态，完整说明放在鼠标悬停提示里
    const setState = (t, cls, short) => { const el = g('pjState'); el.title = t; el.textContent = short || (t.length > 12 ? t.slice(0, 11) + '…' : t); el.className = cls || ''; };
    const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

    async function refreshList() { try { listCache = (await api('/api/md/projects')).projects; } catch (_) {} renderMenu(); }
    function renderMenu() {
      const m = g('pjMenu');
      m.innerHTML = `<div class="t">已保存的项目（${listCache.length}）· 点一下载入</div>` + (listCache.length ? listCache.map(p => {
        const done = p.need_review != null && p.need_review === p.fixed_count;
        const pg = p.need_review == null ? '' : `<span class="pg ${done ? 'ok' : ''}">${done ? '已核对完' : '待核对 ' + (p.need_review - (p.fixed_count || 0))}</span>`;
        return `<div class="it ${p.name === cur ? 'cur' : ''}" data-n="${esc(p.name)}"><div><div class="nm">${p.name === cur ? '● ' : ''}${esc(p.name)}</div><div class="ds">${esc(p.saved_at || new Date(p.updated * 1000).toLocaleString('zh-CN', { hour12: false }))}${p.total ? ' · ' + p.total + ' 题' : ''}</div></div>${pg}</div>`;
      }).join('') : '<div class="t">还没有项目。清洗一个 md 之后点“保存到项目”。</div>') + '<div class="new it" id="pjNew">＋ 另存为新项目…</div>';
      m.querySelectorAll('.it[data-n]').forEach(el => el.onclick = () => loadProject(el.dataset.n));
      g('pjNew').onclick = () => { m.classList.remove('on'); saveProject(true); };
    }
    // 菜单从按钮左边起往右展开；固定定位，不会被文件区大框的 overflow 裁掉；右边放不下才最小幅度往左挪
    function placeMenu() {
      const m = g('pjMenu'); if (!m.classList.contains('on')) return;
      const r = g('pjBtn').getBoundingClientRect(), w = Math.min(420, innerWidth - 16);
      let left = r.left; if (left + w > innerWidth - 8) left = Math.max(8, innerWidth - 8 - w);
      const top = r.bottom + 6;
      m.style.width = w + 'px'; m.style.left = left + 'px'; m.style.top = top + 'px'; m.style.maxHeight = Math.max(160, innerHeight - top - 12) + 'px';
    }
    g('pjBtn').onclick = async () => { const m = g('pjMenu'); if (m.classList.toggle('on')) { renderMenu(); placeMenu(); refreshList().then(placeMenu); } };
    addEventListener('scroll', placeMenu, { passive: true }); addEventListener('resize', placeMenu);
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) g('pjMenu').classList.remove('on'); });

    async function saveProject(asNew, silent) {
      if (saving || !hasContent()) { if (!silent) setState('还没有清洗结果，没有可保存的内容', 'bad', '没有内容'); return; }
      let name = cur;
      if (asNew || !name) {
        const base = (fileName || '项目').replace(/\.(md|markdown|txt)$/i, '');
        name = (prompt('项目名称（一个 .md 文件对应一个项目，自动保存清洗结果与核对进度）', cur && !asNew ? cur : base) || '').trim();
        if (!name) return;
        if (listCache.some(p => p.name === name) && name !== cur && !confirm(`项目“${name}”已经存在，要覆盖它吗？`)) return;
      }
      saving = true; setState('保存中…', '', '保存中…');
      try {
        const k = key();
        const r = await api('/api/md/project/save', { name, cleaned: g('dst').value, source: g('src').value, state: stateOf() });
        cur = r.name; lastKey = k; setState(`项目“${cur}” · 已保存 ${stamp()} ✓`, 'ok', `✓ ${stamp()}`); g('pjSave').disabled = false; refreshList();
      } catch (e) { setState('保存失败：' + e.message, 'bad', '保存失败'); }
      saving = false;
    }
    g('pjSave').onclick = () => saveProject(false);

    async function loadProject(name) {
      g('pjMenu').classList.remove('on');
      if (dirty() && !confirm('当前这份有还没保存的修改，直接切换会丢掉。继续载入吗？')) return;
      try {
        const r = await api('/api/md/project/load?name=' + encodeURIComponent(name));
        const crlf = /\r\n/.test(r.cleaned), k = typeof katex !== 'undefined' ? katex : null;
        fixedSet.clear(); (r.state.fixed || []).forEach(h => fixedSet.add(h));       // 先恢复核对进度，再画“需要你看一眼”
        g('src').value = r.source || ''; fileName = r.state.original || (name + '.md'); curHandle = null;
        if (typeof window.resetEditor === 'function') window.resetEditor();
        else edHead = null;
        g('fname').textContent = `${fileName} · 来自项目“${r.name}”`;
        const again = MdCleaner.clean(r.cleaned.replace(/\r\n/g, '\n'), cleanOpts(), k);
        show(crlf ? again.result.replace(/\n/g, '\r\n') : again.result, again.report);
        if (typeof window.resetUndoHistory === 'function') window.resetUndoHistory();
        cur = r.name; lastKey = key(); g('pjSave').disabled = false;
        setState(`项目“${cur}” · 已载入（${r.state.saved_at || ''}）`, 'ok', '已载入');
        document.querySelector('#sec-fix') && document.querySelector('#sec-fix').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { setState('载入失败：' + e.message, 'bad', '载入失败'); }
    }

    // 有清洗结果就能保存；有项目名且开了自动保存，内容或核对进度变了就静默保存
    window.triggerProjectAutoSave = () => {
      g('pjSave').disabled = !hasContent();
      if (autoOn && cur && dirty() && !saving) saveProject(false, true);
    };
    setInterval(() => {
      g('pjSave').disabled = !hasContent();
      if (autoOn && cur && dirty() && !saving) saveProject(false, true);
      else if (cur && dirty() && !autoOn) setState(`项目“${cur}” · 有未保存的修改`, 'bad', '有未保存修改');
    }, 3000);
    window.addEventListener('beforeunload', e => { if (cur && dirty()) { e.preventDefault(); e.returnValue = ''; } });
    renderMenu();
  })();
})();
