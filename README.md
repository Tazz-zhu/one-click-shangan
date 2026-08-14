<div align="center">

# 🎯 一键上岸（JobSeeker Agent）

### 简历助手 + 面试助手 · AI 驱动的求职全流程

[![Release](https://img.shields.io/github/v/release/Tazz-zhu/one-click-shangan?style=flat-square&color=6366f1)](https://github.com/Tazz-zhu/one-click-shangan/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-33.3-blue?style=flat-square&logo=electron)](https://electronjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org)

**输入 JD + 简历 → AI 精准押题、面经采集、差距分析、模拟面试、简历优化**

</div>

---

## 🧭 一键上岸：简历 + 面试 一体化

本仓库已把 **一键上岸（AI 简历助手）** 整合为内置的「📄 简历助手」Tab，与面试功能组成完整求职 Agent：

````text
写简历（简历助手） → 一键同步 → 粘贴/确认 JD（分析 & 押题） → AI 押题 / 模拟面试 / 简历优化
`

### 数据打通（简历 → 面试）

- 简历助手位于 public/resume-agent/（纯前端，与原项目一致，数据仍只存浏览器 localStorage）；
- 在简历助手任意页面点击 **「⚡ 同步到面试助手」**（导出页/嵌入横幅）：
  - 自动把简历转成 **ATS 纯文本** 并携带你填写的 JD，写入共享键 jobseeker-bridge-v1；
  - 嵌入模式下还会通过 postMessage 通知父页面，自动切到「分析 & 押题」并填入「我的简历 / 岗位JD」输入框；
- 在「分析 & 押题」页也可点 **「📥 从简历助手导入」** 手动拉取最近一次同步的简历；
- 简历助手源码更新后，运行 powershell -ExecutionPolicy Bypass -File scripts\sync-resume-agent.ps1 即可同步到 public/resume-agent/。

---

## 📥 快速开始

### 桌面客户端（推荐）

👉 **[下载最新版](https://github.com/Tazz-zhu/one-click-shangan/releases/latest)** → 解压 → 双击 `一键上岸.exe`

> 💡 首次启动请在 ⚙️ 设置中配置 AI 供应商（DeepSeek / OpenAI API Key）

### 源码运行

```bash
git clone https://github.com/Tazz-zhu/one-click-shangan.git
cd one-click-shangan
npm install
npm start
# → 浏览器打开 http://localhost:3456（导航栏含「📄 简历助手」Tab，即整合后的一键上岸）
```

```bash
# 以 Electron 桌面客户端运行
npm run electron

# 热重载开发模式
npm run dev
```

---

## ✨ 功能全景

### 🔍 分析 & 押题
粘贴 JD 和简历，AI 自动完成 **JD 解析 → 简历解析 → 差距分析 → 并行押题生成**（行为面试 / 专业能力 / 项目深挖 / 压力测试 / HR 面，共 5 类题型）。支持 Boss直聘 / 51job 链接一键扒取、JD 智能排版。快速模式下仅生成 3 类核心题型，速度提升约 5 倍。

### 💪 单题练习
从押题清单选题作答，AI **五维深度评分**（STAR 完整性 / 量化程度 / 岗位匹配 / 表达结构 / 亮点突出），逐句点评标注优缺点，给出基于简历的改进版参考。支持 **AI 追问练习**、**AI 标准答案参考**、**纳入练习记录选项**（用户自主选择）。

### 💡 通用题库
20 道高频行为面试题，覆盖 **自我认知 / 职业规划 / 行为面试 / 压力应对 / 价值观** 五大分类。每道题都配有回答框架和危险区提示，AI 可结合你的简历和 JD **一键生成标准化回答**。

### 📡 面经采集
独立搜索小红书面经，AI 提取真实面试题。**双通道采集**（文字提取 + 截图 OCR），**三阶段 LLM 结构化**（粗提取 → 分类标签 → 增强输出），SSE 实时进度。支持手动粘贴小红书链接批量抓取。**面经整合分析**：跨公司/跨岗位对比，LLM 深度分析面试趋势。

### 🎤 全真模拟面试
AI 扮演面试官，从自我介绍开始多轮追问。**智能追问**不充分回答，多阶段面试（行为 → 专业 → 项目 → 压力）。结束后自动生成 **五维雷达图 + 逐题点评报告**，面试历史回顾记录每次得分。

### 👥 群面模拟
**无领导小组讨论**模拟，AI 根据 JD 生成讨论题目（4 种题型），3 位 AI 候选人（激进型 / 协作型 / 分析型）各具性格，结束后生成 **五维度评估报告 + 角色分析**。

### 🎯 专项训练
题型过滤 + 任务卡 + 计时器（30s 准备 + 120s 作答）+ 历史记录 + ECharts 趋势图。支持语音输入。

### 📄 简历优化
AI 逐段分析简历，对标 JD 给出逐句优化建议。**原文 vs 优化后左右对照**，**全文化化**生成可直接投递的简历，**阶段指示器**实时显示优化进度。自动生成自我介绍脚本（支持自定义 Prompt 追加个性化要求）。

### 🔬 公司调研
输入公司名，AI 搜索并生成公司知识图谱（业务/产品/文化/面试风格），调研历史自动保存。

### 📊 仪表盘
面试准备度评分（6 维度加权）、练习概览卡片、五维雷达图、题型覆盖饼图、练习日历热力图、快速复习卡片（翻转查看答案要点）、面试备战计划（倒计时 + 连续打卡 + 每日完成度）。

### 📝 错题集
分数 <60 自动标记，按题型 / 来源筛选，一键跳转重新练习。

### 💬 话术库
高分回答自动收藏，标签分类，DOCX 一键导出。

### 📥 导出
押题清单 / 练习历史 / 面试报告 / 话术库 / 面经库 → Markdown + DOCX 双格式导出。

### 🌙 暗色模式
跟随系统 + 手动切换 + 定时自动切换（6:00-18:00 浅色，其他时段深色），偏好记忆本地。

### ⌨️ 键盘快捷键
Space 暂停 / 1-5 评分 / Enter 提交 / Esc 关闭。

---

## 🔌 支持的 LLM

| 供应商 | 模型示例 | 说明 |
|--------|---------|------|
| DeepSeek | deepseek-chat, deepseek-reasoner | 推荐，性价比最高 |
| OpenAI | gpt-4o, gpt-4o-mini | 效果最佳 |
| 阿里百炼 | qwen-turbo, qwen-plus, qwen-max | 国产推荐 |
| 硅基流动 | Qwen, DeepSeek, GLM 系列 | 多模型聚合 |
| 豆包 (Doubao) | doubao-pro-32k | 字节跳动 |
| Ollama (本地) | llama3, qwen2.5, mistral | 完全离线 |
| 自定义 | 任何 OpenAI-compatible API | 灵活接入 |

在 ⚙️ 设置中一键添加 / 切换 / 测试连接，支持多供应商并行管理。

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│               Electron 桌面客户端                 │
│           NSIS 安装包 / portable 便携版           │
├─────────────────────────────────────────────────┤
│            Express Server (端口 3456)             │
│       SSE 流式 · 65 个 API 路由 · 会话管理        │
├────────────┬──────────────┬─────────────────────┤
│  Chatflow  │   LLM Client  │      OpenCLI        │
│  分析引擎   │   双后端切换   │   JD扒取 / 面经搜索  │
│  Prompt    │  ai-provider  │   小红书 / Web       │
│  编排管理   │  / standalone │   浏览器自动化       │
├────────────┴──────────────┴─────────────────────┤
│           AI Provider Kit (端口 8787)             │
│        OpenAI-compatible 统一网关                 │
│       DeepSeek / OpenAI / 百炼 / 硅基 / ...       │
└─────────────────────────────────────────────────┘
```

---

## 📁 项目结构

```
一键上岸/
├── server.js              # Express 主服务（65 个 API 路由）
├── electron/              # Electron 桌面客户端
│   ├── main.js            # 主进程（窗口管理 + 延迟启动网关）
│   └── preload.js         # 预加载脚本
├── chatflow/              # AI 引擎核心
│   ├── engine.js          # 分析流水线编排
│   ├── llm-client.js      # LLM 统一调用（双后端）
│   ├── prompts.js         # 20+ 个 System Prompt 模板
│   ├── ai-provider.js     # AI 供应商连接管理
│   ├── standalone-llm.js  # 独立 LLM 降级模式
│   ├── resume-parser.js   # 简历文件解析
│   ├── export-docx.js     # DOCX 文档生成
│   └── nodes/
│       ├── mianjing.js     # 面经采集（搜索+OCR+LLM）
│       ├── company-research.js  # 公司调研
│       └── opencli-setup.js     # OpenCLI 配置
├── public/                # 前端 SPA
│   ├── index.html         # 主页面（11 个功能 Tab + 📄 简历助手 Tab）
│   ├── resume-agent/      # 内置「一键上岸 简历助手」（纯前端，见 scripts/sync-resume-agent.ps1）
│   ├── app.js             # 前端逻辑（~5000 行）
│   ├── style.css          # 样式（亮色/暗色双主题）
│   ├── echarts.min.js     # ECharts 图表
│   └── group-kb-embed.html # 群面知识库嵌入页
├── scripts/              # 工具脚本（sync-resume-agent.ps1：同步简历助手源码）
├── knowledge/             # 知识库（JSON）
│   ├── behavioral-questions.json  # 20 道通用行为面试题
│   ├── group-interview.json       # 群面题库
│   ├── star-framework.json        # STAR 框架
│   └── general-qa.json            # 通用问答
├── .data/                 # 本地数据存储（无数据库依赖）
├── logs/                  # 错误日志
└── README.md              # 本文件
```

---

## 📦 打包发布

```bash
# 打包 Windows（NSIS 安装包 + portable 便携版）
npm run build:win

# 打包 macOS
npm run build:mac

# 打包 Linux
npm run build:linux

# 仅打包目录（不生成安装包，调试用）
npm run pack
```

输出目录：`release/`

---

## 📝 更新日志

### v1.0.0 (2026-08-14)
- 🎯 首个版本：AI 求职 Agent（简历助手 + 面试助手）
- 📄 简历助手：AI 对话引导写简历、模板排版、六维诊断、岗位匹配、PDF / Word / HTML / ATS 导出
- 🔗 简历 → 面试一键同步：ATS 纯文本 + JD 自动带入「分析 & 押题」
- 🔍 分析 & 押题 / 单题练习 / 全真模拟面试 / 面经采集 / 群面模拟 / 专项训练 / 公司调研
- 🛡️ 数据本地化：账号、面试记录、简历全部保存在本机
- ✅ 质量验证：简历助手 132 项 + 集成 20 项 + 贯通 11 项测试全部通过

---

## 📄 License

MIT © [Tazz-zhu](https://github.com/Tazz-zhu)

---

<div align="center">
<sub>Built with ❤️ for job seekers everywhere</sub>
</div>