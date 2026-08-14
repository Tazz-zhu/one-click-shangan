/* ============================================================
 * ai.js — AI 能力层
 * 1) 对话式引导状态机 + 信息抽取
 * 2) 简历内容生成（口语 → 专业表述）
 * 3) AI 优化建议
 * 4) 六维诊断评分
 * 5) JD 岗位匹配分析
 *
 * 原则：所有内容基于用户输入，绝不虚构经历与量化数据。
 * 此版本内置确定性模拟引擎；可在 README 中接入真实 LLM API。
 * ============================================================ */

/* ================= 通用工具 ================= */
function flatSkills(resume) {
  const arr = [];
  (resume.skills || []).forEach(g => (g.items || []).forEach(i => arr.push(i)));
  return arr;
}

/* 敏感信息过滤（PRD 兜底机制：身份证号/银行卡号自动忽略并提示） */
function sanitizeSensitive(text) {
  let clean = String(text || '');
  const flags = [];
  const idRe = /\b\d{17}[\dXx]\b/g;
  if (idRe.test(clean)) {
    flags.push('身份证号');
    clean = clean.replace(idRe, '【已忽略】');
  }
  const bankRe = /(?<!\d)\d{16,19}(?!\d)/g;
  if (bankRe.test(clean)) {
    flags.push('银行卡号');
    clean = clean.replace(bankRe, '【已忽略】');
  }
  return { clean, flags };
}

/* 是否包含真实量化数据（排除 Vue3 / TypeScript 等版本号干扰） */
function hasQuantData(text) {
  return /(\d+(\.\d+)?%|\d+(\.\d+)?\s*[sS秒]|\d+\s*个|\d+\s*人|\d+\s*名|\d+\s*天|\d+\s*万|\d+\s*[kK]|\d+\s*条|\d+\s*次|\d+\s*篇|\d+\s*项|\d+\s*家|排名|前\s*\d+%|TOP\s*\d+|第\s*\d+\s*名|\d+\s*行|\d+\s*页)/.test(text);
}

function resumeText(resume) {
  const parts = [];
  parts.push(resume.name, resume.phone, resume.email, resume.city);
  parts.push(resume.education.school, resume.education.major, resume.education.degree);
  (resume.experiences || []).forEach(e => {
    parts.push(e.title, e.role, e.org, e.desc);
    (e.bullets || []).forEach(b => parts.push(b));
  });
  (resume.skills || []).forEach(g => (g.items || []).forEach(i => parts.push(i)));
  parts.push(resume.summary, resume.intention.position, resume.intention.city);
  return parts.join(' ').toLowerCase();
}

/* ================= 信息抽取 ================= */
function extractName(t) {
  let m = t.match(/(?:我叫|我是|名字(?:是|叫))\s*([\u4e00-\u9fa5·]{2,6})/);
  if (m) return m[1];
  if (/^[\u4e00-\u9fa5·]{2,4}$/.test(t.trim()) && !/(大学|学院|专业|学校)/.test(t)) return t.trim();
  return '';
}

function extractSchool(t) {
  const m = t.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·]{2,24}?(?:大学|学院|职业技术学院|学校))/);
  return m ? m[1].replace(/^(在|于|就读于|来自|去)/, '') : '';
}

function extractMajor(t) {
  let m = t.match(/(?:专业(?:是|为|：|:)?|主修|学(?:的|习的)?(?:是|：|:)?)\s*([\u4e00-\u9fa5A-Za-z]{2,16})/);
  if (m) {
    const cand = m[1].replace(/专业$/,'').replace(/^(读|在|就是|的是)/, '');
    if (/[\u4e00-\u9fa5]{2,}/.test(cand) && !/(大学|学院|学校)/.test(cand)) return cand;
  }
  for (const major of COMMON_MAJORS) if (t.includes(major)) return major;
  m = t.match(/([\u4e00-\u9fa5A-Za-z]{2,16})专业/);
  if (m) return m[1];
  return '';
}

function extractDegree(t) {
  if (/博士/.test(t)) return '博士';
  if (/硕士|研究生/.test(t)) return '硕士';
  if (/本科/.test(t)) return '本科';
  if (/大专|专科/.test(t)) return '大专';
  return '';
}

function extractYear(t) {
  const m = t.match(/20\d{2}/);
  return m ? m[0] : '';
}

function extractPhone(t) {
  const m = t.match(/1[3-9]\d{9}/);
  return m ? m[0] : '';
}

function extractEmail(t) {
  const m = t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? m[0] : '';
}

function extractCity(t) {
  for (const c of CITIES) if (t.includes(c)) return c;
  const m = t.match(/期望在?([\u4e00-\u9fa5]{2,6})(?:工作|发展|就业|上班)/);
  return m ? m[1] : '';
}

function extractPosition(t) {
  const m = t.match(/(?:岗位|职位|方向|意向)(?:是|为|：|:)?\s*([\u4e00-\u9fa5A-Za-z0-9/（）()]{2,18})/);
  if (m) {
    const cand = m[1].replace(/[，。；,;]/g, '').replace(/^(职责|要求|描述|类型)/, '');
    if (cand.length >= 2 && !/职责/.test(cand)) return cand;
  }
  const keys = ['前端开发','前端','后端开发','后端','算法工程师','算法','数据分析','数据挖掘','产品经理','产品','运营','测试开发','测试','UI设计','视觉设计','交互设计','Java开发','Python开发','Web开发','实习生'];
  for (const k of keys) if (t.includes(k)) return k;
  return '';
}

function extractTech(text) {
  const lower = text.toLowerCase();
  const found = [];
  TECH_KEYWORDS.forEach(k => {
    if (k === 'C' || k === 'CSS' || k === 'JS' || k === 'HTML' || k === 'Vue' || k === 'React' || k === 'SQL') return; // 由细分词覆盖
    if (lower.includes(k.toLowerCase())) found.push(k);
  });
  if (/(?:^|[^.\w])js(?![.\w])|javascript/i.test(text)) found.push('JavaScript');
  if (/(?:^|[^.\w])ts(?![.\w])|typescript/i.test(text)) found.push('TypeScript');
  if (/vue3?/i.test(text)) found.push('Vue3');
  if (/react/i.test(text)) found.push('React');
  if (/\bhtml5?\b/i.test(text)) found.push('HTML5');
  if (/\bcss3?\b/i.test(text)) found.push('CSS3');
  if (/\bsql\b/i.test(text)) found.push('SQL');
  return [...new Set(found)];
}

function classifySkill(item) {
  const t = item.toLowerCase();
  if (/(vue|react|typescript|html|css|javascript|前端|小程序)/.test(t)) return '前端';
  if (/(python|java|go|c\+\+|spring|django|flask|node|后端)/.test(t)) return '后端';
  if (/(git|webpack|vite|docker|kubernetes|linux|nginx|ci\/cd)/.test(t)) return '工具';
  if (/(mysql|redis|mongodb|postgresql|sql)/.test(t)) return '数据库';
  if (/(机器|深度|tensorflow|pytorch|数据|算法|opencv|爬虫)/.test(t)) return '数据/AI';
  return '其他';
}

function mergeSkills(resume, items) {
  if (!Array.isArray(resume.skills)) resume.skills = [];
  items.forEach(item => {
    const cat = classifySkill(item);
    let group = resume.skills.find(g => g.category === cat);
    if (!group) {
      group = { category: cat, items: [] };
      resume.skills.push(group);
    }
    if (!group.items.some(i => i.toLowerCase() === item.toLowerCase())) group.items.push(item);
  });
}

/* ================= 对话状态机 ================= */
const STAGE_ORDER = ['name','school','contact','edu','city','exp_type','exp_title','exp_role','exp_time','exp_detail','exp_result','exp_more','skill','intention','jd','summary','done'];

const STAGE_LABEL = {
  name: '了解你的基本信息', school: '了解学校与专业', contact: '收集联系方式',
  edu: '确认教育背景', city: '确认现居城市', exp_type: '挖掘经历类型', exp_title: '了解经历名称',
  exp_role: '了解担任角色', exp_time: '确认经历时间', exp_detail: '了解具体内容',
  exp_result: '挖掘量化成果', exp_more: '询问更多经历', skill: '补充专业技能',
  intention: '确认求职意向', jd: '收集岗位 JD', summary: '生成自我评价', done: '信息收集完成'
};

const STAGE_GROUP = {
  name: 'basic', school: 'basic', contact: 'basic', edu: 'edu', city: 'basic',
  exp_type: 'exp', exp_title: 'exp', exp_role: 'exp', exp_time: 'exp', exp_detail: 'exp', exp_result: 'exp', exp_more: 'exp',
  skill: 'skill', intention: 'intent', jd: 'intent', summary: 'intent', done: 'intent'
};

