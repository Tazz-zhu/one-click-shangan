// ============================================================
// 进度步骤定义
// ============================================================
const STEPS = [
  { id: 'jd_parse',     label: '解析JD',       detail: '正在理解岗位要求...' },
  { id: 'resume_parse', label: '解析简历',       detail: '正在分析你的经历...' },
  { id: 'gap_analysis', label: '差距分析',      detail: '正在对比JD与简历...' },
  { id: 'mianjing',     label: '面经采集',      detail: '正在搜索相关面经...' },
  { id: 'question_gen', label: '生成押题',      detail: '正在生成针对性题目...' },
  { id: 'done',         label: '完成',          detail: '分析完毕' },
];

module.exports = { STEPS };
