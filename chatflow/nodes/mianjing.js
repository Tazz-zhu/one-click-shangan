// ============================================================
// 面经采集节点 V3 — 双通道（文字 + 截图OCR）+ LLM 三阶段结构化
// ============================================================

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { llm } = require('../llm-client');
const { MIANJING_CLEAN_SYSTEM } = require('../prompts');

// ─── tesseract.js OCR (lazy load, optional) ───
let Tesseract = null;
function getTesseract() {
  if (Tesseract) return Tesseract;
  try { Tesseract = require('tesseract.js'); return Tesseract; }
  catch { return null; }
}

// ─── 公共工具 ───
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openCli(cmd, timeoutMs = 25000) {
  return new Promise((resolve) => {
    console.log(`[面经] 异步: ${cmd.slice(0, 80)}...`);
    exec(cmd, { timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) {
          if (stdout && stdout.length > 20) { console.log(`[面经] 部分输出: ${stdout.length}B`); resolve(stdout); }
          else resolve(null);
        } else resolve(stdout);
      });
  });
}

// ─── 阶段一: 搜索笔记 ───
async function searchNotes(company, position) {
  const queries = [
    `${company} ${position} 面经`,
    `${company} 面试题`,
    `${position} 面试经验`
  ];
  const allNotes = [];
  const seen = new Set();

  for (const query of queries) {
    const raw = await openCli(`opencli xiaohongshu search "${query}" -f json --limit 8`);
    if (!raw) continue;
    try {
      const results = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const items = Array.isArray(results) ? results : (results?.notes || results?.data || []);
      for (const item of items) {
        const url = item.url || item.noteId || '';
        const title = item.title || item.display_title || '';
        if (url && title && !seen.has(url)) {
          seen.add(url);
          allNotes.push({ noteId: url, title, url, author: item.author || item.nickname || '', likes: item.likes || 0 });
        }
      }
      console.log(`[面经] 搜索 "${query}" → ${items.length} 篇`);
    } catch { console.warn(`[面经] 搜索 "${query}" 返回非JSON`); }
    await sleep(1500); // 不同关键词之间间隔
  }

  console.log(`[面经] 搜索完成: ${allNotes.length} 篇候选(去重)`);
  return allNotes.slice(0, 25);
}

// ─── 阶段二: 逐篇读取正文 ───
async function readNoteContent(n) {
  const url = n.noteId || n.url || '';
  if (!url) return null;

  const raw = await openCli(`opencli xiaohongshu note "${url}" -f md`, 20000);
  if (!raw || raw.length < 30) return null;

  let title = n.title || '';
  let body = '';
  const lines = raw.split('\n');

  // 策略1: table 格式 | title | ... |, | content | ... |
  for (const line of lines) {
    const m = line.match(/^\|\s*(title|content|author)\s*\|\s*(.+?)\s*\|/i);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'title') title = val || title;
      if (key === 'content' && val.length > body.length) body = val;
    }
  }

  // 策略2: markdown 段落提取
  if (body.length < 30) {
    const paragraphs = raw.split('\n\n').filter(p => {
      const t = p.trim();
      return t.length > 40 && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('*');
    });
    body = paragraphs.slice(0, 5).join('\n\n');
  }

  // 策略3: 全量兜底
  if (body.length < 20) {
    body = lines.filter(l => !l.match(/^\|/) && !l.match(/^#/) && l.trim().length > 15).join('\n');
  }

  // 检查是否有图片
  const imageUrls = [];
  const imgMdRe = /!\[.*?\]\((https?:\/\/[^)]+)\)/g; let m;
  while ((m = imgMdRe.exec(raw)) !== null) imageUrls.push(m[1]);
  const imgHtmlRe = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = imgHtmlRe.exec(raw)) !== null) imageUrls.push(m[1]);

  return {
    ...n, title, content: body.slice(0, 4000),
    hasImages: imageUrls.length > 0, imageCount: imageUrls.length,
    isLowText: body.length < 80  // 正文太少，很可能是图片帖
  };
}

