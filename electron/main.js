'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { exec, execFile, spawn } = require('child_process');
const net = require('net');

const store = require('./lib/store');
const pi = require('./lib/pi');
const papersLib = require('./lib/papers');
const ai = require('./lib/ai');
const prompts = require('./lib/prompts');

let mainWindow = null;

/* ---------------- 基础工具 ---------------- */

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), raw: (err && err.raw) || '' };
    }
  });
}

function requireUser() {
  return store.localUser();
}

function emit(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:event', payload);
}

function settingsOf(uid) {
  return store.readUserSettings(uid);
}

function activeProfile() {
  return store.activeProfile();
}

function modelOf(profile) {
  return String((profile && profile.model) || '').trim();
}

// 所有 AI 调用共用的取消表（纯文本补全走这里，Agent 走 pi.cancel）
const textRuns = new Map();

function findQuestion(paper, questionId) {
  const idx = paper.questions.findIndex((q) => q.id === questionId);
  if (idx < 0) throw new Error('题目不存在');
  return { question: paper.questions[idx], index: idx };
}

// 批改 / 讲解 / 题目对话：纯文本补全，不带工具
async function runAi(options) {
  const prompt = String(options.prompt || '');
  const messages = Array.isArray(options.messages) && options.messages.length ? options.messages : null;
  if (!prompt.trim() && !messages) throw new Error('提示词为空，请检查 prompts 目录是否完整。');
  const profile = activeProfile();
  const settings = settingsOf(requireUser().id);
  const runId = options.runId || store.rid('run');
  const timeoutMs = Math.min(600000, Math.max(30000, Number(options.timeoutMs || settings.timeoutMs || 180000)));
  const controller = new AbortController();
  textRuns.set(runId, controller);

  emit({ runId, ...options.meta, type: 'start' });
  try {
    const result = await pi.completeText({
      profile,
      model: modelOf(profile),
      systemPrompt: options.systemPrompt || '',
      messages: messages || [{ role: 'user', content: prompt, timestamp: Date.now() }],
      thinkingLevel: options.thinking || settingsOf(requireUser().id).thinkingLevel || 'off',
      timeoutMs,
      signal: controller.signal
    });
    emit({ runId, ...options.meta, type: 'done', text: result.text, error: result.error || '' });
    return { runId, ok: !result.error, text: result.text, error: result.error || '', tools: [] };
  } catch (err) {
    const message = controller.signal.aborted ? '已停止' : err && err.message ? err.message : String(err);
    emit({ runId, ...options.meta, type: 'failed', error: message });
    throw new Error(message);
  } finally {
    textRuns.delete(runId);
  }
}


/* ---------------- 启动 / 全局 ---------------- */

handle('app:bootstrap', async () => {
  const folder = store.syncCarrierFolder(store.localUser().id);
  const providers = store.publicProfiles();
  return {
    user: store.localUser(),
    providers: providers.profiles,
    activeProfileId: providers.activeProfileId,
    subjects: papersLib.SUBJECTS,
    types: papersLib.TYPES.map((t) => ({ type: t, label: papersLib.TYPE_LABEL[t] })),
    platform: process.platform,
    dataRoot: store.root(),
    folderSync: { dir: folder.dir, added: folder.added },
    version: app.getVersion()
  };
});

/* ---------------- 设置 / API 接口 ---------------- */

function providerState() {
  const { profiles, activeProfileId } = store.publicProfiles();
  return { settings: settingsOf(requireUser().id), profiles, activeProfileId };
}

handle('settings:get', async () => providerState());

handle('settings:save', async (patch) => {
  const user = requireUser();
  store.saveUserSettings(user.id, patch);
  return providerState();
});

handle('provider:list', async () => store.publicProfiles());

handle('provider:save', async (patch) => store.saveProfile(patch));

handle('provider:delete', async ({ id }) => store.deleteProfile(id));

handle('provider:activate', async ({ id }) => store.setActiveProfile(id));

handle('provider:models', async ({ id } = {}) => {
  const profile = id ? store.profileById(id) : store.activeProfile();
  const models = await pi.listModels(profile);
  return { models };
});

handle('provider:test', async ({ id } = {}) => {
  const profile = id ? store.profileById(id) : store.activeProfile();
  return pi.testProfile(profile);
});

