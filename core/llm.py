# -*- coding: utf-8 -*-
"""
大模型接入层：多厂商、填 API Key 后拉取模型列表、点选用哪个模型。

- 厂商分三种协议：gemini（google-genai SDK，Key 为空时走 Vertex）、openai（OpenAI 兼容接口：
  OpenAI / DeepSeek / 通义千问 / Kimi / 智谱 / 硅基流动 / OpenRouter / 自定义）、anthropic（Claude）；
- 设置存在项目根目录的 llm_settings.json（含 API Key，已加入 .gitignore，只存本机）；
- 切题里用到大模型的几处（书籍嗅探、习题页定位、样例裁判、AI 质检/修复）和侧边陪伴都走 call()，
  调用方只传“文字 + 图片”，不关心是哪家厂商。
"""

import base64
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_FILE = PROJECT_ROOT / "llm_settings.json"
USAGE_FILE = PROJECT_ROOT / "llm_usage.jsonl"      # 全部工作项的调用用量（每次调用一行）
PROJECT_USAGE = "usage_log.jsonl"                      # 每个工作项文件夹里也各记一份
_TLS = threading.local()
_ULOCK = threading.Lock()

# 厂商表：kind 决定协议；base_url 可在设置里改；vision=False 的厂商只能做纯文字（陪伴聊天），不能看切片图
PROVIDERS: Dict[str, Dict[str, Any]] = {
    "vertex": {"label": "Google Vertex AI（本地 ADC 凭证）", "kind": "gemini", "vertex": True, "base_url": "", "vision": True,
               "default_model": "gemini-3.8-flash"},
    "gemini": {"label": "Google Gemini（API Key）", "kind": "gemini", "base_url": "", "vision": True,
               "default_model": "gemini-3.8-flash"},
    "openai": {"label": "OpenAI", "kind": "openai", "base_url": "https://api.openai.com/v1", "vision": True},
    "anthropic": {"label": "Anthropic Claude", "kind": "anthropic", "base_url": "https://api.anthropic.com", "vision": True},
    "deepseek": {"label": "DeepSeek", "kind": "openai", "base_url": "https://api.deepseek.com/v1", "vision": False},
    "qwen": {"label": "阿里通义千问", "kind": "openai", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "vision": True},
    "moonshot": {"label": "月之暗面 Kimi", "kind": "openai", "base_url": "https://api.moonshot.cn/v1", "vision": True},
    "zhipu": {"label": "智谱 GLM", "kind": "openai", "base_url": "https://open.bigmodel.cn/api/paas/v4", "vision": True},
    "siliconflow": {"label": "硅基流动", "kind": "openai", "base_url": "https://api.siliconflow.cn/v1", "vision": True},
    "openrouter": {"label": "OpenRouter", "kind": "openai", "base_url": "https://openrouter.ai/api/v1", "vision": True},
    "custom": {"label": "自定义（OpenAI 兼容）", "kind": "openai", "base_url": "", "vision": True},
}

GEMINI_REST = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT_S = lambda: int(os.environ.get("STUDYHELP_LLM_TIMEOUT_MS", "300000")) / 1000

# 各调用的思考预算（token，仅 Gemini 使用）：都只是“看清图”，思考不用多
THINK_BUDGET = {"crop_check": 4096, "crop_fix": 4096, "crop_judge": 2048, "locate": 4096, "profile": 2048, "test": 128,
                "agent": 1024,   # 陪伴要快：思考少一点，回复更快、也更少出现“只思考没输出”的空响应
                "md_chat": 768, "md_recognize": 1024}
# md_chat / md_recognize（清洗页的助手与截图识别）也要快：默认 4096 会让它想 40 秒；压到 768 后一般几秒到十几秒。
# 想临时放宽/收紧：设环境变量 STUDYHELP_THINKING_BUDGET（对全部环节生效）。


@dataclass
class Image:
    data: bytes
    mime: str = "image/png"