// ─── OCR 通道: 截图 → tesseract 识别 ───
async function ocrNote(noteUrl, noteId, statusCb) {
  const T = getTesseract();
  if (!T) { console.log('[OCR] tesseract.js 未安装，跳过'); return ''; }

  const tmpDir = path.join(os.tmpdir(), 'yijianshangan-ocr');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const screenshotPath = path.join(tmpDir, `note_${Date.now()}.png`);

  try {
    // 1. opencli 截图
    if (statusCb) statusCb({ step: 'ocr', detail: '📸 正在截图笔记...', status: 'running' });
    console.log(`[OCR] 截图: ${noteUrl.slice(0, 60)}...`);
    await openCli(`opencli browser screen shot --url "${noteUrl}" --output "${screenshotPath}"`, 30000);
    if (!fs.existsSync(screenshotPath)) { console.log('[OCR] 截图文件不存在'); return ''; }

    // 2. tesseract OCR (中文+英文)
    if (statusCb) statusCb({ step: 'ocr', detail: '🔤 OCR 文字识别中（首次需下载中文语言包约30MB）...', status: 'running' });
    console.log(`[OCR] tesseract 识别中...`);
    let lastPct = -1;
    const { data } = await T.recognize(screenshotPath, 'chi_sim+eng', {
      tessedit_pageseg_mode: '6',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          console.log(`[OCR] 识别进度: ${pct}%`);
          if (pct > lastPct + 9 && statusCb) {  // 每10%推一次
            statusCb({ step: 'ocr', detail: `🔤 OCR 识别中 ${pct}%...`, status: 'running' });
            lastPct = pct;
          }
        } else if (m.status === 'loading tesseract core' || m.status === 'loading language traineddata') {
          if (statusCb) statusCb({ step: 'ocr', detail: `📥 下载 OCR 模型: ${Math.round(m.progress*100)}%`, status: 'running' });
        }
      }
    });
    const text = (data?.text || '').trim().replace(/\n{3,}/g, '\n\n');

    // 3. 清理临时文件
    try { fs.unlinkSync(screenshotPath); } catch {}

    console.log(`[OCR] 识别 ${text.length} 字`);
    return text.slice(0, 5000);
  } catch (e) {
    console.warn(`[OCR] 失败: ${e.message?.slice(0, 60)}`);
    try { fs.unlinkSync(screenshotPath); } catch {}
    return '';
  }
}

// ─── 阶段三: LLM 三阶段结构化提取 ───
// 阶段3a: 粗提取 — 从原始文本中提取所有可能的面试题
// 阶段3b: 分类Tag — 为每道题标注类型/轮次/频次
// 阶段3c: 增强输出 — 生成回答要点、技巧、高频考点

const STAGE3A_PROMPT = `你是一位面经分析助手。请从面经笔记中提取所有面试题目。

## 面经笔记内容
{{raw_text}}

## 提取要求
- 提取所有面试题（包括技术题、行为题、项目题、HR题）
- 题目保持原文措辞，不要改写
- 即使是不完整的题目也可以提取（标记为推测）
- 如果笔记中提到了面试者被问了什么但未给出完整问题，根据上下文推断

输出严格 JSON：
{
  "questions": [
    {
      "question": "完整题目文字",
      "source_note": 1,
      "confidence": "exact|inferred", 
      "raw_context": "题目在原文中的上下文（一句话）"
    }
  ],
  "extraction_notes": "提取情况说明（如XX题有原文, XX题为推测等）"
}`;

const STAGE3B_PROMPT = `你是一位面经分类专家。请为以下面试题标注类型。

## 待分类的面试题
{{questions_json}}

## 分类规则
- behavioral: 自我介绍、优缺点、团队协作、冲突处理、职业规划、行为面试
- technical: 专业知识、算法、编程语言、框架、系统设计
- project: 项目经历深挖、技术栈问询
- pressure: 压力测试、陷阱题、刁钻问题
- hr: 薪资期望、入职时间、公司了解

输出严格 JSON：
{
  "classified": [
    {
      "index": 0,
      "question": "题目原文",
      "type": "behavioral|technical|project|pressure|hr",
      "difficulty": 1-5,
      "frequency_note": "出现次数说明",
      "tags": ["标签1", "标签2"]
    }
  ]
}`;

const STAGE3C_PROMPT = `你是一位面试辅导专家。请为以下面试题生成回答要点和技巧。

## 已分类的面试题
{{classified_json}}

## 输出要求
为每道题补充：
- sample_answer_points: 2-4个核心回答要点
- tips: 1-3条面试技巧
- examiner_intent: 面试官想考察什么

输出严格 JSON：
{
  "enriched": [
    {
      "index": 0,
      "question": "题目原文",
      "type": "行为面试",
      "difficulty": 3,
      "sample_answer_points": ["要点1", "要点2"],
      "tips": ["技巧1"],
      "examiner_intent": "考察意图",
      "tags": []
    }
  ],
  "meta": {
    "interviewer_style": ["风格特征"],
    "lessons": ["关键经验教训"],
    "hot_topics": ["高频考点汇总"]
  }
}`;

