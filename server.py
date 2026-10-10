# -*- coding: utf-8 -*-
"""
Markdown 公式清洗页 —— 独立后台服务
托管页面，并提供调大模型的接口（AI 助手 / 截图识别 / 项目保存 / 系统截图）。

用法：
  python server.py                 # 默认 8765，并自动打开浏览器
  python server.py --port 8765     # 指定端口
  python server.py --no-open       # 不自动打开浏览器
"""
import os, sys, json, re, time, base64, io, secrets, argparse, threading, webbrowser
from pathlib import Path
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

WEB = ROOT / "web"                   # 页面文件
DATA_ROOT = ROOT / "output"         # 项目都存在这儿
DATA_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Markdown 公式清洗")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def _no_cache(request: Request, call_next):
    r = await call_next(request)     # 改了页面刷新就是新的，不会被缓存
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    r.headers["Pragma"] = "no-cache"
    return r


@app.get("/")
def _index():
    return FileResponse(str(WEB / "index.html"))


@app.get("/md-cleaner")
def _mc():
    return RedirectResponse("/")


app.mount("/static/md_cleaner", StaticFiles(directory=str(WEB)), name="pages")
app.mount("/static", StaticFiles(directory=str(WEB / "katex")), name="katex")
app.mount("/katex", StaticFiles(directory=str(WEB / "katex")), name="katex_rel")


@app.get("/{filename}.js")
def _root_js(filename: str):
    f = (WEB / f"{filename}.js").resolve()
    if f.parent == WEB.resolve() and f.is_file():
        return FileResponse(str(f), media_type="application/javascript")
    return JSONResponse(status_code=404, content={"ok": False, "error": "Not found"})



# ---- 令牌：防止别的网页偷偷调用（会花模型额度、会抓屏）
# ---- 令牌：这些接口会花模型额度 / 会抓屏，所以要防“别的网页偷偷调用”
#      校验 Host（防 DNS 重绑定）+ 每次启动随机生成的令牌，页面从 /api/agent/token 取
import secrets as _secrets
AGENT_TOKEN = _secrets.token_urlsafe(24)


def _agent_guard(request: Request, need_token: bool = True):
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    if host not in ("127.0.0.1", "localhost", "::1"):
        return JSONResponse(status_code=403, content={"ok": False, "error": "不允许的主机"})
    if need_token and request.headers.get("x-agent-token") != AGENT_TOKEN:
        return JSONResponse(status_code=403, content={"ok": False, "error": "令牌无效，请刷新页面"})
    return None


@app.get("/api/agent/token")
def api_agent_token(request: Request):
    bad = _agent_guard(request, need_token=False)
    return bad or {"token": AGENT_TOKEN}



# ---- 模型设置 / 用量（用本项目自己的 llm_settings.json）
class LlmSettingsRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    providers: Optional[Dict[str, Dict[str, Any]]] = None


class LlmModelsRequest(BaseModel):
    provider: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    project: Optional[str] = None
    location: Optional[str] = None


class LlmTestRequest(BaseModel):
    provider: str
    model: str = ""
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    project: Optional[str] = None
    location: Optional[str] = None


class AgentSendRequest(BaseModel):
    sid: str
    text: str
    auto: bool = False
    project_id: Optional[str] = None


class AgentApproveRequest(BaseModel):
    sid: str
    decisions: Dict[str, bool]
    auto: bool = False
    project_id: Optional[str] = None


@app.get("/api/llm/settings")
def api_llm_settings():
    from core import llm
    return llm.public_settings()


@app.post("/api/llm/settings")
def api_llm_save_settings(req: LlmSettingsRequest):
    from core import llm
    llm.save_settings(req.model_dump(exclude_none=True))
    return {"ok": True, **llm.public_settings()}


@app.post("/api/llm/models")
def api_llm_models(req: LlmModelsRequest):
    """用填写的 Key（没填就用已保存的）向厂商拉取可用模型"""
    from core import llm
    try:
        return {"ok": True, "models": llm.list_models(req.provider, req.api_key, req.base_url, req.project, req.location)}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})



