import { call, onAiEvent } from '../api.js';
import { h, md, toast, modal, uid, fmtScore, confirmDialog } from '../ui.js';
import { TYPE_LABEL } from '../constants.js';

export async function renderExam(root, ctx) {
  const { params, go } = ctx;
  const opened = await call('attempt:open', { paperId: params.paperId });
  const paper = opened.paper;
  const attempt = opened.attempt;
  const chats = opened.chats || {};

  let models = ctx.state.models;
  if (!models) {
    try {
      models = (await call('provider:models')).models;
      ctx.state.models = models;
    } catch {
      models = [];
    }
  }

  const answers = {};
  const grades = Object.assign({}, attempt.grades || {});
  const views = new Map();
  const pendingSaves = new Map();
  const runs = new Map();
  const savedModel = typeof attempt.model === 'string' ? attempt.model : '';
  let currentModel = /^(\[object Object\]|.*opencode.*|.*big-pickle.*)$/i.test(savedModel) ? '' : savedModel;

  paper.questions.forEach((q) => {
    answers[q.id] = String((attempt.answers[q.id] || {}).answer || '');
  });

  /* ---------- 顶栏 ---------- */

  const backBtn = h('button', { class: 'back-btn', type: 'button', title: '返回', onclick: () => go('home') }, '←');

  const titleEl = h(
    'div',
    { class: 'exam-title' },
    h('h1', {}, paper.title),
    h(
      'div',
      { class: 'exam-meta' },
      h('span', {}, paper.subject || '综合'),
      paper.grade ? h('span', {}, `· ${paper.grade}`) : null,
      h('span', {}, `· ${paper.questions.length} 题`),
      h('span', {}, `· 满分 ${fmtScore(paper.totalScore)}`),
      paper.durationMinutes ? h('span', {}, `· ${paper.durationMinutes} 分钟`) : null
    )
  );

  const modelSelect = h('select', { class: 'select model-select', title: '本卷使用的模型' });
  const refreshModelsBtn = h(
    'button',
    { class: 'btn subtle sm', type: 'button', title: '重新读取模型列表', onclick: () => reloadModels() },
    '↻'
  );

  const progressPill = h('span', { class: 'pill' });
  const totalPill = h('span', { class: 'pill accent' });
  const timerPill = h('span', { class: 'pill' });
  const submitBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => openSummary() }, 'Submit');

  const bar = h(
    'div',
    { class: 'exam-bar' },
    backBtn,
    titleEl,
    h('div', { class: 'exam-bar-right' }, h('span', { class: 'hint' }, 'Model'), modelSelect, refreshModelsBtn, timerPill, progressPill, totalPill, submitBtn)
  );

  /* ---------- 侧栏目录 ---------- */

  const outlineList = h('div', {});
  const outline = h(
    'aside',
    { class: 'outline' },
    h('div', { class: 'outline-head' }, '题目'),
    outlineList,
    h(
      'div',
      { class: 'outline-foot' },
      h(
        'div',
        { class: 'outline-legend' },
        h('span', {}, h('i', { class: 'dot' }), '未作答'),
        h('span', {}, h('i', { class: 'dot answered' }), '已作答'),
        h('span', {}, h('i', { class: 'dot graded' }), '已批改')
      ),
      h('button', { class: 'btn subtle sm', type: 'button', onclick: () => reopen() }, 'Start over')
    )
  );

  /* ---------- 主区域 ---------- */

  const inner = h('div', { class: 'exam-inner' });
  const main = h('div', { class: 'exam-main' }, inner);

  if (paper.instructions) {
    inner.appendChild(
      h('div', { class: 'instructions' }, h('div', { class: 't' }, 'Instructions'), paper.instructions)
    );
  }

  /* ---------- 模型选择 ---------- */

  function fillModels() {
    modelSelect.innerHTML = '';
    const active = (ctx.state.boot && (ctx.state.boot.providers || []).find((p) => p.id === ctx.state.boot.activeProfileId)) || null;
    if (!currentModel && active && typeof active.model === 'string') currentModel = active.model;
    const ids = (models || []).map((m) => (m && typeof m === 'object' ? m.id : m)).filter(Boolean);
    const list = Array.from(new Set([...ids, currentModel].filter(Boolean)));
    if (!list.length) {
      modelSelect.appendChild(h('option', { value: currentModel || '' }, currentModel || '未获取到模型'));
    }
    for (const id of list) {
      modelSelect.appendChild(h('option', { value: id, selected: id === currentModel }, id));
    }
    modelSelect.value = currentModel;
    modelSelect.title = models && models.length ? '本卷使用的模型' : '模型列表获取失败，请在设置中检查 API 接口';
  }

  async function reloadModels() {
    refreshModelsBtn.textContent = '…';
    try {
      const res = await call('provider:models');
      models = res.models;
      ctx.state.models = models;
      fillModels();
      toast(`已载入 ${models.length} 个模型`, 'ok');
    } catch (err) {
      toast(err.message || '读取模型失败', 'error');
    } finally {
      refreshModelsBtn.textContent = '↻';
    }
  }

  modelSelect.addEventListener('change', async () => {
    currentModel = modelSelect.value;
    try {
      await call('attempt:setModel', { paperId: paper.id, attemptId: attempt.id, model: currentModel });
      toast(`已切换到 ${currentModel}`, 'ok');
    } catch (err) {
      toast(err.message || '切换模型失败', 'error');
    }
  });

  fillModels();

  /* ---------- 头部状态 ---------- */

  function answeredCount() {
    return paper.questions.filter((q) => String(answers[q.id] || '').trim()).length;
  }

  function totalScore() {
    return Object.values(grades).reduce((sum, g) => sum + (g && typeof g.score === 'number' ? g.score : 0), 0);
  }

  function refreshHeader() {
    const total = paper.questions.length;
    progressPill.innerHTML = '';
    progressPill.append('作答 ', h('b', {}, `${answeredCount()}/${total}`));
    totalPill.innerHTML = '';
    totalPill.append('得分 ', h('b', {}, fmtScore(totalScore())), h('small', { style: 'color:var(--muted)' }, ` / ${fmtScore(paper.totalScore)}`));
  }

  function refreshOutline(qid) {
    const view = views.get(qid);
    if (!view) return;
    const answered = String(answers[qid] || '').trim().length > 0;
    const graded = !!grades[qid] && grades[qid].score != null;
    view.dot.className = `dot ${graded ? 'graded' : answered ? 'answered' : ''}`;
    const g = grades[qid];
    view.statusEl.className = `q-status ${g && g.score != null ? 'graded' : ''}`;
    view.statusEl.textContent = g && g.score != null ? `已批 ${fmtScore(g.score)} / ${fmtScore(g.maxScore)}` : answered ? '已作答，待批改' : '未作答';
    refreshHeader();
  }

  /* ---------- 计时 ---------- */

  const startedAt = new Date(attempt.startedAt || Date.now()).getTime();
  function tick() {
    const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    timerPill.textContent = `${mm}:${ss}`;
  }
  tick();
  const timer = setInterval(tick, 1000);

  /* ---------- 保存 ---------- */

  function setSaveState(qid, text) {
    const view = views.get(qid);
    if (view) view.saveState.textContent = text;
  }

  function scheduleSave(qid) {
    setSaveState(qid, '保存中…');
    clearTimeout(pendingSaves.get(qid));
    const timerId = setTimeout(() => doSave(qid), 500);
    pendingSaves.set(qid, timerId);
  }

  async function doSave(qid) {
    clearTimeout(pendingSaves.get(qid));
    pendingSaves.delete(qid);
    try {
      await call('attempt:saveAnswer', {
        paperId: paper.id,
        attemptId: attempt.id,
        questionId: qid,
        answer: answers[qid] || ''
      });
      setSaveState(qid, '已保存');
      const view = views.get(qid);
      if (view) {
        view.saveTimer = setTimeout(() => {
          if (views.get(qid) !== view) return;
          view.saveState.textContent = view.isChoice ? '' : `${String(answers[qid] || '').length} 字`;
        }, 1600);
      }
    } catch (err) {
      setSaveState(qid, '保存失败');
      toast(err.message || '保存失败', 'error');
    }
  }

  function onAnswerChanged(qid) {
    const view = views.get(qid);
    if (view) {
      const graded = grades[qid];
      view.statusEl.className = 'q-status';
      view.statusEl.textContent = String(answers[qid] || '').trim() ? '已作答，待批改' : '未作答';
      if (graded) view.gradeHint.textContent = '作答已修改，建议重新批改';
    }
    refreshHeader();
    refreshOutline(qid);
    scheduleSave(qid);
  }

  /* ---------- AI 运行绑定 ---------- */

  function bindRun(runId, handlers) {
    runs.set(runId, handlers);
  }
  function unbindRun(runId) {
    runs.delete(runId);
  }

  const offEvents = onAiEvent((event) => {
    const handler = runs.get(event.runId);
    if (!handler) return;
    if (event.type === 'tool' && handler.onTool) handler.onTool(event);
    else if (event.type === 'text' && handler.onText) handler.onText(event);
    else if (event.type === 'error' && handler.onError) handler.onError(event);
  });

  /* ---------- 批改结果渲染 ---------- */

  function paintGrade(question, panel, grade) {
    panel.innerHTML = '';
    if (!grade) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.appendChild(
      h(
        'div',
        { class: 'grade-top' },
        h(
          'div',
          { class: 'grade-score' },
          grade.score == null ? '—' : fmtScore(grade.score),
          h('small', {}, ` / ${fmtScore(grade.maxScore || question.maxScore)}`)
        ),
        h('span', { class: 'grade-level' }, grade.level || '待评'),
        h('span', { class: 'grade-model' }, grade.model && grade.model !== 'local' ? String(grade.model).replace(/^.*\//, '') : grade.source === 'local' || grade.model === 'local' ? '本地判定' : '')
      )
    );
    if (grade.comment) panel.appendChild(h('div', { class: 'grade-comment' }, grade.comment));

    if (grade.highlights && grade.highlights.length) {
      panel.appendChild(
        h(
          'div',
          { class: 'grade-block' },
          h('div', { class: 't' }, '得分点'),
          h('ul', { class: 'grade-list' }, grade.highlights.map((t) => h('li', {}, t)))
        )
      );
    }
    if (grade.issues && grade.issues.length) {
      panel.appendChild(
        h(
          'div',
          { class: 'grade-block' },
          h('div', { class: 't' }, '失分点'),
          h(
            'ul',
            { class: 'grade-list' },
            grade.issues.map((item) =>
              h(
                'li',
                {},
                item.point,
                item.deduct != null ? h('span', { class: 'deduct' }, `−${fmtScore(item.deduct)}`) : null,
                item.advice ? h('div', { class: 'hint' }, item.advice) : null
              )
            )
          )
        )
      );
    }
    if (grade.knowledgePoints && grade.knowledgePoints.length) {
      panel.appendChild(
        h(
          'div',
          { class: 'grade-block' },
          h('div', { class: 't' }, '知识点'),
          h('div', { class: 'grade-kp' }, grade.knowledgePoints.map((t) => h('span', {}, t)))
        )
      );
    }
    if (grade.nextSteps && grade.nextSteps.length) {
      panel.appendChild(
        h(
          'div',
          { class: 'grade-block' },
          h('div', { class: 't' }, '下一步'),
          h('ul', { class: 'grade-list' }, grade.nextSteps.map((t) => h('li', {}, t)))
        )
      );
    }
    if (grade.parseWarning) panel.appendChild(h('div', { class: 'grade-warn' }, grade.parseWarning));
  }

  /* ---------- 每题对话窗口 ---------- */

  function messageNode(message) {
    const isUser = message.role === 'user';
    const metaParts = [];
    if (message.kind === 'explain') metaParts.push('讲解');
    if (!isUser && typeof message.model === 'string' && message.model && message.model !== '[object Object]') {
      metaParts.push(message.model.replace(/^.*\//, ''));
    }
    if (message.toolCalls && message.toolCalls.length) metaParts.push(`${message.toolCalls.length} 次工具`);
    if (message.partial) metaParts.push('未完成');

    return h(
      'div',
      { class: `msg ${isUser ? 'user' : 'ai'}` },
      !isUser && metaParts.length ? h('div', { class: 'msg-meta' }, metaParts.join(' · ')) : null,
      h('div', { class: 'msg-body' }, isUser ? message.content : h('div', { html: md(message.content) }))
    );
  }

  function buildChatPanel(question) {
    const list = (chats[question.id] || []).slice();
    const log = h('div', { class: 'chat-log' });
    const countEl = h('span', { class: 'chat-count' });
    const askBtn = h('button', { class: 'btn sm', type: 'button' }, 'Ask AI');
    const panel = h('div', { class: 'chat-panel' });
    const body = h('div', { class: 'chat-body' });

    const input = h('textarea', { placeholder: '问思路、问错因、问怎么写更好…' });
    const sendBtn = h('button', { class: 'btn primary sm', type: 'button' }, 'Send');
    const statusEl = h('span', { class: 'hint' }, '');
    let busy = false;

    const chatInput = h(
      'div',
      { class: 'chat-input' },
      input,
      h('div', { class: 'send-row' }, statusEl, h('span', { class: 'hint' }, '⌘/Ctrl + Enter 发送'), sendBtn)
    );

    const empty = h('div', { class: 'chat-empty' }, '这道题的对话只属于这道题。可以让 AI 讲思路、指出错因，或追问某个得分点。');

    function refreshCount() {
      const n = list.length;
      countEl.textContent = n ? `${n} 条` : '尚未对话';
      askBtn.textContent = n ? `Ask AI (${n})` : 'Ask AI';
    }

    function append(message) {
      list.push(message);
      if (empty.parentNode) empty.remove();
      log.appendChild(messageNode(message));
      refreshCount();
      log.scrollTop = log.scrollHeight;
      return log.lastChild;
    }

    function pendingBubble() {
      const node = h(
        'div',
        { class: 'msg ai' },
        h(
          'div',
          { class: 'msg-body' },
          h(
            'div',
            { class: 'status-line' },
            h('span', { class: 'wave' }, h('i'), h('i'), h('i')),
            h('span', { class: 'pend-text' }, '正在思考…')
          )
        )
      );
      if (empty.parentNode) empty.remove();
      log.appendChild(node);
      log.scrollTop = log.scrollHeight;
      return node;
    }

    function setOpen(open) {
      panel.classList.toggle('open', open);
      if (open) {
        setTimeout(() => input.focus(), 320);
      }
    }

    const head = h(
      'div',
      { class: 'chat-head', onclick: () => setOpen(!panel.classList.contains('open')) },
      h('span', { class: 'caret' }, '▶'),
      h('span', { class: 'title' }, '本题 AI 对话'),
      countEl
    );
    panel.appendChild(head);
    panel.appendChild(body);

    body.appendChild(log);
    if (!list.length) log.appendChild(empty);
    list.forEach((message) => log.appendChild(messageNode(message)));
    body.appendChild(chatInput);

    refreshCount();
    setOpen(false);

    async function send(text, kind = 'chat') {
      const clean = text.trim();
      if (kind !== 'explain' && !clean) return;
      if (busy) {
        toast('请等待本次回答结束');
        return;
      }
      busy = true;
      setOpen(true);
      const runId = uid(kind);
      if (kind === 'explain') {
        append({ role: 'user', kind: 'explain', content: '一键讲解这道题', ts: Date.now() });
      } else {
        append({ role: 'user', kind: 'chat', content: clean, ts: Date.now() });
        input.value = '';
      }

      const bubble = pendingBubble();
      const pendText = bubble.querySelector('.pend-text');
      const bodyEl = bubble.querySelector('.msg-body');
      let toolCount = 0;

      bindRun(runId, {
        onTool: (event) => {
          toolCount += 1;
          const note = h('div', { class: 'tool-note' }, `正在使用工具：${event.title || event.tool || '检索'}`);
          bodyEl.insertBefore(note, bodyEl.firstChild);
          if (pendText) pendText.textContent = `执行中（${toolCount} 次工具调用）`;
        },
        onText: (event) => {
          if (pendText) pendText.textContent = '正在整理回答…';
          const full = event.full || event.text || '';
          bubble._full = full;
          bodyEl.innerHTML = `<div class="status-line"><span class="wave"><i></i><i></i><i></i></span><span>生成中…</span></div>${md(full)}`;
          log.scrollTop = log.scrollHeight;
        },
        onError: () => {
          if (pendText) pendText.textContent = '出错了';
        }
      });

      input.disabled = true;
      sendBtn.disabled = true;
      const canceller = h('button', { class: 'cancel-link', type: 'button', onclick: () => call('ai:cancel', { runId }) }, '取消');
      const sendRow = statusEl.parentNode;
      if (sendRow) sendRow.insertBefore(canceller, statusEl);

      try {
        const res = await call(kind === 'explain' ? 'ai:explain' : 'ai:chat', {
          paperId: paper.id,
          attemptId: attempt.id,
          questionId: question.id,
          model: currentModel,
          text: clean,
          kind,
          runId
        });
        bubble.remove();
        const content = res.text || '';
        if (content.trim()) {
          append({
            role: 'assistant',
            kind,
            content,
            ts: Date.now(),
            model: currentModel,
            toolCalls: toolCount ? new Array(toolCount).fill({ tool: 'tool' }) : []
          });
        }
        if (res.error) toast(res.error, 'error');
      } catch (err) {
        bubble.remove();
        const message = err.message || 'AI 调用失败';
        append({ role: 'assistant', kind, content: `**没有收到有效回答**\n\n${message}`, ts: Date.now(), model: currentModel });
        toast(message, 'error');
      } finally {
        unbindRun(runId);
        busy = false;
        input.disabled = false;
        sendBtn.disabled = false;
        if (canceller.parentNode) canceller.remove();
        log.scrollTop = log.scrollHeight;
      }
    }

    sendBtn.addEventListener('click', () => send(input.value, 'chat'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        send(input.value, 'chat');
      }
    });

    return {
      panel,
      askBtn,
      head,
      open: () => setOpen(true),
      send,
      refreshCount,
      list
    };
  }

  /* ---------- 题目卡片 ---------- */

  function buildCard(question, index, opts = {}) {
    const view = {};
    const card = h('div', { class: 'q-card', id: `q-${question.id}` });
    const statusEl = h('span', { class: 'q-status' });
    const gradeHint = h('span', { class: 'hint' });

    card.appendChild(
      h(
        'div',
        { class: 'q-head' },
        h('span', { class: 'q-num' }, `${index + 1}`),
        question.section ? h('span', { class: 'q-section' }, question.section) : null,
        h('span', { class: 'q-type' }, TYPE_LABEL[question.type] || question.type),
        h('span', { class: 'q-score' }, `${fmtScore(question.maxScore)} 分`),
        statusEl
      )
    );

    // 只有当该题自带独立材料、且未被大题材料覆盖时才展示
    if (question.passage && !opts.hidePassage) {
      const passage = h('div', { class: 'passage expanded' }, question.passage);
      card.appendChild(passage);
      if (question.passage.length > 220) {
        const toggle = h('button', { class: 'passage-toggle', type: 'button' }, '收起 ▴');
        toggle.addEventListener('click', () => {
          const expanded = passage.classList.toggle('expanded');
          toggle.textContent = expanded ? '收起 ▴' : '展开全文 ▾';
        });
        card.appendChild(toggle);
      }
    }

    card.appendChild(h('div', { class: 'stem' }, question.stem));

    let answerControl = null;
    let answerFoot = null;

    if ((question.type === 'choice' || question.type === 'multi_choice') && question.options && question.options.length) {
      const multi = question.type === 'multi_choice';
      const optionNodes = [];
      const selectedSet = new Set(String(answers[question.id] || '').toUpperCase().split(''));
      const optionsWrap = h('div', { class: 'options' });
      question.options.forEach((option) => {
        const input = h('input', {
          type: multi ? 'checkbox' : 'radio',
          name: `q_${question.id}`,
          value: option.key,
          checked: selectedSet.has(option.key)
        });
        const label = h(
          'label',
          { class: `option ${selectedSet.has(option.key) ? 'selected' : ''}` },
          input,
          h('span', { class: 'k' }, option.key),
          h('span', { class: 'opt-text' }, option.text)
        );
        input.addEventListener('change', () => {
          optionNodes.forEach(({ input: i, label: l }) => l.classList.toggle('selected', i.checked));
          if (multi) {
            answers[question.id] = optionNodes
              .filter(({ input: i }) => i.checked)
              .map(({ input: i }) => i.value)
              .sort()
              .join('');
          } else {
            answers[question.id] = input.checked ? option.key : '';
          }
          onAnswerChanged(question.id);
        });
        optionNodes.push({ input, label });
        optionsWrap.appendChild(label);
      });
      card.appendChild(optionsWrap);
      answerControl = optionsWrap;
      const choiceSave = h('span', { class: 'hint' }, '');
      answerFoot = h('div', { class: 'answer-foot' }, choiceSave);
      card.appendChild(answerFoot);
      view.saveState = choiceSave;
      view.isChoice = true;
    } else {
      const ta = h('textarea', {
        class: 'answer-box',
        placeholder: '在这里写下你的答案…',
        rows: question.type === 'essay' ? 8 : 4
      });
      ta.value = answers[question.id] || '';
      const saveState = h('span', { class: 'hint' }, `${ta.value.length} 字`);
      const autoGrow = () => {
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(520, Math.max(88, ta.scrollHeight))}px`;
      };
      ta.addEventListener('input', () => {
        answers[question.id] = ta.value;
        saveState.textContent = `${ta.value.length} 字`;
        autoGrow();
        onAnswerChanged(question.id);
      });
      ta.addEventListener('blur', () => {
        if (pendingSaves.has(question.id)) doSave(question.id);
      });
      card.appendChild(h('div', { class: 'answer-wrap' }, ta));
      answerFoot = h('div', { class: 'answer-foot' }, saveState);
      card.appendChild(answerFoot);
      answerControl = ta;
      setTimeout(autoGrow, 0);
      view.saveState = saveState;
    }

    if (!view.saveState) view.saveState = h('span', { class: 'hint' }, '');

    const gradeBtn = h('button', { class: 'btn sm', type: 'button' }, 'Grade with AI');
    const explainBtn = h('button', { class: 'btn sm', type: 'button' }, 'Explain');
    const clearBtn = h('button', { class: 'btn subtle sm', type: 'button' }, 'Clear');
    const runStatus = h('span', { class: 'status-line' }, '');

    const gradePanel = h('div', { class: 'grade-panel' });
    gradePanel.style.display = 'none';

    const chat = buildChatPanel(question);

    const actions = h(
      'div',
      { class: 'q-actions' },
      gradeBtn,
      explainBtn,
      chat.askBtn,
      h('span', { class: 'spacer' }),
      runStatus,
      gradeHint,
      clearBtn
    );

    chat.askBtn.addEventListener('click', () => chat.open());
    clearBtn.addEventListener('click', () => {
      answers[question.id] = '';
      if (answerControl.tagName === 'TEXTAREA') answerControl.value = '';
      else {
        answerControl.querySelectorAll('input').forEach((i) => {
          i.checked = false;
          i.closest('.option').classList.remove('selected');
        });
      }
      grades[question.id] = undefined;
      paintGrade(question, gradePanel, null);
      onAnswerChanged(question.id);
      doSave(question.id);
      toast('已清空本题作答');
    });

    gradeBtn.addEventListener('click', async () => {
      if (gradeBtn.disabled) return;
      const answer = String(answers[question.id] || '').trim();
      if (!answer) {
        toast('先写下你的答案，再让 AI 批改', 'error');
        if (answerControl.tagName === 'TEXTAREA') answerControl.focus();
        return;
      }
      if (pendingSaves.has(question.id)) await doSave(question.id);

      const runId = uid('grade');
      gradeBtn.disabled = true;
      const originalText = gradeBtn.textContent;
      gradeBtn.innerHTML = '<span class="spin"></span>Grading';
      runStatus.innerHTML = '';
      runStatus.append(h('span', { class: 'wave' }, h('i'), h('i'), h('i')), h('span', {}, 'AI 正在阅卷…'));

      bindRun(runId, {
        onTool: (event) => {
          runStatus.innerHTML = '';
          runStatus.append(h('span', { class: 'wave' }, h('i'), h('i'), h('i')), h('span', {}, `工具：${event.title || event.tool || ''}`));
        }
      });

      try {
        const res = await call('ai:grade', {
          paperId: paper.id,
          attemptId: attempt.id,
          questionId: question.id,
          model: currentModel,
          runId
        });
        grades[question.id] = res.grade;
        paintGrade(question, gradePanel, res.grade);
        refreshOutline(question.id);
        toast(`第 ${index + 1} 题：${fmtScore(res.grade.score)} / ${fmtScore(res.grade.maxScore)}`, 'ok');
      } catch (err) {
        runStatus.textContent = '批改失败';
        toast(err.message || '批改失败', 'error');
        if (err.raw) {
          appendRawError(question, gradePanel, err.raw);
        }
      } finally {
        unbindRun(runId);
        gradeBtn.disabled = false;
        gradeBtn.textContent = originalText;
        runStatus.innerHTML = '';
      }
    });

    explainBtn.addEventListener('click', () => chat.send('', 'explain'));

    card.appendChild(actions);
    card.appendChild(gradePanel);
    card.appendChild(chat.panel);

    const grade = grades[question.id];
    if (grade) paintGrade(question, gradePanel, grade);

    view.card = card;
    view.statusEl = statusEl;
    view.gradeHint = gradeHint;
    view.gradePanel = gradePanel;
    view.chat = chat;
    view.dot = h('i', { class: 'dot' });
    views.set(question.id, view);
    return view;
  }

  function appendRawError(question, panel, raw) {
    panel.style.display = '';
    panel.innerHTML = '';
    panel.appendChild(h('div', { class: 'grade-top' }, h('span', { class: 'grade-level' }, '解析失败')));
    panel.appendChild(h('div', { class: 'grade-comment' }, raw.slice(0, 1200)));
    panel.appendChild(h('div', { class: 'grade-warn' }, 'AI 返回的内容不是合法 JSON，已保留原文供参考。'));
  }

  /* ---------- 装配：按「大题 → 小题」分块渲染 ---------- */

  const outlineItems = new Map();
  const qIndexMap = new Map();
  paper.questions.forEach((q, i) => qIndexMap.set(q.id, i));

  // 兼容旧试卷：没有 sections 时把所有题归到一个匿名大题
  const sections =
    Array.isArray(paper.sections) && paper.sections.length
      ? paper.sections
      : [{ name: '', passage: '', questionIds: paper.questions.map((q) => q.id) }];

  sections.forEach((section) => {
    const block = h('section', { class: 'section-block' });
    if (section.name) {
      block.appendChild(
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, section.name))
      );
    }
    // 大题级阅读材料只显示一次，下面所有小题共用
    if (section.passage) {
      const passage = h('div', { class: 'passage section-passage expanded' }, section.passage);
      block.appendChild(passage);
      if (section.passage.length > 220) {
        const toggle = h('button', { class: 'passage-toggle', type: 'button' }, '收起 ▴');
        toggle.addEventListener('click', () => {
          const expanded = passage.classList.toggle('expanded');
          toggle.textContent = expanded ? '收起 ▴' : '展开全文 ▾';
        });
        block.appendChild(toggle);
      }
    }

    (section.questionIds || []).forEach((qid) => {
      const idx = qIndexMap.get(qid);
      if (idx == null) return;
      const question = paper.questions[idx];
      // 如果该题的材料与大题材料一致，就不在小题里重复展示
      const hidePassage = !!section.passage && question.passage === section.passage;
      const view = buildCard(question, idx, { hidePassage });
      block.appendChild(view.card);

      const item = h(
        'div',
        {
          class: 'outline-item',
          onclick: () => {
            view.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            view.card.classList.add('focus');
            setTimeout(() => view.card.classList.remove('focus'), 1400);
            outlineItems.forEach((el) => el.classList.remove('active'));
            item.classList.add('active');
          }
        },
        h('span', { class: 'n' }, String(idx + 1)),
        h('span', { class: 't' }, section.name || question.section || TYPE_LABEL[question.type] || '题目'),
        view.dot
      );
      outlineItems.set(question.id, item);
      outlineList.appendChild(item);
      refreshOutline(question.id);
    });

    inner.appendChild(block);
  });

  refreshHeader();

  const exam = h('div', { class: 'exam' }, bar, h('div', { class: 'exam-body' }, outline, main));
  root.appendChild(exam);

  /* ---------- 交卷 ---------- */

  function openSummary() {
    const total = paper.questions.length;
    const answered = answeredCount();
    const gradedList = paper.questions.filter((q) => grades[q.id] && grades[q.id].score != null);
    const sum = totalScore();
    const maxSum = gradedList.reduce((acc, q) => acc + Number(q.maxScore || 0), 0);

    const body = h(
      'div',
      {},
      h(
        'div',
        { class: 'summary-hero' },
        h('div', { class: 'summary-score' }, fmtScore(sum), h('small', {}, ` / ${fmtScore(paper.totalScore)}`)),
        h('div', { class: 'summary-sub' }, `已批 ${gradedList.length} / ${total} 题 · 已作答 ${answered} / ${total} 题${gradedList.length ? ` · 已批部分满分 ${fmtScore(maxSum)}` : ''}`)
      ),
      h(
        'div',
        { class: 'summary-grid' },
        paper.questions.map((q, i) => {
          const g = grades[q.id];
          return h(
            'div',
            { class: 'summary-item' },
            h('span', {}, `第 ${i + 1} 题`),
            h('span', { class: 's' }, g && g.score != null ? `${fmtScore(g.score)} / ${fmtScore(q.maxScore)}` : String(answers[q.id] || '').trim() ? '待批改' : '未作答')
          );
        })
      ),
      gradedList.length < total
        ? h('div', { class: 'hint', style: 'margin-top:14px' }, '还有题目没有批改，汇总分只包含已批改的题目。可以先逐题批改再交卷。')
        : null
    );

    const ref = modal({
      title: '本次作答汇总',
      size: '',
      body,
      footer: [
        h('button', { class: 'btn subtle', type: 'button', onclick: () => ref.close() }, '继续作答'),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: async () => {
              try {
                const saved = await call('attempt:finish', { paperId: paper.id, attemptId: attempt.id });
                ref.close();
                toast(`已记录本次作答：${fmtScore(saved.summary.total)} 分`, 'ok');
                submitBtn.textContent = 'Recorded';
                setTimeout(() => (submitBtn.textContent = 'Submit'), 2200);
              } catch (err) {
                toast(err.message || '保存记录失败', 'error');
              }
            }
          },
          'End & Save'
        )
      ]
    });
  }

  async function reopen() {
    const ok = await confirmDialog({
      title: '重新作答',
      message: '会开始一份新的作答记录，当前的答案与批改仍会保留在「记录」里。',
      confirmText: 'Start over'
    });
    if (!ok) return;
    try {
      await call('attempt:new', { paperId: paper.id, model: currentModel });
      go('exam', { paperId: paper.id });
    } catch (err) {
      toast(err.message || '创建新作答失败', 'error');
    }
  }

  /* ---------- 清理 ---------- */

  return function cleanup() {
    clearInterval(timer);
    offEvents();
    for (const qid of Array.from(pendingSaves.keys())) doSave(qid);
    for (const view of views.values()) if (view.saveTimer) clearTimeout(view.saveTimer);
    for (const runId of Array.from(runs.keys())) call('ai:cancel', { runId });
  };
}
