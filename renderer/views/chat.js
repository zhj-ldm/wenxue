import { call, onAiEvent } from '../api.js';
import { h, md, toast, uid, timeAgo, modal, confirmDialog } from '../ui.js';
import { createAgentFlow } from '../agentflow.js';

export async function renderChat(container, ctx) {
  const { state, go } = ctx;
  let profiles = state.boot.providers || [];
  let activeProfile = state.boot.activeProfileId || (profiles[0] ? profiles[0].id : '');

  let busy = false;
  let pinned = true;
  let runId = '';

  let conversations = [];
  let conversationId = '';
  let loadingConv = false;
  let flow = null;

  function modelLabel() {
    const p = profiles.find((item) => item.id === activeProfile);
    return p ? p.model || p.name || 'AI' : 'AI';
  }

  const log = h('div', { class: 'chat-log' });
  const scroller = h('div', { class: 'chat-scroll' }, log);

  function scrollDown(force = false) {
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
    if (force || pinned || nearBottom) scroller.scrollTop = scroller.scrollHeight;
  }

  scroller.addEventListener('scroll', () => {
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
  });
  scroller.addEventListener('wheel', (event) => {
    if (event.deltaY < 0) pinned = false;
  }, { passive: true });
  scroller.addEventListener('pointerdown', () => {
    pinned = false;
  });

  /* ---------------- 消息渲染 ---------------- */

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

  /* ---------------- 会话列表 ---------------- */

  const convList = h('div', { class: 'conv-list' });

  function paintConversations() {
    convList.innerHTML = '';
    if (!conversations.length) {
      convList.appendChild(h('div', { class: 'conv-empty' }, '还没有对话'));
      return;
    }
    conversations.forEach((conv) => {
      const active = conv.id === conversationId;
      const row = h(
        'div',
        { class: `conv-row ${active ? 'active' : ''}` },
        h(
          'button',
          { class: 'conv-main', type: 'button', onclick: () => switchConversation(conv.id) },
          h('div', { class: 'conv-title' }, conv.title || '新对话'),
          h('div', { class: 'conv-meta' }, `${conv.messageCount || 0} 条 · ${timeAgo(conv.updatedAt)}`),
          conv.preview ? h('div', { class: 'conv-preview' }, conv.preview) : null
        ),
        h(
          'div',
          { class: 'conv-actions' },
          h(
            'button',
            {
              class: 'conv-icon',
              type: 'button',
              title: '重命名',
              onclick: (event) => {
                event.stopPropagation();
                renameConversation(conv);
              }
            },
            '✎'
          ),
          h(
            'button',
            {
              class: 'conv-icon danger',
              type: 'button',
              title: '删除',
              onclick: (event) => {
                event.stopPropagation();
                removeConversation(conv);
              }
            },
            '×'
          )
        )
      );
      row.addEventListener('dblclick', () => renameConversation(conv));
      convList.appendChild(row);
    });
  }

  async function refreshConversations() {
    try {
      const res = await call('agent:conversations');
      conversations = res.conversations || [];
    } catch {
      conversations = [];
    }
    paintConversations();
  }

  async function switchConversation(id) {
    if (busy) return toast('等这一轮结束再切换对话', 'error');
    if (loadingConv || id === conversationId) return;
    loadingConv = true;
    try {
      const res = await call('agent:conversation:get', { conversationId: id });
      const conv = res.conversation;
      conversationId = conv.id;
      log.innerHTML = '';
      (conv.messages || []).forEach((m) => bubble(m.role === 'assistant' ? 'ai' : 'user', m.text));
      if (!(conv.messages || []).length) log.appendChild(intro());
      paintConversations();
      pinned = true;
      scrollDown(true);
      input.focus();
    } catch (err) {
      toast(err.message || '读取对话失败', 'error');
    } finally {
      loadingConv = false;
    }
  }

  async function newConversation() {
    if (busy) return toast('等这一轮结束再新开对话', 'error');
    try {
      const res = await call('agent:conversation:new');
      conversationId = res.conversation.id;
      log.innerHTML = '';
      log.appendChild(intro());
      await refreshConversations();
      input.focus();
    } catch (err) {
      toast(err.message || '新建对话失败', 'error');
    }
  }

  function renameConversation(conv) {
    const field = h('input', { class: 'input', type: 'text', value: conv.title || '' });
    const ref = modal({
      title: '重命名对话',
      size: 'narrow',
      body: field,
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => ref.close() }, '取消'),
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: async () => {
              const title = field.value.trim();
              if (!title) return toast('标题不能为空', 'error');
              try {
                await call('agent:conversation:rename', { conversationId: conv.id, title });
                ref.close();
                await refreshConversations();
              } catch (err) {
                toast(err.message || '重命名失败', 'error');
              }
            }
          },
          '保存'
        )
      ]
    });
    setTimeout(() => field.focus(), 40);
  }

  async function removeConversation(conv) {
    const ok = await confirmDialog({
      title: '删除对话',
      message: `「${conv.title || '新对话'}」的聊天记录会被删除，无法恢复。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    try {
      await call('agent:conversation:delete', { conversationId: conv.id });
      if (conversationId === conv.id) {
        conversationId = '';
        log.innerHTML = '';
        log.appendChild(intro());
      }
      await refreshConversations();
      if (!conversationId && conversations.length) await switchConversation(conversations[0].id);
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  }

  const newChatBtn = h('button', { class: 'btn primary conv-new', type: 'button', onclick: newConversation }, '＋ 新对话');

  const side = h(
    'aside',
    { class: 'chat-side' },
    h('div', { class: 'chat-side-head' }, h('div', { class: 'chat-side-title' }, '对话'), newChatBtn),
    convList,
    h(
      'div',
      { class: 'chat-side-foot' },
      h('button', { class: 'btn subtle sm', type: 'button', onclick: () => go('settings') }, '设置'),
      h('button', { class: 'btn subtle sm', type: 'button', onclick: () => go('home') }, '返回学习')
    )
  );

  /* ---------------- 顶部 ---------------- */

  const THINK_LEVELS = [
    ['off', '思考 关'],
    ['low', '思考 低'],
    ['medium', '思考 中'],
    ['high', '思考 高']
  ];
  const thinkSelect = h(
    'select',
    { class: 'select think-select', title: '本轮思考强度（模型支持时生效）' },
    THINK_LEVELS.map(([value, label]) => h('option', { value, selected: value === ((state.settings && state.settings.thinkingLevel) || 'medium') }, label))
  );

  const profileSelect = h(
    'select',
    { class: 'select chat-model' },
    profiles.length
      ? profiles.map((p) => h('option', { value: p.id, selected: p.id === activeProfile }, p.name || p.model))
      : h('option', { value: '' }, '未配置接口')
  );
  profileSelect.addEventListener('change', async () => {
    if (busy) {
      profileSelect.value = activeProfile;
      return toast('等这一轮结束再切换接口', 'error');
    }
    try {
      const res = await call('provider:activate', { id: profileSelect.value });
      profiles = res.profiles;
      activeProfile = res.activeProfileId;
      if (state.boot) {
        state.boot.providers = profiles;
        state.boot.activeProfileId = activeProfile;
      }
      const active = profiles.find((p) => p.id === activeProfile);
      toast(active ? `已切换到 ${active.name} · ${active.model}` : '已切换接口');
    } catch (err) {
      toast(err.message || '切换失败', 'error');
    }
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
    h('div', { class: 'chat-head-right' }, thinkSelect, profileSelect)
  );

  /* ---------------- 输入 ---------------- */

  const input = h('textarea', {
    class: 'input chat-input',
    rows: '3',
    placeholder: '想说点什么？比如「帮我出一套高一语文现代文阅读卷，放到放题目录」或「讲讲这道题为什么错」'
  });

  const sendBtn = h('button', { class: 'btn primary chat-send', type: 'button' }, '发送');
  const stopBtn = h('button', { class: 'btn danger chat-stop', type: 'button' }, '停止');
  stopBtn.style.display = 'none';

  function setBusy(v) {
    busy = v;
    sendBtn.style.display = v ? 'none' : '';
    stopBtn.style.display = v ? '' : 'none';
    input.disabled = v;
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
    // 兜底：后端长时间未返回时也要恢复可输入状态
    setTimeout(() => {
      if (!busy) return;
      if (flow) flow.finish({ aborted: true });
      runId = '';
      setBusy(false);
    }, 6000);
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    pinned = true;
    bubble('user', text);
    flow = createAgentFlow(log, { modelLabel: modelLabel(), onUpdate: () => scrollDown() });

    runId = uid('run');
    setBusy(true);
    stopBtn.textContent = '停止';
    stopBtn.disabled = false;

    try {
      const res = await call('agent:chat', { message: text, runId, conversationId, thinking: thinkSelect.value });
      if (res && res.conversationId) conversationId = res.conversationId;
      if (res && res.text) flow.final(res.text, !!res.error && /abort|cancel|取消|中止|停止/i.test(res.error));
      else if (res && res.error && !/abort|cancel|取消|中止|停止/i.test(res.error)) flow.finish({ aborted: false, error: res.error });
      else flow.finish({ aborted: !!(res && res.error) });
      await refreshConversations();
    } catch (err) {
      const msg = String((err && err.message) || err);
      const stopped = /abort|cancel|取消|中止|停止/i.test(msg);
      if (flow) flow.finish({ aborted: stopped, error: stopped ? '' : msg });
      if (!stopped) toast(msg, 'error');
      await refreshConversations();
    } finally {
      runId = '';
      setBusy(false);
      flow = null;
      input.focus();
      requestAnimationFrame(() => scrollDown(pinned));
    }
  }

  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', stop);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!busy) send();
    }
  });

  const composer = h(
    'div',
    { class: 'chat-composer' },
    input,
    h('div', { class: 'chat-composer-side' }, sendBtn, stopBtn, h('div', { class: 'hint' }, '⌘/Ctrl + Enter 发送 · Enter 换行'))
  );

  const main = h('section', { class: 'chat-main' }, header, scroller, composer);
  const page = h('div', { class: 'chat-page with-side' }, side, main);
  container.appendChild(page);

  // 加载会话
  await refreshConversations();
  if (conversations.length) {
    await switchConversation(conversations[0].id);
  } else {
    log.appendChild(intro());
  }
  input.focus();

  const off = onAiEvent((ev) => {
    if (!ev || ev.scope !== 'agent' || (runId && ev.runId && ev.runId !== runId)) return;
    if (!flow) return;
    if (ev.type === 'text') flow.text(ev.full != null ? ev.full : ev.text);
    else if (ev.type === 'thinking') flow.thinking(ev.full != null ? ev.full : ev.text);
    else if (ev.type === 'thinking_end') flow.thinkingEnd();
    else if (ev.type === 'tool') flow.tool(ev);
    else if (ev.type === 'failed') flow.finish({ aborted: false, error: ev.error || '' });
    else if (ev.type === 'error' && ev.error) flow.note(`错误：${ev.error}`, 'flow-error');
  });

  return () => {
    try {
      off();
    } catch {
      /* ignore */
    }
  };
}
