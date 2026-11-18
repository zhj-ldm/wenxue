import { call } from '../api.js';
import { h, md, toast, uid, fmtScore, confirmDialog } from '../ui.js';
import { TYPE_LABEL } from '../constants.js';
import { isInlineQuestion, buildInlineAnswer, composeBlankAnswer } from '../cloze.js';
import { createQaSidebar } from '../qa-sidebar.js';

function formatDate(date) {
  if (!date) return '';
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const t = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (date === t) return '今天';
  return date.slice(5).replace('-', '/');
}

export async function renderCarrier(container, ctx) {
  const { go, params } = ctx;
  const code = String(params.code || params.carrierCode || '');
  const focusId = params.focus || '';
  const data = await call('carrier:get', { code });
  const carrier = data.carrier;
  const attempt = data.attempt;
  const chats = data.chats || {};
  const globalChat = data.globalChat || [];

  const answers = {};
  const blankAnswers = {};
  const grades = Object.assign({}, attempt.grades || {});
  const views = new Map();
  const pendingSaves = new Map();

  (carrier.sections || []).forEach((section) => {
    (section.questions || []).forEach((q) => {
      answers[q.id] = String((attempt.answers[q.id] || {}).answer || '');
      blankAnswers[q.id] = Object.assign({}, (attempt.answers[q.id] || {}).blanks || {});
    });
  });

  const sidebar = createQaSidebar({ carrier, attempt, chats, globalChat });

  const progress = h('span', { class: 'pill' });
  function answeredCount() {
    return Object.values(answers).filter((v) => String(v || '').trim()).length;
  }
  function refreshProgress() {
    const total = (carrier.sections || []).reduce((sum, s) => sum + (s.questions || []).length, 0);
    progress.textContent = `已作答 ${answeredCount()}/${total}`;
  }
  refreshProgress();

  const codeChip = h(
    'button',
    {
      class: 'code-chip',
      type: 'button',
      title: '点击复制编号',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(carrier.code);
          toast(`已复制编号 ${carrier.code}`, 'ok');
        } catch {
          toast(carrier.code, 'ok');
        }
      }
    },
    carrier.code
  );

  const kindLabel = carrier.kind === 'paper' ? '试卷' : carrier.kind === 'plan' ? '提升计划' : '练习';
  const meta = h(
    'div',
    { class: 'carrier-meta' },
    h('span', {}, kindLabel),
    carrier.subject ? h('span', {}, `· ${carrier.subject}`) : null,
    carrier.grade ? h('span', {}, `· ${carrier.grade}`) : null,
    carrier.durationMinutes ? h('span', {}, `· ${carrier.durationMinutes} 分钟`) : null,
    h('span', {}, `· 满分 ${fmtScore(carrier.totalScore)}`)
  );

  const head = h(
    'div',
    { class: 'carrier-head' },
    h('button', { class: 'back-btn', type: 'button', title: '返回', onclick: () => go('home') }, '←'),
    h('div', { class: 'carrier-head-main' }, h('h1', {}, carrier.title), meta),
    h(
      'div',
      { class: 'carrier-head-right' },
      codeChip,
      progress,
      h('button', { class: 'carrier-del', type: 'button', title: '删除这个载体', onclick: removeCarrier }, '删除')
    )
  );

  const page = h('div', { class: 'carrier-page' });
  const content = h('div', { class: 'carrier-content' });
  page.appendChild(content);
  content.appendChild(head);

  if (carrier.instructions) {
    content.appendChild(h('div', { class: 'carrier-instructions' }, carrier.instructions));
  }
  if (carrier.goal) {
    content.appendChild(h('div', { class: 'carrier-goal' }, h('b', {}, '目标：'), carrier.goal));
  }

  (carrier.sections || []).forEach((section) => {
    content.appendChild(sectionBlock(section));
  });

  content.appendChild(
    h(
      'div',
      { class: 'carrier-global-bar' },
      h('button', { class: 'btn', type: 'button', onclick: () => sidebar.openGlobal() }, `整套 AI 对话 · ${carrier.code}`)
    )
  );

  // 主内容与右侧 AI 之间的可拖动分隔条
  const resizer = h('div', { class: 'carrier-resizer', title: '拖动调整右侧宽度' });
  const WIDTH_KEY = 'wx.qaWidth';
  const clampWidth = (value) => {
    const rect = page.getBoundingClientRect();
    const total = rect.width || window.innerWidth || 1380;
    const max = Math.max(320, Math.min(680, total * 0.62));
    return Math.max(300, Math.min(max, Number(value) || 380));
  };
  let resizing = false;
  resizer.addEventListener('pointerdown', (event) => {
    resizing = true;
    resizer.classList.add('dragging');
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('col-resizing');
    event.preventDefault();
  });
  resizer.addEventListener('pointermove', (event) => {
    if (!resizing) return;
    const rect = page.getBoundingClientRect();
    page.style.setProperty('--qa-width', `${clampWidth(rect.right - event.clientX)}px`);
  });
  const endResize = () => {
    if (!resizing) return;
    resizing = false;
    resizer.classList.remove('dragging');
    document.body.classList.remove('col-resizing');
    const current = parseFloat(page.style.getPropertyValue('--qa-width')) || 380;
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(current)));
    } catch {
      /* ignore */
    }
  };
  resizer.addEventListener('pointerup', endResize);
  resizer.addEventListener('pointercancel', endResize);

  page.appendChild(resizer);
  page.appendChild(sidebar.el);
  container.appendChild(page);
  page.style.setProperty('--qa-width', `${clampWidth(localStorage.getItem(WIDTH_KEY))}px`);

  if (focusId) {
    setTimeout(() => {
      const node = document.getElementById(`q-${focusId}`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('focus');
        setTimeout(() => node.classList.remove('focus'), 2200);
      }
    }, 80);
  }

  function sectionBlock(section) {
    const questions = section.questions || [];
    const block = h('div', { class: 'carrier-section' });
    block.appendChild(
      h(
        'div',
        { class: 'carrier-section-head' },
        h('h2', {}, section.name || '题目'),
        section.date ? h('span', { class: 'pill' }, section.date) : null,
        h('span', { class: 'section-hint' }, `${questions.length} 题`)
      )
    );
    if (section.passage && !/\{\{/.test(section.passage)) {
      block.appendChild(h('div', { class: 'passage expanded' }, section.passage));
    }
    const list = h('div', { class: 'carrier-questions' });
    questions.forEach((q, i) => list.appendChild(questionCard(q, section, i)));
    block.appendChild(list);
    return block;
  }

  function questionCard(question, section, index) {
    const card = h('div', { class: 'q-card', id: `q-${question.id}` });
    const view = {};
    views.set(question.id, view);

    card.appendChild(
      h(
        'div',
        { class: 'q-head' },
        h('span', { class: 'q-index' }, `第 ${index + 1} 题`),
        h('span', { class: 'q-type' }, TYPE_LABEL[question.type] || question.type),
        question.date ? h('span', { class: 'pill' }, formatDate(question.date)) : null,
        h('span', { class: 'q-score' }, `${fmtScore(question.maxScore)} 分`)
      )
    );

    if (question.passage && !isInlineQuestion(question)) {
      card.appendChild(h('div', { class: 'passage expanded' }, question.passage));
    }
    if (!isInlineQuestion(question) && question.stem) {
      card.appendChild(h('div', { class: 'q-stem' }, question.stem));
    }

    if (isInlineQuestion(question)) {
      const values = blankAnswers[question.id];
      const area = buildInlineAnswer(question, values, () => {
        answers[question.id] = composeBlankAnswer(question, values);
        scheduleSave(question.id);
      });
      card.appendChild(area);
    } else if ((question.type === 'choice' || question.type === 'multi_choice') && question.options && question.options.length) {
      const multi = question.type === 'multi_choice';
      const box = h('div', { class: 'options' });
      const selected = new Set(String(answers[question.id] || '').toUpperCase().split(''));
      question.options.forEach((opt) => {
        const input = h('input', {
          type: multi ? 'checkbox' : 'radio',
          name: `q_${question.id}`,
          value: opt.key,
          checked: selected.has(opt.key)
        });
        input.addEventListener('change', () => {
          if (multi) {
            answers[question.id] = Array.from(box.querySelectorAll('input:checked')).map((x) => x.value).sort().join('');
          } else {
            answers[question.id] = input.checked ? opt.key : '';
          }
          box.querySelectorAll('label.option').forEach((label) => {
            const i = label.querySelector('input');
            label.classList.toggle('selected', !!(i && i.checked));
          });
          scheduleSave(question.id);
        });
        box.appendChild(h('label', { class: `option ${input.checked ? 'selected' : ''}` }, input, h('span', { class: 'opt-key' }, opt.key), h('span', {}, opt.text)));
      });
      card.appendChild(box);
    } else {
      const area = h('textarea', { class: 'answer-area', rows: question.type === 'essay' ? '7' : '4', placeholder: '写下你的答案…' });
      area.value = answers[question.id] || '';
      area.addEventListener('input', () => {
        answers[question.id] = area.value;
        scheduleSave(question.id);
      });
      card.appendChild(area);
    }

    const saveHint = h('span', { class: 'hint' }, '');
    view.saveHint = saveHint;

    const gradeBox = h('div', { class: 'grade-box' });
    if (grades[question.id]) gradeBox.appendChild(gradeNode(grades[question.id], question.maxScore));

    const actions = question.actions || { grade: true, explain: true, chat: true };
    const actionRow = h('div', { class: 'q-actions' });
    if (actions.grade !== false) {
      actionRow.appendChild(
        h(
          'button',
          {
            class: 'btn sm',
            type: 'button',
            onclick: () => {
              sidebar.openQuestion(question, section, 'chat', index + 1);
              doGrade(question, gradeBox);
            }
          },
          '批改'
        )
      );
    }
    if (actions.explain !== false) {
      actionRow.appendChild(h('button', { class: 'btn subtle sm', type: 'button', onclick: () => sidebar.openQuestion(question, section, 'explain', index + 1) }, '讲解'));
    }
    if (actions.chat !== false) {
      actionRow.appendChild(h('button', { class: 'btn subtle sm', type: 'button', onclick: () => sidebar.openQuestion(question, section, 'chat', index + 1) }, 'AI 对话'));
    }
    actionRow.appendChild(saveHint);
    card.appendChild(actionRow);
    card.appendChild(gradeBox);

    refreshQuestionState(question.id);
    return card;
  }

  function refreshQuestionState(qid) {
    const view = views.get(qid);
    if (!view) return;
    const answered = String(answers[qid] || '').trim();
    if (view.saveHint) view.saveHint.textContent = answered ? '已作答' : '';
    refreshProgress();
  }

  function gradeNode(grade, maxScore) {
    return h(
      'div',
      { class: 'grade-result' },
      h(
        'div',
        { class: 'grade-top' },
        h('span', { class: 'grade-score' }, `${fmtScore(grade.score)} / ${fmtScore(maxScore)}`),
        grade.level ? h('span', { class: 'pill' }, grade.level) : null
      ),
      grade.comment ? h('div', { class: 'grade-comment' }, grade.comment) : null,
      Array.isArray(grade.issues) && grade.issues.length
        ? h(
            'ul',
            { class: 'grade-issues' },
            grade.issues.map((it) => h('li', {}, `${it.point || ''}${it.advice ? `：${it.advice}` : ''}`))
          )
        : null
    );
  }

  function scheduleSave(questionId) {
    clearTimeout(pendingSaves.get(questionId));
    pendingSaves.set(
      questionId,
      setTimeout(async () => {
        try {
          const res = await call('carrier:answer', {
            code: carrier.code,
            attemptId: attempt.id,
            questionId,
            answer: answers[questionId] || '',
            blanks: blankAnswers[questionId] || undefined
          });
          const view = views.get(questionId);
          if (view && view.saveHint) view.saveHint.textContent = res.answered ? '已保存' : '';
          refreshProgress();
        } catch {
          /* ignore */
        }
      }, 450)
    );
  }

  async function removeCarrier() {
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
      go('home');
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  }

  async function doGrade(question, box) {
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'grade-pending' }, '正在批改…'));
    try {
      const res = await call('carrier:grade', {
        code: carrier.code,
        attemptId: attempt.id,
        questionId: question.id,
        runId: uid('grade')
      });
      grades[question.id] = res.grade;
      box.innerHTML = '';
      box.appendChild(gradeNode(res.grade, question.maxScore));
    } catch (err) {
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'chat-error' }, err.message || '批改失败'));
    }
  }

  return () => {
    sidebar.destroy();
    pendingSaves.forEach((id) => clearTimeout(id));
  };
}
