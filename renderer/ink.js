import { h } from './ui.js';

const COLORS = [
  ['#1f1d19', '黑'],
  ['#c94a3f', '红'],
  ['#2f6fd0', '蓝'],
  ['#2f8f5b', '绿'],
  ['#d9862f', '橙'],
  ['#7a5bd0', '紫']
];

const TOP_OFFSET = 66; // 顶栏高度，批注不能写到导航栏上
const DOC = Symbol('document');
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 左侧悬浮批注球。
 *
 * 批注层不拦截鼠标：点击按钮、选择选项、输入答案都照常工作；
 * 只有在非输入区域按住左键拖动时才落笔，右键不响应。
 *
 * 跟手原理：每个滚动容器内部放一张与内容等大的矢量 SVG，每条笔画是一个 path。
 * 滚动由浏览器合成器完成，SVG 跟着内容走，零延迟、不漂移；
 * 书写时只追加路径点，不再整层重绘，所以笔迹跟手。
 */
export function mountInk() {
  if (document.getElementById('ink-layer')) return;

  // 文档级滚动时用的固定 SVG，坐标即文档坐标，滚动时只平移
  const docSvg = document.createElementNS(SVG_NS, 'svg');
  docSvg.id = 'ink-doc';
  docSvg.setAttribute('aria-hidden', 'true');
  const layer = h('div', { id: 'ink-layer', class: 'ink-layer' }, docSvg);

  const groups = new Map(); // scroller -> group；DOC -> 文档组
  const history = []; // 按落笔顺序记录，用于撤销

  let color = localStorage.getItem('wx.inkColor') || COLORS[0][0];
  let width = Number(localStorage.getItem('wx.inkWidth')) || 3;
  let enabled = false;
  let pending = null; // 按下但还没开始画
  let current = null;
  let suppressClickUntil = 0;

  const ball = h('button', { class: 'ink-ball', type: 'button', title: '批注' }, '✎');
  const panel = h('div', { class: 'ink-panel' });

  const colorRow = h(
    'div',
    { class: 'ink-colors' },
    COLORS.map(([value, label]) =>
      h(
        'button',
        {
          class: `ink-color ${value === color ? 'active' : ''}`,
          type: 'button',
          title: label,
          style: `--dot:${value}`,
          onclick: (event) => {
            color = value;
            localStorage.setItem('wx.inkColor', value);
            colorRow.querySelectorAll('.ink-color').forEach((btn) => btn.classList.toggle('active', btn === event.currentTarget));
            setEnabled(true);
            setPanel(false);
          }
        }
      )
    )
  );

  const slider = h('input', { class: 'ink-slider', type: 'range', min: '1', max: '14', step: '1', value: String(width), title: '笔画粗细' });
  const widthLabel = h('span', { class: 'ink-width-label' }, `${width} px`);
  slider.addEventListener('input', () => {
    width = Number(slider.value) || 3;
    widthLabel.textContent = `${width} px`;
    localStorage.setItem('wx.inkWidth', String(width));
  });

  const toggle = h('input', { type: 'checkbox' });
  const toggleLabel = h('label', { class: 'ink-toggle' }, toggle, h('span', {}, '开启批注'));
  toggle.addEventListener('change', () => {
    setEnabled(toggle.checked);
    if (!toggle.checked) setPanel(false);
  });

  const undoBtn = h('button', { class: 'btn subtle sm', type: 'button' }, '撤销');
  undoBtn.addEventListener('click', () => {
    const item = history.pop();
    if (!item) return;
    const list = item.group.strokes;
    const index = list.indexOf(item.stroke);
    if (index >= 0) list.splice(index, 1);
    if (item.stroke.path) item.stroke.path.remove();
  });
  const clearBtn = h('button', { class: 'btn subtle sm', type: 'button' }, '清空');
  clearBtn.addEventListener('click', () => {
    history.length = 0;
    groups.forEach((group) => {
      group.strokes.forEach((stroke) => stroke.path && stroke.path.remove());
      group.strokes.length = 0;
    });
  });

  panel.appendChild(h('div', { class: 'ink-panel-title' }, '批注'));
  panel.appendChild(colorRow);
  panel.appendChild(
    h('div', { class: 'ink-width' }, h('div', { class: 'ink-width-top' }, h('span', {}, '笔画'), widthLabel), slider)
  );
  panel.appendChild(toggleLabel);
  panel.appendChild(h('div', { class: 'ink-actions' }, undoBtn, clearBtn));

  const dock = h('div', { class: 'ink-dock' }, ball, panel);

  function setPanel(open) {
    dock.classList.toggle('open', open);
  }

  function setEnabled(next) {
    enabled = !!next;
    toggle.checked = enabled;
    ball.classList.toggle('active', enabled);
    document.body.classList.toggle('ink-on', enabled);
    if (!enabled) abortStroke();
  }

  ball.addEventListener('click', () => setPanel(!dock.classList.contains('open')));

  function isDocScroller(scroller) {
    return !scroller || scroller === document.documentElement || scroller === document.body || scroller === document.scrollingElement;
  }

  // 找到鼠标所在的、真正能滚的容器
  function findScroller(target) {
    let el = target instanceof Element ? target : null;
    let fallback = null;
    while (el && el !== document.body && el !== document.documentElement) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        if (el.scrollHeight > el.clientHeight + 1) return el;
        if (!fallback) fallback = el;
      }
      el = el.parentElement;
    }
    return fallback || document.scrollingElement || document.documentElement;
  }

  // 落在滚动条上时优先让滚动条工作，不落笔
  function isScrollbarHit(scroller, event) {
    if (!scroller || isDocScroller(scroller)) return false;
    const rect = scroller.getBoundingClientRect();
    const barX = scroller.offsetWidth - scroller.clientLeft - scroller.clientWidth;
    if (barX > 0 && event.clientX >= rect.left + scroller.clientLeft + scroller.clientWidth) return true;
    const barY = scroller.offsetHeight - scroller.clientTop - scroller.clientHeight;
    if (barY > 0 && event.clientY >= rect.top + scroller.clientTop + scroller.clientHeight) return true;
    return false;
  }

  function groupFor(scroller) {
    const doc = isDocScroller(scroller);
    const key = doc ? DOC : scroller;
    const existed = groups.get(key);
    if (existed) return existed;

    let group;
    if (doc) {
      group = { doc: true, scroller: null, svg: docSvg, strokes: [] };
    } else {
      if (!scroller.isConnected) return null;
      if (getComputedStyle(scroller).position === 'static') scroller.style.position = 'relative';
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.classList.add('ink-surface');
      svg.setAttribute('aria-hidden', 'true');
      scroller.appendChild(svg);
      group = { doc: false, scroller, svg, strokes: [] };
      groups.set(key, group);
      sizeGroup(group);
    }
    groups.set(key, group);
    return group;
  }

  // SVG 是矢量的，不需要跟着设备像素比，简单跟随内容尺寸即可
  function sizeGroup(group) {
    if (group.doc) return;
    if (!group.scroller.isConnected) {
      groups.delete(group.scroller);
      return;
    }
    const w = Math.max(1, group.scroller.clientWidth, group.scroller.scrollWidth);
    const height = Math.max(1, group.scroller.clientHeight, group.scroller.scrollHeight);
    if (group.w === w && group.h === height) return;
    group.w = w;
    group.h = height;
    group.svg.style.width = `${w}px`;
    group.svg.style.height = `${height}px`;
  }

  function toContent(scroller, clientX, clientY) {
    if (isDocScroller(scroller)) {
      return { x: clientX + (window.scrollX || 0), y: clientY + (window.scrollY || 0) };
    }
    const rect = scroller.getBoundingClientRect();
    return {
      x: clientX - rect.left - scroller.clientLeft + scroller.scrollLeft,
      y: clientY - rect.top - scroller.clientTop + scroller.scrollTop
    };
  }

  // 文档级 SVG 的坐标就是文档坐标，滚动时整体平移，笔画不用重算
  function syncDocLayer() {
    docSvg.style.transform = `translate3d(${-(window.scrollX || 0)}px, ${-(window.scrollY || 0)}px, 0)`;
  }
  window.addEventListener('scroll', syncDocLayer, { passive: true });

  function fmtX(p) {
    return `${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`;
  }

  // 中点二次曲线，笔画更顺滑
  function pathData(points) {
    const n = points.length;
    if (!n) return '';
    if (n === 1) return `M ${fmtX(points[0])} L ${fmtX(points[0])}`;
    if (n === 2) return `M ${fmtX(points[0])} L ${fmtX(points[1])}`;
    let d = `M ${fmtX(points[0])}`;
    for (let i = 1; i < n - 1; i += 1) {
      const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      d += ` Q ${fmtX(points[i])} ${fmtX(mid)}`;
    }
    d += ` L ${fmtX(points[n - 1])}`;
    return d;
  }

  function createPath(stroke) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', String(stroke.width));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', pathData(stroke.points));
    stroke.path = path;
    return path;
  }

  // 内容变高后，内嵌 SVG 也要跟着加高（节流，避免滚动中频繁读布局）
  const watched = new WeakSet();
  function watchScroll(scroller) {
    if (!scroller || isDocScroller(scroller) || watched.has(scroller)) return;
    watched.add(scroller);
    let last = 0;
    scroller.addEventListener(
      'scroll',
      () => {
        const now = performance.now();
        if (now - last < 200) return;
        last = now;
        const group = groups.get(scroller);
        if (group) sizeGroup(group);
      },
      { passive: true }
    );
  }

  // 这些区域优先给应用本身：输入、按钮、下拉、链接、批注球面板
  function isInteractive(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest('textarea, input, select, button, a, label, [contenteditable="true"], .ink-dock');
  }

  function onPointerDown(event) {
    if (!enabled || event.button !== 0) return;
    if (event.clientY < TOP_OFFSET) return;
    if (isInteractive(event.target)) return;
    const scroller = findScroller(event.target);
    if (isScrollbarHit(scroller, event)) return;
    pending = { x: event.clientX, y: event.clientY, scroller };
    current = null;
  }

  // 指针事件频率可能高于刷新率，路径每帧合并更新一次
  let paintFrame = 0;
  function schedulePathPaint() {
    if (paintFrame) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      if (current && current.path) current.path.setAttribute('d', pathData(current.points));
    });
  }

  function flushPathPaint() {
    if (paintFrame) {
      cancelAnimationFrame(paintFrame);
      paintFrame = 0;
    }
    if (current && current.path) current.path.setAttribute('d', pathData(current.points));
  }

  function abortStroke() {
    if (paintFrame) {
      cancelAnimationFrame(paintFrame);
      paintFrame = 0;
    }
    if (current && current.path) current.path.remove();
    current = null;
    pending = null;
    document.body.classList.remove('ink-writing');
  }

  function onPointerMove(event) {
    if (!enabled || !pending) return;
    if ((event.buttons & 1) !== 1) {
      abortStroke();
      return;
    }
    if (!isDocScroller(pending.scroller) && !pending.scroller.isConnected) {
      abortStroke();
      return;
    }
    if (!current) {
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 3) return;
      const group = groupFor(pending.scroller);
      if (!group) {
        pending = null;
        return;
      }
      sizeGroup(group);
      watchScroll(pending.scroller);
      const start = toContent(pending.scroller, pending.x, pending.y);
      current = { color, width, group, points: [start] };
      current.path = createPath(current);
      group.svg.appendChild(current.path);
      document.body.classList.add('ink-writing');
    }
    event.preventDefault();
    const point = toContent(pending.scroller, event.clientX, event.clientY);
    const last = current.points[current.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.4) return;
    current.points.push(point);
    schedulePathPaint();
  }

  function finishStroke() {
    if (!current) {
      pending = null;
      return;
    }
    const group = current.group;
    if (!group.doc && !group.scroller.isConnected) {
      abortStroke();
      return;
    }
    flushPathPaint();
    const stroke = { color: current.color, width: current.width, points: current.points, path: current.path };
    group.strokes.push(stroke);
    history.push({ group, stroke });
    current = null;
    pending = null;
    document.body.classList.remove('ink-writing');
    suppressClickUntil = Date.now() + 250;
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    finishStroke();
  });
  window.addEventListener('pointercancel', finishStroke);
  document.addEventListener(
    'click',
    (event) => {
      if (Date.now() < suppressClickUntil) {
        event.stopPropagation();
        event.preventDefault();
      }
    },
    true
  );

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      syncDocLayer();
      groups.forEach((group) => {
        if (!group.doc) sizeGroup(group);
      });
    });
  });

  document.body.appendChild(layer);
  document.body.appendChild(dock);

  syncDocLayer();
  setEnabled(false);
}
