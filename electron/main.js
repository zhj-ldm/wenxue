'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const store = require('./lib/store');
const pi = require('./lib/pi');
const papersLib = require('./lib/papers');
const ai = require('./lib/ai');
const prompts = require('./lib/prompts');
const { localGrade, parseJsonLoose } = require('./lib/grader');

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

// 只接受干净的模型名字符串；历史脏数据（对象、OpenCode 模型）一律丢弃
function cleanModelName(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id === '[object Object]' || /opencode|big-pickle/i.test(id)) return '';
  return id;
}

function modelOf(profile, model) {
  return cleanModelName(model) || profile.model;
}

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

  emit({ runId, ...options.meta, type: 'start' });
  try {
    const result = await pi.completeText({
      profile,
      model: modelOf(profile, options.model),
      systemPrompt: options.systemPrompt || '',
      messages: messages || [{ role: 'user', content: prompt, timestamp: Date.now() }],
      timeoutMs
    });
    emit({ runId, ...options.meta, type: 'done', text: result.text, error: result.error || '' });
    return { runId, ok: !result.error, text: result.text, error: result.error || '', tools: [] };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    emit({ runId, ...options.meta, type: 'failed', error: message });
    throw err;
  }
}


/* ---------------- 启动 / 全局 ---------------- */