@app.get("/api/llm/usage")
def api_llm_usage(scope: str = "all", project_id: Optional[str] = None):
    from core import llm
    return {"ok": True, **llm.usage_summary(None)}

@app.post("/api/llm/test")
def api_llm_test(req: LlmTestRequest):
    """测试连接：用表单里的设置发一次极小的请求（几个 token）"""
    from core import llm
    try:
        ov = {"api_key": req.api_key or "", "base_url": req.base_url or "", "project": req.project or "", "location": req.location or ""}
        return {"ok": True, **llm.test_connection(req.provider, req.model, ov)}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})



# ---- Markdown 清洗页的悬浮 AI 助手：对话 + 看截图 + 通过 action 块让页面执行操作（操作在浏览器里执行，这里只负责问模型）
class MdChatMsg(BaseModel):
    role: str                           # user / assistant / tool（页面执行 action 后回传的结果）
    text: str


class MdChatRequest(BaseModel):
    messages: List[MdChatMsg]
    images: Optional[List[str]] = None  # 附在最后一条用户消息上的截图，data URL / base64
    state: Optional[str] = ""           # 页面当前状态（JSON 文本）：文件、需要核对的题、编辑器里的内容


_MD_CHAT_SYSTEM = """你是「Markdown 公式清洗页」里的 AI 助手，帮用户核对、修复教材习题的 Markdown（用 KaTeX 渲染）。
你能看到下面的【页面状态】，用户也可能附上原书截图。

【写 Markdown / 公式的规则】
1. 行内公式用 $...$；独占一行的公式用 $$...$$，且 $$ 必须单独占一行，前后各空一行。
2. 中文标点（，。：；？！、）放在公式外面，不要放进 $ 里。
3. 不要用 \\tag；带编号的公式写成 \\qquad\\text{(编号)}。
4. 不要有裸露的 LaTeX 指令，数学符号必须被 $ 或 $$ 包住。
5. 小问按 (a)(b)(c) 顺序，每个小问单独一行；图形用【见原图】；表格用 Markdown 表格。
6. 只转写题干，不要解答、解释，不要用代码围栏包住要写进文档的内容。

【你可以操作页面】需要操作时，在回复里单独写一个代码块，语言标记为 action，内容是一个 JSON 对象，例如：
```action
{"name":"goto","args":{"head":"10.12"}}
```
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
- 回答用中文，简洁。"""


@app.post("/api/md/chat")
def api_md_chat(req: MdChatRequest, request: Request):
    bad = _agent_guard(request)           # 会消耗模型额度：和陪伴智能体一样校验主机 + 令牌
    if bad:
        return bad
    import base64
    from core import llm
    if not req.messages:
        return JSONResponse(status_code=400, content={"ok": False, "error": "没有消息"})
    imgs = []
    for raw in (req.images or [])[:4]:
        mime = "image/png"
        m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,", raw or "")
        if m:
            mime, raw = m.group(1), raw[m.end():]
        try:
            data = base64.b64decode(raw, validate=False)
        except Exception:
            return JSONResponse(status_code=400, content={"ok": False, "error": "图片数据不是有效的 base64"})
        if not data or len(data) > 12 * 1024 * 1024:
            return JSONResponse(status_code=400, content={"ok": False, "error": "图片为空或超过 12 MB"})
        imgs.append(llm.image(data, mime))
    label = {"user": "用户", "assistant": "助手", "tool": "【操作结果】"}
    hist = "\n\n".join(f"{label.get(m.role, m.role)}：{m.text}" for m in req.messages[-24:])
    system = _MD_CHAT_SYSTEM + "\n\n【页面状态】\n" + (req.state or "（空）")[:14000]
    parts = ["以下是对话记录。请回答最后一条用户消息；如果最后是【操作结果】，请根据结果继续。\n\n" + hist] + imgs
    try:
        text = llm.call(system, parts, temperature=0.2, tries=2, stage="md_chat")
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    return {"ok": True, "reply": (text or "").strip()}


