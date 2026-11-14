import { call, onAiEvent } from '../api.js';
import { h, md, toast, uid } from '../ui.js';

// 进程内保留对话记录：切到别的页面再回来还能看到
let history = [];

const TOOL_GLYPH = {
  bash: '$',
  shell: '$',
  read: '▤',
  write: '✎',
  edit: '✎',
  patch: '✎',
  grep: '⌕',
  glob: '✦',
  ls: '☰',
  list: '☰',
  webfetch: '↗',
  websearch: '↗',
  fetch: '↗',
  task: '◆',
  todo: '☑',
  default: '●'
};

const TOOL_LABEL = {
  bash: 'Bash',
  shell: 'Shell',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  patch: 'Patch',
  grep: 'Grep',
  glob: 'Glob',
  ls: 'List',
  list: 'List',
  webfetch: 'Fetch',
  websearch: 'Search',
  task: 'Task',
  todo: 'Todo'
};

function toolGlyph(name) {
  const key = String(name || '').toLowerCase();
  return TOOL_GLYPH[key] || TOOL_GLYPH.default;
}

function toolLabel(name) {
  const key = String(name || '').toLowerCase();
  return TOOL_LABEL[key] || name || 'Tool';
}

function toolState(status) {
  const s = String(status || '').toLowerCase();
  if (/error|fail/.test(s)) return 'error';
  if (/run|pending|start|progress/.test(s)) return 'running';
  return 'done';
}

function stateLabel(state) {
  if (state === 'running') return '运行中';
  if (state === 'error') return '失败';
  return '完成';
}

