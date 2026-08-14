// ============================================================
// Chatflow Engine - 模拟 Dify Chatflow 工作流引擎
// 管理节点执行顺序、条件分支、状态传递
// ============================================================

const { llm, fillTemplate } = require('./llm-client');
const prompts = require('./prompts');
const { queryMianjing } = require('./nodes/mianjing');
const { searchKnowledgeBase } = require('../knowledge');

// ============================================================
// Chatflow 1: JD解析 + 简历解析 + 差距分析 + 押题生成
// ============================================================
async function runAnalysisPipeline(jdText, resumeText, useMianjing = false) {
  // 节点1: JD解析
  const jdParsed = await llm(prompts.JD_PARSE_SYSTEM, jdText);

  // 节点2: 简历解析
  const resumeParsed = await llm(prompts.RESUME_PARSE_SYSTEM, resumeText);

  // 节点3: 差距分析
  const gapPrompt = fillTemplate(prompts.GAP_ANALYSIS_SYSTEM, {
    jd_parsed: jdParsed,
    resume_parsed: resumeParsed
  });
  const gapAnalysis = await llm(gapPrompt, '', { temperature: 0.5 });

  // 节点4: 面经采集（条件分支）
  let mianjingData = null;
  if (useMianjing) {
    try {
      // 先生成搜索词
      const queryPrompt = fillTemplate(prompts.MIANJING_QUERY_SYSTEM, {
        jd_parsed: jdParsed
      });
      // 搜索（简化：用JD中的公司名+岗位名）
      const company = jdParsed.company || '';
      const position = jdParsed.position || '';
      if (company && position) {
        mianjingData = await queryMianjing(company, position, jdParsed.keywords || []);
      }
    } catch (e) {
      console.warn('面经采集失败，降级为纯JD押题:', e.message);
    }
  }

  // 节点5: 押题生成
  const questionPrompt = fillTemplate(prompts.QUESTION_GEN_SYSTEM, {
    jd_parsed: jdParsed,
    resume_parsed: resumeParsed,
    gap_analysis: gapAnalysis,
    position: jdParsed.position || '',
    mianjing_data: mianjingData || '无面经数据，请基于JD和简历差距分析生成题目',
    focus_type: '综合'
  });
  const questions = await llm(questionPrompt, '', { temperature: 0.8 });

  // 节点6: 知识库增强（从本地知识库中检索相关题目补充）
  const kbQuestions = searchKnowledgeBase({
    company: jdParsed.company,
    position: jdParsed.position,
    industry: jdParsed.industry,
    keywords: jdParsed.keywords
  });

  return {
    jd: jdParsed,
    resume: resumeParsed,
    gap: gapAnalysis,
    questions: questions.questions || [],
    insights: questions.insights || {},
    mianjing: mianjingData,
    kb_supplement: kbQuestions.slice(0, 5)
  };
}

// ============================================================
// Chatflow 2: 模拟面试 —— 状态机驱动的对话
// ============================================================

const INTERVIEW_STAGES = ['intro', 'behavioral', 'professional', 'project', 'pressure', 'done'];

function createInterviewSession(analysisResult) {
  return {
    stage: 'intro',
    stageIndex: 0,
    currentQuestion: null,
    questionQueue: [...(analysisResult.questions || [])],
    askedQuestions: [],
    history: [],
    followUpCount: 0,
    maxFollowUps: 2,
    jdSummary: JSON.stringify(analysisResult.jd),
    resumeSummary: JSON.stringify(analysisResult.resume),
  };
}

async function interviewStart(session, company, position) {
  const systemPrompt = fillTemplate(prompts.INTERVIEW_START_SYSTEM, {
    company: company || '目标公司',
    position: position || '目标岗位',
    resume_summary: session.resumeSummary,
    jd_summary: session.jdSummary,
  });

  const msg = await llm(systemPrompt, '请开始面试', { jsonMode: false, temperature: 0.9 });
  session.stage = 'intro';
  session.history.push({ role: 'interviewer', content: msg });
  return msg;
}

async function interviewRespond(session, userAnswer) {
  session.history.push({ role: 'candidate', content: userAnswer });

  // 判断是否需要追问
  const followUpPromptStr = fillTemplate(prompts.FOLLOW_UP_SYSTEM, {
    original_question: session.currentQuestion || '自我介绍',
    candidate_answer: userAnswer
  });

  let followUp;
  try {
    followUp = await llm(followUpPromptStr, '', { temperature: 0.5 });
  } catch {
    followUp = { should_follow_up: false };
  }

  if (followUp.should_follow_up && session.followUpCount < session.maxFollowUps) {
    session.followUpCount++;
    session.history.push({ role: 'interviewer', content: followUp.follow_up_question });
    return {
      type: 'follow_up',
      message: followUp.follow_up_question,
      stage: session.stage,
      followUpType: followUp.follow_up_type
    };
  }

  // 进入下一题
  session.followUpCount = 0;
  return interviewNextQuestion(session);
}

