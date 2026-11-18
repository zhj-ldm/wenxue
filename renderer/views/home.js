import { call } from '../api.js';
import { h, fmtScore, toast, confirmDialog } from '../ui.js';
import { importPaperFile } from './import.js';

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDate(date, delta) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

const TABS = [
  { key: 'papers', label: '试卷练习' },
  { key: 'daily', label: '每日任务' },
  { key: 'plans', label: '提升计划' }
];

const KIND_LABEL = { paper: '试卷', practice: '练习', plan: '提升计划' };

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast(`已复制编号 ${code}`, 'ok');
  } catch {
    toast(code, 'ok');
  }
}

function codeChip(code) {
  return h(
    'button',
    {
      class: 'code-chip sm',
      type: 'button',
      title: '点击复制编号',
      onclick: (event) => {
        event.stopPropagation();
        copyCode(code);
      }
    },
    code
  );
}

export async function renderHome(container, ctx) {
  const { state, go, params } = ctx;
  const active = params.tab || 'papers';
  const today = todayStr();
  const activeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date || '')) ? params.date : today;
  const [listRes, dailyRes, todayRes] = await Promise.all([
    call('carrier:list'),
    call('carrier:daily', { date: activeDate }),
    activeDate === today ? Promise.resolve(null) : call('carrier:daily')
  ]);
  const carriers = listRes.carriers || [];
  const daily = dailyRes || { pending: [], done: [], today: activeDate };
  const badgeDaily = activeDate === today ? daily : todayRes || daily;
  const subjects = state.boot.subjects || [];
  const papers = carriers.filter((c) => c.kind === 'paper');
  const practices = carriers.filter((c) => c.kind === 'practice');
  const plans = carriers.filter((c) => c.kind === 'plan');

  const page = h('div', { class: 'page' });
  page.appendChild(
    h(
      'div',
      { class: 'tabs learn-tabs' },
      TABS.map((tab) =>
        h(
          'button',
          {
            class: `tab ${active === tab.key ? 'active' : ''}`,
            type: 'button',
            onclick: () => go('home', { tab: tab.key })
          },
          tab.label,
          tab.key === 'daily' && badgeDaily.pending.length ? h('span', { class: 'tab-badge' }, String(badgeDaily.pending.length)) : null
        )
      )
    )
  );

  if (active === 'papers') renderPapers();
  else if (active === 'daily') renderDaily();
  else renderPlans();
  container.appendChild(page);

  async function removeCarrier(carrier) {
    const ok = await confirmDialog({
      title: '删除载体',
      message: `确定删除《${carrier.title}》（${carrier.code}）？该载体的作答与对话记录、以及放题目录中的源文件会一起删除，且无法恢复。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    try {
      await call('carrier:delete', { code: carrier.code });
      toast(`已删除《${carrier.title}》`, 'ok');
      go('home', { tab: active });
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  }

  function deleteBtn(carrier) {
    return h(
      'button',
      {
        class: 'card-del',
        type: 'button',
        title: '删除载体',
        onclick: (event) => {
          event.stopPropagation();
          removeCarrier(carrier);
        }
      },
      '✕'
    );
  }

  function carrierCard(carrier, extraMeta = '') {
    const percent = carrier.questionCount ? Math.round((carrier.answered / carrier.questionCount) * 100) : 0;
    return h(
      'div',
      {
        class: 'carrier-card',
        role: 'button',
        tabindex: '0',
        onclick: () => go('carrier', { code: carrier.code }),
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            go('carrier', { code: carrier.code });
          }
        }
      },
      h(
        'div',
        { class: 'carrier-card-top' },
        h('span', { class: `badge ${carrier.kind === 'practice' ? '' : 'accent'}` }, KIND_LABEL[carrier.kind] || carrier.kind),
        h('div', { class: 'carrier-card-title' }, carrier.title),
        codeChip(carrier.code),
        deleteBtn(carrier)
      ),
      h(
        'div',
        { class: 'carrier-card-meta' },
        carrier.subject || '综合',
        carrier.grade ? ` · ${carrier.grade}` : '',
        ` · ${carrier.questionCount} 题`,
        ` · 满分 ${fmtScore(carrier.totalScore)}`,
        extraMeta ? ` · ${extraMeta}` : ''
      ),
      h('div', { class: 'progress', style: 'margin-top:12px' }, h('i', { style: `width:${percent}%` })),
      h('div', { class: 'carrier-card-foot' }, h('span', {}, `已作答 ${carrier.answered}/${carrier.questionCount}`), h('span', { class: 'open-hint' }, '进入 →'))
    );
  }

  function empty(title, desc, actions = []) {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'empty-title' }, title),
      h('div', { class: 'empty-desc' }, desc),
      actions.length ? h('div', { class: 'empty-actions' }, actions) : null
    );
  }

  function renderPapers() {
    page.appendChild(
      h(
        'div',
        { class: 'hero compact' },
        h(
          'div',
          {},
          h('h1', { class: 'hero-title' }, `${greeting()}，`, h('em', {}, '今天练一套'), '吧。'),
          h('div', { class: 'hero-sub' }, `共 ${papers.length} 套试卷、${practices.length} 个专项练习，全部保存在本机。`)
        ),
        h(
          'div',
          { class: 'hero-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat') }, '让 AI 出题'),
          h('button', { class: 'btn', type: 'button', onclick: () => importPaperFile(ctx) }, '导入试卷')
        )
      )
    );

    page.appendChild(
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', { class: 'section-title' }, '整套试卷'),
          papers.length ? h('span', { class: 'section-hint' }, `${papers.length} 套`) : null
        ),
        papers.length
          ? h('div', { class: 'carrier-grid' }, papers.map((c) => carrierCard(c)))
          : empty('还没有试卷', '把试卷 JSON 放进放题目录，或直接导入；也可以让 AI 在对话里出题。', [
              h('button', { class: 'btn', type: 'button', onclick: () => importPaperFile(ctx) }, '导入试卷'),
              h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat') }, '去对话出题')
            ])
      )
    );

    page.appendChild(
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, '专项练习'), practices.length ? h('span', { class: 'section-hint' }, `${practices.length} 个`) : null),
        practices.length
          ? h('div', { class: 'carrier-grid' }, practices.map((c) => carrierCard(c)))
          : h('div', { class: 'empty slim' }, '还没有专项练习，可以让 AI 针对薄弱点生成一个。')
      )
    );

    if (practices.length === 0 && papers.length === 0) {
      page.appendChild(h('div', { class: 'empty slim' }, '从右上角「让 AI 出题」或「导入试卷」开始。'));
    }
  }

  function dailyCard(item) {
    const percent = item.total ? Math.round((item.done / item.total) * 100) : 0;
    const target = item.pendingIds[0] || item.questionIds[0];
    return h(
      'div',
      {
        class: 'carrier-card daily-card',
        role: 'button',
        tabindex: '0',
        onclick: () => go('carrier', { code: item.code, focus: target }),
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            go('carrier', { code: item.code, focus: target });
          }
        }
      },
      h(
        'div',
        { class: 'carrier-card-top' },
        h('span', { class: 'badge accent' }, KIND_LABEL[item.kind] || item.kind),
        h('div', { class: 'carrier-card-title' }, item.title),
        codeChip(item.code),
        deleteBtn(item)
      ),
      h(
        'div',
        { class: 'carrier-card-meta' },
        item.subject || '综合',
        ` · 今日 ${item.total} 题`,
        item.pendingIds.length ? ` · 待完成 ${item.pendingIds.length}` : ' · 已全部完成'
      ),
      h('div', { class: 'progress', style: 'margin-top:12px' }, h('i', { style: `width:${percent}%` })),
      h('div', { class: 'carrier-card-foot' }, h('span', {}, `完成 ${item.done}/${item.total}`), h('span', { class: 'open-hint' }, item.pendingIds.length ? '去完成 →' : '回看 →'))
    );
  }

  function renderDaily() {
    const dateInput = h('input', {
      class: 'date-input',
      type: 'date',
      value: activeDate,
      onchange: () => go('home', { tab: 'daily', date: dateInput.value || today })
    });
    page.appendChild(
      h(
        'div',
        { class: 'daily-toolbar' },
        h('button', { class: 'btn subtle sm', type: 'button', title: '前一天', onclick: () => go('home', { tab: 'daily', date: shiftDate(activeDate, -1) }) }, '‹'),
        dateInput,
        h('button', { class: 'btn subtle sm', type: 'button', title: '后一天', onclick: () => go('home', { tab: 'daily', date: shiftDate(activeDate, 1) }) }, '›'),
        activeDate !== today ? h('button', { class: 'btn subtle sm', type: 'button', onclick: () => go('home', { tab: 'daily' }) }, '回到今天') : null,
        h('span', { class: 'daily-date-label' }, activeDate === today ? '今天' : activeDate < today ? '回看' : '提前看')
      )
    );

    page.appendChild(
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', { class: 'section-title' }, '待完成'),
          h('span', { class: 'section-hint' }, `${daily.pending.length} 个载体`)
        ),
        daily.pending.length
          ? h('div', { class: 'carrier-grid' }, daily.pending.map(dailyCard))
          : empty(activeDate === today ? '今天没有待完成任务' : '这一天没有待完成任务', '给题目设置日期后，到期会自动出现在这里；也可以切换到其他日期查看。', [
              h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat') }, '让 AI 安排今天')
            ])
      )
    );

    if (daily.done.length) {
      page.appendChild(
        h(
          'div',
          { class: 'section' },
          h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, '已完成'), h('span', { class: 'section-hint' }, `${daily.done.length} 个载体`)),
          h('div', { class: 'carrier-grid' }, daily.done.map(dailyCard))
        )
      );
    }
  }

  function renderPlans() {
    page.appendChild(
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', { class: 'section-title' }, '提升计划'),
          h('button', { class: 'section-more', type: 'button', onclick: () => go('chat') }, '新建计划 →')
        ),
        plans.length
          ? h('div', { class: 'carrier-grid' }, plans.map((p) => carrierCard(p)))
          : empty('还没有提升计划', '和一个完整的 AI 聊聊你想提升什么，让它按天排好题目；每天到期会自动进入每日任务。', [
              h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat') }, '去对话创建')
            ])
      )
    );
  }
}