const GROUP_PCT = { basic: 0, edu: 22, exp: 38, skill: 76, intent: 88 };

const Chat = {
  start() {
    if (S.chat.started) return;
    S.chat.started = true;
    S.chat.stage = 'name';
    S.chat.messages = [{ role: 'ai', text: CHAT_OPENING.title + '\n' + CHAT_OPENING.body }];
    S.chat.quick = [];
    saveState();
  },

  pushUser(text) {
    S.chat.messages.push({ role: 'user', text });
  },

  process(text, flags) {
    this._missedThisTurn = false;
    if (flags && flags.length) {
      this._ai('我注意到你刚才输入了' + flags.join('、') + '——简历中不建议包含这类敏感信息，我已自动忽略，不会记录。手机号和邮箱足够用于联系。');
    }
    const t = text.toLowerCase();
    if (t === '跳过' || t === 'skip' || t === '下一条') {
      this._skip();
    } else {
      this._process(text);
    }
    if (!this._missedThisTurn) S.chat.unrecognized = 0;
    saveState();
  },

  send(rawText) {
    const text = (rawText || '').trim();
    if (!text) return;
    const { clean, flags } = sanitizeSensitive(text);
    this.pushUser(clean);
    this.process(clean, flags);
  },

  _hit() {
    this._missedThisTurn = false;
    S.chat.unrecognized = 0;
  },

  _misunderstood(msg) {
    this._missedThisTurn = true;
    S.chat.unrecognized = (S.chat.unrecognized || 0) + 1;
    if (S.chat.unrecognized >= 3) {
      S.chat.unrecognized = 0;
      this._ai('连续几次没有理解你的回答 😅 为了不耽误时间，已切换到「表单模式」——点击右侧面板中的「编辑」按钮可以直接填写，或回复「继续对话」回到 AI 引导。');
      S.chat.quick = [['去表单填写', '去表单填写'], ['继续对话', '继续对话']];
    } else {
      this._ai(msg + (S.chat.unrecognized >= 2 ? '\n\n（如果觉得麻烦，回复「去表单填写」直接编辑）' : ''));
    }
  },

  _skip() {
    const cur = S.chat.stage;
    const nextMap = {
      name: 'school', school: 'contact', contact: 'edu', edu: 'city', city: 'exp_type',
      exp_type: 'skill', exp_title: 'exp_more', exp_role: 'exp_more', exp_time: 'exp_more',
      exp_detail: 'exp_result', exp_result: 'exp_more', exp_more: 'skill',
      skill: 'intention', intention: (S.chat.pendingIntent === 'city' ? 'summary' : (S.chat.pendingIntent === 'salary' ? 'summary' : 'city')),
      summary: 'done', jd: 'summary'
    };
    if (cur === 'intention') {
      if (S.chat.pendingIntent === 'position') { S.chat.pendingIntent = 'city'; this._askCity(); }
      else if (S.chat.pendingIntent === 'city') { S.chat.pendingIntent = 'salary'; this._askSalary(); }
      else { this._askJd(); }
      return;
    }
    if (cur === 'jd') { this._askSummary(); return; }
    const next = nextMap[cur] || 'skill';
    S.chat.stage = next;
    this._ask(next);
  },

  _process(text) {
    if (/去表单|表单模式/.test(text)) {
      this._ai('好的，已切换到表单模式 📋 你可以点击右侧「已提取信息」面板中的「编辑」按钮直接填写各项信息；填写后点击「生成简历」即可。需要 AI 引导时回复「继续对话」。');
      S.chat.quick = [['继续对话', '继续对话']];
      return;
    }
    if (/继续对话|回到引导/.test(text)) {
      this._ai('好的，我们继续！回到「' + (STAGE_LABEL[S.chat.stage] || '当前') + '」环节：请直接输入你的回答，或回复「跳过」继续下一步。');
      return;
    }
    const stage = S.chat.stage;
    const R = S.resume;
    let said = false;

    if (stage === 'name') {
      const name = extractName(text);
      const school0 = extractSchool(text);
      const major0 = extractMajor(text);
      if (name && school0 && major0) {
        R.name = name;
        R.education.school = school0;
        R.education.major = major0;
        this._ai('好的 ' + name + '！在 ' + school0 + ' 读' + major0 + '，很不错的专业 👍 方便留一下手机号和邮箱吗？简历上需要联系方式。');
        S.chat.stage = 'contact';
        S.chat.quick = [['先跳过', '跳过']];
      } else if (name) {
        R.name = name;
        this._ai('好的 ' + name + '！你目前在读什么学校和专业呢？');
        S.chat.stage = 'school';
      } else {
        this._misunderstood('我该怎么称呼你呢？（直接输入你的名字即可）');
      }
      said = true;
    }

    else if (stage === 'school') {
      const school = extractSchool(text);
      const major = extractMajor(text);
      if (school) R.education.school = school;
      if (major) R.education.major = major;
      if (school && major) {
        this._ai('明白了！在 ' + school + ' 读' + major + '，很不错的专业 👍 方便留一下手机号和邮箱吗？简历上需要联系方式。');
        S.chat.stage = 'contact';
      } else if (school || major) {
        const missing = !school ? '学校' : '专业';
        this._ai('收到！还差一个信息：你的' + missing + '是什么？');
      } else {
        this._misunderstood('没太听清，可以再说一下你的学校和专业吗？例如「XX大学 计算机科学」');
      }
      said = true;
    }

    else if (stage === 'contact') {
      const phone = extractPhone(text);
      const email = extractEmail(text);
      if (phone) R.phone = phone;
      if (email) R.email = email;
      if (!phone && !email) {
        this._misunderstood('没找到手机号或邮箱，可以再发一次吗？例如「13800138000，liming@xx.edu.cn」');
        return;
      }
      this._ai('联系方式记下了 ✅ 接下来确认一下教育背景：你的学历和预计毕业时间是什么？（例如「本科，2027年6月毕业」）');
      S.chat.stage = 'edu';
      S.chat.quick = [['本科 · 2027届', '本科，2027届毕业'], ['硕士 · 2026届', '硕士，2026届毕业'], ['博士 · 2025届', '博士，2025届毕业'], ['跳过', '跳过']];
      said = true;
    }

    else if (stage === 'edu') {
      const degree = extractDegree(text);
      const year = extractYear(text);
      if (degree) R.education.degree = degree;
      if (year) R.education.gradDate = year + '-06';
      if (degree && year) {
        this._askResidentCity();
      } else {
        const missing = !degree ? '学历' : '毕业时间';
        this._ai('还差' + missing + '信息，例如「本科，2027年6月毕业」');
      }
      said = true;
    }

    else if (stage === 'city') {
      const city = extractCity(text);
      if (city) {
        R.city = city;
        this._ai('好，你目前在' + city + ' 📍 基本信息都齐了！接下来是重头戏——挖掘你的经历！\n\n你有过实习、项目、竞赛或社团经历吗？课程设计、自学项目、志愿服务都可以写进简历哦。');
        S.chat.stage = 'exp_type';
        S.chat.quick = [['实习经历', '实习经历'], ['项目经历', '项目经历'], ['竞赛获奖', '竞赛获奖'], ['社团活动', '社团活动'], ['没有经历', '没有经历']];
      } else {
        this._misunderstood('你目前所在城市是哪里？直接说城市名，例如「北京」「杭州」。');
      }
      said = true;
    }

    else if (stage === 'exp_type') {
      const low = text.toLowerCase();
      let type = '';
      if (/实习/.test(text)) type = 'intern';
      else if (/项目|课程设计|课设/.test(text)) type = 'project';
      else if (/竞赛|比赛|ACM|获奖/.test(text)) type = 'competition';
      else if (/社团|志愿|学生工作|学生会/.test(text)) type = 'club';
      if (type) {
        const exp = { id: uid('e'), type, title: '', role: '', org: '', start: '', end: '', desc: '', bullets: [] };
        S.resume.experiences.push(exp);
        S.chat.expPending = exp.id;
        S.chat.expField = 'title';
        const typeName = { intern:'实习', project:'项目', competition:'竞赛', club:'社团' }[type];
        this._ai('太棒了！这段' + typeName + '经历叫什么名字/主题？');
        S.chat.stage = 'exp_title';
        S.chat.quick = [];
      } else if (/没有|暂无|无/.test(text)) {
        this._ai('没关系，很多同学一开始都觉得「没什么可写」。课程设计、社团活动、自学项目都可以是很好的素材。\n\n如果真的没有，我们直接进入技能补充环节：你掌握哪些专业技能？');
        S.chat.stage = 'skill';
        S.chat.quick = [['前端：Vue3 / React / TS', 'Vue3、React、TypeScript'], ['Python / 数据分析', 'Python、数据分析'], ['数据库 / 运维', 'MySQL、Redis、Linux'], ['帮我从经历中提取', '帮我提取']];
      } else {
        this._ai('这段经历属于哪种类型呢？实习 / 项目 / 竞赛 / 社团，或者也可以直接描述你做过什么。');
      }
      said = true;
    }

    else if (stage === 'exp_title') {
      const exp = this._pendingExp();
      if (!exp) { S.chat.stage = 'skill'; this._askSkill(); return; }
      exp.title = text.replace(/^叫做?|^叫|^是|^主题(?:是|为)?/g, '').trim();
      this._ai('「' + exp.title + '」听起来不错！你在这段经历中担任什么角色？');
      S.chat.stage = 'exp_role';
      S.chat.quick = [['负责人', '负责人'], ['核心成员', '核心成员'], ['参与者', '参与者']];
      said = true;
    }

    else if (stage === 'exp_role') {
      const exp = this._pendingExp();
      if (exp) {
        const raw = text.replace(/^(担任|我是|我的角色是|我的角色为|角色是|角色为)/g, '').trim();
        const role = extractRole(raw);
        exp.role = role || raw.slice(0, 8);
        const rest = role ? raw.slice(raw.indexOf(role) + role.length).replace(/^[，,、\s]+/, '').trim() : '';
        if (rest && rest.length >= 4 && !(exp.desc || '').includes(rest)) {
          exp.desc = exp.desc ? exp.desc + '；' + rest : rest;
        }
      }
      this._ai('大致时间是什么时候？例如「2025.03 - 2025.06」，如果是进行中可以说「2025.09 - 至今」。');
      S.chat.stage = 'exp_time';
      S.chat.quick = [];
      said = true;
    }

    else if (stage === 'exp_time') {
      const exp = this._pendingExp();
      const range = normalizeDateRange(text);
      if (exp) {
        exp.start = range.start;
        exp.end = range.end;
      }
      this._ai('时间记下了 ⏰ 当时具体做了什么？\n\n试着用「动词 + 事情 + 结果」来描述，比如「用 Vue3 开发了商品列表页，支持搜索和筛选」。说大白话也没关系，我会帮你润色。');
      S.chat.stage = 'exp_detail';
      S.chat.quick = [];
      said = true;
    }

    else if (stage === 'exp_detail') {
      const exp = this._pendingExp();
      if (exp) {
        exp.desc = text;
        const techs = extractTech(text);
        if (techs.length) {
          mergeSkills(S.resume, techs);
          this._ai('收到！我注意到你提到了 ' + techs.slice(0, 4).join('、') + '，已自动加入你的技能清单 ✅');
        }
      }
      this._ai('这段经历有什么可以量化的成果吗？比如：覆盖了多少用户、效率提升了多少、拿了什么奖、完成了多少功能？\n\n（没有也没关系，说「没有」就行，我不会编造数据）');
      S.chat.stage = 'exp_result';
      S.chat.quick = [['没有量化数据', '没有量化数据'], ['帮我润色', '帮我润色']];
      said = true;
    }

    else if (stage === 'exp_result') {
      const exp = this._pendingExp();
      if (exp && !/没有|暂无|不用|算了/.test(text)) {
        const result = text.replace(/^(成果(?:是|为)?|结果是|量化成果(?:是|为)?)[：:]?/, '').replace(/^(有，|有,|有。|嗯，|嗯,|大概|大约|一些)/, '').trim();
        if (result) exp.desc = (exp.desc || '') + '；' + result;
      }
      if (exp && /帮我润色/.test(text)) {
        // 交给生成环节统一润色
      }
      this._ai('这段经历已经记下了 ✍️ 还有其它经历要补充吗？实习、竞赛、社团都可以。');
      S.chat.stage = 'exp_more';
      S.chat.quick = [['再添加一段', '再添加一段'], ['没有了', '没有了']];
      said = true;
    }

    else if (stage === 'exp_more') {
      if (/没有|没了|暂无|不需要|够了|暂时|算了/.test(text)) {
        this._askSkill();
      } else if (/再|还有|继续|添加|再添加/.test(text)) {
        S.chat.stage = 'exp_type';
        this._ai('好的！这段经历属于哪种类型呢？');
        S.chat.quick = [['实习经历', '实习经历'], ['项目经历', '项目经历'], ['竞赛获奖', '竞赛获奖'], ['社团活动', '社团活动']];
      } else {
        this._askSkill();
      }
      said = true;
    }

    else if (stage === 'skill') {
      const techs = extractTech(text);
      if (techs.length) {
        mergeSkills(S.resume, techs);
        this._ai('技能收到 ✅ 已添加：' + techs.slice(0, 8).join('、') + '\n\n最后一步——你的求职意向：想投什么岗位？');
        S.chat.stage = 'intention';
        S.chat.pendingIntent = 'position';
        S.chat.quick = [['前端开发', '前端开发'], ['后端开发', '后端开发'], ['产品经理', '产品经理'], ['数据分析', '数据分析'], ['运营', '运营']];
      } else if (/帮我|提取/.test(text)) {
        const all = (S.resume.experiences || []).map(e => e.title + ' ' + e.desc + ' ' + (e.bullets || []).join(' ')).join(' ');
        const techs2 = extractTech(all);
        if (techs2.length) {
          mergeSkills(S.resume, techs2);
          this._ai('已从你的经历中自动提取技能：' + techs2.slice(0, 8).join('、') + ' ✅\n\n最后一步——你的求职意向：想投什么岗位？');
          S.chat.stage = 'intention';
          S.chat.pendingIntent = 'position';
          S.chat.quick = [['前端开发', '前端开发'], ['后端开发', '后端开发'], ['产品经理', '产品经理'], ['数据分析', '数据分析'], ['运营', '运营']];
        } else {
          this._ai('暂时没从经历里提取到明确技能，你可以直接列出，例如「Vue3、TypeScript、Git」');
        }
      } else {
        this._misunderstood('可以再具体一点列出技能关键词吗？例如「Vue3、TypeScript、Git」；或者回复「帮我从经历中提取」。');
      }
      said = true;
    }

    else if (stage === 'intention') {
      const pi = S.chat.pendingIntent || 'position';
      if (pi === 'position') {
        const pos = extractPosition(text);
        if (pos) {
          S.resume.intention.position = pos;
          S.chat.pendingIntent = 'city';
          this._askCity();
        } else {
          this._misunderstood('你想投什么方向的岗位呢？例如「前端开发工程师」「产品经理」。');
        }
      } else if (pi === 'city') {
        const city = extractCity(text);
        if (city) {
          S.resume.intention.city = city;
          S.chat.pendingIntent = 'salary';
          this._askSalary();
        } else {
          this._misunderstood('期望在哪个城市工作？可以直接说城市名。');
        }
      } else {
        const salary = text.match(/[\d.]+k|面议|[\d.]+K/i) ? text : (extractPosition(text) || text);
        S.resume.intention.salary = /面议/.test(text) ? '面议' : salary;
        this._askJd();
      }
      said = true;
    }

    else if (stage === 'jd') {
      if (/跳过|没有|暂无|不需要/.test(text)) {
        this._askSummary();
      } else {
        const isJd = /岗位职责|任职要求|工作内容|职位描述|职责|要求|学历|负责|熟悉|掌握/.test(text) || text.length > 60;
        if (isJd) {
          S.jdText = text;
          this._ai('收到目标岗位 JD ✅ 我会在生成简历时结合岗位要求调整技能顺序与关键词密度。\n\n最后一步：要不要我根据你的经历生成一段自我评价？');
          S.chat.stage = 'summary';
          S.chat.quick = [['帮我生成', '帮我生成'], ['不需要', '不需要']];
        } else {
          this._ai('这段内容看起来不像完整的 JD（职位描述）。可以粘贴「岗位职责 + 任职要求」全文，或者回复「跳过」。');
        }
      }
      said = true;
    }

    else if (stage === 'summary') {
      if (/生成|好|要|写/.test(text)) {
        S.resume.summary = buildSummary(S.resume);
        this._ai('自我评价已生成 ✅ 所有信息都收集完成了！\n\n点击右侧「生成简历」按钮，我会把你的经历整理成专业简历 🎉');
      } else {
        this._ai('好的，先不生成自我评价。所有信息都收集完成了！\n\n点击右侧「生成简历」按钮' + (S.jdText ? '，我会结合你提供的 JD 定制内容' : '') + ' 🎉');
      }
      S.chat.stage = 'done';
      S.chat.quick = [];
      said = true;
    }

    if (!said) {
      this._misunderstood('收到！还有其他想补充的吗？可以继续说，或回复「跳过」继续下一步。');
    }
  },

  _pendingExp() {
    if (!S.chat.expPending) return null;
    return S.resume.experiences.find(e => e.id === S.chat.expPending) || null;
  },

  _ai(text) {
    S.chat.messages.push({ role: 'ai', text });
  },

  _askResidentCity() {
    S.chat.stage = 'city';
    this._ai('基本信息快齐了！你目前所在城市是哪里？（企业校招常关注你的现居地/生源地）');
    S.chat.quick = [['北京', '北京'], ['上海', '上海'], ['深圳', '深圳'], ['杭州', '杭州'], ['广州', '广州'], ['其他城市', '其他']];
  },

  _askCity() {
    this._ai('好的，目标岗位是「' + (S.resume.intention.position || '') + '」🎯 期望在哪个城市工作？');
    S.chat.quick = [['北京', '北京'], ['上海', '上海'], ['深圳', '深圳'], ['杭州', '杭州'], ['广州', '广州'], ['其他城市', '其他']];
  },

  _askSalary() {
    this._ai('期望薪资范围大概是多少？');
    S.chat.quick = [['5-8K', '5-8K'], ['8-12K', '8-12K'], ['12-20K', '12-20K'], ['面议', '面议']];
  },

  _askSummary() {
    S.chat.stage = 'summary';
    this._ai('最后一步：要不要我根据你的经历，生成一段自我评价？');
    S.chat.quick = [['帮我生成', '帮我生成'], ['不需要', '不需要']];
  },

  _askJd() {
    S.chat.stage = 'jd';
    this._ai('如果目标岗位有 JD（职位描述），现在可以粘贴进来——我会让简历内容更贴合岗位要求（调整技能顺序、补关键词）。没有的话回复「跳过」。');
    S.chat.quick = [['跳过', '跳过']];
  },

  _askSkill() {
    S.chat.stage = 'skill';
    this._ai('好的！进入技能补充环节：你掌握哪些专业技能？可以直接列出关键词，例如「Vue3、TypeScript、Git」。');
    S.chat.quick = [['前端：Vue3 / React / TS', 'Vue3、React、TypeScript'], ['Python / 数据分析', 'Python、数据分析'], ['数据库 / 运维', 'MySQL、Redis、Linux'], ['帮我从经历中提取', '帮我提取']];
  },

  progress() {
    const stage = S.chat.stage;
    const group = STAGE_GROUP[stage] || 'basic';
    let pct = GROUP_PCT[group] || 0;
    if (group === 'basic') {
      pct = S.resume.name ? (S.resume.education.school ? 18 : 8) : 2;
    } else if (group === 'exp') {
      const n = S.resume.experiences.length;
      pct = 38 + Math.min(30, n * 8);
      if (stage === 'exp_more' || stage === 'exp_result') pct = 66;
    } else if (group === 'intent') {
      pct = S.resume.intention.position ? 92 : 88;
    }
    if (stage === 'done') pct = 100;
    return { pct, group, label: STAGE_LABEL[stage] || '对话引导' };
  },

  stageStatus() {
    const done = {};
    ['basic','edu','exp','skill','intent'].forEach(g => done[g] = false);
    const order = ['basic','edu','exp','skill','intent'];
    const cur = STAGE_GROUP[S.chat.stage];
    const idx = order.indexOf(cur);
    for (let i = 0; i <= idx; i++) done[order[i]] = true;
    if (S.chat.stage === 'done') order.forEach(g => done[g] = true);
    return done;
  }
};