handle('dialog:pickFolder', async ({ defaultPath } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultPath || app.getPath('documents')
  });
  return res.canceled ? '' : res.filePaths[0];
});

handle('dialog:pickFile', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '试卷文件', extensions: ['json', 'md', 'markdown', 'txt'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });
  return res.canceled ? '' : res.filePaths[0];
});

handle('file:read', async ({ filePath }) => {
  requireUser();
  const stat = fs.statSync(filePath);
  if (stat.size > 2 * 1024 * 1024) throw new Error('文件过大（超过 2MB），请拆分后再导入');
  return { name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf8') };
});

handle('prompts:list', async () => {
  requireUser();
  return prompts.list().map((name) => ({ name, content: prompts.load(name) }));
});

handle('app:openExternal', async ({ url }) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('只允许打开网页链接');
  await shell.openExternal(url);
  return true;
});

/* ---------------- 放题目录同步 ---------------- */

// 手动「从放题目录同步」：强制重新扫描，返回新增明细
handle('carrier:syncFolder', async ({ dir } = {}) => {
  const user = requireUser();
  if (dir) store.saveUserSettings(user.id, { exportDir: dir });
  return store.syncCarrierFolder(user.id, { force: true });
});

/* ---------------- 全局 AI 对话（内置 pi Agent） ---------------- */

function agentContext(uid) {
  const settings = settingsOf(uid);
  return [
    '你是「问学」桌面应用内嵌的学习助手，运行在用户本机，可以读写文件、运行命令、使用工具。',
    `今天是 ${store.todayStr()}。放题目录：${settings.exportDir}`,
    '你拥有以下能力，用户让你做时直接调用工具把事情做完，不要只给方案：',
    '1. 学习内容统一为「载体」，分三种：paper（整套试卷）、practice（专项练习）、plan（提升计划）。',
    '   只能用 create_carrier / update_carrier / find_carrier / list_carriers / delete_carrier 工具创建和修改，不要手写文件。',
    '   每个载体自动生成 8 位编号（如 A7K2M9Q1），用户可以用编号找你检索；回复时提到载体要带上编号。',
    '2. 载体结构：{kind,title,subject,grade,goal,instructions,durationMinutes,sections:[{name,passage,date,questions:[...]}]}。',
    '   题目字段：{id,type,layout,stem,passage,blanks,options,maxScore,referenceAnswer,sampleAnswer,rubric,knowledgePoints,difficulty,date,answerMode,actions}。',
    '   date 写 YYYY-MM-DD：大题写 date，小题自动继承；小题也可单独写 date。到期（当天或已过期未做）会自动出现在「每日任务」。',
    '   actions 控制题目按钮：{"grade":true,"explain":true,"chat":true}，false 则不显示对应按钮。',
    '   answerMode 取 fixed（有标准答案）或 open（答案不唯一，不设标准答案，由你判分）。',
    '   sampleAnswer 是「示范标准答案」，只用于讲解和对话参考，不参与自动批改；开放题可以靠它给出范例。',
    '3. 填空题（语篇填空、语法填空、默写）默认内联：layout 写 "inline"，在 passage 或 stem 里用 {{1}}、{{2}} 标出空位，blanks 给出每个空的 key/answer/maxScore。示例：',
    '   {"id":"q1","type":"fill_blank","layout":"inline","stem":"The Great Wall {{1}} (build) long ago, and it {{2}} (visit) by many people every year.","blanks":[{"key":"1","answer":"was built","maxScore":1},{"key":"2","answer":"is visited","maxScore":1}],"maxScore":2,"referenceAnswer":"1. was built  2. is visited","rubric":[{"point":"时态与语态","score":2}]}',
    '   普通问答题用 block（不写 layout 即可），不要把一个空拆成一道小题。',
    '4. 用户说「帮我做一个两周的英语补全对话提升计划」时，用 create_carrier（kind=plan），把每天做成一个 section 并写 date，题目放该 section 内。',
    '5. 讲题、整理错题、调整计划、修改本地文件都可以直接做；用 list_carriers / find_carrier 了解已有内容和完成情况。',
    '6. 需要最新资料、时事或题目素材时，用 web_search 联网搜索；搜到链接后可以用 web_fetch 读取网页正文。',
    'type 取 choice / multi_choice / fill_blank / short_answer / essay / translation / calculation / other；总分等于各小题 maxScore 之和。',
    '模型由用户在设置里配置，不要询问或声称切换模型。回答用中文，简洁直接；创建或改动了载体要告诉用户编号和结果。'
  ].join('\n');
}

