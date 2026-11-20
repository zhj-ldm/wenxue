import { h, md } from './ui.js';

/**
 * 移植自 pi-agent-desktop 的对话流：
 * - 助手消息按「思考 → 工具 → 正文」的真实顺序分块渲染；
 * - 思考默认收起为一行，可展开、显示耗时；
 * - 工具调用是紧凑卡片，绿色/失败/已取消三态，可展开参数与输出；
 * - 运行中在没有流式内容时显示脉冲状态（正在思考 / 正在调用工具…）。
 */
export function createAgentFlow(log, { modelLabel = 'AI', onUpdate } = {}) {
  const blocks = h('div', { class: 'flow-blocks' });
  const phase = h('div', { class: 'flow-phase' }, h('span', { class: 'flow-phase-dot' }), h('span', { class: 'flow-phase-text' }, ''));
  const foot = h('div', { class: 'flow-foot' });
  const root = h(
    'div',
    { class: 'flow-assistant' },
    h('div', { class: 'flow-model' }, modelLabel),
    blocks,
    phase,
    foot
  );

  let fullText = '';
  let cut = 0;
  let needNewText = true;
  let currentPhase = '';
  let stopped = false;
  let ended = false;
  const textBlocks = [];
  const tools = new Map();
  let think = null;
  let copyBtn = null;
  let thinkTimer = 0;
  let textTimer = 0;
  let thinkFull = '';

  function update() {
    if (typeof onUpdate === 'function') onUpdate();
  }

  function setPhase(text) {
    currentPhase = text || '';
    phase.style.display = currentPhase && !ended ? '' : 'none';
    phase.querySelector('.flow-phase-text').textContent = currentPhase;
    update();
  }

  function closeTextTail() {
    if (!needNewText) {
      cut = fullText.length;
      needNewText = true;
    }
  }

  function ensureTextBlock() {
    if (!needNewText) return textBlocks[textBlocks.length - 1];
    const el = h('div', { class: 'flow-text' });
    blocks.appendChild(el);
    const block = { el, start: cut };
    textBlocks.push(block);
    needNewText = false;
    return block;
  }

  function renderText(useMarkdown) {
    if (!textBlocks.length) return;
    textBlocks.forEach((block, i) => {
      const end = i + 1 < textBlocks.length ? textBlocks[i + 1].start : fullText.length;
      const segment = fullText.slice(block.start, end);
      if (useMarkdown) block.el.innerHTML = md(segment);
      else block.el.textContent = segment;
    });
  }

  function pushText(full) {
    fullText = String(full == null ? fullText : full);
    ensureTextBlock();
    // 流式阶段同样按节流渲染 Markdown，边输出边排版；结束时再兜底渲染一次
    if (!textTimer) {
      textTimer = setTimeout(() => {
        textTimer = 0;
        renderText(true);
        update();
      }, 60);
    }
    if (currentPhase) setPhase('');
  }

  function buildThink() {
    const icon = h('span', { class: 'flow-think-icon' }, '✦');
    const label = h('span', { class: 'flow-think-label' }, '思考中');
    const preview = h('span', { class: 'flow-think-preview' }, '');
    const duration = h('span', { class: 'flow-duration' }, '');
    const caret = h('span', { class: 'flow-caret' }, '›');
    const head = h('button', { class: 'flow-think-head', type: 'button' }, icon, label, preview, duration, caret);
    const body = h('div', { class: 'flow-think-body' });
    const el = h('div', { class: 'flow-think' }, head, body);
    let started = Date.now();
    let expanded = false;
    head.addEventListener('click', () => {
      expanded = !expanded;
      el.classList.toggle('open', expanded);
    });
    const card = {
      el,
      body,
      append(full) {
        if (!started) started = Date.now();
        const text = String(full || '');
        body.textContent = text;
        const last = text.trim().split('\n').filter(Boolean).slice(-1)[0] || '…';
        preview.textContent = last.length > 56 ? `${last.slice(0, 56)}…` : last;
      },
      end() {
        el.classList.add('done');
        label.textContent = '思考过程';
        const sec = Math.max(1, Math.round((Date.now() - started) / 1000));
        duration.textContent = `${sec}s`;
      }
    };
    return card;
  }

  function pushThinking(full) {
    if (!think) {
      closeTextTail();
      think = buildThink();
      blocks.appendChild(think.el);
    }
    thinkFull = String(full || '');
    if (!thinkTimer) {
      thinkTimer = setTimeout(() => {
        thinkTimer = 0;
        if (think) think.append(thinkFull);
        update();
      }, 80);
    }
    setPhase('正在思考…');
  }

  function endThinking() {
    if (!think) return;
    clearTimeout(thinkTimer);
    thinkTimer = 0;
    think.append(thinkFull);
    think.end();
    think = null;
    setPhase('正在整理思路…');
  }

  function toolPreview(ev) {
    if (ev.title) return String(ev.title).replace(/\s+/g, ' ').slice(0, 90);
    if (ev.args == null) return '';
    if (typeof ev.args === 'string') return ev.args.replace(/\s+/g, ' ').slice(0, 90);
    try {
      return JSON.stringify(ev.args).slice(0, 90);
    } catch {
      return '';
    }
  }

  function buildTool(ev) {
    const glyph = h('span', { class: 'flow-tool-glyph' }, '▸');
    const name = h('span', { class: 'flow-tool-name' }, String(ev.tool || 'tool'));
    const preview = h('span', { class: 'flow-tool-preview' }, toolPreview(ev));
    const status = h('span', { class: 'flow-tool-status' });
    const duration = h('span', { class: 'flow-duration' }, '');
    const caret = h('span', { class: 'flow-caret' }, '›');
    const head = h('button', { class: 'flow-tool-head', type: 'button' }, glyph, name, preview, status, duration, caret);
    const argsEl = h('pre', { class: 'flow-tool-args' });
    const outEl = h('pre', { class: 'flow-tool-output' });
    const outWrap = h('div', { class: 'flow-tool-section output' }, h('div', { class: 'flow-tool-label' }, '输出'), outEl);
    const argsWrap = h('div', { class: 'flow-tool-section args' }, h('div', { class: 'flow-tool-label' }, '参数'), argsEl);
    const body = h('div', { class: 'flow-tool-body' }, argsWrap, outWrap);
    const el = h('div', { class: 'flow-tool running' }, head, body);
    let userToggled = false;
    head.addEventListener('click', () => {
      userToggled = true;
      el.classList.toggle('open');
    });

    const card = {
      el,
      update(next = {}) {
        const state = String(next.status || 'running').toLowerCase();
        const running = /run|start|pending/.test(state);
        const error = next.isError || /error|fail/.test(state);
        el.classList.toggle('running', running);
        el.classList.toggle('error', !!error);
        el.classList.toggle('aborted', false);
        if (running) {
          status.innerHTML = '<i class="flow-spin"></i>';
          if (!userToggled) el.classList.add('open');
        } else {
          status.textContent = error ? '✕' : '✓';
          if (!userToggled) el.classList.remove('open');
        }
        if (next.title) preview.textContent = String(next.title).replace(/\s+/g, ' ').slice(0, 90);
        else if (next.args != null) preview.textContent = toolPreview(next);
        if (next.args != null) argsEl.textContent = typeof next.args === 'string' ? next.args : JSON.stringify(next.args, null, 2);
        if (next.result != null && next.result !== '') {
          outWrap.style.display = '';
          outEl.textContent = String(next.result);
        }
        if (next.durationMs != null) {
          const sec = Number(next.durationMs) / 1000;
          duration.textContent = sec < 1 ? `${Math.round(sec * 1000)}ms` : `${sec.toFixed(1)}s`;
        }
      },
      abort() {
        el.classList.remove('running', 'error');
        el.classList.add('aborted');
        status.textContent = '已取消';
        if (!userToggled) el.classList.remove('open');
      }
    };
    return card;
  }

  function pushTool(ev) {
    closeTextTail();
    const key = ev.id || `${ev.tool}:${ev.title}`;
    let card = tools.get(key);
    if (!card) {
      card = buildTool(ev);
      tools.set(key, card);
      blocks.appendChild(card.el);
    }
    card.update(ev);
    const running = String(ev.status || '').toLowerCase();
    if (/run|start|pending/.test(running) || !running) setPhase(`正在调用 ${ev.tool || '工具'}…`);
    else setPhase('正在整理工具结果…');
    update();
  }

  function finish({ aborted = false, error = '' } = {}) {
    if (ended) return;
    ended = true;
    stopped = aborted;
    setPhase('');
    tools.forEach((card) => {
      if (card.el.classList.contains('running')) card.abort();
    });
    if (aborted) {
      appendNote('已停止生成', 'flow-stopped');
    } else if (error) {
      appendNote(`错误：${error}`, 'flow-error');
    }
    if (fullText.trim()) {
      copyBtn = h('button', { class: 'flow-copy', type: 'button', title: '复制回答' }, '复制');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(fullText);
          copyBtn.textContent = '已复制';
          setTimeout(() => {
            copyBtn.textContent = '复制';
          }, 1500);
        } catch {
          /* ignore */
        }
      });
      foot.appendChild(copyBtn);
    }
    update();
  }

  function final(text, aborted = false) {
    if (text != null) fullText = String(text);
    clearTimeout(textTimer);
    textTimer = 0;
    renderText(true);
    if (!ended) finish({ aborted });
    else renderText(true);
    update();
  }

  function appendNote(text, cls) {
    blocks.appendChild(h('div', { class: `flow-note ${cls || ''}` }, text));
  }

  setPhase('正在思考…');
  log.appendChild(root);

  return {
    el: root,
    setPhase,
    thinking: pushThinking,
    thinkingEnd: endThinking,
    tool: pushTool,
    text: pushText,
    finish,
    final,
    note: appendNote,
    getText: () => fullText
  };
}