/* ================= 内容生成 ================= */

/* 角色词抽取：从「实习生，负责订单模块开发」中提取「实习生」 */
function extractRole(t) {
  let s = String(t || '').trim().replace(/^(我(?:是|担任)|担任|我的角色(?:是|为)|角色(?:是|为))/, '').trim();
  if (!s) return '';
  const head = s.split(/[，,、\s]/)[0].trim();
  if (head && head.length >= 2 && head.length <= 8) return head;
  return s.slice(0, 8);
}

/* 单段日期解析：2025年6月 / 2025.06 / 2025-06 / 至今 → YYYY.MM 或 至今 */
function parseCnDatePart(str) {
  const s = String(str || '').trim();
  if (!s) return '';
  if (/^(至今|现在|目前)$/.test(s)) return '至今';
  let m = s.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
  if (m) return m[1] + '.' + String(m[2]).padStart(2, '0');
  m = s.match(/(20\d{2})[.\-/](\d{1,2})/);
  if (m) return m[1] + '.' + String(m[2]).padStart(2, '0');
  m = s.match(/(20\d{2})\s*年/);
  return m ? m[1] : '';
}

/* 经历时间规范化：统一为 YYYY.MM 或 YYYY.MM - YYYY.MM（「至今」保留） */
function normalizeDateRange(text) {
  const s = String(text || '').trim();
  if (!s) return { start: '', end: '' };
  if (/^(至今|现在|目前)$/.test(s)) return { start: '至今', end: '' };
  const sep = s.match(/^(.+?)\s*(?:到|至|-|—|–|~|～)\s*(.+)$/);
  if (sep) {
    const a = parseCnDatePart(sep[1]);
    let b = parseCnDatePart(sep[2]);
    if (!/^\d{4}(\.\d{1,2})?$/.test(b) && b !== '至今' && /^\d{4}\./.test(a)) {
      const mm = sep[2].match(/(\d{1,2})\s*月/);
      if (mm) b = a.slice(0, 5) + String(mm[1]).padStart(2, '0');
      else if (/^\d{1,2}$/.test(sep[2].trim())) b = a.slice(0, 5) + sep[2].trim().padStart(2, '0');
    }
    return { start: a || s.slice(0, 20), end: b === '至今' ? '至今' : b };
  }
  const single = parseCnDatePart(s);
  if (single) return { start: single, end: '' };
  return { start: s.slice(0, 20), end: '' };
}

