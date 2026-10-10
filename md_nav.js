/*
 * md_nav.js —— 清洗页右下角的 ☰ 导航：把页面分成几个“区”，一点直达，并显示各区状态。
 * 区靠元素 id 识别：sec-file / sec-md / sec-fix / sec-render / editor（不存在的区自动跳过）。
 */
(() => {
  const g = id => document.getElementById(id);
  const ALL = [
    { id: 'sec-file', name: '文件区', icon: '📁' },
    { id: 'sec-fix', name: '修复统计', icon: '🛠',
      badge: () => {
        if (typeof lastReport === 'undefined' || !lastReport) return '';
        const nFix = Object.values(lastReport.fixed || {}).reduce((a, b) => a + b, 0);
        const nRem = (lastReport.removed || []).length;
        if (!nFix && !nRem) return { t: '无修复项', ok: true };
        const parts = [];
        if (nFix) parts.push(nFix + ' 项修复');
        if (nRem) parts.push(nRem + ' 处草稿');
        return { t: parts.join(' · '), ok: true };
      }
    },
    { id: 'sec-render', name: '渲染区', icon: '👁',
      badge: () => {
        if (typeof window.getBadFormulaHeads === 'function' && typeof lastReport !== 'undefined' && lastReport) {
          const n = window.getBadFormulaHeads().length;
          return n ? { t: n + ' 题有错' } : { t: '无错误', ok: true };
        }
        const s = g('pstatus') && g('pstatus').innerText;
        const m = /(\d+) 题有公式错误/.exec(s || '');
        return m ? (+m[1] ? { t: m[1] + ' 题有错' } : { t: '无错误', ok: true }) : (s && /渲染|滚动/.test(s) ? { t: '渲染中…' } : '');
      }
    },
    { id: 'editor', name: '编辑区', icon: '✏️',
      badge: () => { if (typeof edHead !== 'undefined' && edHead) return { t: '正在改 ' + edHead };
        const m = window.issueMap; if (!m || !m.size) return (typeof lastReport !== 'undefined' && lastReport) ? { t: '无待核对', ok: true } : '';
        const left = [...m.keys()].filter(h => typeof fixedSet === 'undefined' || !fixedSet.has(h)).length;
        return left ? { t: left + ' 题待核对' } : { t: '全部已核对', ok: true }; } },
    { id: 'sec-md', name: 'MD 区', icon: '📝' },
  ];
  const present = ALL.filter(s => g(s.id));
  if (!present.length) return;

  // ---------------- 大框：每个区用一个可折叠的框包起来 ----------------
  const zcss = `
  .zone{border:2px solid var(--line,#dde1e8);border-radius:16px;margin:18px 0;background:rgba(99,102,241,.03);overflow:hidden}
  .zone>.zh{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none;background:rgba(99,102,241,.08);font-size:15px}
  .zone>.zh:hover{background:rgba(99,102,241,.14)}
  .zone>.zh .ar{display:inline-block;transition:transform .18s;font-size:13px;width:16px;text-align:center;color:var(--mute,#677084)}
  .zone.collapsed>.zh .ar{transform:rotate(-90deg)}
  .zone>.zh .zt{font-weight:700} .zone>.zh .zd{color:var(--mute,#677084);font-size:12.5px}
  .zone>.zh .zb{margin-left:auto;font-size:11.5px;padding:2px 9px;border-radius:10px;background:#fee2e2;color:#991b1b;white-space:nowrap}
  .zone>.zh .zb.ok{background:#dcfce7;color:#166534} .zone>.zh .zb:empty{display:none}
  .zone>.zb2{padding:12px} .zone>.zb2>.card:last-child,.zone>.zb2>.grid:last-child{margin-bottom:0}
  .zone.collapsed>.zb2{display:none}
  /* 框头右侧的控件区（徽标后面）：徽标为空时，控件自己靠右 */
  .zone>.zh .zctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .zone>.zh .zb+.zctl{margin-left:8px} .zone>.zh .zb:empty+.zctl{margin-left:auto}
  .zbtn{position:relative;font:inherit;font-size:13px;padding:4px 12px;border-radius:9px;border:1px solid var(--line,#dde1e8);background:var(--card,#fff);color:var(--ink,#1d2430);cursor:pointer;white-space:nowrap}
  .zbtn:hover{border-color:#6366f1} .zbtn .od{display:none;position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#f59e0b;border:2px solid var(--card,#fff)} .zbtn.mod .od{display:block}
  #optMenu{position:fixed;z-index:85;width:340px;max-width:calc(100vw - 16px);overflow:auto;background:var(--card,#fff);color:var(--ink,#1d2430);border:1px solid var(--line,#dde1e8);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:10px 12px;display:none;cursor:default}
  #optMenu.on{display:block} #optMenu .t{font-size:12px;color:var(--mute,#677084);margin-bottom:6px}
  #optMenu .opts{display:flex;flex-direction:column;gap:9px;margin:0;font-size:14px} #optMenu .opts label{display:flex;align-items:flex-start;gap:8px;cursor:pointer;line-height:1.45} #optMenu .opts input{margin-top:3px}
  #optMenu .hs{font-size:12px;color:var(--mute,#677084);margin-top:8px;border-top:1px solid var(--line,#dde1e8);padding-top:6px}
  /* 渲染区专用的题号搜索/放大镜跳转框（置于最右侧，与文件区“选项”“项目”同款样式，宽度对齐两者总和） */
  .z-search{position:relative;display:inline-flex;align-items:center;gap:4px;background:var(--card,#fff);border:1px solid var(--line,#dde1e8);border-radius:9px;padding:3px 7px 3px 9px;font:inherit;font-size:13px;color:var(--ink,#1d2430);cursor:default;user-select:none;transition:border-color .15s,box-shadow .15s;box-sizing:border-box;width:180px;height:29px}
  .z-search:hover,.z-search:focus-within{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,.12)}
  .z-search.shake{animation:zSearchShake .35s ease;border-color:#ef4444!important}
  @keyframes zSearchShake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
  .z-search .z-search-ic{display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:#6366f1;cursor:pointer;line-height:1;transition:transform .15s;flex:none}
  .z-search .z-search-ic:hover{transform:scale(1.15)}
  .z-search .z-search-in{border:none;outline:none;background:transparent;font-family:inherit;font-size:12.5px;color:var(--ink,#1d2430);flex:1;min-width:0;padding:0}
  .z-search .z-search-in::placeholder{color:var(--mute,#94a3b8);font-size:12px}
  .z-search .z-search-clear{display:none;border:none;background:#f1f5f9;color:#64748b;border-radius:50%;width:15px;height:15px;font-size:11px;line-height:1;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none;transition:background .15s}
  .z-search .z-search-clear:hover{background:#e2e8f0;color:#1e293b}
  .z-search.has-val .z-search-clear{display:inline-flex}
  .z-search .z-search-go{border:none;background:#e0e7ff;color:#4338ca;border-radius:6px;padding:1px 6px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1.2;flex:none;transition:background .15s,color .15s}
  .z-search .z-search-go:hover{background:#6366f1;color:#fff}
  .z-search-drop{position:absolute;top:calc(100% + 5px);right:0;width:280px;max-height:280px;overflow-y:auto;background:var(--card,#fff);border:1px solid var(--line,#dde1e8);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.18);z-index:100;padding:4px;display:none;flex-direction:column;gap:2px}
  .z-search-drop.on{display:flex}
  .z-search-item{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:6px;font-size:12.5px;color:var(--ink,#1d2430);cursor:pointer;transition:background .12s}
  .z-search-item:hover,.z-search-item.active{background:rgba(99,102,241,.1);color:#4338ca;font-weight:600}
  .z-search-item .q-tag{font-size:11px;color:var(--mute,#94a3b8)}
  .z-search-item.bad .q-tag{color:#dc2626;font-weight:600}
  .z-search-tip{padding:8px 10px;font-size:12px;color:var(--mute,#94a3b8);text-align:center}

  /* 渲染区放大镜右侧的删除按钮 (×) 与选模块删除下拉菜单 */
  .z-del-wrap{position:relative;display:inline-flex;align-items:center}
  .z-del-btn{width:29px;height:29px;padding:0;border-radius:8px;border:1px solid var(--line,#dde1e8);background:var(--card,#fff);color:#64748b;font-size:17px;line-height:1;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .15s;box-sizing:border-box}
  .z-del-btn:hover,.z-del-btn.active{border-color:#ef4444;background:#fee2e2;color:#dc2626}
  .z-del-btn.has-dup{border-color:#f59e0b;color:#b45309;background:#fef3c7}
  .z-del-menu{position:absolute;top:calc(100% + 5px);right:0;width:320px;max-height:380px;overflow-y:auto;background:var(--card,#fff);border:1px solid var(--line,#dde1e8);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.2);z-index:110;padding:8px;display:none;flex-direction:column;gap:6px;cursor:default}
  .z-del-menu.on{display:flex}
  .z-del-menu-title{font-size:12px;font-weight:700;color:var(--ink,#1e293b);padding:2px 4px 6px;border-bottom:1px solid var(--line,#e2e8f0);display:flex;justify-content:space-between;align-items:center}
  .z-del-alert{background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 8px;font-size:12px;color:#991b1b;display:flex;flex-direction:column;gap:4px}
  .z-del-alert-btn{align-self:flex-end;border:none;background:#ef4444;color:#fff;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600;cursor:pointer}
  .z-del-alert-btn:hover{background:#dc2626}
  .z-del-filter{border:1px solid var(--line,#dde1e8);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;background:var(--bg,#f8fafc);color:var(--ink,#1e293b)}
  .z-del-filter:focus{border-color:#6366f1;background:#fff}
  .z-del-list{display:flex;flex-direction:column;gap:3px;max-height:220px;overflow-y:auto}
  .z-del-item{display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border-radius:6px;font-size:12px;color:var(--ink,#1e293b);background:#f8fafc;transition:background .12s}
  .z-del-item:hover{background:#f1f5f9}
  .z-del-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px}
  .z-del-item-btn{border:none;background:#fee2e2;color:#dc2626;border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;flex:none;transition:all .12s}
  .z-del-item-btn:hover{background:#dc2626;color:#fff}
  /* 文件区右上角文件信息展示 (#fname)：置于“⚙ 选项 ▾”左侧 */
  .zone>.zh #fname{font-size:12.5px;color:var(--mute,#677084);max-width:min(460px,36vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text;cursor:default;line-height:1.4}
  .zone>.zh #fname:empty{display:none}
  `;
  const zst = document.createElement('style'); zst.textContent = zcss; document.head.appendChild(zst);
  const zones = new Map();      // 区 id -> 外框元素
  const secs = present.map(s => {
    const el = g(s.id), z = document.createElement('section'), zid = s.id === 'editor' ? 'zone-editor' : s.id;
    z.className = 'zone'; if (s.id !== 'editor') el.id = s.id + '-in';
    z.id = zid;
    z.innerHTML = `<div class="zh" title="点击折叠 / 展开"><span class="ar">▾</span><span class="zt">${s.icon} ${s.name}</span><span class="zb"></span><span class="zctl"></span></div><div class="zb2"></div>`;
    el.parentNode.insertBefore(z, el); z.querySelector('.zb2').appendChild(el);
    let col = false; try { col = localStorage.getItem('mdz_' + zid) === '1'; } catch (_) {}
    z.classList.toggle('collapsed', col);
    z.querySelector('.zh').onclick = () => setZone(zid, z.classList.contains('collapsed'));
    zones.set(zid, z); return { ...s, id: zid };
  });
  function syncAllCollapsedState() {
    const allCol = secs.length > 0 && secs.every(s => {
      const z = zones.get(s.id);
      return z && z.classList.contains('collapsed');
    });
    document.body.classList.toggle('all-zones-collapsed', allCol);
    document.documentElement.classList.toggle('all-zones-collapsed', allCol);
    const navMenuEl = g('navMenu');
    if (navMenuEl && navMenuEl.classList.contains('on') && typeof build === 'function') {
      build();
    }
  }
  function setZone(zid, open) {
    const z = zones.get(zid); if (!z) return; z.classList.toggle('collapsed', !open);
    try { localStorage.setItem('mdz_' + zid, open ? '0' : '1'); } catch (_) {}
    syncAllCollapsedState();
  }
  window.openZone = zid => setZone(zid, true);
  syncAllCollapsedState();

  // ---------------- 文件区：清洗选项收进框头右上角的“⚙ 选项 ▾”下拉 ----------------
  (() => {
    const fz = zones.get('sec-file'), opts = fz && fz.querySelector('.opts'), ctl = fz && fz.querySelector('.zctl'); if (!opts || !ctl) return;
    const DEF = { oReorder: true, oNoise: true, oIds: false, oTag: true };
    const boxes = Object.keys(DEF).map(id => g(id)).filter(Boolean);
    const LABEL = { oReorder: '重排颠倒的小问', oNoise: '删除模型草稿', oIds: '题号标题加唯一 ID', oTag: '\\tag 改写' };
    boxes.forEach(b => { try { const v = localStorage.getItem('mdopt_' + b.id); if (v !== null) b.checked = v === '1'; } catch (_) {} });      // 恢复上次的选择
    const wrap = document.createElement('span'); wrap.style.position = 'relative';
    wrap.innerHTML = '<button class="zbtn" id="optBtn" title="清洗选项">⚙ 选项 ▾<span class="od"></span></button>';
    const menu = document.createElement('div'); menu.id = 'optMenu';
    menu.innerHTML = '<div class="t">清洗选项（改完再点“清洗”生效，会记住）</div>';
    menu.appendChild(opts); menu.insertAdjacentHTML('beforeend', '<div class="hs" id="optHint"></div>');
    wrap.onclick = e => e.stopPropagation();

    // 将文件信息提示 (#fname) 挂载到折叠栏右侧控制区，“选项”按钮左边
    const fn = g('fname');
    if (fn) {
      fn.onclick = e => e.stopPropagation();
      const syncTitle = () => { if (fn.textContent) fn.title = fn.textContent.trim(); };
      syncTitle();
      new MutationObserver(syncTitle).observe(fn, { childList: true, characterData: true, subtree: true });
      ctl.appendChild(fn);
    }

    ctl.appendChild(wrap); document.body.appendChild(menu);
    const refresh = () => {
      const mod = boxes.filter(b => b.checked !== DEF[b.id]); g('optBtn').classList.toggle('mod', mod.length > 0);
      g('optHint').textContent = mod.length ? '与默认不同：' + mod.map(b => LABEL[b.id] + (b.checked ? '（开）' : '（关）')).join('、') : '全部是默认设置';
      g('optBtn').title = '清洗选项：' + g('optHint').textContent;
    };
    boxes.forEach(b => b.addEventListener('change', () => { try { localStorage.setItem('mdopt_' + b.id, b.checked ? '1' : '0'); } catch (_) {} refresh(); }));
    const place = () => { if (!menu.classList.contains('on')) return; const r = g('optBtn').getBoundingClientRect(), w = Math.min(340, innerWidth - 16);
      let left = r.left; if (left + w > innerWidth - 8) left = Math.max(8, innerWidth - 8 - w); const top = r.bottom + 6;
      menu.style.width = w + 'px'; menu.style.left = left + 'px'; menu.style.top = top + 'px'; menu.style.maxHeight = Math.max(160, innerHeight - top - 12) + 'px'; };
    g('optBtn').onclick = () => { menu.classList.toggle('on'); place(); };
    document.addEventListener('click', e => { if (menu.classList.contains('on') && !menu.contains(e.target) && !wrap.contains(e.target)) menu.classList.remove('on'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.classList.remove('on'); });
    addEventListener('scroll', place, { passive: true }); addEventListener('resize', place); refresh();
  })();

  // ---------------- 通用折叠栏题号搜索跳转组件（挂载在 .zh 的 .zctl 内） ----------------
  function mountHeadingSearch({ zoneId, searchId, placeholder, title, getHeads, jump, hotkey }) {
    const z = zones.get(zoneId); if (!z) return;
    const zh = z.querySelector('.zh'); if (!zh) return;

    const wrap = document.createElement('div');
    wrap.className = 'z-search';
    wrap.id = searchId;
    wrap.title = title;
    wrap.innerHTML = `
      <span class="z-search-ic" title="点击跳转 (Enter)">🔍</span>
      <input class="z-search-in" type="text" placeholder="${placeholder}" autocomplete="off" spellcheck="false" />
      <button class="z-search-clear" title="清空">×</button>
      <button class="z-search-go" title="跳转 (Enter)">↵</button>
      <div class="z-search-drop"></div>
    `;

    // 挂载到折叠栏最右侧控件区（与上方文件区的“选项”“项目”对齐）
    const ctl = zh.querySelector('.zctl') || zh;
    ctl.appendChild(wrap);

    // 核心防冒泡：点击搜索组件任何区域都不触发折叠
    wrap.onclick = e => e.stopPropagation();
    wrap.onmousedown = e => e.stopPropagation();

    const input = wrap.querySelector('.z-search-in');
    const clearBtn = wrap.querySelector('.z-search-clear');
    const goBtn = wrap.querySelector('.z-search-go');
    const icBtn = wrap.querySelector('.z-search-ic');
    const drop = wrap.querySelector('.z-search-drop');

    let activeIdx = -1;
    let curMatches = [];

    const doJump = (val) => {
      const q = (val !== undefined ? val : input.value).trim();
      if (!q) {
        shake('请输入题号');
        return;
      }
      if (typeof jump !== 'function') {
        shake('页面尚未就绪');
        return;
      }
      const res = jump(q);
      if (res && res.ok) {
        input.value = res.head;
        wrap.classList.add('has-val');
        closeDrop();
        setTimeout(() => { try { input.select(); } catch (_) {} }, 50);
      } else {
        shake((res && res.msg) || '未找到题号');
      }
    };

    const shake = (msg) => {
      wrap.classList.add('shake');
      const origPh = input.placeholder;
      input.placeholder = msg || '未找到该题号';
      setTimeout(() => {
        wrap.classList.remove('shake');
        input.placeholder = origPh;
      }, 900);
    };

    const closeDrop = () => {
      drop.classList.remove('on');
      drop.innerHTML = '';
      activeIdx = -1;
      curMatches = [];
    };

    const renderDrop = () => {
      const raw = input.value.trim().replace(/^#{1,6}\s*/, '').trim();
      const all = (typeof getHeads === 'function' ? getHeads() : []);
      if (!all.length) {
        drop.innerHTML = '<div class="z-search-tip">尚未载入内容或没有题目</div>';
        drop.classList.add('on');
        return;
      }

      if (!raw) {
        // 如果为空，展示前 15 道题作为快捷入口
        curMatches = all.slice(0, 15);
        drop.innerHTML = '<div class="z-search-tip" style="padding:4px 8px;font-size:11px;border-bottom:1px solid var(--line,#dde1e8);margin-bottom:2px">快速跳到题目 (共 ' + all.length + ' 题)</div>' +
          curMatches.map((item, idx) => `
            <div class="z-search-item ${item.bad ? 'bad' : ''}" data-idx="${idx}">
              <span>${item.isSub ? '📌' : '📑'} ${item.label || item.head}</span>
              <span class="q-tag">${item.bad ? '有公式错误' : (item.section || '')}</span>
            </div>
          `).join('');
        drop.classList.add('on');
        return;
      }

      const qClean = raw.replace(/^第\s*/, '').replace(/^习题\s*/i, '').replace(/\s*题$/, '').trim();
      const qNumMatch = raw.match(/(?:习题)?\s*(\d+(?:\.\d+)?|\d+)/i);
      const qNum = qNumMatch ? qNumMatch[1] : qClean;

      const qLow = raw.toLowerCase();
      const qCleanLow = qClean.toLowerCase();
      const norm = s => s.replace(/[\s\-_()（）[\]【】]/g, '').toLowerCase();
      const qNorm = norm(raw);
      const qCleanNorm = norm(qClean);

      // 分级排序：纯题号精确匹配优先
      const exact = [];
      const prefix = [];
      const contains = [];

      all.forEach(item => {
        const hLow = item.head.toLowerCase();
        const qnLow = (item.qNo || '').toLowerCase();
        const hNorm = norm(item.head);
        const qnNorm = norm(item.qNo || '');

        const isExact = (qnLow && (qnLow === qLow || qnLow === qCleanLow || qnLow === qNum)) ||
                        hLow === qLow || hLow === qCleanLow ||
                        (qnNorm && (qnNorm === qNorm || qnNorm === qCleanNorm)) ||
                        hNorm === qNorm || hNorm === qCleanNorm;

        const isPrefix = !isExact && ((qnLow && (qnLow.startsWith(qLow) || qnLow.startsWith(qCleanLow) || (qNum && qnLow.startsWith(qNum)))) ||
                                      hLow.startsWith(qLow) || hLow.startsWith(qCleanLow) ||
                                      (qnNorm && (qnNorm.startsWith(qNorm) || qnNorm.startsWith(qCleanNorm))) ||
                                      hNorm.startsWith(qNorm) || hNorm.startsWith(qCleanNorm));

        const isContains = !isExact && !isPrefix && (hLow.includes(qLow) || hLow.includes(qCleanLow) || hNorm.includes(qNorm) || hNorm.includes(qCleanNorm));

        if (isExact) exact.push(item);
        else if (isPrefix) prefix.push(item);
        else if (isContains) contains.push(item);
      });

      curMatches = [...exact, ...prefix, ...contains].slice(0, 20);

      if (!curMatches.length) {
        drop.innerHTML = `<div class="z-search-tip">无匹配题号 “${raw}”</div>`;
      } else {
        drop.innerHTML = curMatches.map((item, idx) => `
          <div class="z-search-item ${item.bad ? 'bad' : ''} ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
            <span>${item.isSub ? '📌' : '📑'} ${item.label || item.head}</span>
            <span class="q-tag">${item.bad ? '有公式错误' : (item.section || '')}</span>
          </div>
        `).join('');
        activeIdx = 0;
      }
      drop.classList.add('on');
    };

    input.addEventListener('focus', () => {
      if (typeof window.openZone === 'function') window.openZone(zoneId);
      renderDrop();
      setTimeout(() => input.select(), 0);
    });

    input.addEventListener('input', () => {
      wrap.classList.toggle('has-val', !!input.value);
      renderDrop();
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0 && curMatches[activeIdx]) {
          doJump(curMatches[activeIdx].head);
        } else {
          doJump();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!curMatches.length) return;
        activeIdx = (activeIdx + 1) % curMatches.length;
        updateActiveItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!curMatches.length) return;
        activeIdx = (activeIdx - 1 + curMatches.length) % curMatches.length;
        updateActiveItem();
      } else if (e.key === 'Escape') {
        closeDrop();
        input.blur();
      }
    });

    const updateActiveItem = () => {
      const items = drop.querySelectorAll('.z-search-item');
      items.forEach((it, idx) => {
        const isAct = idx === activeIdx;
        it.classList.toggle('active', isAct);
        if (isAct) it.scrollIntoView({ block: 'nearest' });
      });
    };

    drop.addEventListener('click', e => {
      const it = e.target.closest('.z-search-item');
      if (!it) return;
      const idx = +it.dataset.idx;
      if (curMatches[idx]) {
        doJump(curMatches[idx].head);
      }
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      wrap.classList.remove('has-val');
      input.focus();
      renderDrop();
    });

    goBtn.addEventListener('click', () => doJump());
    icBtn.addEventListener('click', () => {
      if (!input.value.trim()) input.focus();
      else doJump();
    });

    if (hotkey) {
      document.addEventListener('keydown', e => {
        if (e.altKey && e.key.toLowerCase() === hotkey.toLowerCase()) {
          e.preventDefault();
          if (typeof window.openZone === 'function') window.openZone(zoneId);
          input.focus();
          input.select();
        }
      });
    }

    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) closeDrop();
    });
  }

  // 1. 渲染区：题号搜索跳转
  mountHeadingSearch({
    zoneId: 'sec-render',
    searchId: 'zRenderSearch',
    placeholder: '跳到题号 (如 11.60)',
    title: '输入题号并回车，直达渲染题目（例如 11.60）',
    getHeads: () => (window.getPreviewQuestionHeads ? window.getPreviewQuestionHeads() : []),
    jump: q => (window.jumpToPreviewHead ? window.jumpToPreviewHead(q) : { ok: false, msg: '页面尚未就绪' }),
    hotkey: 'g'
  });

  // 渲染区放大镜右侧的删除功能（× 按钮 + 下拉菜单选模块删除 / 一键清理重复题目）
  function mountRenderDeleteButton({ zoneId, searchId }) {
    const z = zones.get(zoneId); if (!z) return;
    const zh = z.querySelector('.zh'); if (!zh) return;
    const ctl = zh.querySelector('.zctl') || zh;

    const wrap = document.createElement('div');
    wrap.className = 'z-del-wrap';
    wrap.id = 'zRenderDelWrap';
    wrap.innerHTML = `
      <button class="z-del-btn" id="zRenderDelBtn" type="button" title="删除多余题目行 / 清理重复题目 (×)">×</button>
      <div class="z-del-menu" id="zRenderDelMenu"></div>
    `;

    ctl.appendChild(wrap);

    wrap.onclick = e => e.stopPropagation();
    wrap.onmousedown = e => e.stopPropagation();

    const btn = wrap.querySelector('#zRenderDelBtn');
    const menu = wrap.querySelector('#zRenderDelMenu');

    // 定时检查是否有重复项，有重复项时按钮亮黄色警示
    const checkDupsBadge = () => {
      if (typeof window.checkDuplicateQuestions !== 'function') return;
      const dups = window.checkDuplicateQuestions();
      btn.classList.toggle('has-dup', dups.length > 0);
      if (dups.length > 0) {
        btn.title = `⚠️ 检测到 ${dups.length} 组重复题目（如 ${dups.map(d=>d.key).join('、')}），点击清理多余行 (×)`;
      } else {
        btn.title = '删除多余题目行 / 清理重复题目 (×)';
      }
    };
    setInterval(checkDupsBadge, 1500);
    checkDupsBadge();

    const renderMenuContent = () => {
      const dups = (typeof window.checkDuplicateQuestions === 'function') ? window.checkDuplicateQuestions() : [];
      const allBlocks = (typeof window.getAllQuestionBlocks === 'function') ? window.getAllQuestionBlocks() : [];
      const searchIn = document.querySelector(`#${searchId} .z-search-in`);
      const searchVal = searchIn ? searchIn.value.trim() : '';

      let html = `
        <div class="z-del-menu-title">
          <span>🗑️ 题目行删除与清理</span>
          <small style="color:var(--mute,#64748b);font-weight:normal">共 ${allBlocks.length} 题</small>
        </div>
      `;

      // 1. 若检测到重复题目行（如出现两个 1.1），置顶展示一键清理按钮
      if (dups.length > 0) {
        html += `
          <div class="z-del-alert">
            <div style="font-weight:600">⚠️ 检测到 ${dups.length} 组多余重复题目行：</div>
            <div style="font-size:11.5px;color:#7f1d1d;line-height:1.4">
              ${dups.map(d => `· 题号 <b>${d.key}</b> 出现了 ${d.count} 次（多出 ${d.count - 1} 行）`).join('<br>')}
            </div>
            <div style="display:flex;gap:6px;margin-top:4px;justify-content:flex-end">
              <button type="button" class="z-del-alert-btn" id="cleanAllDupBtn">一键清理所有重复行（保留首项）</button>
            </div>
          </div>
        `;
      }

      // 2. 若放大镜输入框有值，提供快捷删除当前题号
      if (searchVal) {
        html += `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:#fee2e2;border-radius:6px;font-size:12px;color:#991b1b">
            <span>当前搜索题号: <b>${searchVal}</b></span>
            <button type="button" class="z-del-item-btn" id="delCurrentSearchBtn" style="background:#ef4444;color:#fff;font-weight:600">删除此题</button>
          </div>
        `;
      }

      // 3. 选择题目模块进行删除
      html += `
        <input type="text" class="z-del-filter" id="zDelFilterIn" placeholder="🔍 快速筛选题号进行删除..." />
        <div class="z-del-list" id="zDelList">
          ${allBlocks.length ? allBlocks.map((b, idx) => `
            <div class="z-del-item" data-head="${b.head}" data-idx="${idx}" data-headblock="${b.isHeadBlock ? '1' : '0'}">
              <div class="z-del-item-name" title="${b.head}">
                ${b.isHeadBlock ? '<span style="color:#ef4444;font-weight:700" title="此行为文件开头未带 ### 格式的文本或多余行">[开头前置行] </span>' : (b.isDup ? '<span style="color:#d97706;font-weight:700" title="此题号有重复">[重复] </span>' : '')}
                <b>${b.qNo || b.head}</b>
                <span style="color:var(--mute,#64748b);font-size:11px"> ${b.head.replace(b.qNo || '', '').slice(0, 18)}</span>
              </div>
              <button type="button" class="z-del-item-btn" data-head="${b.head}" data-headblock="${b.isHeadBlock ? '1' : '0'}">删除</button>
            </div>
          `).join('') : '<div style="text-align:center;padding:12px;color:var(--mute,#64748b);font-size:12px">暂无题目数据</div>'}
        </div>
      `;

      menu.innerHTML = html;

      // 绑定一键清理重复行
      const cleanBtn = menu.querySelector('#cleanAllDupBtn');
      if (cleanBtn) {
        cleanBtn.onclick = () => {
          if (!confirm(`确定要一键清理这 ${dups.length} 组重复题目吗？\n系统将自动保留正规题目，安全剔除多余的重复行（包含开头无格式重复行）。`)) return;
          const res = window.cleanAllDuplicateQuestions();
          if (res.ok) {
            alert(`清理成功！已剔除 ${res.removedCount} 行重复题目，已自动保存 ✓`);
            checkDupsBadge();
            renderMenuContent();
          } else {
            alert(res.msg);
          }
        };
      }

      // 绑定删除当前搜索题目
      const delCurBtn = menu.querySelector('#delCurrentSearchBtn');
      if (delCurBtn) {
        delCurBtn.onclick = () => {
          if (!confirm(`确定要从文档中彻底删除题目【${searchVal}】吗？`)) return;
          const res = window.deleteQuestionBlock(searchVal);
          if (res.ok) {
            alert(`已成功删除 ${searchVal} 题 ✓`);
            if (searchIn) searchIn.value = '';
            checkDupsBadge();
            renderMenuContent();
          } else {
            alert(res.msg);
          }
        };
      }

      // 绑定过滤输入
      const filterIn = menu.querySelector('#zDelFilterIn');
      const listEl = menu.querySelector('#zDelList');
      if (filterIn && listEl) {
        filterIn.oninput = () => {
          const q = filterIn.value.trim().toLowerCase();
          listEl.querySelectorAll('.z-del-item').forEach(it => {
            const h = (it.dataset.head || '').toLowerCase();
            it.style.display = (!q || h.includes(q)) ? 'flex' : 'none';
          });
        };
      }

      // 绑定单项删除按钮
      menu.querySelectorAll('.z-del-item-btn[data-head]').forEach(b => {
        b.onclick = () => {
          const isHead = b.dataset.headblock === '1';
          const head = b.dataset.head;
          if (isHead) {
            if (!confirm(`确定要从文档中彻底删除文件开头的这段前置内容/多余行吗？\n删除后将自动保存并刷新渲染。`)) return;
            const res = window.deleteHeadTextBlock();
            if (res.ok) {
              checkDupsBadge();
              renderMenuContent();
            } else {
              alert(res.msg || '删除失败');
            }
            return;
          }
          if (!confirm(`确定要从文档中彻底删除此题【${head}】吗？\n删除后将自动保存并刷新渲染。`)) return;
          const res = window.deleteQuestionBlock(head);
          if (res.ok) {
            checkDupsBadge();
            renderMenuContent();
          } else {
            alert(res.msg);
          }
        };
      });
    };

    btn.onclick = () => {
      const willOpen = !menu.classList.contains('on');
      menu.classList.toggle('on', willOpen);
      btn.classList.toggle('active', willOpen);
      if (willOpen) {
        renderMenuContent();
        const fin = menu.querySelector('#zDelFilterIn');
        if (fin) setTimeout(() => fin.focus(), 50);
      }
    };

    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) {
        menu.classList.remove('on');
        btn.classList.remove('active');
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && menu.classList.contains('on')) {
        menu.classList.remove('on');
        btn.classList.remove('active');
      }
    });
  }

  mountRenderDeleteButton({
    zoneId: 'sec-render',
    searchId: 'zRenderSearch'
  });

  // 2. MD 区：原文题号搜索跳转（直达原文位置）
  mountHeadingSearch({
    zoneId: 'sec-md',
    searchId: 'zMdSearch',
    placeholder: '跳到题号 (如 11.60)',
    title: '输入题号并回车，直达原文题目位置（例如 11.60）',
    getHeads: () => (window.getMdQuestionHeads ? window.getMdQuestionHeads() : []),
    jump: q => (window.jumpToMdHead ? window.jumpToMdHead(q) : { ok: false, msg: '页面尚未就绪' }),
    hotkey: 'm'
  });

  // 3. 编辑区：顶部 title 栏右侧挂载“撤销”按钮（上一次操作恢复）
  (() => {
    const ez = zones.get('zone-editor');
    const ctl = ez && ez.querySelector('.zh .zctl');
    if (!ctl) return;
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.id = 'edUndoBtn';
    undoBtn.className = 'zbtn';
    undoBtn.disabled = true;
    undoBtn.title = '暂无可撤销的操作';
    undoBtn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:12.5px;white-space:nowrap';
    undoBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg><span>撤销</span>';
    undoBtn.onclick = e => {
      e.stopPropagation();
      if (typeof window.undoLastOperation === 'function') {
        window.undoLastOperation();
      }
    };
    undoBtn.onmousedown = e => e.stopPropagation();
    ctl.insertBefore(undoBtn, ctl.firstChild);
    if (typeof window.refreshUndoBtnUI === 'function') {
      window.refreshUndoBtnUI();
    }
  })();
  // 框头上的状态徽标（和菜单里的一致），定时刷新
  function refreshBadges() { secs.forEach(s => { const b = s.badge ? s.badge() : ''; const el = zones.get(s.id).querySelector('.zb'); const t = b ? b.t : ''; if (el.textContent !== t) el.textContent = t; el.classList.toggle('ok', !!(b && b.ok)); }); }
  window.refreshZoneBadges = refreshBadges;
  setInterval(refreshBadges, 1200); refreshBadges();
  // 打开编辑器（“转到”、AI 助手跳题）时，如果编辑区或渲染区折叠着，先展开
  if (typeof window.openEditor === 'function') { const orig = window.openEditor; window.openEditor = function () { setZone('zone-editor', true); setZone('sec-render', true); return orig.apply(this, arguments); }; }

  const css = `
  [id^="sec-"],#zone-editor,#editor{scroll-margin-top:8px}
  #topBtn{position:fixed;right:22px;bottom:138px;z-index:80;width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;color:#fff;
    background:linear-gradient(135deg,#38bdf8,#2563eb);box-shadow:0 6px 18px rgba(37,99,235,.38);display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s,right .2s}
  #topBtn:hover{transform:scale(1.08);box-shadow:0 8px 22px rgba(37,99,235,.48)}
  #topBtn svg{transition:transform .18s ease;display:block}
  #topBtn:hover svg{transform:translateY(-2px)}
  #navBtn{position:fixed;right:22px;top:50%;transform:translateY(-50%);z-index:80;width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;font-size:22px;color:#fff;
    background:#4f46e5;box-shadow:0 6px 18px rgba(79,70,229,.4);display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s,right .2s}
  #navBtn:hover{transform:translateY(-50%) scale(1.1)}
  #navMenu{position:fixed;right:78px;top:50%;transform:translateY(-50%);z-index:80;width:180px;background:var(--card,#fff);color:var(--ink,#1d2430);border:1px solid var(--line,#dde1e8);
    border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.18);padding:6px;display:none;transition:right .2s;box-sizing:border-box}
  #navMenu.on{display:flex;flex-direction:column;gap:2px}
  #navMenu .nav-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;border-radius:9px;padding:7px 9px;cursor:pointer;color:inherit;font:inherit;font-size:13.5px;transition:background .12s;box-sizing:border-box}
  #navMenu .nav-item:hover{background:rgba(99,102,241,.09)}
  #navMenu .nav-item.cur{background:rgba(99,102,241,.15);font-weight:700}
  #navMenu .nav-item.is-col{opacity:.72}
  #navMenu .ic{font-size:15px;width:18px;text-align:center;flex:none}
  #navMenu .nm{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #navMenu .bd{margin-left:auto;font-size:11px;padding:2px 6px;border-radius:9px;background:#fee2e2;color:#991b1b;white-space:nowrap;flex:none}
  #navMenu .bd.ok{background:#dcfce7;color:#166534}
  #navMenu .bd.col-tag{background:#f1f5f9;color:#64748b;font-weight:400}
  #navMenu .nav-sep{height:1px;background:var(--line,#dde1e8);margin:4px 3px}
  #navMenu .nav-toggle-all{color:#4f46e5;font-weight:600}
  #navMenu .nav-toggle-all:hover{background:rgba(99,102,241,.12)}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const topBtn = document.createElement('button');
  topBtn.id = 'topBtn';
  topBtn.title = '回到顶部';
  topBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.293 3.293a1 1 0 0 1 1.414 0l6 6a1 1 0 0 1-1.414 1.414L13 6.414V20a1 1 0 1 1-2 0V6.414L6.707 10.707a1 1 0 0 1-1.414-1.414l6-6z"/></svg>';
  topBtn.onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    if (menu.classList.contains('on')) toggle(false);
  };

  const btn = document.createElement('button'); btn.id = 'navBtn'; btn.title = '导航：五个区与一键折叠'; btn.textContent = '☰';
  const menu = document.createElement('div'); menu.id = 'navMenu';
  document.body.append(topBtn, btn, menu);

  // 保证 topBtn 始终精确位于机器人图标 (#maiBtn) 正上方（留在下路）
  function syncTopBtnPos() {
    const mb = g('maiBtn');
    if (!mb) return;
    const mr = mb.getBoundingClientRect();
    if (mb.style.left && mb.style.left !== 'auto') {
      topBtn.style.left = mr.left + 'px';
      topBtn.style.top = Math.max(4, mr.top - 58) + 'px';
      topBtn.style.right = 'auto';
      topBtn.style.bottom = 'auto';
    } else {
      const open = document.body.classList.contains('mai-open');
      const p = g('maiPanel');
      const right = open && p ? Math.round(p.getBoundingClientRect().width) + 22 : 22;
      topBtn.style.right = right + 'px';
      topBtn.style.bottom = '138px';
      topBtn.style.left = 'auto';
      topBtn.style.top = 'auto';
    }
  }
  setInterval(syncTopBtnPos, 300);
  window.addEventListener('resize', syncTopBtnPos);

  function areAllCollapsed() {
    return secs.length > 0 && secs.every(s => {
      const z = zones.get(s.id);
      return z && z.classList.contains('collapsed');
    });
  }

  function getOrderedSecs() {
    const isWorkstation = document.body.classList.contains('layout-workstation') || document.documentElement.classList.contains('layout-workstation');
    // 如果是左右对半工作台：
    // 左列：文件区(上) -> 修复统计(中) -> MD区(下)；右列：编辑区(上) -> 渲染区(下)
    const workstationOrder = ['sec-file', 'sec-fix', 'sec-md', 'zone-editor', 'sec-render'];
    // 如果是模块对半仪表盘（默认推荐）：
    // 首排：文件区(左) -> 修复统计(右)；二排：渲染区(左) -> 编辑区(右)；三排：MD区(底)
    const dashboardOrder = ['sec-file', 'sec-fix', 'sec-render', 'zone-editor', 'sec-md'];

    const targetOrder = isWorkstation ? workstationOrder : dashboardOrder;
    const map = new Map(secs.map(s => [s.id, s]));
    const ordered = [];
    targetOrder.forEach(id => {
      if (map.has(id)) ordered.push(map.get(id));
    });
    secs.forEach(s => {
      if (!ordered.includes(s)) ordered.push(s);
    });
    return ordered;
  }

  function setAllZones(open) {
    secs.forEach(s => {
      const z = zones.get(s.id);
      if (!z) return;
      z.classList.toggle('collapsed', !open);
      try { localStorage.setItem('mdz_' + s.id, open ? '0' : '1'); } catch (_) {}
    });
    if (!open) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
    }
    syncAllCollapsedState();
    build();
  }

  let cur = secs[0].id;
  function currentSection() {
    const line = innerHeight * 0.38;
    const ordered = getOrderedSecs();
    let c = ordered[0].id;
    for (const s of ordered) {
      const el = g(s.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.top <= line && r.bottom > 40) {
        c = s.id;
      }
    }
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 6) {
      c = ordered[ordered.length - 1].id;
    }
    return c;
  }

  function build() {
    cur = currentSection();
    menu.innerHTML = '';
    const ordered = getOrderedSecs();

    // 1~5 行：仅列举五个区的名字（按当前页面排版动线排列）
    ordered.forEach((s) => {
      const b = s.badge ? s.badge() : '';
      const bd = b ? `<span class="bd ${b.ok ? 'ok' : ''}">${b.t}</span>` : '';
      const el = document.createElement('button');
      el.className = 'nav-item' + (s.id === cur ? ' cur' : '');
      el.innerHTML = `<span class="ic">${s.icon}</span><span class="nm">${s.name}</span>${bd}`;
      el.onclick = () => go(s.id);
      menu.appendChild(el);
    });

    // 分割线
    const sep = document.createElement('div');
    sep.className = 'nav-sep';
    menu.appendChild(sep);

    // 底部：单一折叠/展开按钮（点一下折叠，再点一下展开）
    const allCol = areAllCollapsed();
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'nav-item nav-toggle-all';
    toggleBtn.innerHTML = allCol
      ? `<span class="ic">▾</span><span class="nm">全部展开</span>`
      : `<span class="ic">▴</span><span class="nm">全部折叠</span>`;
    toggleBtn.onclick = e => {
      e.stopPropagation();
      setAllZones(allCol);
    };
    menu.appendChild(toggleBtn);
  }

  function go(id) {
    const el = g(id); if (!el) return;
    setZone(id, true);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toggle(false);
    if (id === 'sec-render' && g('prev')) g('prev').scrollTop = 0;
  }

  function toggle(on) {
    const open = on === undefined ? !menu.classList.contains('on') : on;
    if (open) build();
    menu.classList.toggle('on', open);
  }
  btn.onclick = () => toggle();

  document.addEventListener('keydown', e => {
    if (!menu.classList.contains('on')) return;
    if (e.key === 'Escape') { toggle(false); return; }
    const n = +e.key;
    const ordered = getOrderedSecs();
    if (n >= 1 && n <= ordered.length && !/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) {
      e.preventDefault();
      go(ordered[n - 1].id);
    }
  });
  document.addEventListener('click', e => { if (menu.classList.contains('on') && !menu.contains(e.target) && e.target !== btn) toggle(false); });

  function avoidPanel() {
    const p = g('maiPanel'), open = document.body.classList.contains('mai-open');
    const right = open && p ? Math.round(p.getBoundingClientRect().width) + 22 : 22;
    btn.style.right = right + 'px';
    menu.style.right = (right + 56) + 'px';
    topBtn.style.right = right + 'px';
  }
  new MutationObserver(avoidPanel).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', avoidPanel);
  avoidPanel();
  // 菜单开着时，滚动会实时更新“当前所在的区”
  addEventListener('scroll', () => { if (menu.classList.contains('on')) { const c = currentSection(); if (c !== cur) build(); } }, { passive: true });
})();