// 联网搜索：默认调用内置 Aggr Search（bin/aggrsearch），也可在设置里用自定义命令覆盖
const SEARCH_BIN_NAME = process.platform === 'win32' ? 'aggrsearch.exe' : 'aggrsearch';

function searchBinCandidates() {
  const list = [];
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'bin', SEARCH_BIN_NAME));
  list.push(path.join(__dirname, '..', 'bin', SEARCH_BIN_NAME));
  list.push(path.join(app.getAppPath(), 'bin', SEARCH_BIN_NAME));
  return list;
}

function resolveSearchBin() {
  for (const p of searchBinCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return '';
}

// 新版 Aggr Search 自带本地向量模型；优先用随包分发的模型缓存，避免首启联网下载
const EMBED_REPO_DIR = 'models--onnx-community--embeddinggemma-300m-ONNX';

function modelCacheCandidates() {
  const list = [];
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'bin', 'models'));
  list.push(path.join(__dirname, '..', 'bin', 'models'));
  list.push(path.join(app.getAppPath(), 'bin', 'models'));
  return list;
}

function resolveModelCache() {
  for (const dir of modelCacheCandidates()) {
    try {
      if (fs.existsSync(path.join(dir, EMBED_REPO_DIR))) return dir;
    } catch {
      /* ignore */
    }
  }
  return '';
}

function searchEnv() {
  const env = Object.assign({}, process.env);
  if (!env.AGGRSEARCH_EMBED_CACHE) {
    const cache = resolveModelCache();
    if (cache) {
      env.AGGRSEARCH_EMBED_CACHE = cache;
      // 模型随包分发，禁止再联网拉模型；缓存不完整时自动回退词法重排
      env.HF_HUB_OFFLINE = env.HF_HUB_OFFLINE || '1';
    } else {
      env.AGGRSEARCH_EMBED = env.AGGRSEARCH_EMBED || 'off';
    }
  }
  return env;
}

function execSearchBin(args, timeout = 120000) {
  const bin = resolveSearchBin();
  if (!bin) {
    return Promise.reject(
      new Error(`没有找到内置搜索工具（${SEARCH_BIN_NAME}），请把对应平台的 Aggr Search 放到应用的 bin/ 目录，或在「设置 → 联网搜索命令」里填写自定义命令。`)
    );
  }
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: searchEnv() }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      if (err && !out) {
        reject(new Error(`搜索失败：${String(stderr || err.message || '').slice(0, 300)}`));
        return;
      }
      resolve(out);
    });
  });
}

/* ---- 常驻搜索服务：模型只加载一次，后续搜索直接复用 ---- */

let searchService = null; // { port, proc }
let searchServicePromise = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function stopSearchService() {
  if (searchService && searchService.proc) {
    try {
      searchService.proc.kill();
    } catch {
      /* ignore */
    }
  }
  searchService = null;
  searchServicePromise = null;
}