async function stage3Extract(notesWithContent, statusCb) {
  if (!notesWithContent.length) return null;

  const report = (s) => { if (statusCb) statusCb(s); };

  // === 阶段3a: 粗提取 ===
  report({ step: 'llm_extract', detail: '🧠 AI 正在从笔记中提取面试题...', status: 'running' });

  const rawText = notesWithContent.map((n, i) =>
    `### 笔记${i+1}\n标题: ${n.title}\n正文: ${n.content}`
  ).join('\n---\n');

  let extracted;
  try {
    const prompt = STAGE3A_PROMPT.replace('{{raw_text}}', rawText.slice(0, 10000));
    extracted = await llm(prompt, '', { temperature: 0.2 });
  } catch (e) {
    console.warn('[面经] 阶段3a 失败:', e.message?.slice(0, 60));
    return { raw_notes: notesWithContent.length, questions: [], extraction_notes: 'LLM提取失败' };
  }

  const rawQuestions = extracted?.questions || [];
  console.log(`[面经] 阶段3a: 粗提取 ${rawQuestions.length} 道候选`);

  if (rawQuestions.length === 0) {
    // 降级：用旧版 MIANJING_CLEAN_SYSTEM 再试一次
    report({ step: 'llm_extract', detail: '⚠️ 粗提取0题，降级使用备用prompt...', status: 'warn' });
    try {
      const fallback = MIANJING_CLEAN_SYSTEM.replace('{{raw_mianjing}}', rawText.slice(0, 12000));
      const fbResult = await llm(fallback, '', { temperature: 0.3 });
      if (fbResult?.questions?.length) {
        console.log(`[面经] 降级提取: ${fbResult.questions.length} 道`);
        return {
          source_count: notesWithContent.length,
          questions: fbResult.questions.map(q => ({ ...q, source: '小红书' })),
          meta: fbResult.meta || {},
          extraction_method: 'fallback'
        };
      }
    } catch {}
    return { raw_notes: notesWithContent.length, questions: [], extraction_notes: '无题目' };
  }

  // === 阶段3b: 分类Tag ===
  report({ step: 'llm_classify', detail: `🏷️ 正在分类 ${rawQuestions.length} 道题...`, status: 'running' });

  let classified;
  try {
    const qJson = JSON.stringify(rawQuestions.map((q, i) => ({ index: i, question: q.question })));
    const promptB = STAGE3B_PROMPT.replace('{{questions_json}}', qJson.slice(0, 8000));
    classified = await llm(promptB, '', { temperature: 0.2 });
  } catch (e) {
    console.warn('[面经] 阶段3b 失败，跳过分类:', e.message?.slice(0, 60));
    // 跳过分类，直接进入阶段3c
  }

  const toClassify = classified?.classified || rawQuestions.map((q, i) => ({
    index: i, question: q.question, type: '专业能力', difficulty: 3, frequency_note: '', tags: []
  }));

  // === 阶段3c: 增强 ===
  if (rawQuestions.length <= 5) {
    report({ step: 'llm_enrich', detail: '✨ 正在生成回答要点...', status: 'running' });
    try {
      const cJson = JSON.stringify(toClassify.slice(0, 10));
      const promptC = STAGE3C_PROMPT.replace('{{classified_json}}', cJson.slice(0, 8000));
      const enriched = await llm(promptC, '', { temperature: 0.4 });
      const enrichedList = enriched?.enriched || toClassify;

      report({ step: 'llm_done', detail: `✅ 提取完成: ${enrichedList.length} 题`, status: 'ok' });
      return {
        source_count: notesWithContent.length,
        questions: enrichedList,
        meta: enriched?.meta || {},
        extraction_method: '3stage'
      };
    } catch (e) {
      console.warn('[面经] 阶段3c 失败:', e.message?.slice(0, 60));
    }
  }

  report({ step: 'llm_done', detail: `✅ 提取完成: ${toClassify.length} 题`, status: 'ok' });
  return {
    source_count: notesWithContent.length,
    questions: toClassify.map(q => ({
      question: q.question, type: q.type, difficulty: q.difficulty, tags: q.tags || []
    })),
    meta: {},
    extraction_method: '2stage'
  };
}

