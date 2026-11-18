'use strict';

// 内置 pi Agent（@earendil-works/pi-ai + pi-agent-core）。
// 所有请求都在主进程内完成，用户在应用里填 API 地址 / Key / 模型即可。

const { makeTools } = require('./tools');

let cached = null;
const runs = new Map(); // runId -> { agent, timer }

async function libs() {
  if (!cached) {
    const ai = await import('@earendil-works/pi-ai');
    const core = await import('@earendil-works/pi-agent-core');
    const openai = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
    cached = { ai, core, openAICompletionsApi: openai.openAICompletionsApi };
  }
  return cached;
}

function normalizeBaseUrl(url) {
  let base = String(url || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('请先在设置里填写 API 地址');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base;
}

function buildModel(profile, modelId) {
  const id = String(modelId || profile.model || '').trim();
  if (!id) throw new Error('请先在设置里填写模型名（如 gpt-4o-mini、deepseek-chat）');
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: String(profile.id || 'custom'),
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(profile.contextWindow) || 128000,
    // 输出不再设上限：给到上下文窗口大小，具体由模型/接口自身决定
    maxTokens: Number(profile.contextWindow) || 128000,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: true }
  };
}

async function makeModels(profile, modelId) {
  const { ai, openAICompletionsApi } = await libs();
  const model = buildModel(profile, modelId);
  const provider = ai.createProvider({
    id: model.provider,
    name: profile.name || '自定义接口',
    baseUrl: model.baseUrl,
    auth: { apiKey: { name: profile.name || 'API Key', resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: openAICompletionsApi()
  });
  const models = ai.createModels();
  models.setProvider(provider);
  return { models, model };
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((part) => part && part.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

function errorOf(message) {
  if (!message) return '';
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return message.errorMessage || (message.stopReason === 'aborted' ? '已停止' : '模型请求失败');
  }
  return '';
}

/* ---------------- 纯文本补全（批改 / 讲解 / 题目对话） ---------------- */

async function completeText({ profile, systemPrompt, messages, model: modelId, thinkingLevel = 'off', timeoutMs = 180000, signal }) {
  const { models, model } = await makeModels(profile, modelId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.min(600000, Math.max(10000, Number(timeoutMs) || 180000)));
  try {
    const result = await models.complete(
      model,
      { systemPrompt, messages: messages || [], tools: [] },
      {
        apiKey: profile.apiKey || 'no-key',
        signal: controller.signal,
        reasoning: thinkingLevel === 'off' ? undefined : thinkingLevel
      }
    );
    const err = errorOf(result);
    if (err && !textOf(result)) throw new Error(err);
    return { text: textOf(result), error: err };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

/* ---------------- Agent（带 read / write / edit / bash） ---------------- */

const sessions = new Map(); // sessionId -> { agent, profileId, model, baseDir }

async function startAgent({ runId, profile, baseDir, systemPrompt, tools = true, toolHooks = {}, model: modelId, sessionId, thinkingLevel = 'medium' }) {
  const { core } = await libs();
  const reuse = sessionId ? sessions.get(sessionId) : null;
  if (reuse && reuse.profileId === profile.id && reuse.baseDir === baseDir) {
    try {
      reuse.agent.state.thinkingLevel = thinkingLevel;
    } catch {
      /* 旧版本不支持时忽略 */
    }
    runs.set(runId, { agent: reuse.agent });
    return reuse.agent;
  }
  const { models, model } = await makeModels(profile, modelId);
  const agent = new core.Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools: tools ? makeTools(baseDir, toolHooks) : []
    },
    streamFn: models.streamSimple.bind(models),
    getApiKey: async () => profile.apiKey || 'no-key',
    toolExecution: 'sequential'
  });
  if (sessionId) {
    sessions.set(sessionId, { agent, profileId: profile.id, baseDir, model: model.id });
  }
  runs.set(runId, { agent });
  return agent;
}

function resetSession(sessionId) {
  if (!sessionId) return;
  const hit = sessions.get(sessionId);
  if (hit) {
    try {
      hit.agent.abort();
    } catch {
      /* ignore */
    }
    sessions.delete(sessionId);
  }
}

/**
 * 跑一轮对话。
 * @returns {{text:string, tools:Array, error:string, cancelled:boolean}}
 */
async function runAgent({ runId, profile, baseDir, systemPrompt, prompt, sessionId, model, onEvent, toolHooks, thinkingLevel = 'medium', timeoutMs = 300000 }) {
  const agent = await startAgent({ runId, profile, baseDir, systemPrompt, tools: true, toolHooks, model, sessionId, thinkingLevel });
  let buffer = '';
  let thinking = '';
  const usedTools = [];
  const pending = new Map();
  let failure = '';
  let cancelled = false;

  const timer = setTimeout(() => {
    failure = failure || '请求超时';
    try {
      agent.abort();
    } catch {
      /* ignore */
    }
  }, Math.min(900000, Math.max(30000, Number(timeoutMs) || 300000)));
  runs.set(runId, { agent, timer, abort: () => { cancelled = true; agent.abort(); } });

  const unsubscribe = agent.subscribe((event) => {
    if (!event) return;
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent;
      if (inner && inner.type === 'text_delta' && inner.delta) {
        buffer += inner.delta;
        if (onEvent) onEvent({ type: 'text', full: buffer, text: inner.delta });
      } else if (inner && inner.type === 'thinking_delta' && inner.delta) {
        thinking += inner.delta;
        if (onEvent) onEvent({ type: 'thinking', full: thinking, text: inner.delta });
      } else if (inner && inner.type === 'thinking_end') {
        if (onEvent) onEvent({ type: 'thinking_end', full: thinking });
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      const title = summarizeArgs(event.args);
      pending.set(event.toolCallId, { tool: event.toolName, title });
      usedTools.push({ tool: event.toolName, title, status: 'completed' });
      if (onEvent) onEvent({ type: 'tool', id: event.toolCallId, tool: event.toolName, title, args: event.args, status: 'running' });
      return;
    }
    if (event.type === 'tool_execution_end') {
      const meta = pending.get(event.toolCallId) || {};
      const status = event.isError ? 'error' : 'completed';
      const record = usedTools.find((t) => t.tool === (event.toolName || meta.tool) && t.title === (meta.title || ''));
      if (record) record.status = status;
      if (onEvent) {
        onEvent({
          type: 'tool',
          id: event.toolCallId,
          tool: event.toolName || meta.tool,
          title: meta.title || '',
          isError: !!event.isError,
          status,
          result: summarizeResult(event.result),
          durationMs: event.durationMs
        });
      }
      return;
    }
    if (event.type === 'message_end' && event.message && event.message.role === 'assistant') {
      const err = errorOf(event.message);
      if (err) failure = err;
      return;
    }
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      const last = [...event.messages].reverse().find((m) => m && m.role === 'assistant');
      if (last) {
        const text = textOf(last);
        if (text && text.length > buffer.length) buffer = text;
        const err = errorOf(last);
        if (err) failure = err;
      }
    }
  });

  try {
    await agent.prompt(prompt);
  } catch (err) {
    failure = failure || (err && err.message ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    try {
      unsubscribe();
    } catch {
      /* ignore */
    }
    runs.delete(runId);
  }

  if (!buffer.trim() && failure && !cancelled) throw new Error(failure);
  return { text: buffer, thinking, tools: usedTools, error: failure, cancelled };
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const keys = ['command', 'path', 'filePath', 'query', 'pattern', 'url'];
  for (const key of keys) {
    if (typeof args[key] === 'string' && args[key].trim()) {
      return args[key].trim().replace(/\s+/g, ' ').slice(0, 160);
    }
  }
  return '';
}

function summarizeResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result.slice(0, 4000);
  if (Array.isArray(result)) return result.map(summarizeResult).filter(Boolean).join('\n').slice(0, 4000);
  if (Array.isArray(result.content)) {
    return result.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
  }
  if (typeof result.text === 'string') return result.text.slice(0, 4000);
  try {
    return JSON.stringify(result).slice(0, 4000);
  } catch {
    return '';
  }
}

function cancel(runId) {
  const run = runs.get(runId);
  if (!run) return false;
  try {
    if (run.abort) run.abort();
    else run.agent.abort();
  } catch {
    return false;
  }
  return true;
}

function cancelAll() {
  for (const id of Array.from(runs.keys())) cancel(id);
}

/* ---------------- 连接测试 / 模型列表 ---------------- */

async function testProfile(profile) {
  const started = Date.now();
  const res = await completeText({
    profile,
    systemPrompt: '你是一个连通性测试助手，只回复两个字：可用。',
    messages: [{ role: 'user', content: '测试', timestamp: Date.now() }],
    timeoutMs: 30000
  });
  return { ok: true, ms: Date.now() - started, reply: String(res.text || '').slice(0, 60) };
}

async function listModels(profile) {
  const base = normalizeBaseUrl(profile.baseUrl);
  const res = await fetch(`${base}/models`, {
    headers: profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}
  });
  if (!res.ok) throw new Error(`读取模型失败（HTTP ${res.status}）`);
  const data = await res.json();
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return list
    .map((m) => ({
      id: String(m.id || m.name || m.model || ''),
      name: String(m.name || m.id || m.model || '')
    }))
    .filter((m) => m.id);
}

module.exports = { completeText, runAgent, cancel, cancelAll, resetSession, listModels, testProfile, buildModel };