# ---- Markdown 清洗页的“项目”：一个 md 一个项目，存在 output/.md清洗/<项目名>/
#      （文件夹以点开头：工作台的 list_all_projects 会忽略它，不会被当成一本书）
#      source.md  原文（第一次保存时写入，之后不改）
#      cleaned.md 当前清洗后的版本（每次保存覆盖）
#      state.json 页面状态：原文件名、已核对的题、统计、保存时间
#      versions/  覆盖前自动留的历史版本（最多 15 份，同一份最多每 5 分钟留一次）
MD_PROJ_ROOT = DATA_ROOT            # 一个 md 一个项目，直接放 data/ 下


def _md_proj_name(name: str) -> str:
    n = re.sub(r'[\\/:*?"<>|\r\n\t]', "_", (name or "").strip()).strip(". ")
    return n[:80]


def _md_proj_dir(name: str) -> Path:
    n = _md_proj_name(name)
    if not n:
        raise ValueError("项目名不能为空")
    d = MD_PROJ_ROOT / n
    if d.resolve().parent != MD_PROJ_ROOT.resolve():
        raise ValueError("项目名不合法")
    return d


def _md_write(path: Path, text: str):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(text.encode("utf-8"))
    tmp.replace(path)


class MdProjSave(BaseModel):
    name: str
    cleaned: str
    source: Optional[str] = None            # 只在项目第一次保存、或你明确要更新原文时带上
    state: Optional[Dict[str, Any]] = None


class MdProjName(BaseModel):
    name: str


@app.get("/api/md/projects")
def api_md_projects(request: Request):
    bad = _agent_guard(request)
    if bad:
        return bad
    out = []
    if MD_PROJ_ROOT.is_dir():
        for d in MD_PROJ_ROOT.iterdir():
            c = d / "cleaned.md"
            if not (d.is_dir() and c.is_file()):
                continue
            st = {}
            try:
                st = json.loads((d / "state.json").read_text("utf-8"))
            except Exception:
                pass
            out.append({"name": d.name, "updated": c.stat().st_mtime, "size": c.stat().st_size, "original": st.get("original", ""),
                        "total": st.get("total"), "need_review": st.get("need_review"), "fixed_count": st.get("fixed_count"),
                        "saved_at": st.get("saved_at", "")})
    out.sort(key=lambda x: x["updated"], reverse=True)
    return {"ok": True, "root": str(MD_PROJ_ROOT), "projects": out}