def image(data: bytes, mime: str = "image/png") -> Image:
    return Image(data, mime)


# ------------------------------------------------------------------ 设置
def load_settings() -> Dict[str, Any]:
    try:
        d = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")) if SETTINGS_FILE.exists() else {}
    except Exception:
        d = {}
    d.setdefault("provider", "vertex")
    d.setdefault("model", PROVIDERS["vertex"]["default_model"])
    d.setdefault("providers", {})
    return d


def save_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    """patch: provider / model / providers.<id>.{api_key, base_url}。api_key 传空串表示不改，传 null 表示清除。"""
    d = load_settings()
    for k in ("provider", "model"):
        if patch.get(k):
            d[k] = patch[k]
    for pid, ent in (patch.get("providers") or {}).items():
        if pid not in PROVIDERS:
            continue
        cur = d["providers"].setdefault(pid, {})
        if "api_key" in ent:
            if ent["api_key"] is None:
                cur.pop("api_key", None)
            elif ent["api_key"]:
                cur["api_key"] = ent["api_key"].strip()
        for k in ("base_url", "project", "location"):
            if k in ent:
                cur[k] = (ent[k] or "").strip()
    SETTINGS_FILE.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return d


def mask(key: str) -> str:
    return "" if not key else (key[:4] + "…" + key[-4:] if len(key) > 10 else "已填写")


def adc_info() -> Dict[str, Any]:
    """本机 ADC（Application Default Credentials）检测：只看文件是否存在、类型和默认项目，不读密钥内容"""
    info: Dict[str, Any] = {"ok": False, "type": "", "project": os.environ.get("GOOGLE_CLOUD_PROJECT", ""), "source": ""}
    env_f = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    cands = [(Path(env_f), "环境变量 GOOGLE_APPLICATION_CREDENTIALS")] if env_f else []
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    cands.append((Path(base) / "gcloud" / "application_default_credentials.json", "gcloud auth application-default login"))
    for f, src in cands:
        if f.exists():
            try:
                j = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                j = {}
            info.update(ok=True, type=j.get("type", ""), source=src)
            info["project"] = info["project"] or j.get("quota_project_id") or j.get("project_id") or ""
            break
    return info


def public_settings() -> Dict[str, Any]:
    """给前端的设置：API Key 只给打码的样子，绝不回传明文"""
    d = load_settings()
    adc = adc_info()
    provs = {}
    for pid, p in PROVIDERS.items():
        ent = d["providers"].get(pid, {})
        item = {"label": p["label"], "kind": p["kind"], "vision": p["vision"], "vertex": bool(p.get("vertex")),
                "base_url": ent.get("base_url") or p["base_url"], "default_base_url": p["base_url"]}
        if p.get("vertex"):
            item.update(has_key=adc["ok"], key_mask="", key_from_env=False, adc=adc,
                        project=ent.get("project") or adc["project"],
                        location=ent.get("location") or os.environ.get("GOOGLE_CLOUD_LOCATION", "global"))
        else:
            env_key = os.environ.get("GEMINI_API_KEY") if pid == "gemini" else None
            item.update(has_key=bool(ent.get("api_key") or env_key), key_mask=mask(ent.get("api_key", "")),
                        key_from_env=bool(env_key and not ent.get("api_key")))
        provs[pid] = item
    return {"provider": d["provider"], "model": d["model"], "providers": provs}


