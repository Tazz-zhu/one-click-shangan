// ============================================================
// 公司调研节点 v3 — 面试导向 · opencli浏览器搜索 + LLM构建面试备战图谱
// ============================================================

const { execSync } = require('child_process');
const { llm } = require('../llm-client');

function browserSearch(query) {
  const encoded = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encoded}&setlang=zh-cn`;
  try {
    return execSync(
      `opencli web read --url "${url}" -f md --stdout true --wait-until domstable --wait 2`,
      { timeout: 20000, encoding: 'utf-8', maxBuffer: 3 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
    ) || '';
  } catch { return ''; }
}

function extractSnippets(markdown, maxItems = 6) {
  if (!markdown) return '';
  const lines = markdown.split('\n');
  const items = [];
  let i = 0;
  while (i < lines.length && items.length < maxItems) {
    const line = lines[i].trim();
    if (line && (line.match(/^\d+\.\s/) || line.match(/^\[.+\]\(http/) || line.match(/^###\s/))) {
      let snippet = '';
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nl = lines[j].trim();
        if (!nl) continue;
        if (nl.match(/^\d+\.\s/) || nl.match(/^###\s/)) break;
        snippet += nl + ' ';
      }
      const title = line.replace(/^\d+\.\s*/, '').replace(/^###\s*/, '').slice(0, 100);
      items.push(`${items.length + 1}. ${title}\n   ${snippet.trim().slice(0, 250)}`);
      i += 4;
    }
    i++;
  }
  return items.join('\n\n') || markdown.slice(0, 3000);
}

async function researchCompany(company, position = '', onProgress = null) {
  const progress = (d) => onProgress && onProgress(d);

  const dimensions = [
    { key: 'overview',   label: '公司概况', detail: '搜索基本信息...', query: `${company} 公司简介 主营业务 融资 规模` },
    { key: 'business',   label: '业务与产品', detail: '搜索核心业务...', query: `${company} 核心产品 技术服务` },
    { key: 'culture',    label: '企业文化', detail: '搜索文化与价值观...', query: `${company} 企业文化 工作氛围 福利` },
    { key: 'interview',  label: '面试情报', detail: '搜索面试评价...', query: `${company} 面试 面经 面评 site:zhihu.com OR site:maimai.cn OR site:nowcoder.com` },
    { key: 'news',       label: '最新动态', detail: '搜索近期新闻...', query: `${company} 最新动态 新闻 2025 2026` },
    { key: 'competitor', label: '竞争格局', detail: '搜索竞品信息...', query: `${company} 竞争对手 竞品 差异化` },
  ];

  const results = {};

  for (const dim of dimensions) {
    progress({ step: 'search', label: dim.label, detail: dim.detail, status: 'running' });
    const md = await new Promise(resolve => setTimeout(() => resolve(browserSearch(dim.query)), 0));
    results[dim.key] = extractSnippets(md, 6);
    progress({ step: 'search', label: dim.label, detail: `✅ ${dim.label}完成`, status: 'ok' });
  }

  const combined = Object.entries(results)
    .map(([key, text]) => {
      const labels = { overview: '公司概况', business: '业务与产品', culture: '企业文化',
                        interview: '面试情报', news: '最新动态', competitor: '竞争格局' };
      return `## ${labels[key]}\n${text || '(无结果)'}`;
    }).join('\n\n');

  if (combined.length < 200) {
    return { error: '浏览器搜索未返回足够信息，请检查公司名或网络' };
  }

  // ---- LLM 整合为面试备战知识图谱 ----
  progress({ step: 'llm', label: '知识图谱', detail: '正在整合面试备战信息...', status: 'running' });
  const prompt = `你是一位面试辅导专家。候选人即将面试「${company}」${position ? `的「${position}」岗位` : ''}。请根据搜索到的信息，从**面试备战**的角度构建一份公司认知图谱，帮助候选人在被问"你对我们公司了解多少？""你为什么想来我们公司？"等问题时能对答如流。

## 搜索到的原始信息
${combined.slice(0, 10000)}

## 输出要求
⚠️ 所有内容必须从面试者视角出发，目标受众是**即将面试的候选人**。

输出以下 JSON：
{
  "company_name": "公司全称",

  "elevator_pitch": "面试时一句话介绍公司（30字内，口述自然不僵硬）",

  "interview_talking_points": {
    "why_join": ["为什么想加入这家公司？→ 结合公司亮点回答的点"],
    "what_know": ["你对我们了解多少？→ 可以说的关键事实"],
    "my_value": ["我能带来什么价值？→ 结合候选人可能技能的切入角度"]
  },

  "company_basics": {
    "founded": "成立时间",
    "headquarters": "总部",
    "scale": "公司规模",
    "industry": "行业",
    "one_liner": "一句话干什么的"
  },

  "business_insight": {
    "main_business": ["核心业务线"],
    "flagship_product": "王牌产品/服务",
    "business_model": "B2B/B2C/平台？怎么赚钱？",
    "tech_focus": ["技术重点"]
  },

  "mock_qa": [
    {"q": "面试官可能这样问", "a_tips": "回答角度和关键词"}
  ],

  "competitive_edge": {
    "vs_competitors": "和竞品相比的独特优势",
    "recent_milestones": ["近期重大事件"],
    "risk_awareness": ["公司面临的挑战（面试中可以提及，显得你有深度思考）"]
  },

  "culture_signals": {
    "vibe": "公司氛围关键词",
    "perks": ["福利亮点"],
    "watch_out": ["需要留意的方面"]
  },

  "hot_prep": {
    "must_know_3": ["面试前必须知道的3件事"],
    "red_flags": ["危险信号（判断是否值得去）"],
    "green_flags": ["正面信号"],
    "suggested_question_to_ask": ["建议反问面试官的问题"]
  }
}`;

  try {
    const result = await llm(prompt, '', { temperature: 0.4 });
    const summary = buildInterviewSummary(result, company, position);
    return { ...result, _summary: summary };
  } catch (e) {
    return { error: '知识图谱生成失败: ' + e.message };
  }
}

function buildInterviewSummary(data, company, position) {
  if (!data || data.error) return '';
  const parts = [];
  if (data.elevator_pitch) parts.push(`🎤 一句话介绍：${data.elevator_pitch}`);
  if (data.interview_talking_points?.why_join?.length) {
    parts.push('\n💼 为什么想加入？');
    data.interview_talking_points.why_join.forEach(p => parts.push(`  • ${p}`));
  }
  if (data.mock_qa?.length) {
    parts.push('\n🎯 可能被问：');
    data.mock_qa.slice(0, 3).forEach(qa => parts.push(`  Q: ${qa.q}`));
  }
  if (data.hot_prep?.must_know_3?.length) {
    parts.push('\n🔑 面试必知：');
    data.hot_prep.must_know_3.forEach(f => parts.push(`  • ${f}`));
  }
  return parts.join('\n');
}

module.exports = { researchCompany };