async function waitSearchHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.status === 'ok') {
          last = body;
          // 等模型预热完成，第一次搜索就不用再等加载
          if (!body.embedding || !body.embedding.enabled || body.embedding.ready) return true;
        }
      }
    } catch {
      /* 服务还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return !!last;
}

async function startSearchService() {
  const bin = resolveSearchBin();
  if (!bin) throw new Error('没有找到内置搜索工具');
  for (let i = 0; i < 3; i += 1) {
    const port = await getFreePort();
    const proc = spawn(bin, ['serve', '--port', String(port)], {
      env: searchEnv(),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    proc.stderr.on('data', () => {});
    proc.on('error', () => {});
    proc.on('exit', () => {
      if (searchService && searchService.proc === proc) {
        searchService = null;
        searchServicePromise = null;
      }
    });
    const ok = await waitSearchHealth(port, 30000);
    if (ok) return { port, proc };
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
  throw new Error('搜索服务启动失败');
}

function ensureSearchService() {
  if (searchService) return Promise.resolve(searchService);
  if (!searchServicePromise) {
    searchServicePromise = startSearchService()
      .then((svc) => {
        searchService = svc;
        return svc;
      })
      .catch((err) => {
        searchServicePromise = null;
        throw err;
      });
  }
  return searchServicePromise;
}

function formatSearchResults(query, data, limit) {
  const results = data && Array.isArray(data.results) ? data.results.slice(0, limit) : [];
  if (!results.length) return `查询：${query}\n（没有搜索到结果）`;
  const lines = results.map((r, i) => {
    const snippet = String(r.snippet || r.content || '').replace(/\s+/g, ' ').slice(0, 260);
    return `${i + 1}. ${r.title || '(无标题)'}\n   ${r.url || ''}\n   ${snippet}`;
  });
  return `查询：${query}\n${lines.join('\n')}`;
}

async function httpSearch(port, query, limit) {
  const url = `http://127.0.0.1:${port}/search?q=${encodeURIComponent(query)}&max_results=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`搜索服务返回 ${res.status}`);
  return res.json();
}

async function httpFetch(port, target) {
  const url = `http://127.0.0.1:${port}/fetch?url=${encodeURIComponent(target)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`抓取服务返回 ${res.status}`);
  return res.json();
}

async function webSearch(uid, { query, count, max } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('搜索关键词为空');
  const limit = Math.min(Math.max(Number(count || max) || 6, 1), 20);
  const template = String(settingsOf(uid).searchCmd || '').trim();

  // 用户自定义命令优先
  if (template) {
    const safe = q.replace(/["`$\\]/g, '\\$&');
    const cmd = template.includes('{{query}}') ? template.replace(/\{\{query\}\}/g, safe) : `${template} "${safe}"`;
    const out = await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 45000, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
        const text = String(stdout || '').trim();
        if (err && !text) {
          reject(new Error(`搜索命令执行失败：${String(stderr || err.message || '').slice(0, 300)}`));
          return;
        }
        resolve(text);
      });
    });
    return out ? out.slice(0, 20000) : '没有搜索到结果。';
  }

  try {
    const svc = await ensureSearchService();
    const data = await httpSearch(svc.port, q, limit);
    return formatSearchResults(q, data, limit);
  } catch {
    // 常驻服务异常时退回单次 CLI，保证搜索仍可用
    const raw = await execSearchBin(['search', q, '--max', String(limit), '--json']);
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return raw.slice(0, 20000) || '没有搜索到结果。';
    }
    return formatSearchResults(q, data, limit);
  }
}

async function webFetch(uid, { url } = {}) {
  const target = String(url || '').trim();
  if (!target) throw new Error('网址为空');
  const template = String(settingsOf(uid).searchCmd || '').trim();
  if (template) {
    const base = template.replace(/\{\{query\}\}/g, '{{url}}');
    const safe = target.replace(/["`$\\]/g, '\\$&');
    const cmd = base.includes('{{url}}') ? base.replace(/\{\{url\}\}/g, safe) : `${base} "${safe}"`;
    const out = await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        const text = String(stdout || '').trim();
        if (err && !text) reject(new Error(`抓取失败：${String(stderr || err.message || '').slice(0, 300)}`));
        else resolve(text);
      });
    });
    return out.slice(0, 20000) || '没有抓到内容。';
  }
  let data = null;
  try {
    const svc = await ensureSearchService();
    data = await httpFetch(svc.port, target);
  } catch {
    // 常驻服务异常时退回单次 CLI
    const raw = await execSearchBin(['fetch', target, '--json'], 120000);
    try {
      data = JSON.parse(raw);
    } catch {
      return raw.slice(0, 20000);
    }
  }
  if (data.error) throw new Error(`抓取失败：${data.error}`);
  return `${target}\n\n${String(data.body || data.content || '').slice(0, 16000)}`;
}

// 暴露给 Agent 的计划 / 任务工具
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return store.todayStr();
  d.setDate(d.getDate() + n);
  return store.todayStr(d);
}

function carrierHooks(uid) {
  return {
    webSearch: (params) => webSearch(uid, params),
    webFetch: (params) => webFetch(uid, params),
    createCarrier: async (params = {}) => {
      const carrier = store.saveCarrier(uid, {
        kind: params.kind,
        title: String(params.title || '未命名载体').trim(),
        subject: String(params.subject || '综合').trim(),
        grade: String(params.grade || '').trim(),
        goal: String(params.goal || '').trim(),
        instructions: String(params.instructions || '').trim(),
        durationMinutes: Number(params.durationMinutes) || 0,
        sections: params.sections || []
      });
      const brief = store.listCarrierBriefs(uid).find((c) => c.code === carrier.code);
      return { ok: true, code: carrier.code, title: carrier.title, kind: carrier.kind, questionCount: brief ? brief.questionCount : 0 };
    },
    updateCarrier: async ({ code, patch } = {}) => {
      const exist = store.getCarrier(uid, String(code || ''));
      const carrier = store.saveCarrier(uid, Object.assign({}, exist, patch || {}, { code: exist.code }));
      return { ok: true, code: carrier.code, title: carrier.title };
    },
    findCarrier: async ({ code, title } = {}) => {
      const list = store.listCarriers(uid);
      const hit = code
        ? list.find((c) => c.code === String(code).toUpperCase())
        : list.find((c) => String(c.title).includes(String(title || '')));
      if (!hit) throw new Error('没有找到对应载体');
      const brief = store.listCarrierBriefs(uid).find((c) => c.code === hit.code);
      return { carrier: hit, brief };
    },
    listCarriers: async ({ kind } = {}) => ({ carriers: store.listCarrierBriefs(uid, kind || '') }),
    deleteCarrier: async ({ code } = {}) => ({ ok: store.deleteCarrier(uid, String(code || '')) })
  };
}

function normalizeThinking(value, fallback = 'medium') {
  const v = String(value || fallback || 'medium').toLowerCase();
  return ['off', 'low', 'medium', 'high'].includes(v) ? v : 'medium';
}

// 已在本进程内建立过 Agent 会话的对话 id
const liveConversations = new Set();

handle('agent:conversations', async () => {
  const uid = requireUser().id;
  return { conversations: store.listConversationBriefs(uid) };
});

handle('agent:conversation:get', async ({ conversationId } = {}) => {
  const uid = requireUser().id;
  const conv = store.getConversation(uid, String(conversationId || ''));
  return { conversation: conv };
});

handle('agent:conversation:new', async () => {
  const uid = requireUser().id;
  const conv = store.saveConversation(uid, { title: '新对话', messages: [] });
  return { conversation: conv };
});

handle('agent:conversation:delete', async ({ conversationId } = {}) => {
  const uid = requireUser().id;
  const id = String(conversationId || '');
  pi.resetSession(id);
  liveConversations.delete(id);
  return { ok: store.deleteConversation(uid, id) };
});

handle('agent:conversation:rename', async ({ conversationId, title } = {}) => {
  const uid = requireUser().id;
  const clean = String(title || '').trim().slice(0, 40);
  if (!clean) throw new Error('标题不能为空');
  const conv = store.saveConversation(uid, { id: String(conversationId || ''), title: clean });
  return { conversation: conv };
});

handle('agent:chat', async ({ message, thinking, conversationId, runId } = {}) => {
  const uid = requireUser().id;
  const settings = settingsOf(uid);
  const text = String(message || '').trim();
  if (!text) throw new Error('请输入内容');

  let conv = null;
  if (conversationId) {
    try {
      conv = store.getConversation(uid, String(conversationId));
    } catch {
      conv = null;
    }
  }
  if (!conv) conv = store.saveConversation(uid, { title: text.replace(/\s+/g, ' ').slice(0, 24) });

  const history = (conv.messages || []).filter((m) => m && String(m.text || '').trim());
  const wasEmpty = !(conv.messages || []).some((m) => String(m.text || '').trim());
  const resumed = liveConversations.has(conv.id);
  const prompt = resumed
    ? text
    : history.length
      ? `以下是之前的对话记录：\n${history
          .slice(-20)
          .map((m) => `${m.role === 'assistant' ? 'AI' : '用户'}：${String(m.text).slice(0, 500)}`)
          .join('\n')}\n\n用户现在说：\n${text}`
      : text;

  store.appendConversationMessage(uid, conv.id, { role: 'user', text, ts: Date.now() });

  const profile = store.activeProfile();
  const run = runId || store.rid('run');
  emit({ runId: run, scope: 'agent', type: 'start' });
  const result = await pi.runAgent({
    runId: run,
    profile,
    model: modelOf(profile),
    baseDir: settings.exportDir,
    systemPrompt: agentContext(uid),
    prompt,
    sessionId: conv.id,
    toolHooks: carrierHooks(uid),
    thinkingLevel: normalizeThinking(thinking || settings.thinkingLevel),
    timeoutMs: settings.timeoutMs,
    onEvent: (event) => emit({ runId: run, scope: 'agent', ...event })
  });
  liveConversations.add(conv.id);
  emit({ runId: run, scope: 'agent', type: result.error ? 'failed' : 'done', error: result.error || '', text: result.text });
  if (result.text) {
    store.appendConversationMessage(uid, conv.id, { role: 'assistant', text: result.text, ts: Date.now() });
  }
  if (wasEmpty) {
    store.saveConversation(uid, { id: conv.id, title: text.replace(/\s+/g, ' ').slice(0, 24) });
  }
  return { text: result.text, conversationId: conv.id, tools: result.tools || [] };
});

/* ---------------- 统一载体 ---------------- */

function findCarrierQuestion(carrier, questionId) {
  const sections = carrier.sections || [];
  let index = 0;
  for (const section of sections) {
    for (const question of section.questions || []) {
      if (question.id === String(questionId)) {
        return { question, section, index, total: sections.reduce((sum, s) => sum + (s.questions || []).length, 0) };
      }
      index += 1;
    }
  }
  throw new Error('题目不存在');
}

function chatHistoryText(list) {
  return list
    .filter((m) => m && String(m.content || m.text || '').trim())
    .map((m) => `${m.role === 'assistant' ? 'AI' : '用户'}：${String(m.content || m.text).trim()}`)
    .join('\n');
}

function carrierFullContext(carrier, attempt) {
  const lines = [
    `载体：${carrier.title}（编号 ${carrier.code}，类型 ${carrier.kind}）`,
    carrier.subject ? `学科：${carrier.subject}` : '',
    carrier.goal ? `目标：${carrier.goal}` : '',
    carrier.instructions ? `说明：${carrier.instructions}` : '',
    `共 ${(carrier.sections || []).reduce((sum, s) => sum + (s.questions || []).length, 0)} 题，满分 ${carrier.totalScore}`
  ];
  (carrier.sections || []).forEach((section) => {
    lines.push(`\n【${section.name}${section.date ? ` · ${section.date}` : ''}】`);
    (section.questions || []).forEach((q, i) => {
      const ans = String(((attempt && attempt.answers && attempt.answers[q.id]) || {}).answer || '').trim();
      const grade = attempt && attempt.grades ? attempt.grades[q.id] : null;
      lines.push(
        `${i + 1}. [${q.type}] ${String(q.stem || '').replace(/\s+/g, ' ').slice(0, 160)}\n   作答：${ans ? ans.slice(0, 300) : '（空）'}${grade && grade.score != null ? `　得分：${grade.score}/${q.maxScore}` : ''}`
      );
    });
  });
  return lines.filter(Boolean).join('\n');
}

handle('carrier:list', async ({ kind } = {}) => {
  const uid = requireUser().id;
  return { carriers: store.listCarrierBriefs(uid, kind || ''), today: store.todayStr() };
});

handle('carrier:get', async ({ code } = {}) => {
  const uid = requireUser().id;
  const carrier = store.getCarrier(uid, code);
  const attempt = store.latestCarrierAttempt(uid, carrier.code) || store.newCarrierAttempt(uid, carrier.code);
  const chats = {};
  (carrier.sections || []).forEach((section) => {
    (section.questions || []).forEach((q) => {
      chats[q.id] = store.readCarrierChat(uid, carrier.code, attempt.id, q.id);
    });
  });
  return { carrier, attempt, chats, globalChat: store.readCarrierGlobalChat(uid, carrier.code) };
});

handle('carrier:save', async (patch) => {
  const uid = requireUser().id;
  return { carrier: store.saveCarrier(uid, patch || {}) };
});

handle('carrier:delete', async ({ code } = {}) => ({ ok: store.deleteCarrier(requireUser().id, String(code || '')) }));

handle('carrier:import', async ({ raw, subject } = {}) => {
  const uid = requireUser().id;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('JSON 解析失败，请检查文件格式');
    }
  }
  const paper = papersLib.normalizePaper(parsed, { subject });
  const qById = new Map((paper.questions || []).map((q) => [q.id, q]));
  const sections = (paper.sections || []).map((section, i) => ({
    id: `s${i + 1}`,
    name: section.name,
    passage: section.passage,
    date: String((section && section.date) || ''),
    questions: (section.questionIds || []).map((id) => qById.get(id)).filter(Boolean)
  }));
  const carrier = store.saveCarrier(uid, {
    kind: 'paper',
    title: paper.title,
    subject: paper.subject,
    grade: paper.grade,
    difficulty: paper.difficulty,
    instructions: paper.instructions,
    durationMinutes: paper.durationMinutes,
    sections
  });
  return { carrier };
});