handle('app:bootstrap', async () => {
  const folder = store.syncPaperFolder(store.localUser().id);
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

/* ---------------- 试卷 ---------------- */

handle('paper:list', async () => {
  const user = requireUser();
  store.syncPaperFolder(user.id);
  return store.listPapers(user.id);
});

// 手动「从放题文件夹同步」：强制重新扫描，返回新增明细
handle('paper:syncFolder', async ({ dir } = {}) => {
  const user = requireUser();
  if (dir) store.saveUserSettings(user.id, { exportDir: dir });
  const res = store.syncPaperFolder(user.id, { force: true });
  return res;
});

handle('paper:get', async ({ paperId }) => {
  const user = requireUser();
  return store.getPaper(user.id, paperId);
});

handle('paper:delete', async ({ paperId }) => {
  const user = requireUser();
  return store.deletePaper(user.id, paperId);
});

handle('paper:export', async ({ paperId, dir }) => {
  const user = requireUser();
  const settings = settingsOf(user.id);
  return { file: store.exportPaper(user.id, paperId, dir || settings.exportDir) };
});

handle('paper:import', async ({ raw, subject, grade }) => {
  const user = requireUser();
  const uid = user.id;
  const parsed = parseJsonLoose(raw);
  if (!parsed.ok) throw new Error('这不是合法的 JSON。请选择应用导出的试卷 JSON 文件（*.json）。');
  const paper = papersLib.normalizePaper(parsed.value, { subject, grade, source: 'imported' });
  store.savePaper(uid, paper, papersLib.summary(paper));
  let file = '';
  try {
    file = store.exportPaper(uid, paper.id, settingsOf(uid).exportDir);
  } catch {
    /* 导出失败不影响入库 */
  }
  return { paper, file };
});

/* ---------------- 全局 AI 对话（内置 pi Agent） ---------------- */

function agentContext(uid) {
  const settings = settingsOf(uid);
  return [
    '你是「问学」桌面应用内嵌的学习助手，运行在用户本机，可以直接读写文件、运行命令、使用工具。',
    `放题目录（用户放试卷的地方）：${settings.exportDir}`,
    '生成试卷时：写成一个 .json 文件放进放题目录的学科子文件夹（如 语文/、数学/），应用会自动收录。格式必须是：',
    '{"title","subject","grade","difficulty","totalScore","durationMinutes","instructions","sections":[{"name","passage","questions":[{"id","type","stem","passage","options","maxScore","referenceAnswer","rubric":[{"point","score"}],"knowledgePoints","difficulty"}]}]}',
    '其中 type 取 choice / multi_choice / fill_blank / short_answer / essay / translation / calculation / other；共用阅读材料只放在 section.passage，小题 passage 留空；totalScore 等于各小题 maxScore 之和。',
    '用户可能让你讲题、出卷、整理错题、制定学习计划、修改本地文件。按需调用工具把事做完，不要只说方案。',
    '回答用中文，简洁直接；改动了文件就说清路径。'
  ].join('\n');
}

handle('agent:chat', async ({ message, model, reset, runId } = {}) => {
  const uid = requireUser().id;
  const settings = settingsOf(uid);
  if (reset) {
    pi.resetSession(settings.agentSessionId);
    store.saveUserSettings(uid, { agentSessionId: '' });
    if (!String(message || '').trim()) return { text: '', sessionId: '', tools: [] };
  }
  const text = String(message || '').trim();
  if (!text) throw new Error('请输入内容');
  if (!settings.agentSessionId) {
    const fresh = store.rid('sess');
    store.saveUserSettings(uid, { agentSessionId: fresh });
  }
  const sessionId = settingsOf(uid).agentSessionId;

  const profile = store.activeProfile();
  const run = runId || store.rid('run');
  emit({ runId: run, scope: 'agent', type: 'start' });
  const result = await pi.runAgent({
    runId: run,
    profile,
    model: modelOf(profile, model || settings.defaultModel),
    baseDir: settings.exportDir,
    systemPrompt: agentContext(uid),
    prompt: text,
    timeoutMs: settings.timeoutMs,
    onEvent: (event) => emit({ runId: run, scope: 'agent', ...event })
  });
  emit({ runId: run, scope: 'agent', type: result.error ? 'failed' : 'done', error: result.error || '', text: result.text });
  if (result.error && !result.text) throw new Error(result.error);
  return { text: result.text, sessionId, tools: result.tools || [] };
});

/* ---------------- 作答 ---------------- */

handle('attempt:open', async ({ paperId }) => {
  const user = requireUser();
  const uid = user.id;
  const settings = settingsOf(uid);
  const paper = store.getPaper(uid, paperId);

  let attempt = store.activeAttempt(uid, paperId);
  if (!attempt) attempt = store.newAttempt(uid, paper, settings.defaultModel);
  if (!cleanModelName(attempt.model)) {
    attempt.model = '';
    store.saveAttempt(uid, paperId, attempt);
  }
  // 清理旧版遗留的自定义会话 ID
  let dirty = false;
  for (const qid of Object.keys(attempt.chatSessions || {})) {
    const sid = attempt.chatSessions[qid];
    if (typeof sid !== 'string' || sid.startsWith('ses_wx_')) {
      delete attempt.chatSessions[qid];
      dirty = true;
    }
  }
  if (dirty) store.saveAttempt(uid, paperId, attempt);
  store.touchPaper(uid, paperId);

  const chats = store.readAllChats(uid, paperId, attempt.id, paper.questions.map((q) => q.id));
  return { paper, attempt, chats, settings };
});

handle('attempt:new', async ({ paperId, model }) => {
  const user = requireUser();
  const uid = user.id;
  const paper = store.getPaper(uid, paperId);
  const attempt = store.newAttempt(uid, paper, cleanModelName(model));
  store.touchPaper(uid, paperId);
  return { paper, attempt, chats: {} };
});

handle('attempt:saveAnswer', async ({ paperId, attemptId, questionId, answer }) => {
  const user = requireUser();
  return store.setAnswer(user.id, paperId, attemptId, questionId, answer);
});

handle('attempt:setModel', async ({ paperId, attemptId, model }) => {
  const user = requireUser();
  return store.setModel(user.id, paperId, attemptId, model);
});

handle('attempt:finish', async ({ paperId, attemptId }) => {
  const user = requireUser();
  return store.finishAttempt(user.id, paperId, attemptId);
});

handle('attempt:history', async () => {
  const user = requireUser();
  return store.listHistory(user.id);
});

/* ---------------- AI：批改 / 讲解 / 对话 ---------------- */

handle('ai:grade', async ({ paperId, attemptId, questionId, model, runId }) => {
  const user = requireUser();
  const uid = user.id;
  const paper = store.getPaper(uid, paperId);
  const attempt = store.getAttempt(uid, paperId, attemptId);
  const { question } = findQuestion(paper, questionId);
  const answer = (attempt.answers[questionId] || {}).answer || '';
  const usedModel = modelOf(store.activeProfile(), model || attempt.model);

  if ((question.type === 'choice' || question.type === 'multi_choice') && settingsOf(uid).autoGradeChoice) {
    const grade = Object.assign(localGrade(question, answer, 'local'), { model: 'local', source: 'local' });
    store.setGrade(uid, paperId, attemptId, questionId, grade);
    emit({ runId: runId || 'local', scope: 'grade', questionId, type: 'done', text: grade.comment });
    return { grade };
  }

  const prompt = ai.buildGradePrompt(paper, question, answer);
  const result = await runAi({
    runId,
    model: usedModel,
    prompt,
    meta: { scope: 'grade', questionId, paperId, attemptId }
  });
  if (!result.ok) throw new Error(result.error || '批改失败');

  const grade = ai.parseGrade(result.text, question.maxScore);
  grade.model = usedModel;
  grade.source = 'ai';
  store.setGrade(uid, paperId, attemptId, questionId, grade);
  return { grade, raw: result.text };
});

handle('ai:chat', async ({ paperId, attemptId, questionId, model, text, kind, runId }) => {
  const user = requireUser();
  const uid = user.id;
  const paper = store.getPaper(uid, paperId);
  let attempt = store.getAttempt(uid, paperId, attemptId);
  const { question, index } = findQuestion(paper, questionId);
  const usedModel = modelOf(store.activeProfile(), model || attempt.model);
  const questionText = String(text || '').trim();
  if (!questionText) throw new Error('请输入要问的内容');

  const history = store.readChat(uid, paperId, attemptId, questionId);
  const answer = (attempt.answers[questionId] || {}).answer || '';
  const grade = attempt.grades[questionId] || null;
  const context = ai.buildQuestionContext(paper, question, index, paper.questions.length, answer, grade);
  const messages = history
    .filter((m) => m && String(m.content || '').trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content), timestamp: m.ts || Date.now() }));
  messages.push({ role: 'user', content: questionText, timestamp: Date.now() });

  store.appendChat(uid, paperId, attemptId, questionId, {
    role: 'user',
    kind: kind || 'chat',
    content: questionText,
    ts: Date.now()
  });

  const result = await runAi({
    runId,
    model: usedModel,
    systemPrompt: context,
    messages,
    meta: { scope: 'chat', questionId, paperId, attemptId, kind: kind || 'chat' }
  });

  const content = result.text || '';
  if (content.trim()) {
    store.appendChat(uid, paperId, attemptId, questionId, {
      role: 'assistant',
      kind: kind || 'chat',
      content,
      ts: Date.now(),
      model: usedModel,
      toolCalls: result.tools || [],
      partial: !result.ok
    });
  }
  if (!result.ok && !content.trim()) throw new Error(result.error || 'AI 没有返回内容');
  return { text: content, sessionId: '', runId: result.runId, error: result.ok ? '' : result.error || '' };
});