/* 口语清洗：去除确认词/模糊口语词，杜绝「负责有」类病句 */
function cleanBulletText(sentence) {
  let s = String(sentence || '').trim();
  if (!s) return s;
  s = s.replace(/(大概|大约|一些|挺多|好多|不少|有点|有点儿)/g, '');
  s = s.replace(/负责\s*有[，,。]?/g, '');
  s = s.replace(/负责\s*参与/g, '参与');
  s = s.replace(/负责\s*负责/g, '负责');
  s = s.replace(/(^|[，,。；;])\s*有[，,]/g, '$1');
  s = s.replace(/^[，,、；;。\s]+/, '').replace(/[，,、；;。\s]+$/, '');
  return s;
}

function professionalize(sentence) {
  let s = String(sentence || '').trim();
  const reps = [
    [/我做了/g, '负责'], [/做了/g, '负责'], [/弄了/g, '实现'],
    [/搞了/g, '完成'], [/写了/g, '开发了'], [/用了/g, '使用'],
    [/用(?=[A-Za-z0-9])/g, '使用'], [/修了/g, '修复了'], [/帮忙/g, '协助'],
    [/参与和/g, '参与'], [/东西/g, '功能模块'], [/页面/g, '页面'], [/系统/g, '系统']
  ];
  reps.forEach(([re, to]) => s = s.replace(re, to));
  const resultLike = /(从[\d.]+.*(?:到|降至|提升|优化|降低|提高|减少)|提升|优化|降低|提高|减少|覆盖)/.test(s);
  if (s && !resultLike && !/^(负责|实现|完成|开发|参与|使用|基于|设计|搭建|维护|优化|撰写|组织|担任|主导|独立|协助|支持|推动|重构|测试|部署|发布|跟进|对接|排查|修复|编写|输出|统筹)/.test(s)) {
    s = '负责' + s;
  }
  return s;
}

function buildBullets(exp) {
  const raw = (exp.desc || '').replace(/^(成果(?:是|为)?|结果是|量化成果(?:是|为)?)[：:]?/, '');
  const sentences = raw.split(/[。；;\n]/).map(s => cleanBulletText(s)).filter(s => s.length >= 4);
  const bullets = [];
  sentences.forEach(s => {
    const p = professionalize(s);
    if (p.length > 80) {
      bullets.push(p.slice(0, 60) + '…');
    } else {
      bullets.push(p);
    }
  });
  if (bullets.length === 0 && exp.title) {
    bullets.push('负责「' + exp.title + '」相关工作，完成核心任务与日常交付');
  }
  return bullets.slice(0, 4);
}

function buildSummary(resume) {
  const pos = resume.intention.position || '目标岗位';
  const n = (resume.experiences || []).length;
  const skills = flatSkills(resume);
  const skillText = skills.length ? skills.slice(0, 6).join('、') : '相关专业技能';
  let s = '对' + pos + '方向充满热情，具备扎实的基础与快速学习能力。';
  if (n > 0) s += '在校期间积累了' + n + '段实践经历（项目/实习/竞赛），能够在实践中独立解决问题。';
  s += '熟练掌握' + skillText + '，注重细节与结果，具备良好的沟通能力和团队协作精神。';
  return s;
}