// ─── 主入口 ───
async function queryMianjing(company, position, statusCb) {
  const report = (s) => { if (statusCb) statusCb(s); };

  // 阶段一: 搜索
  report({ step: 'search', detail: '🔍 搜索小红书面经...', status: 'running' });
  const candidates = await searchNotes(company, position);

  if (candidates.length < 3) {
    report({ step: 'search', detail: `⚠️ 仅找到 ${candidates.length} 篇候选，少于3篇，退出`, status: 'warn' });
    return { success: false, data: { source_count: 0, sources: [], questions: [] } };
  }

  // 阶段二: 逐篇读取正文 + OCR
  const notesWithContent = [];
  let textSuccess = 0, ocrSuccess = 0, total = Math.min(candidates.length, 8);

  for (let i = 0; i < total; i++) {
    if (i > 0) await sleep(2000);
    const note = candidates[i];

    report({ step: 'read', detail: `📖 读取笔记 ${i+1}/${total}...`, status: 'running' });

    // 通道1: 文字提取
    const textResult = await readNoteContent(note);

    if (textResult && textResult.content.length > 30) {
      notesWithContent.push(textResult);
      textSuccess++;
    }

    // 通道2: 如果是图片帖或文字太少 → OCR
    const needsOcr = !textResult || textResult.isLowText;
    if (needsOcr) {
      const ocrText = await ocrNote(note.url || note.noteId, `${i}`, report);
      if (ocrText && ocrText.length > 30) {
        notesWithContent.push({ ...note, title: note.title, content: `[OCR识别]\n${ocrText}`, hasImages: true });
        ocrSuccess++;
      }
    }
  }

  const sources = notesWithContent.map(n => ({
    title: n.title, url: n.url || n.noteId || '',
    platform: '小红书', author: n.author, likes: n.likes
  }));

  console.log(`[面经] 阶段二完成: 文字${textSuccess} + OCR${ocrSuccess} = ${notesWithContent.length} 篇`);
  report({ step: 'read', detail: `✅ 内容采集: 文字${textSuccess}篇 + OCR${ocrSuccess}篇`, status: 'ok' });

  if (notesWithContent.length < 2) {
    report({ step: 'read', detail: '❌ 有效内容不足2篇', status: 'warn' });
    return { success: false, data: { source_count: notesWithContent.length, sources, questions: [] } };
  }

  // 阶段三: LLM 三阶段结构化
  const structured = await stage3Extract(notesWithContent, report);

  if (!structured || !structured.questions?.length) {
    report({ step: 'done', detail: '❌ 未能提取出面经题目', status: 'warn' });
    return {
      success: true,
      data: { source_count: notesWithContent.length, sources, questions: [], meta: { raw_notes: notesWithContent.length } }
    };
  }

  const qCount = structured.questions?.length || 0;
  report({ step: 'done', detail: `✅ 面经采集完成: ${notesWithContent.length} 篇笔记 → ${qCount} 道真题`, status: 'ok' });

  return {
    success: true,
    data: {
      source_count: notesWithContent.length,
      sources,
      questions: structured.questions,
      meta: structured.meta || {},
      extraction_method: structured.extraction_method || 'unknown'
    }
  };
}

// ─── 手动URL 批量抓取 ───
async function fetchNotesFromUrls(urls, statusCb) {
  if (!urls?.length) return null;

  const notesWithContent = [];
  for (let i = 0; i < Math.min(urls.length, 5); i++) {
    if (i > 0) await sleep(2000);
    const url = urls[i].trim();
    if (!url) continue;

    const textResult = await readNoteContent({ noteId: url, url, title: url });
    if (textResult) { notesWithContent.push(textResult); continue; }

    // text 失败 → OCR
    const ocrText = await ocrNote(url, `${i}`, statusCb);
    if (ocrText && ocrText.length > 30) {
      notesWithContent.push({ url, title: url, content: `[OCR]\n${ocrText}`, hasImages: true });
    }
  }

  if (!notesWithContent.length) return null;
  const structured = await stage3Extract(notesWithContent, statusCb);
  return {
    success: true,
    data: {
      source_count: notesWithContent.length,
      sources: notesWithContent.map(n => ({ title: n.title, url: n.url || '', platform: '小红书' })),
      questions: structured?.questions || [],
      meta: structured?.meta || {}
    }
  };
}

module.exports = { queryMianjing, fetchNotesFromUrls };
