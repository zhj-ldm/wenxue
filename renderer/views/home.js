import { call } from '../api.js';
import { h, fmtScore, timeAgo, toast, confirmDialog } from '../ui.js';
import { paperCard, emptyState } from '../components.js';
import { importPaperFile } from './import.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export async function renderHome(container, ctx) {
  const { state, go } = ctx;
  const papers = await call('paper:list');
  const subjects = state.boot.subjects || [];

  const doing = papers.filter((p) => p.status === 'doing');
  const resumeTarget = doing[0] || papers.find((p) => p.status === 'new') || papers[0];
  const gradedTotal = papers.reduce((sum, p) => sum + (p.graded || 0), 0);
  const scoreTotal = papers.reduce((sum, p) => sum + (p.total || 0), 0);

  function openPaper(paper) {
    go('exam', { paperId: paper.id });
  }

  async function removePaper(paper) {
    const ok = await confirmDialog({
      title: '删除试卷',
      message: `「${paper.title}」的作答记录与每道题的对话都会一并删除，且无法恢复。`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    await call('paper:delete', { paperId: paper.id });
    toast('试卷已删除');
    container.innerHTML = '';
    await renderHome(container, ctx);
  }

  async function exportPaper(paper) {
    try {
      const res = await call('paper:export', { paperId: paper.id });
      toast(`已导出到 ${res.file}`, 'ok');
    } catch (err) {
      toast(err.message || '导出失败', 'error');
    }
  }

  const page = h('div', { class: 'page' });

  page.appendChild(
    h(
      'div',
      { class: 'hero' },
      h(
        'div',
        {},
        h('h1', { class: 'hero-title' }, `${greeting()}，`, h('em', {}, '今天练一套'), '吧。'),
        h('div', { class: 'hero-sub' }, doing.length ? `还有 ${doing.length} 套卷做到一半，接着来。` : '选一个学科，开始今天的练习。'),
        h(
          'div',
          { class: 'stats' },
          h('div', { class: 'stat' }, h('div', { class: 'num' }, String(papers.length)), h('div', { class: 'lbl' }, 'Papers')),
          h('div', { class: 'stat' }, h('div', { class: 'num' }, String(doing.length)), h('div', { class: 'lbl' }, 'In progress')),
          h('div', { class: 'stat' }, h('div', { class: 'num' }, String(gradedTotal)), h('div', { class: 'lbl' }, 'Graded')),
          h('div', { class: 'stat' }, h('div', { class: 'num' }, fmtScore(scoreTotal)), h('div', { class: 'lbl' }, 'Score'))
        )
      ),
      h(
        'div',
        { class: 'hero-actions' },
        h('button', { class: 'btn primary hero-cta', type: 'button', onclick: () => go('chat') }, '和 AI 聊聊'),
        h('button', { class: 'btn', type: 'button', onclick: () => importPaperFile(ctx) }, '导入试卷')
      )
    )
  );

  if (resumeTarget) {
    const total = resumeTarget.questionCount || 0;
    const answered = Math.min(resumeTarget.answered || 0, total);
    const percent = total ? Math.round((answered / total) * 100) : 0;
    page.appendChild(
      h(
        'div',
        { class: 'resume' },
        h(
          'div',
          { class: 'resume-main' },
          h('div', { class: 'resume-kicker' }, resumeTarget.status === 'finished' ? '上次完成' : '继续上次'),
          h('div', { class: 'resume-title' }, resumeTarget.title),
          h(
            'div',
            { class: 'resume-meta' },
            `${resumeTarget.subject}${resumeTarget.grade ? ` · ${resumeTarget.grade}` : ''} · ${answered}/${total} 题已作答`,
            resumeTarget.graded ? ` · 已批 ${resumeTarget.graded} 题 · 得分 ${fmtScore(resumeTarget.total)}` : '',
            ` · ${timeAgo(resumeTarget.lastOpenedAt || resumeTarget.createdAt)}`
          ),
          h('div', { class: 'progress', style: 'max-width:420px;margin-top:12px' }, h('i', { style: `width:${percent}%` }))
        ),
        h('button', { class: 'btn primary', type: 'button', onclick: () => openPaper(resumeTarget) }, 'Continue')
      )
    );
  }

  const subjectSection = h(
    'div',
    { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, '选择学科')),
    h(
      'div',
      { class: 'subject-grid' },
      subjects.map((subject) => {
        const count = papers.filter((p) => p.subject === subject.name).length;
        return h(
          'button',
          {
            class: `subject-card ${subject.key === 'math' ? 'is-muted' : ''}`,
            type: 'button',
            onclick: () => go('library', { subject: subject.name })
          },
          h('div', { class: 'subject-en' }, subject.en),
          h('div', { class: 'subject-cn' }, subject.name),
          h('div', { class: 'subject-meta' }, subject.note),
          count ? h('span', { class: 'subject-count' }, `${count} 套`) : null
        );
      })
    )
  );
  page.appendChild(subjectSection);

  page.appendChild(
    h(
      'div',
      { class: 'section' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { class: 'section-title' }, '最近作答'),
        papers.length ? h('button', { class: 'section-more', type: 'button', onclick: () => go('library', { subject: '全部' }) }, '查看全部 →') : null
      ),
      papers.length
        ? h(
            'div',
            { class: 'paper-grid' },
            papers.slice(0, 6).map((paper) =>
              paperCard(paper, { onOpen: openPaper, onDelete: removePaper, onExport: exportPaper })
            )
          )
        : emptyState({
            icon: '卷',
            title: '还没有试卷',
            desc: '把一份试卷 JSON 放进「问学试卷」文件夹，或直接选文件导入；也可以让 AI 对话帮你出一套。',
            actions: [
              h('button', { class: 'btn', type: 'button', onclick: () => importPaperFile(ctx) }, '导入试卷'),
              h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat') }, '和 AI 聊聊')
            ]
          })
    )
  );

  container.appendChild(page);
}