/* 按 JD 关键词重排技能分组（命中 JD 的组前置），让简历更贴合岗位 */
function reorderSkillsForJd(resume, jdText) {
  const jd = (jdText == null ? S.jdText : jdText) || '';
  if (!jd || !Array.isArray(resume.skills) || resume.skills.length < 2) return resume.skills;
  const lower = jd.toLowerCase();
  const score = g => (g.items || []).filter(it => lower.includes(it.toLowerCase())).length;
  const idx = new Map(resume.skills.map((g, i) => [g, i]));
  const sorted = resume.skills.slice().sort((a, b) => (score(b) - score(a)) || (idx.get(a) - idx.get(b)));
  resume.skills = sorted;
  return resume.skills;
}

function generateResumeContent() {
  (S.resume.experiences || []).forEach(exp => {
    /* U02：角色整句 → 只保留角色词 */
    if (exp.role && (exp.role.includes('，') || exp.role.includes(',') || exp.role.includes('、') || exp.role.length > 8)) {
      const role = extractRole(exp.role);
      if (role && role !== exp.role) exp.role = role;
    }
    /* U02：日期统一 YYYY.MM / YYYY.MM - YYYY.MM */
    if (exp.start || exp.end) {
      const range = normalizeDateRange([exp.start, exp.end].filter(Boolean).join(' - '));
      if (range.start) exp.start = range.start;
      if (range.end) exp.end = range.end;
    }
    if (!exp.bullets || !exp.bullets.length) {
      exp.bullets = buildBullets(exp);
    }
  });
  if (S.jdText) reorderSkillsForJd(S.resume, S.jdText);
  S.generated = true;
  saveState();
}

/* ================= AI 优化建议 ================= */
function collectSuggestions() {
  const list = [];
  const R = S.resume;

  /* U04：无经历用户必须看到高优先级补充提醒 */
  if ((R.experiences || []).length === 0) {
    list.unshift({
      id: 's-exp', type: 'missing', action: 'goto-chat',
      title: '缺失内容提醒：缺少实习/项目经历',
      desc: '当前简历还没有任何经历模块。建议通过对话补充课程设计、社团活动、自学项目或实习经历——没有经历会明显降低 HR 的关注度。'
    });
  }

  /* U10：现居城市未采集时提醒 */
  if (!R.city) {
    list.push({
      id: 's-city', type: 'missing', action: 'goto-chat',
      title: '缺失内容提醒：现居城市未填写',
      desc: '简历头部缺少现居城市，企业校招常关注你的现居地/生源地。点击前往对话补充。'
    });
  }

  if (!R.summary) {
    list.push({
      id: 's-summary', type: 'missing', action: 'gen-summary',
      title: '缺失内容提醒',
      desc: '检测到你的简历还没有自我评价模块。需要我根据你的经历自动生成一段吗？',
      newText: buildSummary(R)
    });
  }

  /* JD 关键词补足建议（简历 = 基础信息 + JD 共同定制） */
  if (S.jdText) {
    const jdRes = analyzeJD(S.jdText);
    const missingTech = jdRes.suggestions.filter(s => s.type === 'tech').slice(0, 3);
    if (missingTech.length) {
      list.unshift({
        id: 's-jd', type: 'missing', action: 'open-jd',
        title: 'JD 关键词待补足',
        desc: '根据你提供的 JD，以下关键词暂未在简历中体现：' + missingTech.map(s => s.keyword).join('、') + '。建议在真实经历中补充相关实践（我不会虚构）。',
        newText: missingTech.map(s => s.keyword).join('、')
      });
    }
  }

  if (!R.phone || !R.email) {
    list.push({
      id: 's-contact', type: 'missing', action: 'goto-chat',
      title: '联系方式不完整',
      desc: '简历缺少手机号或邮箱，会降低 HR 联系你的可能性。点击前往对话补充。'
    });
  }

  (R.experiences || []).forEach(exp => {
    (exp.bullets || []).forEach((b, i) => {
      if (b && !hasQuantData(b)) {
        list.push({
          id: 's-q-' + exp.id + '-' + i, type: 'quantify', action: 'quantify',
          target: { expId: exp.id, bulletIndex: i },
          title: '建议补充量化成果',
          desc: '「' + b.slice(0, 26) + (b.length > 26 ? '…' : '') + '」缺少具体产出指标，HR 很难感知你的贡献。',
          oldText: b,
          newText: '（在真实数据基础上补充，例如：效率提升 X%、覆盖用户 X 人、完成 X 个功能）'
        });
      }
      WEAK_PHRASES.forEach(w => {
        if (b.includes(w)) {
          const nb = b.replace(new RegExp(w, 'g'), w === '协助' ? '支持' : w === '帮忙' ? '协助' : w);
          if (nb !== b) {
            list.push({
              id: 's-w-' + exp.id + '-' + i, type: 'optimize', action: 'optimize',
              target: { expId: exp.id, bulletIndex: i },
              title: '表述优化',
              desc: '「' + b.slice(0, 30) + (b.length > 30 ? '…' : '') + '」中的表述偏口语/弱化，建议调整以突出主动贡献。',
              oldText: b,
              newText: nb
            });
          }
        }
      });
    });
  });

  if (flatSkills(R).length < 2) {
    list.push({
      id: 's-skill', type: 'missing', action: 'gen-skills',
      title: '技能描述过于笼统',
      desc: '简历中技能信息较少。可以点击「一键提取」，从你的经历描述中自动提取技术关键词。'
    });
  }

  return list.slice(0, 10);
}

/* ================= 六维诊断 ================= */
const DIAG_DIMS = [
  { key: 'complete',    name: '内容完整性', weight: 0.20 },
  { key: 'professional', name: '表述专业度', weight: 0.20 },
  { key: 'quantify',    name: '量化程度',   weight: 0.15 },
  { key: 'ats',         name: 'ATS 兼容性', weight: 0.15 },
  { key: 'match',       name: '岗位匹配度', weight: 0.20 },
  { key: 'layout',      name: '排版规范度', weight: 0.10 }
];

