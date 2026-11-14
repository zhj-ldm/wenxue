import { h, fmtScore, timeAgo } from './ui.js';
import { SOURCE_LABEL } from './constants.js';

export function paperCard(paper, { onOpen, onDelete, onExport } = {}) {
  const total = paper.questionCount || 0;
  const answered = Math.min(paper.answered || 0, total);
  const percent = total ? Math.round((answered / total) * 100) : 0;
  const statusText =
    paper.status === 'finished'
      ? `已完成 · ${fmtScore(paper.total)} 分`
      : paper.status === 'doing'
        ? `进行中 · ${answered}/${total}`
        : `未开始 · ${total} 题`;

  return h(
    'article',
    { class: 'paper-card' },
    h(
      'div',
      {},
      h('h3', { class: 'paper-title' }, paper.title),
      h(
        'div',
        { class: 'paper-meta', style: 'margin-top:7px' },
        h('span', { class: `badge ${paper.source === 'generated' || paper.source === 'searched' ? 'accent' : ''}` }, SOURCE_LABEL[paper.source] || paper.source || '导入'),
        paper.grade ? h('span', { class: 'badge' }, paper.grade) : null,
        h('span', {}, `${total} 题`),
        h('span', {}, `满分 ${fmtScore(paper.totalScore)}`),
        paper.durationMinutes ? h('span', {}, `${paper.durationMinutes} 分钟`) : null
      )
    ),
    h('div', { class: 'progress' }, h('i', { style: `width:${percent}%` })),
    h(
      'div',
      { class: 'paper-foot' },
      h('div', { class: 'left' }, `${statusText} · ${timeAgo(paper.lastOpenedAt || paper.createdAt)}`),
      h(
        'div',
        { class: 'row', style: 'gap:4px' },
        onExport ? h('button', { class: 'btn subtle sm', type: 'button', onclick: () => onExport(paper) }, 'Export') : null,
        onDelete ? h('button', { class: 'btn subtle sm', type: 'button', onclick: () => onDelete(paper) }, 'Delete') : null,
        h(
          'button',
          { class: 'btn primary sm', type: 'button', onclick: () => onOpen && onOpen(paper) },
          paper.status === 'new' ? 'Start' : 'Continue'
        )
      )
    )
  );
}

export function emptyState({ icon = '问', title = '这里还空着', desc = '', actions = [] } = {}) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'icon' }, icon),
    h('div', { class: 'empty-title' }, title),
    desc ? h('div', { class: 'empty-desc' }, desc) : null,
    h('div', { class: 'row', style: 'justify-content:center;gap:8px;flex-wrap:wrap' }, actions)
  );
}