async function interviewNextQuestion(session) {
  // 从题库中选下一题（按类型优先）
  const stageOrder = ['behavioral', 'behavioral', 'professional', 'professional', 'project', 'project', 'pressure'];
  const typeMap = {
    behavioral: '行为面试',
    professional: '专业能力',
    project: '项目深挖',
    pressure: '压力测试'
  };

  const currentStageIdx = INTERVIEW_STAGES.indexOf(session.stage);
  let nextType = typeMap.behavioral;

  if (currentStageIdx < stageOrder.length) {
    nextType = typeMap[stageOrder[Math.min(session.askedQuestions.length, stageOrder.length - 1)]] || typeMap.behavioral;
  }

  // 找到对应类型的未问过题目
  const available = session.questionQueue.filter(q =>
    !session.askedQuestions.includes(q.question) &&
    (q.type || '').includes(nextType)
  );

  let nextQ;
  if (available.length > 0) {
    nextQ = available[0];
  } else {
    // 无匹配类型，取任意未问题目
    const anyAvailable = session.questionQueue.filter(q => !session.askedQuestions.includes(q.question));
    if (anyAvailable.length === 0) {
      session.stage = 'done';
      return { type: 'end', message: '面试结束！请查看评估报告。', stage: 'done' };
    }
    nextQ = anyAvailable[0];
  }

  session.askedQuestions.push(nextQ.question);
  session.currentQuestion = nextQ.question;
  session.history.push({ role: 'interviewer', content: nextQ.question });

  return {
    type: 'question',
    message: nextQ.question,
    stage: session.stage,
    questionInfo: {
      type: nextQ.type,
      examinerIntent: nextQ.examiner_intent
    }
  };
}

// ============================================================
// Chatflow 3: 回答评估
// ============================================================
async function evaluateAnswer(question, answer, jdSummary, resumeText) {
  const evalPrompt = fillTemplate(prompts.EVALUATION_SYSTEM, {
    question,
    candidate_answer: answer,
    jd_summary: jdSummary,
    resume_summary: resumeText || ''
  });

  return await llm(evalPrompt, '', { temperature: 0.3 });
}

async function evaluateFullSession(session, resumeText) {
  const evaluations = [];
  let i = 0;
  for (const entry of session.history) {
    if (entry.role === 'candidate') {
      // 找对应的面试官问题
      const qIdx = session.history.slice(0, session.history.indexOf(entry))
        .filter(h => h.role === 'interviewer').length - 1;
      const question = session.askedQuestions[Math.max(0, qIdx)] || '自我介绍';
      try {
        const eval_ = await evaluateAnswer(question, entry.content, session.jdSummary, resumeText || session.resumeSummary || '');
        evaluations.push(eval_);
      } catch (e) {
        console.warn('评估失败:', e.message);
      }
      i++;
    }
  }

  // 汇总评分
  const totalScores = { star_completeness: 0, quantification: 0, position_match: 0, structure: 0, highlight: 0 };
  let count = 0;
  for (const ev of evaluations) {
    if (ev.scores) {
      for (const [k, v] of Object.entries(ev.scores)) {
        totalScores[k] = (totalScores[k] || 0) + v;
      }
      count++;
    }
  }
  const avgScores = {};
  for (const [k, v] of Object.entries(totalScores)) {
    avgScores[k] = Math.round(v / count);
  }
  const overall = Math.round(Object.values(avgScores).reduce((a, b) => a + b, 0) / 5);

  return {
    per_question: evaluations,
    average_scores: avgScores,
    overall_score: overall,
    total_questions: count
  };
}