@app.post("/api/md/project/save")
def api_md_project_save(req: MdProjSave, request: Request):
    bad = _agent_guard(request)
    if bad:
        return bad
    try:
        d = _md_proj_dir(req.name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    if not req.cleaned.strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "内容为空，不保存"})
    d.mkdir(parents=True, exist_ok=True)
    cur = d / "cleaned.md"
    if cur.is_file():                                    # 覆盖前留历史版本
        try:
            old = cur.read_bytes()
            if old != req.cleaned.encode("utf-8"):
                vdir = d / "versions"
                vdir.mkdir(exist_ok=True)
                vs = sorted(vdir.glob("*.md"))
                if not vs or time.time() - vs[-1].stat().st_mtime > 300:
                    (vdir / (time.strftime("%Y%m%d-%H%M%S") + ".md")).write_bytes(old)
                    for extra in sorted(vdir.glob("*.md"))[:-15]:
                        extra.unlink()
        except Exception:
            pass
    src = d / "source.md"
    if req.source is not None and (req.source.strip() and not src.is_file()):
        _md_write(src, req.source)
    _md_write(cur, req.cleaned)
    state = dict(req.state or {})
    state["saved_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    _md_write(d / "state.json", json.dumps(state, ensure_ascii=False, indent=1))
    return {"ok": True, "name": d.name, "saved_at": state["saved_at"], "path": str(d)}


@app.get("/api/md/project/load")
def api_md_project_load(name: str, request: Request):
    bad = _agent_guard(request)
    if bad:
        return bad
    try:
        d = _md_proj_dir(name)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    c = d / "cleaned.md"
    if not c.is_file():
        return JSONResponse(status_code=404, content={"ok": False, "error": "项目不存在"})
    src = d / "source.md"
    try:
        st = json.loads((d / "state.json").read_text("utf-8"))
    except Exception:
        st = {}
    return {"ok": True, "name": d.name, "cleaned": c.read_bytes().decode("utf-8", "replace"),
            "source": src.read_bytes().decode("utf-8", "replace") if src.is_file() else "", "state": st}


# ---- Markdown 清洗页“编辑区”的截图识别：一张图 → 符合 KaTeX 规范的 Markdown（只转写，不聊天、不做别的）
class MdRecognizeRequest(BaseModel):
    image: str                          # base64，可带 data:image/png;base64, 前缀
    context: Optional[str] = ""         # 这一题当前的 Markdown（让模型沿用同样的符号写法）
    selection: Optional[str] = ""       # 用户选中的、有问题的片段；有的话只重写这一段


_MD_RECOGNIZE_SYSTEM = """你是高精度的教材习题 OCR 转写员，把截图里的文字和公式转成严格兼容 KaTeX 的 Markdown。
规则：
1. 行内公式用单美元符 $...$；独占一行的公式用 $$...$$，且 $$ 必须单独占一行，前后各空一行，不能和文字写在同一行。
2. 中文标点（，。：；？！、）不能放在公式内部，必须放在公式外面。
3. 不要使用 \\tag；带编号的公式写成 \\qquad\\text{(编号)}，例如 x=1 \\qquad\\text{(P1.2-1)}。
4. 不要有裸露的 LaTeX 指令，所有数学符号都必须被 $ 或 $$ 包住。
5. 小问按 (a)(b)(c) 的顺序，每个小问单独一行；双栏排版先读完左栏再读右栏。
6. 截图里凡是图（波形图、电路图、系统框图、零极点图、曲线图、几何示意图、坐标图等），一律只在对应位置写【见原图】：不要描述图形内容，不要用文字或代码把图画出来，不要转写图里的坐标、标注和数值；图外的题目文字照常转写。纯文字的表格可以用 Markdown 表格；填空横线写六个下划线。
7. 只转写，不要解答、不要解释、不要前言和结语，不要用代码围栏包裹输出。看不清的地方写 [?]，不要编造。"""


# ---- 清洗页的“有没有新版本”：静态文件一变，这个值就变。页面轮询它，变了就弹“点这里刷新”
@app.get("/api/md/page-version")
def api_md_page_version():
    import hashlib
    base = WEB
    parts = []
    for n in ("index.html", "cleaner_core.js", "md_nav.js", "md_ocr.js", "md_assistant.js", "md_projects.js"):
        try:
            st = (base / n).stat()
            parts.append(f"{n}:{int(st.st_mtime)}:{st.st_size}")
        except OSError:
            parts.append(n + ":-")
    return {"v": hashlib.md5("|".join(parts).encode()).hexdigest()[:12]}


@app.post("/api/md/recognize")
def api_md_recognize(req: MdRecognizeRequest, request: Request):
    bad = _agent_guard(request)           # 会消耗模型额度：和陪伴智能体一样校验主机 + 令牌
    if bad:
        return bad
    import base64
    from core import llm
    raw = req.image or ""
    mime = "image/png"
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,", raw)
    if m:
        mime = m.group(1)
        raw = raw[m.end():]
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "error": "图片数据不是有效的 base64"})
    if not data or len(data) > 12 * 1024 * 1024:
        return JSONResponse(status_code=400, content={"ok": False, "error": "图片为空或超过 12 MB"})
    sel = (req.selection or "").strip()
    ctx = (req.context or "").strip()
    if sel:
        task = ("下面是这一题当前转写里有问题（可能残缺或写错）的片段：\n<<<\n" + sel + "\n>>>\n"
                "截图是原书里这一段对应的位置。请对照截图，只输出这个片段的正确 Markdown，不要输出片段之外的内容。")
    else:
        task = "请把截图里的内容完整转写成 Markdown（只要题干，不含题号标题、不含解答）。"
    if ctx:
        task += "\n\n供参考的这一题现有转写（符号写法请保持一致，不要照抄其中的错误）：\n<<<\n" + ctx[:6000] + "\n>>>"
    try:
        text = llm.call(_MD_RECOGNIZE_SYSTEM, [task, llm.image(data, mime)], temperature=0.0, tries=2, stage="md_recognize")
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    text = (text or "").strip()
    text = re.sub(r"^```(?:markdown|md)?\s*\n", "", text)
    text = re.sub(r"\n```\s*$", "", text).strip()
    return {"ok": True, "markdown": text}