function diagnoseResume() {
  const R = S.resume;
  const scores = {};
  const issues = [];

  /* 1. 内容完整性 */
  let complete = 20;
  if (R.name) complete += 10;
  if (R.phone) complete += 10;
  if (R.email) complete += 10;
  if (R.education.school) complete += 10;
  if (R.education.degree && R.education.gradDate) complete += 10;
  complete += Math.min(25, (R.experiences || []).length * 10);
  if (flatSkills(R).length >= 2) complete += 10;
  if (R.intention.position) complete += 5;
  /* U05：无任何经历时内容完整性不得超过 50（避免虚假高分） */
  if ((R.experiences || []).length === 0) complete = Math.min(complete, 50);
  scores.complete = Math.min(100, complete);

  /* 2. 表述专业度 */
  const allText = (R.experiences || []).map(e => e.title + ' ' + e.role + ' ' + e.desc + ' ' + (e.bullets || []).join(' ')).join(' ') + (R.summary || '');
  let prof = 82;
  const weakHits = [];
  WEAK_PHRASES.forEach(w => { if (allText.includes(w)) { prof -= 10; weakHits.push(w); } });
  CLICHE_WORDS.forEach(w => { if ((R.summary || '').includes(w)) prof -= 8; });
  const bulletCount = (R.experiences || []).reduce((a, e) => a + (e.bullets || []).length, 0);
  if (bulletCount < 2) prof -= 12;
  /* U05：病句 / 口语确认词检测 */
  const BAD_PATTERNS = [
    { re: /负责\s*有[，,。；;]/, label: '「负责有」类病句' },
    { re: /负责\s*参与/, label: '「负责参与」类病句' },
    { re: /(^|[，,。；;])\s*(有|没有|嗯)[，,。]/, label: '口语确认词残留' }
  ];
  const badHits = [];
  BAD_PATTERNS.forEach(p => { if (p.re.test(allText)) { prof -= 20; badHits.push(p.label); } });
  scores.professional = Math.max(15, Math.min(100, prof));

  /* 3. 量化程度 */
  let digitBullets = 0, totalBullets = 0;
  (R.experiences || []).forEach(e => (e.bullets || []).forEach(b => { totalBullets++; if (hasQuantData(b)) digitBullets++; }));
  scores.quantify = totalBullets ? Math.round(digitBullets / totalBullets * 100) : 0;

  /* 4. ATS 兼容性 */
  let ats = 96;
  if (S.settings.showPhoto) ats -= 8;
  if (!R.phone || !R.email) ats -= 8;
  if (/[🎉✅👍😄🚀]/.test(allText)) ats -= 5;
  if (!R.education.school) ats -= 5;
  scores.ats = Math.max(40, ats);

  /* 5. 岗位匹配度 */
  let match = 30;
  const pos = R.intention.position || '';
  if (pos) {
    match = 45;
    const corpus = resumeText(R);
    let key = '';
    for (const k of Object.keys(POSITION_SKILLS)) if (pos.includes(k)) key = k;
    const reqs = key ? POSITION_SKILLS[key] : [];
    if (reqs.length) {
      const hit = reqs.filter(s => corpus.includes(s.toLowerCase())).length;
      match = Math.min(98, 40 + Math.round(hit / reqs.length * 55));
    } else {
      match = 62;
    }
  }
  scores.match = match;

  /* 6. 排版规范度 */
  let layout = 86;
  const dates = [];
  (R.experiences || []).forEach(e => { if (e.start) dates.push(e.start); if (e.end) dates.push(e.end); });
  const badDate = dates.some(d => d && !/^\d{4}\.\d{1,2}$/.test(d) && !/^至今$/.test(d));
  if (badDate) layout -= 12;
  const halfFull = /[\uFF01-\uFF5E]/.test(allText) && /[!-~]/.test(allText);
  if (halfFull) layout -= 8;
  if (allText.length > 1200) layout -= 6;
  if (allText.length < 120) layout -= 6;
  scores.layout = Math.max(40, layout);

  const totalBase = Math.round(DIAG_DIMS.reduce((a, d) => a + scores[d.key] * d.weight, 0));

  /* 问题清单 */
  if (scores.quantify < 50 && totalBullets > 0) {
    const firstPlain = (R.experiences || []).map(e => e.bullets || []).flat().find(b => b && !hasQuantData(b)) || '';
    issues.push({
      level: 'high', title: '经历描述缺少量化数据',
      desc: firstPlain ? '「' + firstPlain.slice(0, 30) + (firstPlain.length > 30 ? '…' : '') + '」缺少具体产出指标' : '大部分经历条目未包含数字成果',
      detail: { old: firstPlain, new: '（请在真实数据基础上补充，例如：效率提升 X%、覆盖用户 X 人）' },
      action: 'open-edit', target: null
    });
  }
  if (weakHits.length || badHits.length) {
    const parts = [];
    if (weakHits.length) parts.push('检测到口语化表述：' + [...new Set(weakHits)].join('、'));
    if (badHits.length) parts.push('检测到' + [...new Set(badHits)].join('、'));
    issues.push({ level: 'high', title: '表述存在口语化/病句', desc: parts.join('；') + '。建议改用「动词 + 具体内容 + 结果」的专业表述。', action: 'open-edit', target: null });
  }
  if (!R.name || !R.phone || !R.email) {
    issues.push({ level: 'high', title: '基本信息不完整', desc: '姓名、手机号、邮箱是简历必填项。', action: 'goto-chat' });
  }
  if (!R.education.school || !R.education.degree) {
    issues.push({ level: 'high', title: '教育背景不完整', desc: '学校、专业、学历信息缺失会影响筛选。', action: 'goto-chat' });
  }
  if (flatSkills(R).length < 2) {
    issues.push({ level: 'high', title: '技能描述过于笼统', desc: '技能列表过少，建议列出具体技术栈。', action: 'gen-skills' });
  }
  if ((R.experiences || []).length === 0) {
    issues.push({ level: 'high', title: '缺少实习/项目经历', desc: '没有可展示的经历，建议通过对话补充课程设计或社团活动。', action: 'goto-chat' });
  }
  if ((R.summary || '').length > 0 && CLICHE_WORDS.some(w => R.summary.includes(w))) {
    issues.push({ level: 'medium', title: '自我评价模板化', desc: '「' + CLICHE_WORDS.find(w => R.summary.includes(w)) + '」属于通用套话，建议结合具体经历重写。', action: 'gen-summary', detail: { old: R.summary, new: buildSummary(R) } });
  }
  if (totalBullets > 0 && !/(难点|挑战|性能|优化|解决|重构|设计|架构)/.test(allText)) {
    issues.push({ level: 'medium', title: '项目经历缺少技术难点', desc: '建议补充项目中遇到的技术挑战及解决方案，体现问题解决能力。', action: 'open-edit' });
  }
  const hasDates = dates.length > 0;
  const badDates = dates.filter(d => d && !/^\d{4}\.\d{1,2}$/.test(d) && !/^至今$/.test(d));
  if (hasDates && badDates.length) {
    issues.push({ level: 'high', title: '日期格式不统一', desc: '经历时间建议统一为「2025.06 - 2025.09」格式（当前包含：' + [...new Set(badDates)].slice(0, 3).join('、') + '）。', action: 'none' });
  }
  if (R.phone && R.email && R.education.school) {
    issues.push({ level: 'low', title: '联系方式完整', desc: '电话、邮箱、学校信息均已填写 ✅', action: 'none' });
  }
  if (issues.length === 0) {
    issues.push({ level: 'low', title: '整体表现不错', desc: '未发现明显问题，继续保持！', action: 'none' });
  }

  /* U05：评分与问题清单联动——存在高优先问题必须明显压制总分 */
  const highCount = issues.filter(i => i.level === 'high').length;
  const total = Math.max(0, totalBase - highCount * 10);

  return { scores, total, issues, dims: DIAG_DIMS };
}

/* ================= 简历完成度（0-100） ================= */
function resumeCompletion(resume) {
  const R = resume || S.resume;
  const E = R.education || {}, I = R.intention || {};
  let p = 0;
  if (R.name) p += 10;
  if (R.phone) p += 5;
  if (R.email) p += 5;
  if (E.school) p += 10;
  if (E.major) p += 10;
  if (E.degree) p += 5;
  if (E.gradDate) p += 5;
  p += Math.min(20, (R.experiences || []).length * 10);
  if (flatSkills(R).length) p += 10;
  if (R.summary) p += 5;
  if (I.position) p += 10;
  if (I.city) p += 5;
  return Math.min(100, p);
}

/* ================= 版本行级 diff（模块6） ================= */
function diffResumeDetail(a, b) {
  const lines = [];
  const push = (type, text) => lines.push({ type, text });
  const cmp = (label, va, vb) => {
    if (String(va || '') !== String(vb || '')) {
      push('del', label + '：' + (va || '（空）'));
      push('add', label + '：' + (vb || '（空）'));
    }
  };
  cmp('姓名', a.name, b.name);
  cmp('电话', a.phone, b.phone);
  cmp('邮箱', a.email, b.email);
  cmp('城市', a.city, b.city);
  const ea0 = a.education || {}, eb0 = b.education || {};
  cmp('学校', ea0.school, eb0.school);
  cmp('专业', ea0.major, eb0.major);
  cmp('学历', ea0.degree, eb0.degree);
  cmp('毕业时间', ea0.gradDate, eb0.gradDate);

  const ea = a.experiences || [], eb = b.experiences || [];
  const max = Math.max(ea.length, eb.length);
  for (let i = 0; i < max; i++) {
    const x = ea[i], y = eb[i];
    if (!x) push('add', '新增经历：「' + (y.title || '未命名') + '」');
    else if (!y) push('del', '删除经历：「' + (x.title || '未命名') + '」');
    else if (x.title !== y.title || JSON.stringify(x.bullets || []) !== JSON.stringify(y.bullets || [])) {
      push('header', '经历「' + (y.title || x.title) + '」');
      if (x.title !== y.title) { push('del', '标题：' + x.title); push('add', '标题：' + y.title); }
      const bx = x.bullets || [], by = y.bullets || [];
      const bmax = Math.max(bx.length, by.length);
      for (let j = 0; j < bmax; j++) {
        if (bx[j] == null) push('add', '+ ' + by[j]);
        else if (by[j] == null) push('del', '- ' + bx[j]);
        else if (bx[j] !== by[j]) { push('del', '- ' + bx[j]); push('add', '+ ' + by[j]); }
      }
    }
  }

  const flatA = (a.skills || []).reduce((arr, g) => arr.concat(g.items || []), []);
  const flatB = (b.skills || []).reduce((arr, g) => arr.concat(g.items || []), []);
  flatB.filter(x => !flatA.includes(x)).forEach(x => push('add', '技能 + ' + x));
  flatA.filter(x => !flatB.includes(x)).forEach(x => push('del', '技能 - ' + x));
  cmp('自我评价', a.summary, b.summary);
  const ia = a.intention || {}, ib = b.intention || {};
  cmp('目标岗位', ia.position, ib.position);
  cmp('期望城市', ia.city, ib.city);
  cmp('期望薪资', ia.salary, ib.salary);
  if (!lines.length) push('same', '两个版本内容完全一致 ✅');
  return lines;
}