def _creds(provider: str, override: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    d = load_settings()
    ent = dict(d["providers"].get(provider, {}))
    ent.update({k: v for k, v in (override or {}).items() if v})
    p = PROVIDERS[provider]
    key = ent.get("api_key") or (os.environ.get("GEMINI_API_KEY", "") if provider == "gemini" else "")
    out = {"api_key": key, "base_url": (ent.get("base_url") or p["base_url"]).rstrip("/")}
    if p.get("vertex"):
        out["vertex"] = "1"
        out["project"] = ent.get("project") or adc_info()["project"] or ""
        out["location"] = ent.get("location") or os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
    return out


# ------------------------------------------------------------------ 拉取模型列表
def list_models(provider: str, api_key: Optional[str] = None, base_url: Optional[str] = None,
                project: Optional[str] = None, location: Optional[str] = None) -> List[Dict[str, str]]:
    """用填写的 Key 向厂商拉取可用模型。api_key 不传就用已保存的。"""
    import requests
    if provider not in PROVIDERS:
        raise ValueError(f"未知厂商: {provider}")
    c = _creds(provider, {"api_key": api_key or "", "base_url": base_url or "", "project": project or "", "location": location or ""})
    kind = PROVIDERS[provider]["kind"]
    if PROVIDERS[provider].get("vertex"):
        if not adc_info()["ok"]:
            raise ValueError("没有检测到本地 ADC 凭证，请先在终端运行：gcloud auth application-default login")
        out = []
        client = _gemini_client(c)      # 必须持有引用：迭代翻页时客户端不能被回收
        for m in client.models.list():
            name = (m.name or "").split("/")[-1]
            acts = getattr(m, "supported_actions", None) or []
            if name.startswith("gemini") and (not acts or "generateContent" in acts):
                out.append({"id": name, "name": getattr(m, "display_name", None) or name})
        return sorted(out, key=lambda x: x["id"])
    if not c["api_key"]:
        raise ValueError("还没有填写 API Key")
    if kind == "gemini":
        out, token = [], None
        for _ in range(5):
            r = requests.get(f"{GEMINI_REST}/models", params={"key": c["api_key"], "pageSize": 200, **({"pageToken": token} if token else {})},
                             timeout=30)
            _raise_for(r)
            j = r.json()
            for m in j.get("models", []):
                if "generateContent" in (m.get("supportedGenerationMethods") or []):
                    out.append({"id": m["name"].split("/", 1)[-1], "name": m.get("displayName") or m["name"]})
            token = j.get("nextPageToken")
            if not token:
                break
        return out
    if kind == "anthropic":
        r = requests.get(f"{c['base_url']}/v1/models", params={"limit": 200}, timeout=30,
                         headers={"x-api-key": c["api_key"], "anthropic-version": "2023-06-01"})
        _raise_for(r)
        return [{"id": m["id"], "name": m.get("display_name") or m["id"]} for m in r.json().get("data", [])]
    if not c["base_url"]:
        raise ValueError("请填写接口地址（base URL）")
    r = requests.get(f"{c['base_url']}/models", timeout=30, headers={"Authorization": f"Bearer {c['api_key']}"})
    _raise_for(r)
    j = r.json()
    items = j.get("data") if isinstance(j, dict) else j
    return sorted(({"id": m["id"], "name": m.get("name") or m["id"]} for m in (items or []) if m.get("id")), key=lambda x: x["id"])


def _raise_for(r):
    if r.status_code >= 400:
        try:
            msg = r.json()
            msg = (msg.get("error") or msg) if isinstance(msg, dict) else msg
            msg = msg.get("message") if isinstance(msg, dict) and msg.get("message") else msg
        except Exception:
            msg = r.text[:200]
        raise RuntimeError(f"HTTP {r.status_code}：{str(msg)[:300]}")


# ------------------------------------------------------------------ 调用
def _b64(im: Image) -> str:
    return base64.b64encode(im.data).decode("ascii")


def _call_openai(c, model, system, parts, temperature) -> str:
    import requests
    content: List[Dict[str, Any]] = []
    for p in parts:
        if isinstance(p, Image):
            content.append({"type": "image_url", "image_url": {"url": f"data:{p.mime};base64,{_b64(p)}"}})
        else:
            content.append({"type": "text", "text": str(p)})
    body: Dict[str, Any] = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}]}
    if not re.match(r"^(o\d|gpt-5)", model):      # 推理模型不接受自定义 temperature
        body["temperature"] = temperature
    r = requests.post(f"{c['base_url']}/chat/completions", json=body, timeout=TIMEOUT_S(),
                      headers={"Authorization": f"Bearer {c['api_key']}"})
    _raise_for(r)
    j = r.json()
    u = j.get("usage") or {}
    think = int((u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0)
    _TLS.usage = {"in": int(u.get("prompt_tokens") or 0), "out": max(0, int(u.get("completion_tokens") or 0) - think), "think": think}
    msg = (j.get("choices") or [{}])[0].get("message") or {}
    return (msg.get("content") or "").strip()


def _call_anthropic(c, model, system, parts, temperature) -> str:
    import requests
    content: List[Dict[str, Any]] = []
    for p in parts:
        if isinstance(p, Image):
            content.append({"type": "image", "source": {"type": "base64", "media_type": p.mime, "data": _b64(p)}})
        else:
            content.append({"type": "text", "text": str(p)})
    r = requests.post(f"{c['base_url']}/v1/messages", timeout=TIMEOUT_S(),
                      headers={"x-api-key": c["api_key"], "anthropic-version": "2023-06-01"},
                      json={"model": model, "max_tokens": 4096, "temperature": temperature, "system": system,
                            "messages": [{"role": "user", "content": content}]})
    _raise_for(r)
    j = r.json()
    u = j.get("usage") or {}
    _TLS.usage = {"in": int(u.get("input_tokens") or 0), "out": int(u.get("output_tokens") or 0), "think": 0}
    return "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text").strip()