export async function renderChat(container, ctx) {
  const { state, go } = ctx;
  let profiles = state.boot.providers || [];
  let activeId = state.boot.activeProfileId || (profiles[0] ? profiles[0].id : '');
  let models = [];

  async function loadModels() {
    try {
      const res = await call('provider:models', {});
      models = (res && res.models) || [];
    } catch {
      models = [];
    }
    modelSelect.innerHTML = '';
    const active = profiles.find((p) => p.id === activeId);
    modelSelect.appendChild(h('option', { value: '' }, active ? `跟随接口（${active.model}）` : '跟随接口配置'));
    models.forEach((m) => modelSelect.appendChild(h('option', { value: m.id }, m.name || m.id)));
  }

  let busy = false;
  let pinned = true;
  let runId = '';
  let aiBody = null;
  let aiBuffer = '';
  let toolStack = null;
  let toolCards = new Map();
  let typing = null;
  let bubbleWrap = null;

  const log = h('div', { class: 'chat-log' });
  const scroller = h('div', { class: 'chat-scroll' }, log);

  function scrollDown(force = false) {
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
    if (force || pinned || nearBottom) scroller.scrollTop = scroller.scrollHeight;
  }

  scroller.addEventListener('scroll', () => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  });

  function bubble(role, text) {
    const isUser = role === 'user';
    const body = h('div', { class: 'chat-text' });
    if (isUser) body.textContent = text;
    else if (text) body.innerHTML = md(text);
    const node = h(
      'div',
      { class: `chat-msg ${isUser ? 'user' : 'ai'}` },
      h('div', { class: 'chat-avatar' }, isUser ? '我' : 'AI'),
      h('div', { class: 'chat-bubble' }, body)
    );
    log.appendChild(node);
    scrollDown(true);
    return { node, body };
  }

  /* 工具调用卡片：紧凑列表，不堆边框 */

  function toolCard(tool) {
    const st = toolState(tool.status);
    const name = String(tool.tool || 'tool').toLowerCase();
    const title = String(tool.title || '');
    const showTitle = title && title.toLowerCase() !== name;
    const row = h(
      'div',
      { class: `tool-row ${st}` },
      h('span', { class: 'tool-glyph' }, toolGlyph(name)),
      h('span', { class: 'tool-name' }, toolLabel(name)),
      showTitle ? h('span', { class: 'tool-title' }, title) : null,
      h('span', { class: 'tool-status' }, st === 'running' ? h('i', { class: 'tool-spin' }) : st === 'error' ? '✕' : '✓')
    );
    return row;
  }

  function startAiBubble() {
    if (bubbleWrap) return bubbleWrap;
    const b = bubble('ai', '');
    aiBody = b.body;
    toolStack = h('div', { class: 'tool-stack' });
    b.node.querySelector('.chat-bubble').insertBefore(toolStack, aiBody);
    typing = h('div', { class: 'chat-typing' }, h('i', {}), h('i', {}), h('i', {}));
    aiBody.appendChild(typing);
    bubbleWrap = b;
    return b;
  }

  function clearTyping() {
    if (typing) {
      typing.remove();
      typing = null;
    }
  }

  function upsertTool(ev) {
    startAiBubble();
    const key = ev.id || `${ev.tool}:${ev.title}`;
    let card = toolCards.get(key);
    if (!card) {
      card = toolCard(ev);
      toolCards.set(key, { node: card, tool: ev.tool, title: ev.title });
      toolStack.appendChild(card);
    } else {
      const fresh = toolCard({ tool: ev.tool || card.tool, title: ev.title || card.title, status: ev.status });
      card.node.replaceWith(fresh);
      card.node = fresh;
    }
    scrollDown();
  }

  function paintAi(text) {
    startAiBubble();
    clearTyping();
    aiBuffer = text == null ? aiBuffer : text;
    const prev = aiBody.querySelector('.chat-text-inner');
    if (!prev) {
      const inner = h('div', { class: 'chat-text-inner' });
      aiBody.appendChild(inner);
      inner.innerHTML = md(aiBuffer);
    } else {
      prev.innerHTML = md(aiBuffer);
    }
    scrollDown();
  }

  // 本轮结束时把还在转的卡片落定，避免一直转圈
  function settleTools(failed) {
    toolCards.forEach((card) => {
      const row = card.node;
      if (!row || !row.classList || !row.classList.contains('running')) return;
      row.className = `tool-row ${failed ? 'error' : 'done'}`;
      const status = row.querySelector('.tool-status');
      if (status) status.textContent = failed ? '✕' : '✓';
    });
  }

  function finishAi(finalText) {
    if (finalText && !aiBuffer) paintAi(finalText);
    else if (finalText && finalText !== aiBuffer) paintAi(finalText);
    clearTyping();
    if (!aiBuffer.trim()) {
      const content = aiBody.querySelector('.chat-text-inner');
      if (!content) {
        const hint = h('div', { class: 'chat-note' }, toolCards.size ? '已完成，没有文字说明。' : '没有返回内容，换个模型或稍后重试。');
        aiBody.appendChild(hint);
      }
    }
  }

  /* ---------------- 顶部 ---------------- */

  const modelSelect = h('select', { class: 'select chat-model' }, h('option', { value: '' }, '默认模型'));

  const profileSelect = h(
    'select',
    { class: 'select chat-model' },
    profiles.length
      ? profiles.map((p) => h('option', { value: p.id, selected: p.id === activeId }, p.name || p.model))
      : h('option', { value: '' }, '未配置接口')
  );
  profileSelect.addEventListener('change', async () => {
    if (busy) {
      profileSelect.value = activeId;
      return toast('等这一轮结束再切换接口', 'error');
    }
    try {
      const res = await call('provider:activate', { id: profileSelect.value });
      profiles = res.profiles;
      activeId = res.activeProfileId;
      if (state.boot) {
        state.boot.providers = profiles;
        state.boot.activeProfileId = activeId;
      }
      await loadModels();
      toast('已切换接口');
    } catch (err) {
      toast(err.message || '切换失败', 'error');
    }
  });

  const newChatBtn = h('button', { class: 'btn subtle', type: 'button' }, '新对话');
  newChatBtn.addEventListener('click', async () => {
    if (busy) return toast('等这一轮结束再新开对话', 'error');
    try {
      await call('agent:chat', { reset: true });
    } catch {
      /* ignore */
    }
    history = [];
    log.innerHTML = '';
    log.appendChild(intro());
    toast('已开始新对话');
  });

  const header = h(
    'div',
    { class: 'chat-head' },
    h(
      'div',
      { class: 'chat-head-left' },
      h('div', { class: 'chat-title' }, 'AI 对话'),
      h('div', { class: 'chat-sub' }, '内置 pi Agent · 能读写文件、跑命令、直接出卷')
    ),
    h(
      'div',
      { class: 'chat-head-right' },
      profileSelect,
      modelSelect,
      newChatBtn,
      h('button', { class: 'btn subtle', type: 'button', onclick: () => go('settings') }, '设置')
    )
  );

  /* ---------------- 输入 ---------------- */

  const input = h('textarea', {
    class: 'input chat-input',
    rows: '3',
    placeholder: '想说点什么？比如「帮我出一套高一语文现代文阅读卷，放到放题目录」或「讲讲这道题为什么错」'
  });

  const sendBtn = h('button', { class: 'btn primary chat-send', type: 'button' }, '发送');

  function setBusy(v) {
    busy = v;
    if (v) {
      sendBtn.textContent = '停止';
      sendBtn.className = 'btn danger chat-send';
    } else {
      sendBtn.textContent = '发送';
      sendBtn.className = 'btn primary chat-send';
    }
  }

  async function stop() {
    if (!runId) return;
    sendBtn.textContent = '停止中…';
    sendBtn.disabled = true;
    try {
      await call('ai:cancel', { runId });
    } catch {
      /* ignore */
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    pinned = true;
    history.push({ role: 'user', text });
    bubble('user', text);

    aiBody = null;
    aiBuffer = '';
    bubbleWrap = null;
    toolStack = null;
    toolCards = new Map();
    typing = null;

    runId = uid('run');
    setBusy(true);
    const b = startAiBubble();

    try {
      const res = await call('agent:chat', { message: text, model: modelSelect.value || '', runId });
      finishAi(res && res.text ? res.text : aiBuffer);
      history.push({ role: 'ai', text: res && res.text ? res.text : aiBuffer, tools: [] });
    } catch (err) {
      clearTyping();
      settleTools(true);
      const msg = String((err && err.message) || err);
      const stopped = /取消|中止|停止/.test(msg);
      aiBody.appendChild(h('div', { class: stopped ? 'chat-note' : 'chat-error' }, stopped ? '已停止本次回答。' : msg));
      history.push({ role: 'ai', text: `${stopped ? '（已停止）' : '（出错）'}${msg}` });
    } finally {
      runId = '';
      setBusy(false);
      input.focus();
      requestAnimationFrame(() => scrollDown(pinned));
    }
  }

  sendBtn.addEventListener('click', () => {
    if (busy) stop();
    else send();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!busy) send();
    }
  });

  function intro() {
    return h(
      'div',
      { class: 'chat-intro' },
      h('div', { class: 'chat-intro-title' }, '你可以直接这样说'),
      h(
        'div',
        { class: 'chip-row' },
        [
          '帮我出一套高一语文现代文阅读卷，3 道题，20 分，放到放题目录',
          '这套卷子我错在哪？帮我梳理知识漏洞',
          '我数学函数这块很弱，给我一个两周的学习计划'
        ].map((t) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              onclick: () => {
                input.value = t;
                input.focus();
              }
            },
            t
          )
        )
      )
    );
  }

  // 恢复本次进程内的对话
  if (history.length) {
    history.forEach((m) => {
      const b = bubble(m.role, m.text);
      if (m.role !== 'ai' || !m.tools || !m.tools.length) return;
      const stack = h('div', { class: 'tool-stack' });
      m.tools.forEach((t) => stack.appendChild(toolCard(t)));
      b.node.querySelector('.chat-bubble').insertBefore(stack, b.body);
    });
  } else {
    log.appendChild(intro());
  }

  const composer = h(
    'div',
    { class: 'chat-composer' },
    input,
    h('div', { class: 'chat-composer-side' }, sendBtn, h('div', { class: 'hint' }, 'Enter 发送 · Shift+Enter 换行'))
  );

  const page = h('div', { class: 'chat-page' }, header, scroller, composer);
  container.appendChild(page);
  input.focus();
  loadModels();

  const off = onAiEvent((ev) => {
    if (!ev || ev.scope !== 'agent' || (runId && ev.runId && ev.runId !== runId)) return;
    if (ev.type === 'text') paintAi(ev.full != null ? ev.full : ev.text);
    else if (ev.type === 'tool') upsertTool(ev);
    else if (ev.type === 'done') settleTools(false);
    else if (ev.type === 'failed') settleTools(true);
    else if (ev.type === 'error' && ev.error) {
      clearTyping();
      settleTools(true);
      if (aiBody) aiBody.appendChild(h('div', { class: 'chat-error' }, ev.error));
      else toast(ev.error, 'error');
    }
  });

  return () => {
    try {
      off();
    } catch {
      /* ignore */
    }
  };
}
