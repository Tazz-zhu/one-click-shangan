// ============================================================
// DOCX 导出 — 话术库 / 面经库
// 自动美化排版，支持中文，适合打印复习
// ============================================================
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
        WidthType, ShadingType, PageNumber, PageBreak, LevelFormat } = require('docx');
const os = require('os');

const CJK_FONT = os.platform() === 'darwin' ? 'PingFang SC' : 'Microsoft YaHei';
const BODY_FONT = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: CJK_FONT };
const BODY_SIZE = 22; // 11pt

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

// ---- 公共：基础文档配置 ----
function baseDoc(sections = []) {
  return new Document({
    styles: {
      default: { document: { run: { font: BODY_FONT, size: BODY_SIZE } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, color: '1E1E2E', font: BODY_FONT },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0, keepNext: false, keepLines: false } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, color: '4F46E5', font: BODY_FONT },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1, keepNext: false, keepLines: false } },
      ]
    },
    numbering: {
      config: [
        { reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 }
        }
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: '一键上岸 自动生成', font: BODY_FONT, size: 18, color: '999999' })]
        })] })
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '第 ', font: BODY_FONT, size: 18, color: '999999' }),
            new TextRun({ children: [PageNumber.CURRENT], font: BODY_FONT, size: 18, color: '999999' }),
            new TextRun({ text: ' 页', font: BODY_FONT, size: 18, color: '999999' }),
          ]
        })] })
      },
      children: sections,
    }]
  });
}

function hr() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E4E7F0' } },
    children: []
  });
}

function title(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text, bold: true, size: 44, color: '4F46E5', font: BODY_FONT })]
  });
}

function subtitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [new TextRun({ text, size: 22, color: '71748A', font: BODY_FONT })]
  });
}

// ---- 话术库导出 ----
async function generatePhraseDocx(phrases) {
  const children = [];

  children.push(title('个人话术库'));
  children.push(subtitle(`${new Date().toLocaleDateString('zh-CN')} 导出 · 共 ${phrases.length} 条`));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(`#${i + 1}  [${p.score || 0}分]  ${p.question || ''}`)]
    }));

    // 元信息
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `评分: ${p.score || 0}分  |  日期: ${new Date(p.createdAt).toLocaleDateString('zh-CN')}  |  标签: ${(p.tags || []).join(', ') || '-'}`,
          size: 18, color: '999999', font: BODY_FONT })
      ]
    }));

    // 原始回答
    children.push(new Paragraph({
      spacing: { before: 120 },
      children: [new TextRun({ text: '▎你的回答', bold: true, size: 20, color: '71748A', font: BODY_FONT })]
    }));
    children.push(new Paragraph({
      spacing: { before: 60, after: 160 },
      children: [new TextRun({ text: p.answer || '', font: BODY_FONT })]
    }));

    // 改进版
    if (p.improvedVersion) {
      children.push(new Paragraph({
        spacing: { before: 80 },
        children: [new TextRun({ text: '▎改进版本', bold: true, size: 20, color: '4F46E5', font: BODY_FONT })]
      }));
      children.push(new Paragraph({
        shading: { fill: 'F5F3FF', type: ShadingType.CLEAR },
        indent: { left: 360 },
        spacing: { before: 60, after: 200 },
        children: [new TextRun({ text: p.improvedVersion, font: BODY_FONT })]
      }));
    }

    if (i < phrases.length - 1) children.push(hr());
  }

  const doc = baseDoc(children);
  return Packer.toBuffer(doc);
}

// ---- 面经库导出 ----
async function generateMianjingDocx(items) {
  const children = [];

  children.push(title('面经库'));
  const companies = [...new Set(items.map(i => i.company).filter(Boolean))];
  children.push(subtitle(`${new Date().toLocaleDateString('zh-CN')} 导出 · ${companies.length}家公司 · 共 ${items.length} 题`));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // 按公司分组
  const grouped = {};
  for (const item of items) {
    const key = item.company || '未知公司';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  for (const [company, qs] of Object.entries(grouped)) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(`${company}  (${qs.length}题)`)]
    }));

    for (const q of qs) {
      // 题目行
      children.push(new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        spacing: { after: 60 },
        children: [new TextRun({ text: q.question || '', bold: true, font: BODY_FONT })]
      }));

      // 题目标签
      const tags = [
        q.type ? `类型: ${q.type}` : '',
        q.position ? `岗位: ${q.position}` : '',
        q.round ? `轮次: ${q.round}` : '',
        q.frequency ? `出现 ${q.frequency} 次` : '',
        q.collectedAt ? `采集于 ${new Date(q.collectedAt).toLocaleDateString('zh-CN')}` : ''
      ].filter(Boolean).join('  |  ');

      if (tags) {
        children.push(new Paragraph({
          indent: { left: 720 },
          spacing: { after: 180 },
          children: [new TextRun({ text: tags, size: 18, color: '999999', font: BODY_FONT })]
        }));
      }
    }

    children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
  }

  const doc = baseDoc(children);
  return Packer.toBuffer(doc);
}

module.exports = { generatePhraseDocx, generateMianjingDocx };