// ============================================================
// Chatflow 4: 简历优化
// ============================================================
async function optimizeResume(jdParsed, resumeText) {
  const optPrompt = fillTemplate(prompts.RESUME_OPTIMIZE_SYSTEM, {
    jd_parsed: jdParsed,
    resume_text: resumeText
  });

  const result = await llm(optPrompt, '', { temperature: 0.5 });

  // 兜底: LLM 返回 JSON 解析失败时，从 raw 文本中尝试提取
  if (result.parse_error) {
    console.warn('[engine] 简历优化 JSON 解析失败，尝试从 raw 文本生成降级结果');
    // 从原始文本中提取可用的段落作为 optimizations
    const lines = (result.raw || '').split(/\n(?=[\d]+[\.\、]|[☞✓✅✔✕✗❌⚠])/).filter(Boolean);
    const fallbackOpts = [];
    for (const line of lines) {
      const parts = line.split(/[→\->]/);
      if (parts.length === 2 && parts[0].trim().length > 5 && parts[1].trim().length > 5) {
        fallbackOpts.push({ original: parts[0].trim(), suggestion: parts[1].trim(), reason: 'AI 原始输出（未解析为JSON）' });
      } else if (line.trim().length > 10) {
        fallbackOpts.push({ original: '(原始输出)', suggestion: line.trim(), reason: 'AI 原始输出' });
      }
    }
    return {
      optimizations: fallbackOpts.length > 0 ? fallbackOpts : [{
        original: '无法解析 AI 返回的结构化数据',
        suggestion: result.raw || '',
        reason: 'AI 以非 JSON 格式返回，已完整展示'
      }],
      elevator_pitch: jdParsed.position ? `我是${jdParsed.position}岗位的最佳候选人` : '',
      self_intro_script: ''
    };
  }

  return result;
}

// ============================================================
// Chatflow 4: 群面模拟
// ============================================================
async function groupInterviewStart(jdParsed, resumeParsed) {
  const topicPrompt = fillTemplate(prompts.GROUP_DISCUSSION_TOPIC, {
    jd_parsed: typeof jdParsed === 'string' ? jdParsed : JSON.stringify(jdParsed, null, 2),
    position: (jdParsed && jdParsed.position) || '通用岗位'
  });
  const topic = await llm(topicPrompt, '', { temperature: 0.8 });

  return {
    topic,
    discussionHistory: [],
    stage: 'intro',
    candidates: [
      { id: 'A', name: '候选人A', role: '激进型', style: '观点鲜明，抢先发言，偶尔强势' },
      { id: 'B', name: '候选人B', role: '协作型', style: '温和友善，补充观点，推动共识' },
      { id: 'C', name: '候选人C', role: '分析型', style: '数据驱动，提出质疑，逻辑严密' }
    ]
  };
}

async function groupInterviewRespond(session, userMessage) {
  if (!session.discussionHistory) {
    session.discussionHistory = [];
  }
  session.discussionHistory.push({ speaker: '我', message: userMessage });

  // 判断下一个发言者
  const nextSpeaker = getNextSpeaker(session);

  const responsePrompt = fillTemplate(prompts.GROUP_CANDIDATE_RESPONSE, {
    role: nextSpeaker.name + '（' + nextSpeaker.role + '）',
    topic: JSON.stringify(session.topic),
    discussion_history: JSON.stringify(session.discussionHistory.slice(-10)),
    user_last_message: userMessage
  });

  const response = await llm(responsePrompt, '', { temperature: 0.7 });
  session.discussionHistory.push({ speaker: nextSpeaker.name, message: response.message });

  return { speaker: nextSpeaker.name, role: nextSpeaker.role, message: response.message, action: response.action };
}

function getNextSpeaker(session) {
  const history = session.discussionHistory || [];
  const lastSpeaker = history[history.length - 1]?.speaker;
  // 轮流发言逻辑：如果用户刚发言，随机选一个AI候选人
  if (lastSpeaker === '我') {
    const candidates = session.candidates;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  // 如果AI刚发言，返回面试官做阶段性总结（每5轮）
  const aiCount = history.filter(m => m.speaker !== '我' && m.speaker !== '面试官').length;
  if (aiCount > 0 && aiCount % 5 === 0) {
    return { id: 'interviewer', name: '面试官', role: '面试官' };
  }
  // 轮换下一个候选人
  const lastAi = session.candidates.findIndex(c => c.name === lastSpeaker);
  const next = lastAi >= 0 ? (lastAi + 1) % session.candidates.length : 0;
  return session.candidates[next];
}

async function groupInterviewEvaluate(session) {
  const evalPrompt = fillTemplate(prompts.GROUP_EVALUATION, {
    discussion_log: JSON.stringify(session.discussionHistory || []),
    topic: JSON.stringify(session.topic)
  });
  return await llm(evalPrompt, '', { temperature: 0.5 });
}

module.exports = {
  runAnalysisPipeline,
  createInterviewSession,
  interviewStart,
  interviewRespond,
  interviewNextQuestion,
  evaluateAnswer,
  evaluateFullSession,
  optimizeResume,
  groupInterviewStart,
  groupInterviewRespond,
  groupInterviewEvaluate
};
