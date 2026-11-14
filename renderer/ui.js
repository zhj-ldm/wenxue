export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = !!value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'object' && child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function inline(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(（])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function renderTable(rows) {
  const cells = rows.map((r) =>
    r
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())
  );
  const body = cells.filter((row) => !row.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
  if (!body.length) return '';
  const [head, ...rest] = body;
  const thead = `<thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rest.map((row) => `<tr>${row.map((c) => `<td>${inline(esc(c))}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

export function md(src) {
  const text = String(src == null ? '' : src).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      i += 1;
      const code = [];
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!trimmed) {
      i += 1;
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(5, Math.max(3, heading[1].length + 2));
      out.push(`<h${level}>${inline(esc(heading[2]))}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const quoted = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${quoted.map((t) => inline(esc(t))).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+])\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+])\s+/, ''));
        i += 1;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(esc(t))}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      out.push(`<ol>${items.map((t) => `<li>${inline(esc(t))}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(rows));
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s|^>\s?|^\s*([-*+])\s|^\s*\d+[.)]\s|^```|^\s*\|/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${para.map((t) => inline(esc(t))).join('<br>')}</p>`);
  }
  return out.join('');
}

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = h('div', { class: `toast ${kind}` }, String(message));
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 5200 : 3200);
}

export function modal(options) {
  const { title = '', body = null, footer = null, size = '', onClose = null, closable = true } = options || {};
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: `modal ${size}` });
  const bodyEl = h('div', { class: 'modal-body' }, body || '');

  const head = h(
    'div',
    { class: 'modal-head' },
    h('h3', { class: 'modal-title' }, title),
    closable ? h('button', { class: 'close', type: 'button', onclick: () => close() }, '×') : null
  );

  box.appendChild(head);
  box.appendChild(bodyEl);
  if (footer) {
    const foot = h('div', { class: 'modal-foot' }, footer);
    box.appendChild(foot);
  }
  backdrop.appendChild(box);
  document.getElementById('overlay').appendChild(backdrop);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (onClose) onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape' && closable) close();
  }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && closable) close();
  });
  return { close, el: box, bodyEl, headEl: head };
}

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      ref.close();
    };
    const ref = modal({
      title,
      size: 'narrow',
      body: h('div', { class: 'hint', style: 'font-size:13px;color:var(--ink-2)' }, message),
      footer: [
        h('button', { class: 'btn subtle', type: 'button', onclick: () => done(false) }, '取消'),
        h(
          'button',
          {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            type: 'button',
            onclick: () => done(true)
          },
          confirmText
        )
      ],
      onClose: () => done(false)
    });
  });
}

export function uid(prefix = 'run') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function fmtScore(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Math.round(Number(value) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function dateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function pill(text, kind = '') {
  return h('span', { class: `pill ${kind}` }, text);
}
