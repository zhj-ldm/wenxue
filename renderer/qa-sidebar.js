import { call, onAiEvent } from './api.js';
import { h, md, toast, uid } from './ui.js';
import { createAgentFlow } from './agentflow.js';

/**
 * 右侧 AI 侧边栏：
 * - question 模式：与单道小题绑定，会话隔离；
 * - global 模式：整套载体上下文。
 * 对话渲染统一走 agentflow（思考 / 工具 / 正文分块，移植 pi-agent-desktop）。
 */
export function createQaSidebar({ carrier, attempt, chats, globalChat }) {
  let mode = 'question';
  let current = null; // { question, section }
  let allowFullChoice = false;
  let busy = false;
  let runId = '';
  let flow = null;
  let pinned = true;

  const headTitle = h('div', { class: 'qa-title' }, 'AI 助手');
  const headSub = h('div', { class: 'qa-sub' }, '');
  const allowFull = h('input', { type: 'checkbox' });
  const thinkSelect = h(
    'select',
    { class: 'select think-select', title: '思考强度' },
    [
      ['off', '思考 关'],
      ['low', '思考 低'],
      ['medium', '思考 中'],
      ['high', '思考 高']
    ].map(([value, label]) => h('option', { value, selected: value === 'medium' }, label))
  );
  const log = h('div', { class: 'qa-log' });
  const input = h('textarea', { class: 'qa-input', rows: '3', placeholder: '问思路、问错因，或让它分析整套…' });
  const sendBtn = h('button', { class: 'btn primary sm', type: 'button' }, '发送');
  const stopBtn = h('button', { class: 'btn danger sm', type: 'button' }, '停止');
  stopBtn.style.display = 'none';

  function scrollDown(force = false) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    if (force || pinned || nearBottom) log.scrollTop = log.scrollHeight;
  }

  log.addEventListener('scroll', () => {
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  });
  log.addEventListener('wheel', (event) => {
    if (event.deltaY < 0) pinned = false;
  }, { passive: true });
  log.addEventListener('pointerdown', () => {
    pinned = false;
  });

  function intro(text) {
    return h('div', { class: 'qa-intro' }, text);
  }

  function setMode(next) {
    mode = next;
    allowFull.disabled = mode === 'global';
    allowFull.checked = mode === 'global' ? true : allowFullChoice;
    headTitle.textContent = mode === 'global' ? '整套 AI 对话' : '本题 AI 助手';
  }

  function resetLog() {
    log.innerHTML = '';
    pinned = true;
    flow = null;
  }

  function bubble(role, text) {
    const mine = role === 'user';
    const body = h('div', { class: 'qa-text' });
    if (mine) body.textContent = text;
    else if (text) body.innerHTML = md(text);
    const node = h(
      'div',
      { class: `qa-msg ${mine ? 'user' : 'ai'}` },
      h('div', { class: 'qa-avatar' }, mine ? '我' : 'AI'),
      h('div', { class: 'qa-bubble' }, body)
    );
    log.appendChild(node);
    scrollDown();
    return { node, body };
  }

  function setBusy(v) {
    busy = v;
    sendBtn.style.display = v ? 'none' : '';
    stopBtn.style.display = v ? '' : 'none';
    stopBtn.textContent = '停止';
    stopBtn.disabled = false;
    input.disabled = v;
  }

  const off = onAiEvent((ev) => {
    if (!ev || !runId || ev.runId !== runId) return;
    if (!flow) return;
    if (ev.type === 'thinking') flow.thinking(ev.full != null ? ev.full : ev.text);
    else if (ev.type === 'thinking_end') flow.thinkingEnd();
    else if (ev.type === 'tool') flow.tool(ev);
    else if (ev.type === 'text') flow.text(ev.full != null ? ev.full : ev.text);
    else if (ev.type === 'failed') flow.finish({ aborted: false, error: ev.error || '' });
    else if (ev.type === 'start') flow.setPhase('正在思考…');
  });

  async function send(text, kind = 'chat') {
    const content = String(text || input.value || '').trim();
    if (!content || busy) return;
    if (mode === 'question' && !current) return toast('先点一道题的「AI 对话」', 'error');
    input.value = '';
    bubble('user', content);
    scrollDown(true);
    runId = uid(mode === 'global' ? 'gchat' : 'qchat');
    setBusy(true);
    flow = createAgentFlow(log, { onUpdate: () => scrollDown() });
    const questionId = current ? current.question.id : '';
    const turn = { role: 'user', content };
    try {
      const res =
        mode === 'global'
          ? await call('carrier:gchat', { code: carrier.code, text: content, thinking: thinkSelect.value, runId })
          : await call('carrier:qchat', {
              code: carrier.code,
              attemptId: attempt.id,
              questionId,
              text: content,
              kind,
              thinking: thinkSelect.value,
              runId,
              allowFull: allowFull.checked
            });
      const isAborted = !!res.error && /abort|cancel|取消|中止|停止/i.test(res.error);
      if (res.text) flow.final(res.text, isAborted);
      else flow.finish({ aborted: isAborted, error: isAborted ? '' : '' });
      if (res.error && !isAborted) flow.note(`错误：${res.error}`, 'flow-error');
      // 写回内存会话，切题再回来能看到最新记录
      if (mode === 'global') {
        globalChat.push(turn);
        if (res.text) globalChat.push({ role: 'assistant', content: res.text });
      } else if (questionId) {
        if (!chats[questionId]) chats[questionId] = [];
        chats[questionId].push(turn);
        if (res.text) chats[questionId].push({ role: 'assistant', content: res.text });
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      const stopped = /abort|cancel|取消|中止|停止/i.test(msg);
      if (flow) flow.finish({ aborted: stopped, error: stopped ? '' : msg });
      if (!stopped) toast(msg, 'error');
    } finally {
      runId = '';
      setBusy(false);
      flow = null;
      input.focus();
    }
  }

  async function stop() {
    if (!runId) return;
    stopBtn.textContent = '停止中…';
    stopBtn.disabled = true;
    try {
      await call('ai:cancel', { runId });
    } catch {
      /* ignore */
    }
  }

  function openQuestion(question, section, kind = 'chat', index = 0) {
    current = { question, section };
    setMode('question');
    headSub.textContent = `${section.name || '本题'} · 第 ${index || question.id} 题`;
    resetLog();
    const history = chats[question.id] || [];
    if (history.length) {
      history.forEach((m) => bubble(m.role === 'assistant' ? 'ai' : 'user', m.content));
    } else {
      log.appendChild(intro('这题的对话只属于这道题。可以让 AI 讲思路、指出错因，或追问某个得分点。'));
    }
    if (kind === 'explain') send('请把这道题讲透：考点、思路、我可能错在哪。', 'explain');
    else input.focus();
  }

  function openGlobal() {
    current = null;
    setMode('global');
    headSub.textContent = `${carrier.title} · ${carrier.code}`;
    resetLog();
    if (globalChat && globalChat.length) {
      globalChat.forEach((m) => bubble(m.role === 'assistant' ? 'ai' : 'user', m.content));
    } else {
      log.appendChild(intro('这里能看到整套载体的题目与作答，适合做整套总结、错题分析和提分建议。'));
    }
    input.focus();
  }

  sendBtn.addEventListener('click', () => send());
  stopBtn.addEventListener('click', stop);
  allowFull.addEventListener('change', () => {
    if (mode === 'question') allowFullChoice = allowFull.checked;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!busy) send();
    }
  });

  const el = h(
    'aside',
    { class: 'qa-side' },
    h(
      'div',
      { class: 'qa-head' },
      h('div', { class: 'qa-head-main' }, headTitle, headSub),
      h('div', { class: 'qa-head-tools' }, thinkSelect)
    ),
    h(
      'div',
      { class: 'qa-context-bar' },
      h('label', { class: 'qa-toggle' }, allowFull, '允许读取整套载体')
    ),
    log,
    h(
      'div',
      { class: 'qa-composer' },
      input,
      h('div', { class: 'qa-composer-side' }, sendBtn, stopBtn, h('div', { class: 'qa-hint' }, '⌘/Ctrl+Enter 发送'))
    )
  );

  headSub.textContent = '未选择题目';
  log.appendChild(
    intro('点击题目旁的「批改 / 讲解 / AI 对话」，我会带着这道题的作答和所属大题来帮你；整套的问题可以在底部打开「整套 AI 对话」。')
  );

  return {
    el,
    openQuestion,
    openGlobal,
    destroy: () => {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
  };
}