/* ================= ATS 模拟解析（模块4：ATS 模拟解析引擎） ================= */
function atsParse(resume) {
  const R = resume || S.resume;
  const E = R.education || {}, I = R.intention || {};
  const lines = [];
  const warnings = [];

  lines.push(R.name || '（未填写姓名）');
  lines.push('电话：' + (R.phone || '—') + '    邮箱：' + (R.email || '—'));
  if (E.school || E.major) lines.push([E.school, E.major, E.degree, E.gradDate].filter(Boolean).join(' · '));
  lines.push('求职意向：' + [I.position, I.city, I.salary].filter(Boolean).join(' · ') || '（未填写）');
  lines.push('');

  lines.push('【教育背景】');
  lines.push([E.school || '（未填写）', E.major || '', E.degree || '', E.gradDate || ''].filter(Boolean).join(' · ') || '（未填写）');
  lines.push('');

  lines.push('【项目与实习经历】');
  const exps = R.experiences || [];
  if (!exps.length) lines.push('（暂无经历）');
  exps.forEach(e => {
    lines.push(e.title || '（未命名经历）' + (e.role ? ' - ' + e.role : ''));
    if (e.start || e.end) lines.push('时间：' + [e.start, e.end].filter(Boolean).join(' 至 '));
    (e.bullets && e.bullets.length ? e.bullets : [e.desc]).forEach(b => lines.push('- ' + (b || '（无描述）')));
    lines.push('');
  });

  lines.push('【专业技能】');
  const skills = flatSkills(R);
  lines.push(skills.length ? skills.join('、') : '（未填写）');
  lines.push('');

  lines.push('【自我评价】');
  lines.push(R.summary || '（未填写）');
  lines.push('');

  /* 解析警告 */
  const allText = resumeText(R);
  if (!R.phone || !R.email) warnings.push({ level: 'high', text: '缺少手机号或邮箱，HR 无法联系你' });
  if (S.settings && S.settings.showPhoto) warnings.push({ level: 'info', text: '已开启照片：多数 ATS 会忽略照片，但部分系统按附件处理，建议正式投递时关闭' });
  if (/[🎉✅👍😄🚀📷🎯✨💡]/.test(allText)) warnings.push({ level: 'medium', text: '检测到 emoji 表情，部分 ATS 解析为乱码，建议移除' });
  if (/[★●◆■▲▶►❤☑√✗]/.test(allText)) warnings.push({ level: 'medium', text: '检测到特殊符号（★●◆等），建议使用标准列表符号' });
  const dates = [];
  exps.forEach(e => { if (e.start) dates.push(e.start); if (e.end) dates.push(e.end); });
  if (dates.some(d => /[\/]/.test(d))) warnings.push({ level: 'low', text: '日期格式不统一（混用 / 与 .），建议统一为 2025.03 - 2025.06' });
  if (!exps.length) warnings.push({ level: 'high', text: '无任何经历条目，ATS 关键词命中率会很低' });
  if (flatSkills(R).length < 3) warnings.push({ level: 'medium', text: '技能关键词过少，建议补充具体技术栈以提升关键词命中' });
  if (!warnings.length) warnings.push({ level: 'ok', text: '未发现明显 ATS 兼容性问题 ✅' });

  return { text: lines.join('\n'), warnings };
}

/* ================= 求职信生成（简历 + JD） ================= */
function extractCompany(jdText) {
  const t = jdText || '';
  let m = t.match(/(?:公司|企业|集团)(?:名称)?[：:：\s]*([\u4e00-\u9fa5A-Za-z0-9]{2,20})/);
  if (m) return m[1];
  m = t.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20}?(?:科技|网络|信息|集团|有限公司|公司|工作室))/);
  return m ? m[1] : '';
}

function generateCoverLetter(resume, jdText) {
  const R = resume || S.resume;
  const name = R.name || '我';
  const jdRes = jdText ? analyzeJD(jdText) : null;
  const pos = (jdRes && jdRes.position) || R.intention.position || '目标岗位';
  const company = extractCompany(jdText) || '贵公司';
  const skills = flatSkills(R).slice(0, 5).join('、');
  const exp = (R.experiences || [])[0];
  const expLine = exp
    ? '在「' + exp.title + '」中，我' + ((exp.bullets && exp.bullets[0]) || exp.desc || '承担了核心工作') + '。'
    : '虽然没有正式的工作经历，但通过课程设计与课外实践，我积累了扎实的基础能力与快速学习能力。';
  const missing = jdRes ? jdRes.suggestions.filter(s => s.type === 'tech').slice(0, 2).map(s => s.keyword).join('、') : '';
  const lines = [
    '尊敬的' + company + '招聘团队：',
    '',
    '您好！我叫' + name + '，应聘' + pos + '一职。我对贵公司' + pos + '方向的工作充满热情，也相信自己的学习能力与责任心能够胜任这一岗位。',
    '',
    expLine,
    '',
    '我目前掌握' + (skills || '相关基础技能') + (missing ? '，并会针对岗位要求快速补齐 ' + missing + ' 等能力缺口。' : '。') + '同时，我注重结果与细节，习惯用数据和行动证明自己的价值。',
    '',
    '感谢您抽出时间阅读我的简历，期待有机会与您进一步交流。',
    '',
    '此致',
    '敬礼',
    '',
    name
  ];
  return lines.join('\n');
}

/* ================= 模拟面试问题（JD + 简历） ================= */
function generateInterviewQuestions(resume, jdText) {
  const R = resume || S.resume;
  const pos = (jdText ? analyzeJD(jdText).position : '') || R.intention.position || '目标岗位';
  const skills = flatSkills(R);
  const exp = (R.experiences || [])[0];
  const qs = [];
  qs.push({ q: '请用 1 分钟做自我介绍，重点突出你与「' + pos + '」相关的经历与优势。', tip: '结构：我是谁 → 关键经历 → 为什么适合这个岗位' });
  if (skills[0]) qs.push({ q: '你如何理解「' + skills[0] + '」在真实项目中的应用？请结合你的经历说明。', tip: '不要只背概念，用「场景-动作-结果」展开' });
  if (exp) {
    qs.push({ q: '请详细讲讲「' + exp.title + '」中你遇到的最大挑战，以及你是如何解决的。', tip: '重点突出你的思考过程与最终结果' });
    qs.push({ q: '「' + exp.title + '」有哪些可以量化的成果？具体数据是多少？', tip: '提前准备 2-3 组数字（效率提升 X%、覆盖用户 X 人）' });
  }
  qs.push({ q: '你为什么选择' + pos + '方向？为这个岗位做了哪些准备？', tip: '结合课程、项目、自学与职业规划回答' });
  qs.push({ q: '描述一次团队协作中你主动推动问题解决的经历。', tip: '体现沟通、责任心与结果导向' });
  qs.push({ q: '如果你入职后发现岗位要求与你的技能有差距，你会怎么快速补上？', tip: '给出具体学习计划：文档 + 项目 + 请教同事' });
  return qs.slice(0, 7);
}

/* ================= JD 匹配分析 ================= */
function analyzeJD(jdText) {
  const text = jdText || '';
  const lower = text.toLowerCase();
  const R = S.resume;
  const corpus = resumeText(R);
  const kws = [];

  TECH_KEYWORDS.forEach(k => {
    if (k === 'C' || k === 'CSS' || k === 'JS' || k === 'HTML' || k === 'Vue' || k === 'React' || k === 'SQL') return;
    if (lower.includes(k.toLowerCase())) kws.push({ name: k, type: 'tech', weight: 1.0, match: corpus.includes(k.toLowerCase()) });
  });
  ['JavaScript','TypeScript','Vue3','React','HTML5','CSS3','SQL'].forEach(k => {
    if (new RegExp(k.replace('+','\\+').replace('.','\\.'), 'i').test(text)) {
      if (!kws.some(x => x.name === k)) kws.push({ name: k, type: 'tech', weight: 1.0, match: corpus.includes(k.toLowerCase()) });
    }
  });
  SOFT_KEYWORDS.forEach(k => {
    if (text.includes(k)) kws.push({ name: k, type: 'soft', weight: 0.5, match: corpus.includes(k) });
  });
  const eduReq = ['博士','硕士','本科','大专'].find(d => text.includes(d)) || '';
  if (eduReq) {
    const degree = R.education.degree;
    const ok = degree === eduReq || (eduReq === '本科' && ['本科','硕士','博士'].includes(degree));
    kws.push({ name: '学历要求：' + eduReq, type: 'edu', weight: 0.6, match: ok });
  }
  const position = extractPosition(text);

  const totalW = kws.reduce((a, k) => a + k.weight, 0);
  const matchedW = kws.reduce((a, k) => a + (k.match ? k.weight : 0), 0);
  const overall = totalW ? Math.round(matchedW / totalW * 100) : 0;

  const suggestions = [];
  kws.filter(k => !k.match && k.type === 'tech').forEach(k => {
    const exp = (R.experiences || [])[0];
    suggestions.push({
      keyword: k.name,
      type: 'tech',
      title: '建议补充「' + k.name + '」',
      desc: exp ? '在你的「' + exp.title + '」经历中补充与 ' + k.name + ' 相关的实践表述。' : '在你的项目/实习经历中补充与 ' + k.name + ' 相关的实践表述。',
      ref: '参考模板（请基于真实经历改写）：使用 ' + k.name + ' 实现了…，解决了…问题'
    });
  });
  kws.filter(k => !k.match && k.type === 'soft').forEach(k => {
    suggestions.push({
      keyword: k.name,
      type: 'soft',
      title: '建议体现「' + k.name + '」',
      desc: 'JD 强调' + k.name + '能力，可在自我评价或经历中补充相关表述。',
      ref: '参考模板：在团队协作中主动推动…，与 X 个角色高效沟通'
    });
  });

  return { overall, kws, suggestions, position, eduReq, analyzedAt: new Date().toISOString() };
}




















