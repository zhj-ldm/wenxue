import { call } from '../api.js';
import { h, fmtScore, dateTime, timeAgo } from '../ui.js';
import { emptyState } from '../components.js';

const KIND_LABEL = { paper: '试卷', practice: '练习', plan: '计划' };

export async function renderHistory(container, ctx) {
  const { go } = ctx;
  const res = await call('carrier:history');
  const rows = res.records || [];

  const page = h('div', { class: 'page' });
  page.appendChild(
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h('h1', { class: 'page-title' }, '作答记录'),
        h('div', { class: 'page-sub' }, `${rows.length} 条记录 · 答案、批改与每题对话都完整保留`)
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '← 返回')
    )
  );

  if (!rows.length) {
    page.appendChild(
      emptyState({
        icon: '记',
        title: '还没有作答记录',
        desc: '打开任意试卷、练习或提升计划开始作答，这里会留下完整记录。',
        actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => go('home') }, '去学习')]
      })
    );
    container.appendChild(page);
    return;
  }

  page.appendChild(
    h(
      'div',
      { class: 'history' },
      h(
        'div',
        { class: 'history-row head' },
        h('span', {}, '时间'),
        h('span', {}, '载体'),
        h('span', {}, '作答'),
        h('span', {}, '得分'),
        h('span', {}, '')
      ),
      rows.map((row) =>
        h(
          'div',
          { class: 'history-row', onclick: () => go('carrier', { code: row.code }) },
          h('span', { class: 'hint' }, dateTime(row.startedAt)),
          h(
            'span',
            { class: 'hp' },
            h('span', { class: 'badge' }, KIND_LABEL[row.kind] || row.kind),
            ` ${row.title || '未命名'} `,
            h('span', { class: 'hint' }, row.code)
          ),
          h('span', { class: 'hint' }, `${row.answered} 题 / 批 ${row.graded}`),
          h('span', { class: 'hs' }, `${fmtScore(row.total)} / ${fmtScore(row.max)}`),
          h('span', { class: 'hint' }, row.finishedAt ? '已完成' : timeAgo(row.updatedAt))
        )
      )
    )
  );

  container.appendChild(page);
}