handle('carrier:answer', async ({ code, attemptId, questionId, answer, blanks }) => {
  const uid = requireUser().id;
  const attempt = store.setCarrierAnswer(uid, String(code), String(attemptId), String(questionId), answer, blanks);
  return {
    ok: true,
    savedAt: (attempt.answers[questionId] || {}).updatedAt || '',
    answered: String((attempt.answers[questionId] || {}).answer || '').trim().length > 0
  };
});

handle('carrier:finish', async ({ code, attemptId } = {}) => {
  const uid = requireUser().id;
  return { attempt: store.finishCarrierAttempt(uid, String(code), String(attemptId)) };
});

handle('carrier:daily', async ({ date } = {}) => {
  const uid = requireUser().id;
  return store.carrierDaily(uid, date ? String(date) : undefined);
});

handle('carrier:history', async () => ({ records: store.listCarrierHistory(requireUser().id) }));

handle('carrier:grade', async ({ code, attemptId, questionId, runId }) => {
  const uid = requireUser().id;
  const carrier = store.getCarrier(uid, code);
  const attempt = store.getCarrierAttempt(uid, code, attemptId);
  const found = findCarrierQuestion(carrier, questionId);
  const answer = (attempt.answers[questionId] || {}).answer || '';
  const usedModel = modelOf(store.activeProfile());
  const result = await runAi({
    runId,
    prompt: ai.buildGradePrompt(carrier, found.question, answer),
    meta: { scope: 'carrier', code, questionId }
  });
  if (!result.ok) throw new Error(result.error || '批改失败');
  const grade = ai.parseGrade(result.text, found.question.maxScore);
  grade.model = usedModel;
  grade.source = 'ai';
  store.setCarrierGrade(uid, code, attemptId, questionId, grade);
  return { grade, raw: result.text };
});