/* ================= 文字与格式体检（规则引擎，不依赖 AI/后端） ================= */
function normalizeDate(d) {
  const s = String(d == null ? '' : d).trim();
  const m = s.match(/(\d{4})\s*[年./-]\s*(\d{1,2})/);
  if (m) return m[1] + '.' + String(Number(m[2])).padStart(2, '0');
  return s;
}

function contentCheck(resume) {
  const R = resume || S.resume;
  const E = R.education || {};
  const issues = [];
  const hasContent = !!(R.name || R.phone || R.email || (R.experiences || []).length || E.school);
  let allText = '';
  if (hasContent) {
    const norm = Object.assign({}, R, {
      education: R.education || {},
      intention: R.intention || {},
      experiences: R.experiences || [],
      skills: R.skills || []
    });
    allText = resumeText(norm);
  }
  if (!hasContent) {
    return { score: 0, issues: [{ level: 'medium', type: 'empty', title: '简历内容为空', desc: '先去「对话引导」填写基本信息，或「载入示例」体验完整流程。' }] };
  }

  /* 1. 联系方式格式 */
  if (R.phone && !/^1\d{10}$/.test(String(R.phone).replace(/[\s-]/g, ''))) {
    issues.push({ level: 'high', type: 'contact', title: '手机号格式可能有误', desc: '建议填写 11 位手机号（1 开头），当前为：' + R.phone });
  }
  if (R.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(R.email)) {
    issues.push({ level: 'high', type: 'contact', title: '邮箱格式可能有误', desc: '建议填写标准邮箱（如 name@example.com），当前为：' + R.email });
  }

  /* 2. 日期格式统一 */
  const dates = [];
  (R.experiences || []).forEach(e => { if (e.start) dates.push(e.start); if (e.end) dates.push(e.end); });
  if (E.gradDate) dates.push(E.gradDate);
  const hasSlash = dates.some(d => d.indexOf('/') >= 0);
  const hasDash = dates.some(d => d.indexOf('-') >= 0);
  const hasDot = dates.some(d => d.indexOf('.') >= 0);
  const hasYearWord = dates.some(d => d.indexOf('年') >= 0);
  if (dates.length > 1 && (hasSlash + hasDash + hasDot + hasYearWord) > 1) {
    issues.push({
      level: 'medium', type: 'date', title: '日期格式不统一',
      desc: '混用了 . / - 或「年」等写法，建议统一为 2025.03 格式。',
      detail: { old: dates.join('、'), new: dates.map(normalizeDate).join('、') },
      fix: 'normalize-dates'
    });
  }

  /* 3. 连续重复字 */
  const dupMatches = allText.match(/([\u4e00-\u9fa5])\1{2,}/g) || [];
  if (dupMatches.length) {
    issues.push({ level: 'low', type: 'typo', title: '疑似重复字', desc: '检测到连续重复汉字：' + dupMatches.slice(0, 5).join('、') + '，请检查是否有笔误。' });
  }

  /* 4. 中英文标点混用 / 相邻重复标点 */
  const punctMatches = allText.match(/[，,]{2}|[。.]{2}|[；;]{2}|[：:]{2}/g) || [];
  if (punctMatches.length) {
    issues.push({ level: 'low', type: 'format', title: '标点疑似重复/混用', desc: '检测到相邻重复标点：' + punctMatches.slice(0, 5).join(' ') + '，建议统一使用中文标点。' });
  }

  /* 5. 口语化 / 弱表达 */
  const weakWords = ['负责了', '做了', '搞了', '一些', '大概', '好像', '挺多', '还不错', '基本完成', '各种'];
  const weakHits = weakWords.filter(w => allText.indexOf(w) >= 0);
  if (weakHits.length) {
    issues.push({ level: 'medium', type: 'weak', title: '存在口语化/弱表达', desc: '建议改为专业表述（如「负责」→「主导」「独立完成」）：' + weakHits.join('、') });
  }

  /* 6. 经历描述过短 */
  let shortCount = 0;
  (R.experiences || []).forEach(e => {
    const bullets = (e.bullets && e.bullets.length) ? e.bullets : (e.desc ? [e.desc] : []);
    bullets.forEach(b => { if (b && b.replace(/[，。、\s]/g, '').length < 8) shortCount++; });
  });
  if (shortCount) {
    issues.push({ level: 'medium', type: 'length', title: '经历描述过短（' + shortCount + ' 处）', desc: '单条描述建议 15-50 字并包含「动作 + 结果/数据」，例如：负责校园二手平台前端开发，日活提升 30%。' });
  }

  /* 7. 自我评价过短 */
  if (R.summary && R.summary.replace(/[，。、\s]/g, '').length < 10) {
    issues.push({ level: 'low', type: 'length', title: '自我评价过短', desc: '自我评价建议 50-100 字，突出 1-2 个核心优势与求职动机。' });
  }

  /* 8. 技能重复 */
  const seen = {};
  const dups = [];
  flatSkills(R).forEach(s => {
    const k = String(s).toLowerCase().trim();
    if (!k) return;
    if (seen[k]) dups.push(s);
    seen[k] = true;
  });
  if (dups.length) {
    issues.push({ level: 'low', type: 'dup', title: '技能重复', desc: '检测到重复技能：' + dups.slice(0, 5).join('、') + '，建议合并去重。' });
  }

  /* 9. 缺少关键信息 */
  const missing = [];
  if (!R.name) missing.push('姓名');
  if (!R.phone) missing.push('手机号');
  if (!R.email) missing.push('邮箱');
  if (!E.school) missing.push('学校');
  if (!(R.experiences || []).length) missing.push('经历');
  if (missing.length && missing.length < 5) {
    issues.push({ level: 'high', type: 'missing', title: '缺少关键信息', desc: '尚未填写：' + missing.join('、') });
  }

  const w = { high: 15, medium: 8, low: 3 };
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((s, it) => s + (w[it.level] || 0), 0)));
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => (order[a.level] - order[b.level]));
  return { score: Math.round(score), issues };
}


/* ================= 求职邮件生成（简历 + JD） ================= */
function generateJobEmail(resume, jdText) {
  const R = resume || S.resume;
  const name = R.name || '我';
  const jdRes = jdText ? analyzeJD(jdText) : null;
  const pos = (jdRes && jdRes.position) || R.intention.position || '目标岗位';
  const company = extractCompany(jdText) || '贵公司';
  const skills = flatSkills(R).slice(0, 4).join('、');
  const exp = (R.experiences || [])[0];
  const expLine = exp
    ? '在「' + exp.title + '」中，我' + ((exp.bullets && exp.bullets[0]) || exp.desc || '承担了核心工作') + '。'
    : '虽然没有正式工作经历，但通过课程设计与课外实践，我积累了扎实的基础能力与快速学习能力。';
  const subject = '应聘' + pos + '（' + name + '）· 附个人简历';
  const body = [
    '尊敬的HR：',
    '',
    '您好！我是' + name + (R.education && R.education.school ? '，毕业于' + R.education.school + (R.education.major ? ' ' + R.education.major : '') : '') + '，应聘贵司' + pos + '岗位。',
    expLine,
    skills ? '我掌握' + skills + '，并希望将所学应用到实际项目中。' : '',
    '随信附上我的个人简历，期待您的回复，也欢迎随时通过电话或邮件与我联系。',
    '',
    '此致',
    '敬礼',
    '',
    name,
    R.phone ? '电话：' + R.phone : '',
    R.email ? '邮箱：' + R.email : ''
  ].filter(Boolean).join('\n');
  return { subject: subject, body: body };
}
