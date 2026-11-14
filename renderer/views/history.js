import { call } from '../api.js';
import { h, fmtScore, dateTime, timeAgo } from '../ui.js';
import { emptyState } from '../components.js';

function modelLabel(row) {
  const raw = typeof row.model === 'string' ? row.model.trim() : '';
  if (!raw || raw === '[object Object]' || /opencode|big-pickle/i.test(raw)) return '—';
  return raw.replace(/^.*\//, '').slice(0, 14);
}

export async function renderHistory(container, ctx) {
  const { go } = ctx;
  const rows = await call('attempt:history');

  const page = h('div', { class: 'page' });
  page.appendChild(
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'page-title' }, '作答记录'),
        h('div', { class: 'page-sub' }, `${rows.length} 条记录 · 每次作答的答案与每题对话都完整保留`)
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '← Back')
    )
  );

  if (!rows.length) {
    page.appendChild(
      emptyState({
        icon: '记',
        title: '还没有作答记录',
        desc: '选一套试卷开始作答，交卷后这里会留下完整的记录。',
        actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => go('library', { subject: '全部' }) }, '去选试卷')]
      })
    );
    container.appendChild(page);
    return;
  }

  const table = h(
    'div',
    { class: 'history' },
    h(
      'div',
      { class: 'history-row head' },
      h('span', {}, '时间'),
      h('span', {}, '试卷'),
      h('span', {}, '作答'),
      h('span', {}, '得分'),
      h('span', {}, '模型'),
      h('span', {}, '')
    ),
    rows.map((row) =>
      h(
        'div',
        { class: 'history-row', onclick: () => go('exam', { paperId: row.paperId }) },
        h('span', { class: 'hint' }, dateTime(row.startedAt)),
        h('span', { class: 'hp' }, row.paperTitle || '未命名试卷'),
        h('span', { class: 'hint' }, `${row.answered} 题 / 批 ${row.graded}`),
        h('span', { class: 'hs' }, `${fmtScore(row.total)} / ${fmtScore(row.max)}`),
        h('span', { class: 'hint', title: modelLabel(row) }, modelLabel(row)),
        h('span', { class: 'hint' }, row.finishedAt ? '已完成' : timeAgo(row.updatedAt))
      )
    )
  );

  page.appendChild(table);
  container.appendChild(page);
}