handle('carrier:qchat', async ({ code, attemptId, questionId, thinking, text, kind, runId, allowFull } = {}) => {
  const uid = requireUser().id;
  const carrier = store.getCarrier(uid, code);
  const attempt = store.getCarrierAttempt(uid, code, attemptId);
  const found = findCarrierQuestion(carrier, questionId);
  const content = String(text || '').trim();
  if (!content) throw new Error('请输入要问的内容');
  const answer = (attempt.answers[questionId] || {}).answer || '';
  const grade = (attempt.grades || {})[questionId] || null;
  let systemPrompt = ai.buildQuestionContext(carrier, found.question, found.index, found.total, answer, grade, found.section);
  if (allowFull) systemPrompt += '\n\n用户已允许读取整套载体：可用 find_carrier / list_carriers 工具查看完整内容。';
  const history = store.readCarrierChat(uid, code, attemptId, questionId);
  const historyText = chatHistoryText(history);
  const hooks = allowFull
    ? carrierHooks(uid)
    : { webSearch: (params) => webSearch(uid, params), webFetch: (params) => webFetch(uid, params) };

  store.appendCarrierChat(uid, code, attemptId, questionId, { role: 'user', kind: kind || 'chat', content, ts: Date.now() });
  const profile = store.activeProfile();
  const run = runId || store.rid('run');
  emit({ runId: run, scope: 'qchat', type: 'start', code, questionId });
  const result = await pi.runAgent({
    runId: run,
    profile,
    model: modelOf(profile),
    baseDir: settingsOf(uid).exportDir,
    systemPrompt,
    prompt: historyText ? `之前的对话：\n${historyText}\n\n用户现在说：\n${content}` : content,
    toolHooks: hooks,
    thinkingLevel: normalizeThinking(thinking || settingsOf(uid).thinkingLevel),
    timeoutMs: settingsOf(uid).timeoutMs,
    onEvent: (event) => emit({ runId: run, scope: 'qchat', code, questionId, ...event })
  });
  emit({ runId: run, scope: 'qchat', code, questionId, type: result.error ? 'failed' : 'done', error: result.error || '', text: result.text });
  if (result.text) {
    store.appendCarrierChat(uid, code, attemptId, questionId, { role: 'assistant', kind: kind || 'chat', content: result.text, ts: Date.now() });
  }
  return { text: result.text, tools: result.tools || [], error: result.error || '' };
});

