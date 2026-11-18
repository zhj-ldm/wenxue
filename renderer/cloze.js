import { h } from './ui.js';

const MARKER = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

/** 是否按「题文 + 答案穿插」的内联方式渲染 */
export function isInlineQuestion(question) {
  if (!question) return false;
  if (question.layout === 'inline') return true;
  return Array.isArray(question.blanks) && question.blanks.length > 0;
}

/** 这道题需要用到的空位（按出现顺序） */
export function blankKeys(question) {
  if (!question) return [];
  const keys = [];
  const seen = new Set();
  const scan = (text) => {
    if (!text) return;
    const re = new RegExp(MARKER.source, 'g');
    let m;
    while ((m = re.exec(String(text)))) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        keys.push(m[1]);
      }
    }
  };
  scan(question.passage);
  scan(question.stem);
  (Array.isArray(question.blanks) ? question.blanks : []).forEach((b) => {
    const key = String(b && b.key != null ? b.key : '');
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  });
  return keys;
}

function blankMeta(question, key) {
  const list = Array.isArray(question.blanks) ? question.blanks : [];
  return list.find((b) => String(b.key) === String(key)) || {};
}

function makeInput(question, key, values, onChange) {
  const meta = blankMeta(question, key);
  const width = Number(meta.width) || Math.min(24, Math.max(7, String(meta.answer || '').length + 3));
  const input = h('input', {
    class: 'blank-input',
    type: 'text',
    value: values[key] == null ? '' : String(values[key]),
    placeholder: key,
    size: String(width),
    'aria-label': `第 ${key} 空`
  });
  input.addEventListener('input', () => {
    values[key] = input.value;
    onChange(key, input.value);
  });
  return input;
}

/** 把带 {{1}} 标记的文本渲染成「文字 + 输入框」穿插 */
function renderMarked(text, question, values, onChange, used) {
  if (!text) return null;
  const node = h('div', { class: 'cloze-text' });
  const source = String(text);
  let last = 0;
  const re = new RegExp(MARKER.source, 'g');
  let m;
  while ((m = re.exec(source))) {
    if (m.index > last) node.appendChild(document.createTextNode(source.slice(last, m.index)));
    node.appendChild(makeInput(question, m[1], values, onChange));
    used.add(m[1]);
    last = m.index + m[0].length;
  }
  if (last < source.length) node.appendChild(document.createTextNode(source.slice(last)));
  return node;
}

/**
 * 内联作答区：阅读材料与题干里的 {{n}} 直接变成输入框；
 * 没有标记时把空追加在题干末尾，保证每道题都有地方写。
 */
export function buildInlineAnswer(question, values, onChange) {
  const box = h('div', { class: 'cloze' });
  const used = new Set();

  const passage = renderMarked(question.passage, question, values, onChange, used);
  if (passage) box.appendChild(h('div', { class: 'cloze-passage' }, passage));

  const stem = renderMarked(question.stem, question, values, onChange, used);
  if (stem) box.appendChild(h('div', { class: 'cloze-stem' }, stem));

  const keys = blankKeys(question);
  const remaining = keys.filter((k) => !used.has(k));
  if (remaining.length && (!stem || !used.size)) {
    const tail = h('div', { class: 'cloze-tail' });
    remaining.forEach((key, index) => {
      if (index) tail.appendChild(document.createTextNode('　'));
      tail.appendChild(h('span', { class: 'blank-index' }, `(${key})`));
      tail.appendChild(makeInput(question, key, values, onChange));
      used.add(key);
    });
    box.appendChild(tail);
  } else if (!keys.length && !used.size) {
    // 既没有 blanks 也没有标记：按单空处理
    const key = '1';
    const tail = h('div', { class: 'cloze-tail' });
    tail.appendChild(makeInput(question, key, values, onChange));
    box.appendChild(tail);
  }

  return box;
}

/** 把各空答案合成一段可读文本，存进 answers 并交给 AI 批改 */
export function composeBlankAnswer(question, values) {
  const keys = blankKeys(question);
  if (!keys.length) return String(values['1'] || '');
  return keys.map((key) => `${key}. ${String(values[key] || '').trim() || '（空）'}`).join('\n');
}