handle('ai:explain', async ({ paperId, attemptId, questionId, model, runId }) => {
  const user = requireUser();
  const uid = user.id;
  const paper = store.getPaper(uid, paperId);
  let attempt = store.getAttempt(uid, paperId, attemptId);
  const { question, index } = findQuestion(paper, questionId);
  const usedModel = modelOf(store.activeProfile(), model || attempt.model);
  const answer = (attempt.answers[questionId] || {}).answer || '';
  const grade = attempt.grades[questionId] || null;

  const prompt = ai.buildExplainPrompt(paper, question, answer, grade);
  store.appendChat(uid, paperId, attemptId, questionId, {
    role: 'user',
    kind: 'explain',
    content: '一键讲解这道题',
    ts: Date.now()
  });

  const result = await runAi({
    runId,
    model: usedModel,
    prompt,
    meta: { scope: 'chat', questionId, paperId, attemptId, kind: 'explain' }
  });
  const content = result.text || '';
  if (content.trim()) {
    store.appendChat(uid, paperId, attemptId, questionId, {
      role: 'assistant',
      kind: 'explain',
      content,
      ts: Date.now(),
      model: usedModel,
      toolCalls: result.tools || [],
      partial: !result.ok
    });
  }
  if (!result.ok && !content.trim()) throw new Error(result.error || '讲解失败');
  return { text: content, sessionId: '', runId: result.runId, error: result.ok ? '' : result.error || '' };
});

handle('ai:cancel', async ({ runId }) => ({ cancelled: pi.cancel(runId) }));

/* ---------------- 窗口 ---------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#F6F3ED',
    title: '问学 · AI 试卷练习',
    show: false,
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
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    pi.cancelAll();
    if (process.platform !== 'darwin') app.quit();
  });
}
