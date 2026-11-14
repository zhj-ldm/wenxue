import { call } from '../api.js';
import { h, toast, confirmDialog } from '../ui.js';
import { paperCard, emptyState } from '../components.js';
import { importPaperFile } from './import.js';

export async function renderLibrary(container, ctx) {
  const { params, go, state } = ctx;
  const subject = params.subject || '全部';
  const all = await call('paper:list');
  const papers = subject === '全部' ? all : all.filter((p) => p.subject === subject);
  const subjects = state.boot.subjects || [];

  const page = h('div', { class: 'page' });

  async function removePaper(paper) {
    const ok = await confirmDialog({
      title: '删除试卷',
      message: `「${paper.title}」的作答记录与对话都会一并删除。`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    await call('paper:delete', { paperId: paper.id });
    toast('试卷已删除');
    container.innerHTML = '';
    await renderLibrary(container, ctx);
  }

  async function exportPaper(paper) {
    try {
      const res = await call('paper:export', { paperId: paper.id });
      toast(`已导出到 ${res.file}`, 'ok');
    } catch (err) {
      toast(err.message || '导出失败', 'error');
    }
  }

  const chips = h(
    'div',
    { class: 'chips', style: 'margin-bottom:18px' },
    ['全部', ...subjects.map((s) => s.name)].map((name) => {
      const count = name === '全部' ? all.length : all.filter((p) => p.subject === name).length;
      if (name !== '全部' && !count) return null;
      return h(
        'button',
        {
          class: `user-pill ${subject === name ? 'active' : ''}`,
          type: 'button',
          onclick: () => go('library', { subject: name })
        },
        name,
        h('span', { style: 'font-size:11px;opacity:.66' }, String(count))
      );
    })
  );

  page.appendChild(
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h(
          'div',
          { class: 'row', style: 'gap:8px;margin-bottom:6px' },
          h('button', { class: 'btn subtle sm', type: 'button', onclick: () => go('home') }, '← Back'),
          h('span', { class: 'hint' }, '试卷库')
        ),
        h('h1', { class: 'page-title' }, subject === '全部' ? '全部试卷' : `${subject} · 试卷`),
        h('div', { class: 'page-sub' }, `${papers.length} 套 · 题干与作答都保存在本机`)
      ),
      h(
        'div',
        { class: 'row', style: 'gap:8px' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            title: '扫描「放题目录」，把新放入的试卷 JSON 收录进来',
            onclick: async (event) => {
              const btn = event.currentTarget;
              btn.disabled = true;
              try {
                const res = await call('paper:syncFolder', {});
                toast(res.added ? `已收录 ${res.added} 套新试卷` : `已扫描 ${res.scanned} 个文件，没有新试卷`, res.added ? 'ok' : '');
                if (res.added) {
                  container.innerHTML = '';
                  await renderLibrary(container, ctx);
                  return;
                }
              } catch (err) {
                toast(err.message || '同步失败', 'error');
              }
              btn.disabled = false;
            }
          },
          '同步文件夹'
        ),
        h('button', { class: 'btn primary', type: 'button', onclick: () => importPaperFile(ctx, { subject: subject === '全部' ? '' : subject }) }, '导入试卷')
      )
    )
  );

  page.appendChild(chips);

  if (!papers.length) {
    page.appendChild(
      emptyState({
        icon: '卷',
        title: subject === '全部' ? '试卷库还是空的' : `${subject}还没有试卷`,
        desc: '把试卷 JSON 放进「问学试卷」文件夹点同步，或直接选文件导入；也可以让 AI 对话帮你出一套。',
        actions: [
          h('button', { class: 'btn', type: 'button', onclick: () => importPaperFile(ctx, { subject: subject === '全部' ? '' : subject }) }, '导入试卷'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat') }, '和 AI 聊聊')
        ]
      })
    );
  } else {
    page.appendChild(
      h(
        'div',
        { class: 'paper-grid' },
        papers.map((paper) =>
          paperCard(paper, {
            onOpen: (p) => go('exam', { paperId: p.id }),
            onDelete: removePaper,
            onExport: exportPaper
          })
        )
      )
    );
  }

  container.appendChild(page);
}
