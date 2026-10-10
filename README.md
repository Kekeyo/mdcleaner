# Markdown 公式清洗工作台 (mdcleaner)

面向理工科教材与习题 Markdown（KaTeX）的高精度公式清洗、实时渲染核对与 AI 视觉转写工作台。支持 **GitHub Pages 纯前端在线即开即用** 与 **本地 Python 服务启动** 双模式。

## ✨ 核心特性

- **100% 纯前端公式清洗引擎**：自动修复 `$` 边界空格、块级 `$$` 换行、中文标点外移、`\tag` 规范化、小问 `(a)(b)(c)` 顺序重排、剔除大模型转写草稿噪音。
- **KaTeX 实时渲染与报错快修**：双联题号同行对齐对比、单题源码实时预览、报错公式一键弹窗快修。
- **AI 视觉截图转写 & 悬浮助手**：支持框选屏幕或 `Ctrl+V` 粘贴截图直接转写为符合 KaTeX 规范的 Markdown，支持多厂商模型（Gemini / 硅基流动 / OpenRouter / 通义千问 / DeepSeek / OpenAI / Claude）。
- **项目版本管理**：在线模式自动使用浏览器 `IndexedDB` 本地数据库存储项目与历史版本；本地服务模式自动存入 `output/` 目录。
- **零隐私泄露设计**：在线模式下所有文档、项目进度与 API Key 均 100% 存储在您自己浏览器的本地存储（`localStorage` / `IndexedDB`）中，绝不上传至任何第三方服务器。

## 🚀 使用方式

### 1. 在线直接使用（GitHub Pages）
直接访问在线工作台网址即可使用全部功能。如需使用 AI 截图识别或 AI 助手，点击页面右下角 **🤖 AI 助手 → 顶部「先设置模型」** 填入您的 API Key（仅保存在当前浏览器本地）。

### 2. 本地服务启动（可选）
```bash
pip install fastapi uvicorn pydantic pillow requests google-genai
python server.py
```
或直接双击 `启动网页.bat`，浏览器将自动打开 `http://127.0.0.1:8765/`。
