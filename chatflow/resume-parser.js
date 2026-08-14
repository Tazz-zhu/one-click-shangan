// ============================================================
// 简历本地解析 — PDF / DOCX / TXT 文件上传提取纯文本
// 依赖: mammoth (.docx) | pdf-parse (.pdf) | node:fs (.txt)
// ============================================================
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

/**
 * 解析上传的简历文件，返回纯文本
 * @param {string} filePath - 临时文件路径
 * @param {string} originalName - 原始文件名（判断扩展名）
 * @returns {{ text: string, sourceType: string, fileName: string, warnings: string[] }}
 */
async function parseResumeFile(filePath, originalName) {
  const ext = path.extname(originalName || 'file.txt').toLowerCase();
  let text = '';
  let sourceType = '未知';
  const warnings = [];

  try {
    if (ext === '.txt' || ext === '.md') {
      // 尝试多种编码
      text = readTextFile(filePath);
      sourceType = 'txt';

    } else if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value || '';
      if (result.messages?.length) {
        // 过滤 mammoth 的无害警告（矢量图形/图像关系ID等）
        const harmless = /unrecognised element|imagedata.*without a relationship|unrecognised attribute/i;
        const msgs = result.messages
          .filter(m => m.type !== 'warning' || !harmless.test(m.message))
          .slice(0, 3)
          .map(m => m.message);
        if (msgs.length) {
          warnings.push(...msgs);
          console.warn('[简历解析] mammoth 警告:', msgs.join('; '));
        }
      }
      sourceType = 'docx';

    } else if (ext === '.pdf') {
      const buffer = fs.readFileSync(filePath);
      if (buffer.length === 0) throw new Error('PDF 文件为空');

      // pdf-parse v2 API
      let parsed = false;
      try {
        const { PDFParse } = require('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        try {
          // 先尝试提取信息（验证PDF有效性）
          const info = await parser.getInfo();
          const totalPages = info.total || 0;

          // 提取文本
          const textResult = await parser.getText();
          text = textResult.text || '';
          parsed = true;
          sourceType = 'pdf';

          if (totalPages > 0 && !text.trim()) {
            warnings.push(`PDF 共 ${totalPages} 页，但未提取到文本（可能是扫描件/图片PDF）。建议导出为 Word 或直接粘贴文字`);
          }
        } finally {
          await parser.destroy();
        }
      } catch (pdfErr) {
        // pdf-parse 失败 → 尝试 pdftotext 命令行（兜底）
        console.warn('[简历解析] pdf-parse 失败，尝试 pdftotext:', pdfErr.message?.slice(0, 80));
        const fallback = tryPdfToTextCli(filePath);
        if (fallback) {
          text = fallback;
          sourceType = 'pdf';
          parsed = true;
          warnings.push('已通过备用方式解析 PDF，如有缺漏请手动补充');
        } else if (!parsed) {
          throw pdfErr;
        }
      }
    } else {
      // 尝试按 UTF-8 读取
      text = readTextFile(filePath);
      sourceType = 'unknown';
    }
  } catch (e) {
    const detail = e.message || String(e);
    console.error('[简历解析] 错误:', detail);

    // 最后兜底：尝试当作二进制提取可读文本
    const fallback = extractReadableFromBinary(filePath);
    if (fallback && fallback.length > 20) {
      text = fallback;
      sourceType = 'fallback';
      warnings.push('无法正常解析，已提取部分可识别文本，可能有缺失');
    } else {
      throw new Error(`文件解析失败 (${sourceType}): ${detail}`);
    }
  }

  // 清理：去多余空行、去BOM、压缩空白
  text = cleanText(text);

  if (!text || text.length < 10) {
    throw new Error('文件解析后无文本内容。请检查：\n1) 是否加密PDF\n2) 是否为纯图片扫描件\n3) 文件是否已损坏');
  }

  return { text, sourceType, fileName: originalName || 'unknown', warnings };
}

// — helpers —

function readTextFile(filePath) {
  // 优先 UTF-8
  try { return fs.readFileSync(filePath, 'utf-8'); } catch {}
  // 兜底 latin1 + 转 UTF-8
  try {
    const buf = fs.readFileSync(filePath);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

function cleanText(raw) {
  return raw
    .replace(/^\uFEFF/, '')      // BOM
    .replace(/\r\n/g, '\n')       // CRLF → LF
    .replace(/\t/g, ' ')          // tabs → spaces
    .replace(/ {3,}/g, '  ')      // collapse multi-spaces
    .replace(/\n{4,}/g, '\n\n\n') // collapse excessive newlines
    .trim();
}

/**
 * 从二进制中提取可读文本片段（utf8 + latin1 混合）
 */
function extractReadableFromBinary(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // 尝试 UTF-8
    const utf8 = buf.toString('utf-8');
    // 统计可读比例
    const readable = utf8.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    if (readable.length > utf8.length * 0.3) {
      return cleanText(readable);
    }
  } catch {}
  return '';
}

/**
 * 尝试调用系统 pdftotext 命令行工具（如果安装了 poppler）
 */
function tryPdfToTextCli(filePath) {
  try {
    const { execSync } = require('child_process');
    // Windows: 检查是否安装了 poppler (如通过 choco/scoop)
    const out = execSync(`pdftotext -layout "${filePath}" -`, {
      timeout: 15000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return out?.trim() || '';
  } catch {
    return '';
  }
}

module.exports = { parseResumeFile };