def _gemini_client(c):
    from google import genai
    from google.genai import types
    http = types.HttpOptions(timeout=int(os.environ.get("STUDYHELP_LLM_TIMEOUT_MS", "300000")))
    if c.get("vertex"):
        # 本地 ADC 凭证（gcloud auth application-default login）
        return genai.Client(vertexai=True, project=c["project"], location=c["location"], http_options=http)
    return genai.Client(api_key=c["api_key"], http_options=http)


def _call_gemini(c, model, system, parts, temperature, stage) -> str:
    from google.genai import types
    contents = [types.Part.from_bytes(data=p.data, mime_type=p.mime) if isinstance(p, Image) else str(p) for p in parts]
    budget = int(os.environ.get("STUDYHELP_THINKING_BUDGET") or THINK_BUDGET.get(stage, 4096))
    # 流式接收 + 回传思考摘要：模型先“思考”一阵才出第一个字，期间连接无数据会被代理按空闲超时断开；
    # 思考摘要持续回传可保活，拼接时排除。
    cfg = types.GenerateContentConfig(
        system_instruction=system, temperature=temperature,
        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_HIGH,
        thinking_config=types.ThinkingConfig(include_thoughts=True, thinking_budget=budget),
        safety_settings=[
            types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
            types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
            types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
            types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
            types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="BLOCK_NONE"),
        ])
    out = []
    client = _gemini_client(c)          # 必须持有引用：流式迭代期间客户端不能被回收
    for chunk in client.models.generate_content_stream(model=model, contents=contents, config=cfg):
        um = getattr(chunk, "usage_metadata", None)
        if um is not None:        # 每个 chunk 都带累计用量，中途断开也能记到已用的部分
            g = lambda k: int(getattr(um, k, None) or 0)
            _TLS.usage = {"in": g("prompt_token_count"), "out": g("candidates_token_count"), "think": g("thoughts_token_count")}
        for cand in (chunk.candidates or [])[:1]:
            for part in ((cand.content.parts if cand.content else None) or []):
                if part.text and not getattr(part, "thought", False):
                    out.append(part.text)
    return "".join(out).strip()


