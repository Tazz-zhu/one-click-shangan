/* ============================================================
 * docx.js — 纯前端生成真实 .docx（OOXML + ZIP store，零依赖）
 * 在浏览器与 Node 中均可运行；挂载到 window.DocxBuilder（Node 下 module.exports）
 * ============================================================ */
(function () {
  function xmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(data) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function encodeText(s) { return new TextEncoder().encode(s); }

  /* ---------- ZIP（仅 store 存储，无压缩） ---------- */
  function buildZip(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dosTime = (((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF);
    var dosDate = ((((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF);
    entries.forEach(function (entry) {
      var nameBytes = encodeText(entry.name);
      var data = entry.data;
      var crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length + data.length);
      var ld = new DataView(local.buffer);
      ld.setUint32(0, 0x04034b50, true);
      ld.setUint16(4, 20, true);
      ld.setUint16(6, 0, true);
      ld.setUint16(8, 0, true);
      ld.setUint16(10, dosTime, true);
      ld.setUint16(12, dosDate, true);
      ld.setUint32(14, crc, true);
      ld.setUint32(18, data.length, true);
      ld.setUint32(22, data.length, true);
      ld.setUint16(26, nameBytes.length, true);
      ld.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      chunks.push(local);

      var cen = new Uint8Array(46 + nameBytes.length);
      var cd = new DataView(cen.buffer);
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      central.push(cen);
      offset += local.length;
    });

    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var eocd = new Uint8Array(22);
    var ed = new DataView(eocd.buffer);
    ed.setUint32(0, 0x06054b50, true);
    ed.setUint16(4, 0, true);
    ed.setUint16(6, 0, true);
    ed.setUint16(8, entries.length, true);
    ed.setUint16(10, entries.length, true);
    ed.setUint32(12, cdSize, true);
    ed.setUint32(16, offset, true);
    ed.setUint16(20, 0, true);

    var total = offset + cdSize + eocd.length;
    var out = new Uint8Array(total);
    var pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    central.forEach(function (c) { out.set(c, pos); pos += c.length; });
    out.set(eocd, pos);
    return out;
  }

  /* ---------- OOXML ---------- */
  function run(text, opts) {
    opts = opts || {};
    var rpr = '';
    if (opts.bold || opts.size || opts.color || opts.italic) {
      rpr = '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>';
      if (opts.bold) rpr += '<w:b/>';
      if (opts.italic) rpr += '<w:i/>';
      if (opts.size) rpr += '<w:sz w:val="' + opts.size + '"/>';
      if (opts.color) rpr += '<w:color w:val="' + opts.color + '"/>';
      rpr += '</w:rPr>';
    }
    return '<w:r>' + rpr + '<w:t xml:space="preserve">' + xmlEscape(text) + '</w:t></w:r>';
  }
  function para(runs, opts) {
    opts = opts || {};
    var ppr = '';
    var parts = [];
    if (opts.center) parts.push('<w:jc w:val="center"/>');
    if (opts.before !== undefined || opts.after !== undefined) {
      parts.push('<w:spacing w:before="' + (opts.before || 0) + '" w:after="' + (opts.after || 0) + '"/>');
    }
    if (parts.length) ppr = '<w:pPr>' + parts.join('') + '</w:pPr>';
    return '<w:p>' + ppr + runs + '</w:p>';
  }
  function sectionTitle(text) {
    return para(run(text, { bold: true, size: 28, color: '1F4E3F' }), { before: 240, after: 120 });
  }

  function buildDocumentXml(resume) {
    var R = resume || {};
    var E = R.education || {};
    var I = R.intention || {};
    var parts = [];

    parts.push(para(run(R.name || '简历', { bold: true, size: 44 }), { center: true, after: 60 }));
    var sub = [R.phone, R.email, R.city].filter(Boolean).join(' | ');
    if (sub) parts.push(para(run(sub, { size: 21 }), { center: true }));
    var eduLine = [E.school, E.major, E.degree, E.gradDate].filter(Boolean).join(' · ');
    if (eduLine) parts.push(para(run(eduLine, { size: 21 }), { center: true }));
    var intentLine = '求职意向：' + [I.position, I.city, I.salary].filter(Boolean).join(' · ');
    if (I.position || I.city || I.salary) parts.push(para(run(intentLine, { size: 21 }), { center: true }));
    parts.push(para(''));

    if (eduLine) {
      parts.push(sectionTitle('教育背景'));
      parts.push(para(run(eduLine, { size: 21 })));
    }

    if (R.experiences && R.experiences.length) {
      parts.push(sectionTitle('项目与实习经历'));
      R.experiences.forEach(function (e) {
        var head = [e.title, e.role, e.org].filter(Boolean).join(' · ');
        var time = [e.start, e.end].filter(Boolean).join(' - ');
        parts.push(para(run(head, { bold: true, size: 22 })));
        if (time) parts.push(para(run(time, { size: 18, color: '888888' })));
        var bullets = (e.bullets && e.bullets.length) ? e.bullets : (e.desc ? [e.desc] : []);
        bullets.forEach(function (b) { parts.push(para(run('• ' + b, { size: 21 }))); });
      });
    }

    if (R.skills && R.skills.length) {
      parts.push(sectionTitle('专业技能'));
      R.skills.forEach(function (g) {
        var line = g.category + '：' + (g.items || []).join(' / ');
        if (line !== '：') parts.push(para(run(line, { size: 21 })));
      });
    }

    if (R.summary) {
      parts.push(sectionTitle('自我评价'));
      parts.push(para(run(R.summary, { size: 21 })));
    }

    (R.customSections || []).forEach(function (s) {
      if (!s.title) return;
      parts.push(sectionTitle(s.title));
      (s.items || []).forEach(function (it) { parts.push(para(run(it, { size: 21 }))); });
    });

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + parts.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  var RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  function build(resume) {
    var entries = [
      { name: '[Content_Types].xml', data: encodeText(CONTENT_TYPES) },
      { name: '_rels/.rels', data: encodeText(RELS) },
      { name: 'word/document.xml', data: encodeText(buildDocumentXml(resume)) }
    ];
    return buildZip(entries);
  }

  function buildBlob(resume) {
    var zip = build(resume);
    return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  var DocxBuilder = {
    build: build,
    buildBlob: buildBlob,
    buildDocumentXml: buildDocumentXml,
    crc32: crc32,
    buildZip: buildZip
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DocxBuilder;
  } else if (typeof window !== 'undefined') {
    window.DocxBuilder = DocxBuilder;
  }
})();