handle('carrier:gchat', async ({ code, thinking, text, runId } = {}) => {
  const uid = requireUser().id;
  const carrier = store.getCarrier(uid, code);
  const attempt = store.latestCarrierAttempt(uid, code);
  const content = String(text || '').trim();
  if (!content) throw new Error('请输入要问的内容');
  const history = store.readCarrierGlobalChat(uid, code);
  const historyText = chatHistoryText(history);
  const systemPrompt = [
    '你是「问学」里的整套学习教练，掌握下面这个载体的全部题目、作答与得分。',
    `今天是 ${store.todayStr()}。`,
    carrierFullContext(carrier, attempt),
    '回答用中文：先给结论，再给依据；可以做整体错题分析、提分建议和下一步安排。'
  ].join('\n');
  store.appendCarrierGlobalChat(uid, code, { role: 'user', content, ts: Date.now() });
  const profile = store.activeProfile();
  const run = runId || store.rid('run');
  emit({ runId: run, scope: 'gchat', type: 'start', code });
  const result = await pi.runAgent({
    runId: run,
    profile,
    model: modelOf(profile),
    baseDir: settingsOf(uid).exportDir,
    systemPrompt,
    prompt: historyText ? `之前的对话：\n${historyText}\n\n用户现在说：\n${content}` : content,
    toolHooks: carrierHooks(uid),
    thinkingLevel: normalizeThinking(thinking || settingsOf(uid).thinkingLevel),
    timeoutMs: settingsOf(uid).timeoutMs,
    onEvent: (event) => emit({ runId: run, scope: 'gchat', code, ...event })
  });
  emit({ runId: run, scope: 'gchat', code, type: result.error ? 'failed' : 'done', error: result.error || '', text: result.text });
  if (result.text) {
    store.appendCarrierGlobalChat(uid, code, { role: 'assistant', content: result.text, ts: Date.now() });
  }
  return { text: result.text, tools: result.tools || [], error: result.error || '' };
});