# ---- 备用截图：浏览器的“屏幕共享”被拦（比如 Claude 内置的浏览器窗格）时，由本机的工作台服务抓整块屏幕，页面里再框选
#      只在用户点“截图”之后才抓一次；接口校验主机 + 令牌；图片只返回给页面，不落盘。
class MdScreengrabRequest(BaseModel):
    delay: Optional[float] = 0          # 先等几秒再抓（页面自己倒计时，这里一般传 0）


@app.post("/api/md/screengrab")
def api_md_screengrab(req: MdScreengrabRequest, request: Request):
    bad = _agent_guard(request)
    if bad:
        return bad
    import io, base64
    try:
        from PIL import ImageGrab
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "error": "服务端没有安装 Pillow，无法抓屏"})
    d = max(0.0, min(float(req.delay or 0), 10.0))
    if d:
        time.sleep(d)
    try:
        im = ImageGrab.grab(all_screens=True)          # 所有显示器拼成的整块屏幕
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": "抓屏失败：" + str(e)})
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "PNG")
    return {"ok": True, "width": im.width, "height": im.height,
            "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")}


# ---- 直接调用 Windows 自带的截图（和 Win+Shift+S 同一个）：服务端调起 ms-screenclip:，用户在屏幕上拖框，截图进剪贴板，这里取回来交给页面
#      只在用户点“截图”之后才调起一次；接口校验主机 + 令牌；图片只返回给页面，不落盘。
def _md_snip_wait(clip_fn, start_fn, timeout=45.0, interval=0.4):
    """start_fn 调起截图；然后轮询剪贴板，等到出现一张和调起前不同的图片就返回（PIL Image），超时返回 None。"""
    import hashlib

    def sig(im):
        if im is None or not hasattr(im, "tobytes"):
            return None
        return hashlib.md5(im.convert("RGB").resize((64, 64)).tobytes() + str(im.size).encode()).hexdigest()

    before = sig(clip_fn())
    start_fn()
    end = time.time() + timeout
    while time.time() < end:
        time.sleep(interval)
        im = clip_fn()
        s = sig(im)
        if s is not None and s != before:
            return im
    return None


@app.post("/api/md/snip")
def api_md_snip(request: Request):
    bad = _agent_guard(request)
    if bad:
        return bad
    import io, base64
    if not sys.platform.startswith("win"):
        return JSONResponse(status_code=400, content={"ok": False, "error": "系统截图目前只支持 Windows"})
    try:
        from PIL import ImageGrab
    except Exception:
        return JSONResponse(status_code=400, content={"ok": False, "error": "服务端没有安装 Pillow"})

    def clip():
        try:
            return ImageGrab.grabclipboard()
        except Exception:
            return None

    def start():
        os.startfile("ms-screenclip:")            # Windows 截图工具（框选界面）

    try:
        im = _md_snip_wait(clip, start)
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": "无法调起系统截图：" + str(e)})
    if im is None:
        return JSONResponse(status_code=408, content={"ok": False, "error": "没有等到截图（45 秒内没有框选）"})
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "PNG")
    return {"ok": True, "width": im.width, "height": im.height,
            "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")}

# ----------------- 启动 -----------------
def _start(port: int, open_browser: bool):
    import uvicorn
    if open_browser:
        url = f"http://127.0.0.1:{port}/"
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    print(f"\n清洗页已启动: http://127.0.0.1:{port}/\n关闭这个窗口即停止服务。\n", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    _start(a.port, not a.no_open)