def record_usage(provider: str, model: str, stage: str, seconds: float, ok: bool, project_dir=None):
    """把这次调用的真实用量追加到 llm_usage.jsonl（全部）和工作项文件夹的 usage_log.jsonl（这本书）"""
    u = getattr(_TLS, "usage", None) or {}
    row = {"t": round(time.time(), 1), "stage": stage, "provider": provider, "model": model, "ok": ok, "sec": round(seconds, 1),
           "in": int(u.get("in", 0)), "out": int(u.get("out", 0)), "think": int(u.get("think", 0)),
           "project": Path(project_dir).name if project_dir else ""}
    row["total"] = row["in"] + row["out"] + row["think"]
    line = json.dumps(row, ensure_ascii=False) + "\n"
    try:
        with _ULOCK:
            with open(USAGE_FILE, "a", encoding="utf-8") as f:
                f.write(line)
            if project_dir and Path(project_dir).is_dir():
                with open(Path(project_dir) / PROJECT_USAGE, "a", encoding="utf-8") as f:
                    f.write(line)
    except Exception:
        pass


STAGE_NAMES = {"profile": "书籍嗅探", "locate": "习题页定位", "crop_judge": "样例裁判", "crop_check": "AI 切题检查",
               "crop_fix": "AI 切题修复", "agent": "陪伴助手", "test": "连接测试", "other": "其它"}


def usage_summary(project_dir=None, recent: int = 15) -> Dict[str, Any]:
    """用量统计：project_dir 不传 = 全部工作项；传了 = 这本书"""
    f = (Path(project_dir) / PROJECT_USAGE) if project_dir else USAGE_FILE
    rows = []
    try:
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    except Exception:
        pass

    def agg(rs):
        return {"calls": len(rs), "failed": sum(1 for r in rs if not r.get("ok", True)), "in": sum(r.get("in", 0) for r in rs),
                "out": sum(r.get("out", 0) for r in rs), "think": sum(r.get("think", 0) for r in rs),
                "total": sum(r.get("total", 0) for r in rs), "sec": round(sum(r.get("sec", 0) for r in rs), 1)}

    def group(keyf):
        g: Dict[Any, List[Dict[str, Any]]] = {}
        for r in rows:
            g.setdefault(keyf(r), []).append(r)
        return g

    today = time.strftime("%Y-%m-%d")
    day = lambda r: time.strftime("%Y-%m-%d", time.localtime(r.get("t", 0)))
    by_model = sorted(({"provider": PROVIDERS.get(k[0], {}).get("label", k[0]), "model": k[1], **agg(v)} for k, v in group(lambda r: (r.get("provider"), r.get("model"))).items()),
                      key=lambda x: -x["total"])
    # 不认识的环节名（别的脚本自己起的，如 ch3_p182）合并成一行，免得表被刷得很长
    by_stage = sorted(({"stage": k, **agg(v)} for k, v in group(lambda r: STAGE_NAMES.get(r.get("stage"), "其它（外部脚本等）")).items()), key=lambda x: -x["total"])
    by_day = sorted(({"day": k, **agg(v)} for k, v in group(day).items()), key=lambda x: x["day"])[-7:]
    rec = [{"time": time.strftime("%m-%d %H:%M:%S", time.localtime(r.get("t", 0))), "stage": STAGE_NAMES.get(r.get("stage"), r.get("stage")),
            "model": r.get("model"), "in": r.get("in", 0), "out": r.get("out", 0), "think": r.get("think", 0), "sec": r.get("sec", 0),
            "ok": r.get("ok", True), "project": r.get("project", "")} for r in rows[-recent:]][::-1]
    return {"scope": "project" if project_dir else "all", "project": Path(project_dir).name if project_dir else "",
            "since": time.strftime("%Y-%m-%d %H:%M", time.localtime(rows[0]["t"])) if rows else "",
            "totals": agg(rows), "today": agg([r for r in rows if day(r) == today]),
            "by_model": by_model, "by_stage": by_stage, "by_day": by_day, "recent": rec}