/* ---------------- 取消 ---------------- */

handle('ai:cancel', async ({ runId }) => {
  const hit = textRuns.get(runId);
  if (hit) {
    hit.abort();
    return { cancelled: true };
  }
  return { cancelled: pi.cancel(runId) };
});

/* ---------------- 窗口 ---------------- */

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#F6F3ED',
    title: '问学 · AI 试卷练习',
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 24 } }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#F8F5EF', symbolColor: '#3E4A3F', height: 40 }
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    pi.cancelAll();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    store.init();
    try {
      store.migrateToCarriers(store.localUser().id);
    } catch {
      /* 迁移失败不阻塞启动 */
    }
    try {
      store.migrateCarrierHomes(store.localUser().id);
    } catch {
      /* 同上 */
    }
    createWindow();
    // 后台预热常驻搜索服务：模型只加载一次，之后每次搜索直接复用
    setTimeout(() => {
      try {
        const uid = store.localUser().id;
        if (String(store.readUserSettings(uid).searchCmd || '').trim()) return;
        ensureSearchService().catch(() => {});
      } catch {
        /* 预热失败不影响启动，首次搜索会再尝试 */
      }
    }, 2500);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', stopSearchService);

  app.on('window-all-closed', () => {
    pi.cancelAll();
    if (process.platform !== 'darwin') app.quit();
  });
}
