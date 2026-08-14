// ============================================================
// 知识库管理器 - 5层结构：通用题库 / 行业题库 / 公司档案 / STAR框架 / 话术库
// ============================================================

const generalQA = require('./general-qa.json');
const starFramework = require('./star-framework.json');
const path = require('path');
const fs = require('fs');

// 加载群面知识库
let groupInterviewKB = null;
try {
  const groupFile = path.join(__dirname, 'group-interview.json');
  if (fs.existsSync(groupFile)) {
    groupInterviewKB = JSON.parse(fs.readFileSync(groupFile, 'utf-8'));
  }
} catch (e) {
  console.warn('[Knowledge] 群面知识库加载失败:', e.message);
}

// 加载行业题库
function loadIndustryKB() {
  const dir = path.join(__dirname, 'industry');
  const kb = {};
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.json')) {
        try {
          kb[file.replace('.json', '')] = JSON.parse(
            fs.readFileSync(path.join(dir, file), 'utf-8')
          );
        } catch (e) { /* skip corrupt files */ }
      }
    }
  }
  return kb;
}

const industryKB = loadIndustryKB();

/**
 * 多维度检索知识库
 * @param {object} context - { company, position, industry, keywords }
 * @returns {array} 匹配的题目
 */
function searchKnowledgeBase({ company, position, industry, keywords = [] } = {}) {
  const results = [];
  const allKeywords = [
    ...(keywords || []),
    ...(position ? position.split(/[\s\-·]/) : []),
    ...(industry ? [industry] : [])
  ].map(k => k.toLowerCase());

  // 1. 搜索通用题库
  for (const item of generalQA) {
    const itemText = (item.question + ' ' + (item.tags || []).join(' ')).toLowerCase();
    let score = 0;
    for (const kw of allKeywords) {
      if (itemText.includes(kw)) score += 2;
    }
    // 通识题（自我介绍、职业规划等）始终保留
    if (item.category === '通用') score += 1;
    if (score > 0) results.push({ ...item, kb_source: '通用题库', relevance: score });
  }

  // 2. 搜索行业题库
  if (industry) {
    const industryKey = Object.keys(industryKB).find(k =>
      k.toLowerCase().includes(industry.toLowerCase()) ||
      industry.toLowerCase().includes(k.toLowerCase())
    );
    if (industryKey && industryKB[industryKey]) {
      for (const item of industryKB[industryKey].questions || []) {
        const itemText = (item.question + ' ' + (item.tags || []).join(' ')).toLowerCase();
        let score = 1;
        for (const kw of allKeywords) {
          if (itemText.includes(kw)) score += 3;
        }
        if (score > 1) results.push({ ...item, kb_source: `行业题库-${industryKey}`, relevance: score });
      }
    }
  }

  // 3. 搜索公司档案（如果有）
  if (company) {
    const companyFile = path.join(__dirname, 'industry', `${company.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '')}.json`);
    if (fs.existsSync(companyFile)) {
      try {
        const companyData = JSON.parse(fs.readFileSync(companyFile, 'utf-8'));
        for (const item of companyData.questions || []) {
          results.push({ ...item, kb_source: `公司档案-${company}`, relevance: 10 });
        }
      } catch (e) { /* skip */ }
    }
  }

  // 4. 搜索群面知识库（当关键词包含群面相关术语时）
  const groupKeywords = ['群面', '无领导', '小组讨论', '无领导小组', 'leaderless', 'LGD', '集体面试', '群组面试'];
  const hasGroupKeyword = allKeywords.some(kw => groupKeywords.some(gk => kw.includes(gk)));
  if (hasGroupKeyword && groupInterviewKB) {
    // 提取群面知识库中的结构化信息作为参考条目
    const overview = groupInterviewKB.overview;
    if (overview) {
      results.push({
        question: '群面概览：' + (overview.definition || '').slice(0, 100),
        type: '群面知识',
        category: '群面基础知识',
        kb_source: '群面知识库-概览',
        relevance: 8,
        _detail: overview
      });
    }

    // 添加角色策略
    if (groupInterviewKB.roles && groupInterviewKB.roles.roles) {
      for (const role of groupInterviewKB.roles.roles) {
        results.push({
          question: `群面角色-${role.name}：${role.responsibility}`,
          type: '群面知识',
          category: '角色策略',
          kb_source: '群面知识库-角色',
          relevance: 7,
          _detail: role
        });
      }
    }

    // 添加题型策略
    if (groupInterviewKB.question_types && groupInterviewKB.question_types.types) {
      for (const qt of groupInterviewKB.question_types.types) {
        results.push({
          question: `群面题型-${qt.name}：${qt.characteristics}`,
          type: '群面知识',
          category: '题型策略',
          kb_source: '群面知识库-题型',
          relevance: 7,
          _detail: qt
        });
      }
    }

    // 添加话术模板
    if (groupInterviewKB.speech_templates && groupInterviewKB.speech_templates.templates) {
      for (const [key, templates] of Object.entries(groupInterviewKB.speech_templates.templates)) {
        if (templates.length > 0) {
          results.push({
            question: `群面话术-${key}：${templates[0]}`,
            type: '群面知识',
            category: '话术模板',
            kb_source: '群面知识库-话术',
            relevance: 6,
            _detail: { category: key, templates }
          });
        }
      }
    }

    // 添加经典案例
    if (groupInterviewKB.classic_cases) {
      for (const cs of groupInterviewKB.classic_cases) {
        results.push({
          question: `群面经典案例-${cs.title}：${cs.scenario ? cs.scenario.slice(0, 80) : ''}`,
          type: '群面知识',
          category: '经典案例',
          kb_source: '群面知识库-案例',
          relevance: 5,
          _detail: cs
        });
      }
    }
  }

  // 按相关度排序，去重
  const seen = new Set();
  const unique = results.filter(r => {
    const key = r.question;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => b.relevance - a.relevance);
}

/**
 * 获取STAR评估框架
 */
function getSTARFramework() {
  return starFramework;
}

module.exports = {
  searchKnowledgeBase,
  getSTARFramework
};
