/* ============================================================
 * effects.js — 科技感动态背景（纯前端、零依赖）
 * 1) Canvas 粒子连线背景：漂浮光点 + 邻近连线 + 鼠标吸引
 * 2) Hero 3D 鼠标视差倾斜（桌面指针设备）
 * 尊重 prefers-reduced-motion；页面隐藏时自动暂停；支持开关（S.settings.fx）
 * ============================================================ */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var canvas = document.getElementById('fx-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hero = canvas.parentElement;
  var particles = [];
  var raf = 0;
  var running = false;
  var mouse = { x: -9999, y: -9999 };
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var LINK_DIST = 130;

  function enabled() {
    if (typeof S === 'undefined' || !S || !S.settings) return true;
    return S.settings.fx !== false;
  }

  function resize() {
    var rect = hero.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * DPR));
    canvas.height = Math.max(1, Math.round(rect.height * DPR));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    var count = Math.min(70, Math.max(22, Math.round(rect.width / 22)));
    particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - .5) * .0012,
        vy: (Math.random() - .5) * .0012,
        r: (Math.random() * 1.5 + .6) * DPR
      });
    }
  }

  function isDark() {
    return document.documentElement.dataset.theme === 'dark';
  }

  function tick() {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var w = canvas.width, h = canvas.height;
    var base = isDark() ? '125,211,252' : '45,157,120';
    var i, j, p, q, dx, dy, dist, px, py, mdx, mdy, md;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > 1) { p.vx *= -1; p.x = Math.min(1, Math.max(0, p.x)); }
      if (p.y < 0 || p.y > 1) { p.vy *= -1; p.y = Math.min(1, Math.max(0, p.y)); }
      px = p.x * w; py = p.y * h;
      mdx = mouse.x - px; mdy = mouse.y - py;
      md = Math.sqrt(mdx * mdx + mdy * mdy);
      if (md < 150 * DPR && md > 0.01) {
        px += (mdx / md) * 0.7 * DPR;
        py += (mdy / md) * 0.7 * DPR;
      }
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + base + ',.85)';
      ctx.fill();
    }
    ctx.lineWidth = 1 * DPR;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      for (j = i + 1; j < particles.length; j++) {
        q = particles[j];
        dx = (p.x - q.x) * w; dy = (p.y - q.y) * h;
        dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST * DPR) {
          ctx.strokeStyle = 'rgba(' + base + ',' + ((1 - dist / (LINK_DIST * DPR)) * 0.32).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(p.x * w, p.y * h);
          ctx.lineTo(q.x * w, q.y * h);
          ctx.stroke();
        }
      }
    }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (reduce || !enabled() || running) return;
    running = true;
    resize();
    tick();
    if (glowEl) glowEl.style.opacity = '1';
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (glowEl) glowEl.style.opacity = '0';
  }

  window.addEventListener('resize', function () { if (running) resize(); });
  document.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }, { passive: true });
  document.addEventListener('mouseleave', function () { mouse.x = -9999; mouse.y = -9999; });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  /* AI 生成粒子风暴：全屏短暂粒子爆发 */
  function burst() {
    if (reduce) return;
    var old = document.getElementById('fx-burst');
    if (old) old.remove();
    var layer = document.createElement('div');
    layer.id = 'fx-burst';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999;overflow:hidden';
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(window.innerWidth * DPR));
    c.height = Math.max(1, Math.round(window.innerHeight * DPR));
    c.style.cssText = 'width:100%;height:100%';
    layer.appendChild(c);
    document.body.appendChild(layer);
    var g = c.getContext('2d');
    var parts = [];
    var cx = c.width / 2, cy = c.height / 2;
    var base = isDark() ? '125,211,252' : '45,157,120';
    for (var i = 0; i < 46; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = (Math.random() * 6 + 2) * DPR;
      parts.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - Math.random() * 2 * DPR, r: (Math.random() * 2.4 + 1) * DPR });
    }
    var t0 = Date.now();
    var dur = 1400;
    function frame() {
      var p = (Date.now() - t0) / dur;
      g.clearRect(0, 0, c.width, c.height);
      for (var j = 0; j < parts.length; j++) {
        var pt = parts[j];
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.06 * DPR;
        var alpha = Math.max(0, 1 - p);
        g.beginPath();
        g.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        g.fillStyle = 'rgba(' + base + ',' + alpha.toFixed(3) + ')';
        g.fill();
      }
      if (p < 1) requestAnimationFrame(frame);
      else layer.remove();
    }
    requestAnimationFrame(frame);
  }

  window.FxEffects = {
    start: start,
    stop: stop,
    isRunning: function () { return running; },
    burst: burst,
    isDark: isDark
  };

  /* Hero 3D 鼠标视差倾斜（仅桌面指针设备） */
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches && !reduce && hero) {
    hero.style.transition = 'transform .18s ease-out';
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5;
      var y = (e.clientY - r.top) / r.height - .5;
      hero.style.transform = 'perspective(900px) rotateX(' + (-y * 3).toFixed(2) + 'deg) rotateY(' + (x * 3).toFixed(2) + 'deg)';
    });
    hero.addEventListener('mouseleave', function () { hero.style.transform = ''; });
  }

  /* 鼠标跟随光晕（科技感聚光） */
  var glowEl = null;
  if (!reduce) {
    glowEl = document.createElement('div');
    glowEl.id = 'fx-glow';
    glowEl.style.cssText = 'position:fixed;left:0;top:0;width:280px;height:280px;border-radius:50%;pointer-events:none;z-index:9998;transform:translate(-9999px,-9999px);background:radial-gradient(circle,rgba(45,255,176,.16),rgba(75,126,240,.09) 42%,transparent 70%);mix-blend-mode:screen;opacity:0;transition:opacity .35s';
    document.body.appendChild(glowEl);
    var gx = -9999, gy = -9999, tx = -9999, ty = -9999;
    document.addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (glowEl && enabled()) glowEl.style.opacity = '1';
    }, { passive: true });
    (function glowFrame() {
      gx += (tx - gx) * .14; gy += (ty - gy) * .14;
      if (glowEl) glowEl.style.transform = 'translate(' + (gx - 140) + 'px,' + (gy - 140) + 'px)';
      requestAnimationFrame(glowFrame);
    })();
  }

  /* 诊断雷达 3D 鼠标视差（桌面指针设备） */
  var radarWrap = document.querySelector('.radar-wrap');
  if (radarWrap && window.matchMedia && window.matchMedia('(pointer: fine)').matches && !reduce) {
    radarWrap.style.transition = 'transform .15s ease-out';
    radarWrap.addEventListener('mousemove', function (e) {
      var r = radarWrap.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5;
      var y = (e.clientY - r.top) / r.height - .5;
      radarWrap.style.transform = 'perspective(700px) rotateX(' + (-y * 6).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg)';
    });
    radarWrap.addEventListener('mouseleave', function () { radarWrap.style.transform = ''; });
  }

  /* 简历纸张 3D 鼠标悬浮（所有 .sheet-wrap） */
  var sheetWraps = document.querySelectorAll('.sheet-wrap');
  if (sheetWraps.length && window.matchMedia && window.matchMedia('(pointer: fine)').matches && !reduce) {
    sheetWraps.forEach(function (sw) {
      sw.style.transition = 'transform .16s ease-out';
      sw.addEventListener('mousemove', function (e) {
        var r = sw.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - .5;
        var y = (e.clientY - r.top) / r.height - .5;
        sw.style.transform = 'perspective(1100px) rotateX(' + (-y * 2.2).toFixed(2) + 'deg) rotateY(' + (x * 2.2).toFixed(2) + 'deg) translateY(-2px)';
      });
      sw.addEventListener('mouseleave', function () { sw.style.transform = ''; });
    });
  }

  /* 首页副标题打字机（首次打开逐字打出） */
  /* 首页副标题打字机（首次打开逐字打出） */
  var heroSub = document.querySelector('.hero-sub');
  if (heroSub && !reduce) {
    var fullText = heroSub.textContent || '';
    heroSub.textContent = '';
    var cursorEl = document.createElement('span');
    cursorEl.className = 'typing-cursor';
    cursorEl.textContent = '|';
    heroSub.appendChild(cursorEl);
    var idx = 0;
    var typing = setInterval(function () {
      if (idx < fullText.length) {
        cursorEl.before(document.createTextNode(fullText.charAt(idx)));
        idx++;
      } else {
        clearInterval(typing);
        cursorEl.remove();
      }
    }, 26);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
