/*
 * md_browser_backend.js —— 纯前端在线满血版后端引擎（GitHub Pages / 静态托管自适应）
 *
 * 作用：
 * 1. 自动检测当前环境：若通过本地 `python server.py` 启动，则透传给本地 Python 服务；
 *    若部署在 GitHub Pages 或直接静态打开（无 Python 后端），则自动在浏览器端接管全部 `/api/*` 接口。
 * 2. 零服务端数据泄露：所有 API Key、模型配置、Token 用量统计与项目历史版本（IndexedDB）
 *    100% 存储在访问者自己的浏览器本地（localStorage / IndexedDB），仓库本身零个人数据。
 */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const SETTINGS_KEY = 'mdcleaner_online_llm_settings_v1';
  const USAGE_KEY = 'mdcleaner_online_llm_usage_v1';
  const DB_NAME = 'mdcleaner_projects_db_v1';
  const DB_STORE = 'projects';
  const GEMINI_REST = 'https://generativelanguage.googleapis.com/v1beta';

  // 厂商定义（与 core/llm.py 对齐，针对浏览器直连优化默认模型）
  const PROVIDERS = {
    gemini: {
      label: 'Google Gemini（API Key）',
      kind: 'gemini',
      base_url: GEMINI_REST,
      vision: true,
      default_model: 'gemini-2.5-flash',
      builtin_models: [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash（推荐·快且准）' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
      ]
    },
    siliconflow: {
      label: '硅基流动 SiliconFlow',
      kind: 'openai',
      base_url: 'https://api.siliconflow.cn/v1',
      vision: true,
      default_model: 'Qwen/Qwen2.5-VL-72B-Instruct',
      builtin_models: [
        { id: 'Qwen/Qwen2.5-VL-72B-Instruct', name: 'Qwen2.5-VL-72B-Instruct（视觉）' },
        { id: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct', name: 'Qwen2.5-VL-7B-Instruct（视觉）' },
        { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek-V3' }
      ]
    },
    openrouter: {
      label: 'OpenRouter',
      kind: 'openai',
      base_url: 'https://openrouter.ai/api/v1',
      vision: true,
      default_model: 'google/gemini-2.5-flash',
      builtin_models: [
        { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' },
        { id: 'google/gemini-2.5-pro', name: 'Google: Gemini 2.5 Pro' },
        { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o Mini' }
      ]
    },
    qwen: {
      label: '阿里通义千问',
      kind: 'openai',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      vision: true,
      default_model: 'qwen-vl-max',
      builtin_models: [
        { id: 'qwen-vl-max', name: '通义千问 VL-Max（视觉）' },
        { id: 'qwen-vl-plus', name: '通义千问 VL-Plus（视觉）' },
        { id: 'qwen-plus', name: '通义千问 Plus' }
      ]
    },
    deepseek: {
      label: 'DeepSeek（纯文本对话）',
      kind: 'openai',
      base_url: 'https://api.deepseek.com/v1',
      vision: false,
      default_model: 'deepseek-chat',
      builtin_models: [
        { id: 'deepseek-chat', name: 'DeepSeek-V3 (deepseek-chat)' },
        { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (deepseek-reasoner)' }
      ]
    },
    zhipu: {
      label: '智谱 GLM',
      kind: 'openai',
      base_url: 'https://open.bigmodel.cn/api/paas/v4',
      vision: true,
      default_model: 'glm-4v-plus',
      builtin_models: [
        { id: 'glm-4v-plus', name: 'GLM-4V-Plus（视觉）' },
        { id: 'glm-4v-flash', name: 'GLM-4V-Flash（免费视觉）' },
        { id: 'glm-4-flash', name: 'GLM-4-Flash' }
      ]
    },
    moonshot: {
      label: '月之暗面 Kimi',
      kind: 'openai',
      base_url: 'https://api.moonshot.cn/v1',
      vision: true,
      default_model: 'moonshot-v1-8k-vision-preview',
      builtin_models: [
        { id: 'moonshot-v1-8k-vision-preview', name: 'Kimi 8K Vision（视觉）' },
        { id: 'moonshot-v1-32k-vision-preview', name: 'Kimi 32K Vision（视觉）' },
        { id: 'kimi-latest', name: 'Kimi Latest' }
      ]
    },
    openai: {
      label: 'OpenAI',
      kind: 'openai',
      base_url: 'https://api.openai.com/v1',
      vision: true,
      default_model: 'gpt-4o-mini',
      builtin_models: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }
      ]
    },
    anthropic: {
      label: 'Anthropic Claude',
      kind: 'anthropic',
      base_url: 'https://api.anthropic.com',
      vision: true,
      default_model: 'claude-3-7-sonnet-latest',
      builtin_models: [
        { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' }
      ]
    },
    custom: {
      label: '自定义（OpenAI 兼容）',
      kind: 'openai',
      base_url: '',
      vision: true,
      default_model: '',
      builtin_models: []
    }
  };

  const MD_CHAT_SYSTEM = `你是「Markdown 公式清洗页」里的 AI 助手，帮用户核对、修复教材习题的 Markdown（用 KaTeX 渲染）。
你能看到下面的【页面状态】，用户也可能附上原书截图。

【写 Markdown / 公式的规则】
1. 行内公式用 $...$；独占一行的公式用 $$...$$，且 $$ 必须单独占一行，前后各空一行。
2. 中文标点（，。：；？！、）放在公式外面，不要放进 $ 里。
3. 不要用 \\tag；带编号的公式写成 \\qquad\\text{(编号)}。
4. 不要有裸露的 LaTeX 指令，数学符号必须被 $ 或 $$ 包住。
5. 小问按 (a)(b)(c) 顺序，每个小问单独一行；图形用【见原图】；表格用 Markdown 表格。
6. 只转写题干，不要解答、解释，不要用代码围栏包住要写进文档的内容。

【你可以操作页面】需要操作时，在回复里单独写一个代码块，语言标记为 action，内容是一个 JSON 对象，例如：
\`\`\`action
{"name":"goto","args":{"head":"10.12"}}
\`\`\`
一次回复可以写多个 action 块，页面会按顺序执行，并把结果作为【操作结果】回传给你，你再接着回答。不需要操作时不要写 action 块。
可用操作：
- goto {head}：在题目编辑器里打开某题（head 形如 "10.12"）
- get_question {head}：读取某题当前完整的 Markdown
- edit_question {head, markdown}：把某题除 "### 题号" 标题行之外的全部内容替换成 markdown
- edit_selection {mode, markdown}：在编辑器里替换选中的文字（mode=replace）或在光标处插入（mode=insert）
- replace_text {find, replace, head}：把文字原样替换；head 省略则全文替换
- search {query}：返回包含这段文字的题号
- list_issues {}：列出当前需要核对的题和原因
- recheck {}：对当前全文重新检查一遍（不会丢掉已做的修改）
- mark_fixed {head, value}：给某题打勾（true）或取消打勾（false）
你不能保存到磁盘，保存由用户点页面上的“保存到源文件”。

【原则】
- 只做用户要求的事；用户只是提问时就回答，不要擅自改动。
- 看截图转写时，看不清的地方要明说，不要编造题目里没有的内容。
- 改完题后看操作结果里的检查结论，没通过就继续改；通过了再告诉用户。
- 用户只说“继续”时：接着你上一条回复往下写或往下做，不要重复已经说过的内容、不要重新开始。
- 回答用中文，简洁。`;

  const MD_RECOGNIZE_SYSTEM = `你是高精度的教材习题 OCR 转写员，把截图里的文字和公式转成严格兼容 KaTeX 的 Markdown。
规则：
1. 行内公式用单美元符 $...$；独占一行的公式用 $$...$$，且 $$ 必须单独占一行，前后各空一行，不能和文字写在同一行。
2. 中文标点（，。：；？！、）不能放在公式内部，必须放在公式外面。
3. 不要使用 \\tag；带编号的公式写成 \\qquad\\text{(编号)}，例如 x=1 \\qquad\\text{(P1.2-1)}。
4. 不要有裸露的 LaTeX 指令，所有数学符号都必须被 $ 或 $$ 包住。
5. 小问按 (a)(b)(c) 的顺序，每个小问单独一行；双栏排版先读完左栏再读右栏。
6. 截图里凡是图（波形图、电路图、系统框图、零极点图、曲线图、几何示意图、坐标图等），一律只在对应位置写【见原图】：不要描述图形内容，不要用文字或代码把图画出来，不要转写图里的坐标、标注和数值；图外的题目文字照常转写。纯文字的表格可以用 Markdown 表格；填空横线写六个下划线。
7. 只转写，不要解答、不要解释、不要前言和结语，不要用代码围栏包裹输出。看不清的地方写 [?]，不要编造。`;

  const STAGE_NAMES = {
    md_chat: 'AI 助手对话',
    md_recognize: '截图公式识别',
    test: '连接测试',
    other: '其它'
  };

  // ---------------- 环境探测 ----------------
  let backendMode = null; // 'server' | 'browser'
  let detectPromise = null;

  async function getBackendMode() {
    if (backendMode) return backendMode;
    if (detectPromise) return detectPromise;
    detectPromise = (async () => {
      const host = location.hostname;
      if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 700);
          const r = await nativeFetch('/api/agent/token', { signal: ctl.signal });
          clearTimeout(t);
          if (r.ok) {
            const j = await r.json().catch(() => null);
            if (j && j.token) {
              backendMode = 'server';
              return backendMode;
            }
          }
        } catch (_) {}
      }
      backendMode = 'browser';
      return backendMode;
    })();
    return detectPromise;
  }

  // ---------------- 本地设置与用量存储 ----------------
  function loadSettings() {
    let d = {};
    try {
      d = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (_) {
      d = {};
    }
    if (!d.provider || !PROVIDERS[d.provider]) d.provider = 'gemini';
    if (!d.model) d.model = PROVIDERS[d.provider].default_model || 'gemini-2.5-flash';
    if (!d.providers || typeof d.providers !== 'object') d.providers = {};
    return d;
  }

  function saveSettings(patch) {
    const d = loadSettings();
    if (patch.provider && PROVIDERS[patch.provider]) d.provider = patch.provider;
    if (patch.model) d.model = patch.model;
    if (patch.providers && typeof patch.providers === 'object') {
      for (const [pid, ent] of Object.entries(patch.providers)) {
        if (!PROVIDERS[pid] || !ent) continue;
        const cur = d.providers[pid] || (d.providers[pid] = {});
        if ('api_key' in ent) {
          if (ent.api_key === null) delete cur.api_key;
          else if (ent.api_key && String(ent.api_key).trim()) cur.api_key = String(ent.api_key).trim();
        }
        if ('base_url' in ent) cur.base_url = String(ent.base_url || '').trim();
      }
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(d));
    } catch (_) {}
    return d;
  }

  function maskKey(k) {
    if (!k) return '';
    return k.length > 10 ? k.slice(0, 4) + '…' + k.slice(-4) : '已填写';
  }

  function publicSettings() {
    const d = loadSettings();
    const provs = {};
    for (const [pid, p] of Object.entries(PROVIDERS)) {
      const ent = d.providers[pid] || {};
      provs[pid] = {
        label: p.label,
        kind: p.kind,
        vision: p.vision,
        vertex: false,
        base_url: ent.base_url || p.base_url,
        default_base_url: p.base_url,
        default_model: p.default_model || '',
        builtin_models: p.builtin_models || [],
        has_key: Boolean(ent.api_key),
        key_mask: maskKey(ent.api_key || ''),
        key_from_env: false
      };
    }
    return {
      browser_mode: true,
      provider: d.provider,
      model: d.model,
      providers: provs
    };
  }

  function getCreds(provider, override) {
    const d = loadSettings();
    const p = PROVIDERS[provider];
    if (!p) throw new Error('未知厂商: ' + provider);
    const ent = Object.assign({}, d.providers[provider] || {});
    if (override) {
      for (const [k, v] of Object.entries(override)) {
        if (v) ent[k] = v;
      }
    }
    return {
      api_key: (ent.api_key || '').trim(),
      base_url: (ent.base_url || p.base_url || '').trim().replace(/\/+$/, '')
    };
  }

  function recordUsage(provider, model, stage, seconds, ok, usageObj) {
    try {
      const rows = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]') || [];
      const u = usageObj || {};
      const inTok = Number(u.in || 0);
      const outTok = Number(u.out || 0);
      const thinkTok = Number(u.think || 0);
      rows.push({
        t: Math.round(Date.now() / 100) / 10,
        stage,
        provider,
        model,
        ok: Boolean(ok),
        sec: Math.round(seconds * 10) / 10,
        in: inTok,
        out: outTok,
        think: thinkTok,
        total: inTok + outTok + thinkTok
      });
      if (rows.length > 500) rows.splice(0, rows.length - 500);
      localStorage.setItem(USAGE_KEY, JSON.stringify(rows));
    } catch (_) {}
  }

  function usageSummary() {
    let rows = [];
    try {
      rows = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]') || [];
    } catch (_) {
      rows = [];
    }
    const agg = rs => ({
      calls: rs.length,
      failed: rs.filter(r => r.ok === false).length,
      in: rs.reduce((s, r) => s + (r.in || 0), 0),
      out: rs.reduce((s, r) => s + (r.out || 0), 0),
      think: rs.reduce((s, r) => s + (r.think || 0), 0),
      total: rs.reduce((s, r) => s + (r.total || 0), 0),
      sec: Math.round(rs.reduce((s, r) => s + (r.sec || 0), 0) * 10) / 10
    });
    const fmtDay = ts => {
      const d = new Date((ts || 0) * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const todayStr = fmtDay(Date.now() / 1000);
    const byModelMap = new Map();
    const byStageMap = new Map();
    rows.forEach(r => {
      const mk = `${r.provider || ''}|${r.model || ''}`;
      if (!byModelMap.has(mk)) byModelMap.set(mk, []);
      byModelMap.get(mk).push(r);

      const sk = STAGE_NAMES[r.stage] || r.stage || '其它';
      if (!byStageMap.has(sk)) byStageMap.set(sk, []);
      byStageMap.get(sk).push(r);
    });
    const by_model = [...byModelMap.entries()].map(([k, rs]) => {
      const [prov, mod] = k.split('|');
      return { provider: (PROVIDERS[prov] && PROVIDERS[prov].label) || prov, model: mod, ...agg(rs) };
    }).sort((a, b) => b.total - a.total);
    const by_stage = [...byStageMap.entries()].map(([stage, rs]) => ({ stage, ...agg(rs) })).sort((a, b) => b.total - a.total);
    return {
      ok: true,
      scope: 'all',
      totals: agg(rows),
      today: agg(rows.filter(r => fmtDay(r.t) === todayStr)),
      by_model,
      by_stage
    };
  }

  // ---------------- 浏览器直连大模型请求 ----------------
  function parseDataUrl(raw) {
    let mime = 'image/png';
    let b64 = String(raw || '').trim();
    const m = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    if (m) {
      mime = m[1];
      b64 = b64.slice(m[0].length);
    }
    return { mime, b64, dataUrl: `data:${mime};base64,${b64}` };
  }

  async function listModelsOnline(req) {
    const provider = req.provider || 'gemini';
    const p = PROVIDERS[provider];
    if (!p) throw new Error('未知厂商: ' + provider);
    const c = getCreds(provider, req);
    if (!c.api_key) {
      if (p.builtin_models && p.builtin_models.length) return p.builtin_models;
      throw new Error('请先填写 API Key');
    }
    try {
      if (p.kind === 'gemini') {
        const base = c.base_url || GEMINI_REST;
        const r = await nativeFetch(`${base}/models?key=${encodeURIComponent(c.api_key)}&pageSize=200`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const out = [];
        for (const m of (j.models || [])) {
          if ((m.supportedGenerationMethods || []).includes('generateContent')) {
            const id = String(m.name || '').replace(/^models\//, '');
            out.push({ id, name: m.displayName || id });
          }
        }
        return out.length ? out : p.builtin_models;
      }
      if (p.kind === 'anthropic') {
        const r = await nativeFetch(`${c.base_url}/v1/models?limit=200`, {
          headers: {
            'x-api-key': c.api_key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const out = (j.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
        return out.length ? out : p.builtin_models;
      }
      if (!c.base_url) throw new Error('请填写接口地址（Base URL）');
      const r = await nativeFetch(`${c.base_url}/models`, {
        headers: { 'Authorization': `Bearer ${c.api_key}` }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const items = Array.isArray(j) ? j : (j.data || []);
      const out = items.filter(m => m && m.id).map(m => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.id.localeCompare(b.id));
      return out.length ? out : p.builtin_models;
    } catch (e) {
      if (p.builtin_models && p.builtin_models.length) {
        return p.builtin_models;
      }
      throw e;
    }
  }

  async function invokeOnline(provider, creds, model, system, parts, temperature) {
    const p = PROVIDERS[provider];
    if (!p) throw new Error('未知厂商: ' + provider);
    if (!creds.api_key) {
      throw new Error(`还没有填写 ${p.label} 的 API Key（请点右下角 🤖 助手 → 顶部「先设置模型」填写，Key 仅保存在您当前浏览器中）`);
    }
    const hasImg = parts.some(x => x && typeof x === 'object' && x.type === 'image');
    if (hasImg && !p.vision) {
      throw new Error(`${p.label} 不支持图片识别，请在设置里切换到支持视觉的模型（如 Gemini / 硅基流动 Qwen-VL / 通义千问 VL / OpenRouter）`);
    }

    if (p.kind === 'gemini') {
      const base = creds.base_url || GEMINI_REST;
      const contentsParts = parts.map(pt => {
        if (pt && typeof pt === 'object' && pt.type === 'image') {
          return { inline_data: { mime_type: pt.mime, data: pt.b64 } };
        }
        return { text: String(pt) };
      });
      const body = {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: contentsParts }],
        generationConfig: { temperature }
      };
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(creds.api_key)}`;
      const r = await nativeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j.error && j.error.message) || JSON.stringify(j).slice(0, 240);
        throw new Error(`HTTP ${r.status}：${msg}`);
      }
      const um = j.usageMetadata || {};
      const usage = {
        in: Number(um.promptTokenCount || 0),
        out: Number(um.candidatesTokenCount || 0),
        think: Number(um.thoughtsTokenCount || 0)
      };
      const cand = (j.candidates || [])[0] || {};
      const cparts = (cand.content && cand.content.parts) || [];
      const text = cparts.filter(x => x.text && !x.thought).map(x => x.text).join('').trim();
      return { text, usage };
    }

    if (p.kind === 'anthropic') {
      const content = parts.map(pt => {
        if (pt && typeof pt === 'object' && pt.type === 'image') {
          return { type: 'image', source: { type: 'base64', media_type: pt.mime, data: pt.b64 } };
        }
        return { type: 'text', text: String(pt) };
      });
      const r = await nativeFetch(`${creds.base_url}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': creds.api_key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          temperature,
          system,
          messages: [{ role: 'user', content }]
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j.error && j.error.message) || JSON.stringify(j).slice(0, 240);
        throw new Error(`HTTP ${r.status}：${msg}`);
      }
      const u = j.usage || {};
      const usage = { in: Number(u.input_tokens || 0), out: Number(u.output_tokens || 0), think: 0 };
      const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
      return { text, usage };
    }

    // OpenAI 兼容协议
    if (!creds.base_url) throw new Error('请填写接口地址（Base URL）');
    const content = hasImg
      ? parts.map(pt => {
          if (pt && typeof pt === 'object' && pt.type === 'image') {
            return { type: 'image_url', image_url: { url: pt.dataUrl } };
          }
          return { type: 'text', text: String(pt) };
        })
      : parts.map(pt => String(pt)).join('\n\n');
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    };
    if (!/^(o\d|gpt-5|deepseek-reasoner)/i.test(model)) {
      body.temperature = temperature;
    }
    const r = await nativeFetch(`${creds.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${creds.api_key}`
      },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && (j.error.message || j.error)) || JSON.stringify(j).slice(0, 240);
      throw new Error(`HTTP ${r.status}：${msg}`);
    }
    const u = j.usage || {};
    const think = Number((u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0);
    const usage = {
      in: Number(u.prompt_tokens || 0),
      out: Math.max(0, Number(u.completion_tokens || 0) - think),
      think
    };
    const msgObj = ((j.choices || [])[0] && j.choices[0].message) || {};
    return { text: String(msgObj.content || '').trim(), usage };
  }

  async function callOnline(system, parts, temperature, stage) {
    const s = loadSettings();
    const provider = s.provider;
    const model = s.model;
    const creds = getCreds(provider);
    const t0 = performance.now();
    try {
      const { text, usage } = await invokeOnline(provider, creds, model, system, parts, temperature);
      recordUsage(provider, model, stage, (performance.now() - t0) / 1000, Boolean(text), usage);
      return text;
    } catch (e) {
      recordUsage(provider, model, stage, (performance.now() - t0) / 1000, false, null);
      throw e;
    }
  }

  // ---------------- IndexedDB 项目版本管理 ----------------
  function openProjDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'name' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
    });
  }

  async function dbListProjects() {
    const db = await openProjDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const st = tx.objectStore(DB_STORE);
      const req = st.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const out = all.map(p => ({
          name: p.name,
          updated: p.updated || Date.now() / 1000,
          size: new Blob([p.cleaned || '']).size,
          original: (p.state && p.state.original) || '',
          total: p.state && p.state.total,
          need_review: p.state && p.state.need_review,
          fixed_count: p.state && p.state.fixed_count,
          saved_at: (p.state && p.state.saved_at) || ''
        })).sort((a, b) => b.updated - a.updated);
        resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetProject(name) {
    const db = await openProjDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbSaveProject(body) {
    const cleanName = String(body.name || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 80);
    if (!cleanName) throw new Error('项目名不能为空');
    if (!String(body.cleaned || '').trim()) throw new Error('内容为空，不保存');
    const existing = await dbGetProject(cleanName);
    const nowSec = Date.now() / 1000;
    const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const versions = (existing && Array.isArray(existing.versions)) ? existing.versions.slice() : [];
    if (existing && existing.cleaned && existing.cleaned !== body.cleaned) {
      const lastVer = versions[versions.length - 1];
      if (!lastVer || nowSec - (lastVer.t || 0) > 300) {
        versions.push({ t: nowSec, saved_at: nowStr, cleaned: existing.cleaned });
        if (versions.length > 15) versions.splice(0, versions.length - 15);
      }
    }
    const source = (existing && existing.source)
      ? existing.source
      : (body.source && String(body.source).trim() ? String(body.source) : '');
    const state = Object.assign({}, body.state || {}, { saved_at: nowStr });
    const record = {
      name: cleanName,
      cleaned: String(body.cleaned),
      source,
      state,
      updated: nowSec,
      versions
    };
    const db = await openProjDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return { ok: true, name: cleanName, saved_at: nowStr, path: 'IndexedDB/' + cleanName };
  }

  // ---------------- JSON Response 构造工具 ----------------
  function jsonResp(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  async function parseReqBody(opts) {
    if (!opts || !opts.body) return {};
    if (typeof opts.body === 'string') {
      try { return JSON.parse(opts.body); } catch (_) { return {}; }
    }
    return {};
  }

  const safeOrigin = () => (location.origin && location.origin !== 'null') ? location.origin : 'https://local.static';

  // ---------------- 路由分发（Browser Mode） ----------------
  async function handleBrowserApi(urlStr, opts = {}) {
    const u = new URL(urlStr, safeOrigin());
    const path = u.pathname;
    const method = (opts.method || 'GET').toUpperCase();

    try {
      if (path.endsWith('/api/agent/token')) {
        return jsonResp({ token: 'browser-direct-token' });
      }
      if (path.endsWith('/api/md/page-version')) {
        return jsonResp({ v: 'static-online-v1' });
      }
      if (path.endsWith('/api/llm/settings') && method === 'GET') {
        return jsonResp(publicSettings());
      }
      if (path.endsWith('/api/llm/settings') && method === 'POST') {
        const body = await parseReqBody(opts);
        saveSettings(body);
        return jsonResp({ ok: true, ...publicSettings() });
      }
      if (path.endsWith('/api/llm/models') && method === 'POST') {
        const body = await parseReqBody(opts);
        const models = await listModelsOnline(body);
        return jsonResp({ ok: true, models });
      }
      if (path.endsWith('/api/llm/test') && method === 'POST') {
        const body = await parseReqBody(opts);
        const provider = body.provider || 'gemini';
        const model = body.model || '';
        if (!model) return jsonResp({ ok: false, error: '请先选一个模型（点“获取模型”后选择）' }, 400);
        const creds = getCreds(provider, body);
        const t0 = performance.now();
        try {
          const { text, usage } = await invokeOnline(provider, creds, model, '你是连接测试，只回答 OK。', ['请回复 OK'], 0.0);
          const sec = Math.round(((performance.now() - t0) / 1000) * 10) / 10;
          recordUsage(provider, model, 'test', sec, true, usage);
          return jsonResp({
            ok: true,
            seconds: sec,
            reply: (text || 'OK').slice(0, 60),
            provider: (PROVIDERS[provider] && PROVIDERS[provider].label) || provider,
            model
          });
        } catch (e) {
          recordUsage(provider, model, 'test', (performance.now() - t0) / 1000, false, null);
          return jsonResp({ ok: false, error: e.message || String(e) }, 400);
        }
      }
      if (path.endsWith('/api/llm/usage')) {
        return jsonResp(usageSummary());
      }
      if (path.endsWith('/api/md/recognize') && method === 'POST') {
        const body = await parseReqBody(opts);
        if (!body.image) return jsonResp({ ok: false, error: '没有收到图片数据' }, 400);
        const img = parseDataUrl(body.image);
        const sel = String(body.selection || '').trim();
        const ctx = String(body.context || '').trim();
        let task = sel
          ? `下面是这一题当前转写里有问题（可能残缺或写错）的片段：\n<<<\n${sel}\n>>>\n截图是原书里这一段对应的位置。请对照截图，只输出这个片段的正确 Markdown，不要输出片段之外的内容。`
          : '请把截图里的内容完整转写成 Markdown（只要题干，不含题号标题、不含解答）。';
        if (ctx) {
          task += `\n\n供参考的这一题现有转写（符号写法请保持一致，不要照抄其中的错误）：\n<<<\n${ctx.slice(0, 6000)}\n>>>`;
        }
        const text = await callOnline(
          MD_RECOGNIZE_SYSTEM,
          [task, { type: 'image', mime: img.mime, b64: img.b64, dataUrl: img.dataUrl }],
          0.0,
          'md_recognize'
        );
        let cleaned = String(text || '').trim();
        cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();
        return jsonResp({ ok: true, markdown: cleaned });
      }
      if (path.endsWith('/api/md/chat') && method === 'POST') {
        const body = await parseReqBody(opts);
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (!msgs.length) return jsonResp({ ok: false, error: '没有消息' }, 400);
        const imgs = (body.images || []).slice(0, 4).map(raw => {
          const im = parseDataUrl(raw);
          return { type: 'image', mime: im.mime, b64: im.b64, dataUrl: im.dataUrl };
        });
        const label = { user: '用户', assistant: '助手', tool: '【操作结果】' };
        const hist = msgs.slice(-24).map(m => `${label[m.role] || m.role}：${m.text}`).join('\n\n');
        const system = MD_CHAT_SYSTEM + '\n\n【页面状态】\n' + String(body.state || '（空）').slice(0, 14000);
        const parts = ['以下是对话记录。请回答最后一条用户消息；如果最后是【操作结果】，请根据结果继续。\n\n' + hist, ...imgs];
        const reply = await callOnline(system, parts, 0.2, 'md_chat');
        return jsonResp({ ok: true, reply: String(reply || '').trim() });
      }
      if (path.endsWith('/api/md/projects') && method === 'GET') {
        const projects = await dbListProjects();
        return jsonResp({ ok: true, root: '浏览器 IndexedDB 本地存储', projects });
      }
      if (path.endsWith('/api/md/project/save') && method === 'POST') {
        const body = await parseReqBody(opts);
        const res = await dbSaveProject(body);
        return jsonResp(res);
      }
      if (path.endsWith('/api/md/project/load') && method === 'GET') {
        const name = u.searchParams.get('name') || '';
        const rec = await dbGetProject(name);
        if (!rec) return jsonResp({ ok: false, error: '项目不存在' }, 404);
        return jsonResp({
          ok: true,
          name: rec.name,
          cleaned: rec.cleaned || '',
          source: rec.source || '',
          state: rec.state || {}
        });
      }
      if (path.endsWith('/api/md/snip')) {
        // 在线模式返回 na，让 md_ocr.js 自动无缝切换到浏览器原生 getDisplayMedia 屏幕捕获框选
        return jsonResp({ ok: false, error: 'na' }, 400);
      }
      if (path.endsWith('/api/md/screengrab')) {
        return jsonResp({
          ok: false,
          error: '在线模式下请允许浏览器的“屏幕共享”权限以框选屏幕，或直接按 Win+Shift+S 截图后在页面按 Ctrl+V 粘贴'
        }, 400);
      }
    } catch (e) {
      return jsonResp({ ok: false, error: e.message || String(e) }, 400);
    }

    return jsonResp({ ok: false, error: '未知接口: ' + path }, 404);
  }

  // ---------------- 拦截全局 fetch ----------------
  window.fetch = async function (input, init) {
    const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
    let isApi = false;
    try {
      const base = safeOrigin();
      const u = new URL(urlStr, base);
      if (u.origin === base && (u.pathname.startsWith('/api/') || u.pathname.includes('/api/'))) {
        isApi = true;
      }
    } catch (_) {}

    if (isApi) {
      const mode = await getBackendMode();
      if (mode === 'browser') {
        return handleBrowserApi(urlStr, init);
      }
    }
    return nativeFetch(input, init);
  };
})();