def _invoke(provider, c, model, system, parts, temperature, stage) -> str:
    _TLS.usage = None
    kind = PROVIDERS[provider]["kind"]
    if kind == "openai":
        return _call_openai(c, model, system, parts, temperature)
    if kind == "anthropic":
        return _call_anthropic(c, model, system, parts, temperature)
    return _call_gemini(c, model, system, parts, temperature, stage)


def test_connection(provider: str, model: str, override: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """测试连接：用当前表单里的设置（不必先保存）发一次极小的请求，成功返回用时和回复"""
    if provider not in PROVIDERS:
        raise ValueError(f"未知厂商: {provider}")
    meta = PROVIDERS[provider]
    if not model:
        raise ValueError("请先选一个模型（点“获取模型”后选择）")
    c = _creds(provider, override)
    if meta.get("vertex"):
        if not adc_info()["ok"]:
            raise ValueError("没有检测到本地 ADC 凭证，请先在终端运行：gcloud auth application-default login")
    elif not c["api_key"]:
        raise ValueError(f"还没有填写 {meta['label']} 的 API Key")
    t0 = time.time()
    try:
        text = _invoke(provider, c, model, "你是连接测试，只回答 OK。", ["请回复 OK"], 0.0, "test")
    except Exception:
        record_usage(provider, model, "test", time.time() - t0, False)
        raise
    record_usage(provider, model, "test", time.time() - t0, True)
    return {"seconds": round(time.time() - t0, 1), "reply": (text or "")[:60], "provider": meta["label"], "model": model}


def call(system: str, parts: List[Any], temperature: float = 0.0, tries: int = 3, stage: str = "other",
         provider: Optional[str] = None, model: Optional[str] = None, project_dir=None) -> str:
    """parts：文字(str)和图片(llm.image(...))混排。厂商和模型取设置里选中的。project_dir：这次调用算在哪本书头上（用量统计）。"""
    from core import events
    s = load_settings()
    provider = provider or s["provider"]
    model = model or s["model"]
    if provider not in PROVIDERS:
        raise ValueError(f"未知厂商: {provider}")
    meta = PROVIDERS[provider]
    if any(isinstance(p, Image) for p in parts) and not meta["vision"]:
        raise RuntimeError(f"{meta['label']} 不支持看图，请在设置里换一个支持图片的模型/厂商")
    c = _creds(provider)
    if meta.get("vertex"):
        if not adc_info()["ok"]:
            raise RuntimeError("没有检测到本地 ADC 凭证，请先在终端运行：gcloud auth application-default login")
    elif not c["api_key"]:
        raise RuntimeError(f"还没有填写 {meta['label']} 的 API Key（侧栏设置里填写）")
    last = None
    for attempt in range(tries):
        t0 = time.time()
        tag = f"[{stage}] {meta['label']}/{model} 第 {attempt + 1}/{tries} 次"
        print(f"⚡ 请求 {tag}", flush=True)
        events.log("请求", tag)
        try:
            text = _invoke(provider, c, model, system, parts, temperature, stage)
            record_usage(provider, model, stage, time.time() - t0, bool(text), project_dir)
            events.log("返回", f"[{stage}] 用时 {time.time() - t0:.0f}s")
            print(f"✓ 返回 [{stage}] 用时 {time.time() - t0:.0f}s", flush=True)
            if text:
                return text
            last = "空响应"
        except Exception as err:
            last = err
            msg = str(err)
            record_usage(provider, model, stage, time.time() - t0, False, project_dir)
            events.log("失败", f"{tag}：{msg[:120]}")
            print(f"✗ 失败 {tag}：{msg[:120]}", flush=True)
            if "401" in msg or "403" in msg or "API key" in msg or "invalid_api_key" in msg:
                break         # Key 不对，重试没有意义
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "disconnected" in msg.lower():
                time.sleep(min(180, 30 * (attempt + 1)))
            else:
                time.sleep(min(45, 5 * (attempt + 1) ** 1.5))
    raise RuntimeError(f"模型调用失败: {last}")
