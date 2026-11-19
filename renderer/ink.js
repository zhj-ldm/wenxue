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

/**
 * 左侧悬浮批注球。
 * 批注层不拦截鼠标：点击按钮、选择选项、输入答案都照常工作；
 * 只有在非输入区域按住左键拖动时才落笔，右键不响应。
 */
export function mountInk() {
  if (document.getElementById('ink-layer')) return;

  const canvas = h('canvas', { id: 'ink-canvas' });
  const ctx = canvas.getContext('2d');
  const strokes = [];
  let color = localStorage.getItem('wx.inkColor') || COLORS[0][0];
  let width = Number(localStorage.getItem('wx.inkWidth')) || 3;
  let enabled = false;
  let pending = null; // 按下但还没开始画
  let current = null;
  let suppressClickUntil = 0;

  const layer = h('div', { id: 'ink-layer', class: 'ink-layer' }, canvas);
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
    strokes.pop();
    redraw();
  });
  const clearBtn = h('button', { class: 'btn subtle sm', type: 'button' }, '清空');
  clearBtn.addEventListener('click', () => {
    strokes.length = 0;
    redraw();
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
    if (!enabled) {
      pending = null;
      current = null;
    }
  }

  ball.addEventListener('click', () => setPanel(!dock.classList.contains('open')));

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = window.innerWidth;
    const cssHeight = Math.max(0, window.innerHeight - TOP_OFFSET);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function drawStroke(stroke) {
    if (!stroke.points.length) return;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    stroke.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawStroke);
    if (current) drawStroke(current);
  }

  function pointOf(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // 这些区域优先给应用本身：输入、按钮、下拉、链接、批注球面板
  function isInteractive(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'textarea, input, select, button, a, label, [contenteditable="true"], .ink-dock'
    );
  }

  function onPointerDown(event) {
    if (!enabled || event.button !== 0) return;
    if (isInteractive(event.target)) return;
    if (event.clientY < TOP_OFFSET) return;
    pending = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    current = null;
  }

  function onPointerMove(event) {
    if (!enabled || !pending) return;
    if ((event.buttons & 1) !== 1) {
      pending = null;
      current = null;
      return;
    }
    if (!current) {
      const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (moved < 4) return;
      current = { color, width, points: [{ x: pending.x - canvas.getBoundingClientRect().left, y: pending.y - canvas.getBoundingClientRect().top }] };
      document.body.classList.add('ink-writing');
    }
    event.preventDefault();
    current.points.push(pointOf(event));
    redraw();
  }

  function finishStroke() {
    if (!current) {
      pending = null;
      return;
    }
    strokes.push(current);
    current = null;
    pending = null;
    document.body.classList.remove('ink-writing');
    suppressClickUntil = Date.now() + 250;
    redraw();
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

  window.addEventListener('resize', resize);

  document.body.appendChild(layer);
  document.body.appendChild(dock);

  resize();
  setEnabled(false);
}
