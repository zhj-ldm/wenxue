'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const papersLib = require('./papers');

let ROOT = null;

function root() {
  if (!ROOT) ROOT = path.join(app.getPath('userData'), 'data');
  return ROOT;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // 文件损坏时尝试从上次的备份恢复，避免整份会话/作答直接丢失
    try {
      return JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
    } catch {
      return fallback;
    }
  }
}

function writeJson(file, value, options = {}) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  if (options.backup !== false) {
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    } catch {
      /* 备份失败不影响正常写入 */
    }
  }
  fs.renameSync(tmp, file);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function rid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

/* ---------------- 全局设置 ---------------- */

function globalFile() {
  return path.join(root(), 'settings', 'global.json');
}

function defaultGlobal() {
  return {
    profiles: [],
    activeProfileId: '',
    lastUserId: null
  };
}

function readGlobalRaw() {
  return Object.assign(defaultGlobal(), readJson(globalFile(), {}));
}

function cleanProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    baseUrl: String(raw.baseUrl || ''),
    model: String(raw.model || ''),
    contextWindow: Number(raw.contextWindow) || 128000,
    maxTokens: Number(raw.maxTokens) || 8192,
    keyBox: raw.keyBox || null
  };
}

function readProfiles() {
  const raw = readGlobalRaw();
  const list = Array.isArray(raw.profiles) ? raw.profiles.map(cleanProfile).filter(Boolean) : [];
  return { profiles: list, activeProfileId: raw.activeProfileId || (list[0] ? list[0].id : '') };
}

function publicProfiles() {
  const { profiles, activeProfileId } = readProfiles();
  return {
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      contextWindow: p.contextWindow,
      maxTokens: p.maxTokens,
      hasKey: !!decryptSecret(p.keyBox)
    })),
    activeProfileId
  };
}

function activeProfile() {
  const { profiles, activeProfileId } = readProfiles();
  const p = profiles.find((item) => item.id === activeProfileId) || profiles[0];
  if (!p) throw new Error('还没有配置 AI 接口，请到「设置 → API 接口」添加一个');
  return decodeProfile(p);
}

function decodeProfile(p) {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    contextWindow: p.contextWindow,
    maxTokens: p.maxTokens,
    apiKey: decryptSecret(p.keyBox)
  };
}

function profileById(id) {
  const { profiles } = readProfiles();
  const p = profiles.find((item) => item.id === id);
  if (!p) throw new Error('接口配置不存在');
  return decodeProfile(p);
}

// 新增或更新一条接口配置；apiKey 留空表示保持原值
function saveProfile(patch = {}) {
  const raw = readGlobalRaw();
  const list = (Array.isArray(raw.profiles) ? raw.profiles : []).map(cleanProfile).filter(Boolean);
  const id = String(patch.id || '').trim() || rid('prov');
  const baseUrl = String(patch.baseUrl || '').trim();
  const model = String(patch.model || '').trim();
  if (!baseUrl) throw new Error('请填写 API 地址');
  if (!model) throw new Error('请填写模型名');
  const existing = list.find((p) => p.id === id);
  const next = {
    id,
    name: String(patch.name || '').trim() || model,
    baseUrl,
    model,
    contextWindow: Number(patch.contextWindow) || (existing ? existing.contextWindow : 128000),
    maxTokens: Number(patch.maxTokens) || (existing ? existing.maxTokens : 8192),
    keyBox: patch.apiKey ? encryptSecret(patch.apiKey) : existing ? existing.keyBox : null
  };
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  raw.profiles = list;
  if (!raw.activeProfileId || patch.active) raw.activeProfileId = id;
  writeJson(globalFile(), raw);
  return publicProfiles();
}

function deleteProfile(id) {
  const raw = readGlobalRaw();
  const list = (Array.isArray(raw.profiles) ? raw.profiles : []).map(cleanProfile).filter(Boolean);
  raw.profiles = list.filter((p) => p.id !== id);
  if (raw.activeProfileId === id) raw.activeProfileId = raw.profiles[0] ? raw.profiles[0].id : '';
  writeJson(globalFile(), raw);
  return publicProfiles();
}

function setActiveProfile(id) {
  const raw = readGlobalRaw();
  raw.activeProfileId = String(id || '');
  writeJson(globalFile(), raw);
  return publicProfiles();
}

// 说明：早期用 safeStorage（钥匙串）加密，但每次重新打包签名变化后系统会拒绝解密，
// 导致 Key 悄悄失效。这里改为写入本机配置文件（目录仅当前用户可读），保证跨版本可用。
function encryptSecret(value) {
  return { plain: String(value) };
}

function decryptSecret(box) {
  if (!box) return '';
  if (box.plain != null) return box.plain;
  try {
    return safeStorage.decryptString(Buffer.from(box.enc, 'base64'));
  } catch {
    return '';
  }
}

/* ---------------- 单用户（本机） ---------------------------- */

const LOCAL_UID = 'local';

function localUser() {
  return { id: LOCAL_UID, name: '本地用户', initial: '本', createdAt: null, lastLoginAt: null };
}

function usersFile() {
  return path.join(root(), 'users.json');
}

function listLegacyUsers() {
  const list = readJson(usersFile(), []);
  return Array.isArray(list) ? list : [];
}

// 把旧版「多账号」的数据合并进 local：试卷目录、设置、工作区。幂等，只在首次运行时生效。
function migrateLegacyUsers() {
  const localDir = userDir(LOCAL_UID);
  ensureDir(localDir);
  ensureDir(path.join(localDir, 'papers'));
  if (!fs.existsSync(paperIndexFile(LOCAL_UID))) writeJson(paperIndexFile(LOCAL_UID), []);

  const legacy = listLegacyUsers();
  if (!legacy.length) return { migrated: 0 };

  const index = listPaperIndex(LOCAL_UID);
  const seen = new Set(index.map((p) => p.id));

  // 设置沿用上次使用的账号
  const g = readGlobalRaw();
  const preferred =
    legacy.find((u) => u.id === g.lastUserId) ||
    legacy.slice().sort((a, b) => String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || '')))[0];
  if (preferred && !fs.existsSync(userSettingsFile(LOCAL_UID))) {
    const saved = readJson(userSettingsFile(preferred.id), null);
    if (saved) writeJson(userSettingsFile(LOCAL_UID), saved);
  }

  let migrated = 0;
  for (const user of legacy) {
    if (!user || user.id === LOCAL_UID) continue;
    const srcPapers = path.join(userDir(user.id), 'papers');
    let entries = [];
    try {
      entries = fs.readdirSync(srcPapers, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue;
    }
    const srcIndex = readJson(paperIndexFile(user.id), []);
    for (const entry of entries) {
      const paperId = entry.name;
      const target = paperDir(LOCAL_UID, paperId);
      const srcPaperDir = path.join(srcPapers, paperId);
      if (fs.existsSync(target)) {
        // 目录已存在（可能由「放题目录」扫描先写入），补合并缺失的作答记录
        const srcAttempts = path.join(srcPaperDir, 'attempts');
        if (fs.existsSync(srcAttempts)) {
          const dstAttempts = ensureDir(path.join(target, 'attempts'));
          for (const a of fs.readdirSync(srcAttempts, { withFileTypes: true })) {
            if (!a.isDirectory()) continue;
            const dst = path.join(dstAttempts, a.name);
            if (fs.existsSync(dst)) continue;
            try {
              fs.cpSync(path.join(srcAttempts, a.name), dst, { recursive: true });
            } catch {
              /* ignore */
            }
          }
        }
        continue;
      }
      try {
        fs.cpSync(srcPaperDir, target, { recursive: true, force: false, errorOnExist: false });
      } catch {
        continue;
      }
      const meta = Array.isArray(srcIndex) ? srcIndex.find((p) => p.id === paperId) : null;
      if (meta && !seen.has(meta.id)) {
        index.push(meta);
        seen.add(meta.id);
      }
      migrated += 1;
    }
  }
  writePaperIndex(LOCAL_UID, index);

  // 原始 users.json 留作备份，不直接删
  try {
    fs.renameSync(usersFile(), `${usersFile()}.merged-backup`);
  } catch {
    /* ignore */
  }
  return { migrated };
}

/* ---------------- 用户目录 ---------------- */

function userDir(uid) {
  return path.join(root(), 'users', String(uid).replace(/[^a-zA-Z0-9_-]/g, ''));
}

function workspaceDir(uid) {
  return ensureDir(path.join(app.getPath('userData'), 'workspace', String(uid).replace(/[^a-zA-Z0-9_-]/g, '')));
}

function userSettingsFile(uid) {
  return path.join(userDir(uid), 'settings.json');
}

function defaultUserSettings() {
  return {
    exportDir: path.join(app.getPath('documents'), '问学试卷'),
    timeoutMs: 180000,
    autoGradeChoice: true,
    searchCmd: '',
    thinkingLevel: 'medium'
  };
}

function readUserSettings(uid) {
  const saved = readJson(userSettingsFile(uid), {});
  const merged = Object.assign(defaultUserSettings(), saved);
  // 清理旧版本残留字段
  delete merged.defaultModel;
  delete merged.cliPath;
  return merged;
}

function saveUserSettings(uid, patch) {
  const merged = Object.assign(readUserSettings(uid), patch || {});
  if (merged.timeoutMs) merged.timeoutMs = Math.min(600000, Math.max(30000, Number(merged.timeoutMs) || 180000));
  writeJson(userSettingsFile(uid), merged);
  return merged;
}

/* ---------------- 试卷库 ---------------- */

function paperIndexFile(uid) {
  return path.join(userDir(uid), 'papers', 'index.json');
}

function papersDir(uid) {
  return path.join(userDir(uid), 'papers');
}

function paperDir(uid, paperId) {
  return path.join(papersDir(uid), String(paperId).replace(/[^a-zA-Z0-9_-]/g, ''));
}

function listPaperIndex(uid) {
  const list = readJson(paperIndexFile(uid), []);
  return Array.isArray(list) ? list : [];
}

function writePaperIndex(uid, list) {
  writeJson(paperIndexFile(uid), list);
}

function upsertPaperIndex(uid, summary) {
  const list = listPaperIndex(uid);
  const i = list.findIndex((p) => p.id === summary.id);
  if (i >= 0) list[i] = Object.assign({}, list[i], summary);
  else list.unshift(summary);
  writePaperIndex(uid, list);
  return summary;
}

function savePaper(uid, paper, summary) {
  writeJson(path.join(paperDir(uid, paper.id), 'paper.json'), paper);
  upsertPaperIndex(uid, summary);
  return paper;
}

function getPaper(uid, paperId) {
  const paper = readJson(path.join(paperDir(uid, paperId), 'paper.json'), null);
  if (!paper) throw new Error('试卷不存在或已被删除');
  return paper;
}

function deletePaper(uid, paperId) {
  const dir = paperDir(uid, paperId);
  fs.rmSync(dir, { recursive: true, force: true });
  writePaperIndex(uid, listPaperIndex(uid).filter((p) => p.id !== paperId));
  return true;
}

function touchPaper(uid, paperId) {
  const list = listPaperIndex(uid);
  const item = list.find((p) => p.id === paperId);
  if (item) {
    item.lastOpenedAt = nowIso();
    writePaperIndex(uid, list);
  }
}

/* ---------------- 外部放题目录（默认 文稿/问学试卷） ---------------- */

function walkJsonFiles(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const lower = entry.name.toLowerCase();
      // 作答与会话目录里也有 json，不能当载体扫描
      if (lower === 'attempts' || lower === 'chats' || lower === 'node_modules') continue;
      walkJsonFiles(full, out, depth + 1);
    } else if (/\.json$/i.test(entry.name)) out.push(full);
  }
  return out;
}

let scanCache = { at: 0, dir: '', result: null };

// 把放题目录里的一份 JSON 转成载体：带 kind/sections 的按载体解析，其余按旧试卷格式解析
function carrierFromFile(raw) {
  if (raw && (['paper', 'practice', 'plan'].includes(raw.kind) || raw.carrier)) {
    return papersLib.normalizeCarrier(raw.carrier || raw);
  }
  const paper = papersLib.normalizePaper(raw);
  const sections = (paper.sections || []).map((sec, i) => ({
    id: sec.id || `s${i + 1}`,
    name: sec.name || `第 ${i + 1} 部分`,
    passage: sec.passage || '',
    questions: sec.questionIds.map((qid) => paper.questions.find((q) => q.id === qid)).filter(Boolean)
  }));
  return papersLib.normalizeCarrier({
    kind: 'paper',
    title: paper.title,
    subject: paper.subject,
    grade: paper.grade,
    difficulty: paper.difficulty,
    totalScore: paper.totalScore,
    durationMinutes: paper.durationMinutes,
    instructions: paper.instructions,
    sections
  });
}

// 扫描「放题目录」，把尚未收录的题目自动导入为载体（试卷/练习/提升计划）
// 目录约定：<放题目录>/<学科>/<题目名>/paper.json（同目录下还有 attempts 与会话）
function syncCarrierFolder(uid, { force = false } = {}) {
  const dir = path.resolve(readUserSettings(uid).exportDir);
  if (!force && scanCache.result && scanCache.dir === dir && Date.now() - scanCache.at < 8000) {
    return scanCache.result;
  }

  const files = walkJsonFiles(dir);
  const existing = listCarriers(uid);
  const byKey = new Map(existing.map((c) => [`${c.title}::${c.totalScore}::${papersLib.carrierQuestions(c).length}`, c]));
  const added = [];
  let skipped = 0;

  for (const found of files) {
    let file = found;
    let homeDir = '';

    if (path.basename(file).toLowerCase() === 'paper.json') {
      homeDir = path.dirname(file);
    } else {
      // 旧格式的平铺 JSON：转成「同名文件夹/paper.json」，作答与题目就能放在一起
      const folder = path.join(path.dirname(file), safeFolderName(path.basename(file, path.extname(file))));
      const target = path.join(folder, 'paper.json');
      try {
        if (!fs.existsSync(target)) {
          ensureDir(folder);
          fs.renameSync(file, target);
        }
      } catch {
        skipped += 1;
        continue;
      }
      file = target;
      homeDir = folder;
    }

    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      skipped += 1;
      continue;
    }
    let carrier = null;
    try {
      carrier = carrierFromFile(raw);
    } catch {
      skipped += 1;
      continue;
    }
    const key = `${carrier.title}::${carrier.totalScore}::${papersLib.carrierQuestions(carrier).length}`;
    const hit = byKey.get(key);
    if (hit) {
      // 补记来源与文件夹，这样作答会写到题目旁边，删除时也能整夹删掉
      if (!hit.sourceFile || !hit.homeDir) {
        try {
          saveCarrier(uid, Object.assign({}, hit, { sourceFile: file, homeDir }));
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    try {
      carrier = saveCarrier(uid, Object.assign({}, carrier, { sourceFile: file, homeDir }));
    } catch {
      skipped += 1;
      continue;
    }
    byKey.set(key, carrier);
    added.push({ code: carrier.code, title: carrier.title, kind: carrier.kind, file });
  }

  const result = { dir, scanned: files.length, added: added.length, carriers: added, skipped };
  scanCache = { at: Date.now(), dir, result };
  return result;
}

/* ---------------- 作答记录 ---------------- */

function attemptsDir(uid, paperId) {
  return path.join(paperDir(uid, paperId), 'attempts');
}

function attemptDir(uid, paperId, attemptId) {
  return path.join(attemptsDir(uid, paperId), String(attemptId).replace(/[^a-zA-Z0-9_-]/g, ''));
}

function attemptFile(uid, paperId, attemptId) {
  return path.join(attemptDir(uid, paperId, attemptId), 'attempt.json');
}

function listAttemptIds(uid, paperId) {
  try {
    return fs
      .readdirSync(attemptsDir(uid, paperId), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function newAttempt(uid, paper, model) {
  const attempt = {
    id: rid('att'),
    paperId: paper.id,
    userId: uid,
    model: model || '',
    startedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    answers: {},
    grades: {},
    chatSessions: {},
    summary: null
  };
  writeJson(attemptFile(uid, paper.id, attempt.id), attempt);
  return attempt;
}

function latestAttempt(uid, paperId) {
  const ids = listAttemptIds(uid, paperId);
  if (!ids.length) return null;
  const all = ids
    .map((id) => readJson(attemptFile(uid, paperId, id), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return all[0] || null;
}

function activeAttempt(uid, paperId) {
  const latest = latestAttempt(uid, paperId);
  if (latest && !latest.finishedAt) return latest;
  return null;
}

function getAttempt(uid, paperId, attemptId) {
  const attempt = readJson(attemptFile(uid, paperId, attemptId), null);
  if (!attempt) throw new Error('作答记录不存在，请重新打开试卷');
  return attempt;
}

function saveAttempt(uid, paperId, attempt) {
  attempt.updatedAt = nowIso();
  writeJson(attemptFile(uid, paperId, attempt.id), attempt);
  return attempt;
}

function setAnswer(uid, paperId, attemptId, questionId, answer, blanks) {
  const attempt = readJson(attemptFile(uid, paperId, attemptId), null);
  if (!attempt) throw new Error('作答记录不存在');
  const record = { answer: answer == null ? '' : String(answer), updatedAt: nowIso() };
  if (blanks && typeof blanks === 'object') {
    record.blanks = Object.fromEntries(Object.entries(blanks).map(([k, v]) => [String(k), v == null ? '' : String(v)]));
  }
  attempt.answers[questionId] = record;
  return saveAttempt(uid, paperId, attempt);
}

function setModel(uid, paperId, attemptId, model) {
  const attempt = readJson(attemptFile(uid, paperId, attemptId), null);
  if (!attempt) throw new Error('作答记录不存在');
  attempt.model = String(model || '');
  return saveAttempt(uid, paperId, attempt);
}

function setGrade(uid, paperId, attemptId, questionId, grade) {
  const attempt = readJson(attemptFile(uid, paperId, attemptId), null);
  if (!attempt) throw new Error('作答记录不存在');
  attempt.grades[questionId] = grade;
  return saveAttempt(uid, paperId, attempt);
}

function finishAttempt(uid, paperId, attemptId) {
  const attempt = readJson(attemptFile(uid, paperId, attemptId), null);
  if (!attempt) throw new Error('作答记录不存在');
  const paper = getPaper(uid, paperId);
  let total = 0;
  let graded = 0;
  for (const q of paper.questions) {
    const g = attempt.grades[q.id];
    if (g && typeof g.score === 'number') {
      total += g.score;
      graded += 1;
    }
  }
  attempt.finishedAt = nowIso();
  attempt.summary = {
    total: Math.round(total * 10) / 10,
    max: paper.totalScore,
    graded,
    totalQuestions: paper.questions.length
  };
  return saveAttempt(uid, paperId, attempt);
}

/* ---------------- 每题对话 ---------------- */

function chatFile(uid, paperId, attemptId, questionId) {
  return path.join(attemptDir(uid, paperId, attemptId), 'chats', `${String(questionId).replace(/[^a-zA-Z0-9_-]/g, '')}.jsonl`);
}

function readChat(uid, paperId, attemptId, questionId) {
  const file = chatFile(uid, paperId, attemptId, questionId);
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function appendChat(uid, paperId, attemptId, questionId, message) {
  const file = chatFile(uid, paperId, attemptId, questionId);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(message)}\n`, 'utf8');
  return message;
}

function readAllChats(uid, paperId, attemptId, questionIds) {
  const out = {};
  for (const qid of questionIds) out[qid] = readChat(uid, paperId, attemptId, qid);
  return out;
}

/* ---------------- 历史 / 统计 ---------------- */

function paperStats(uid, paperId) {
  const latest = latestAttempt(uid, paperId);
  if (!latest) return { answered: 0, graded: 0, total: 0, max: null, status: 'new', updatedAt: null };
  const answered = Object.values(latest.answers || {}).filter((a) => a && String(a.answer || '').trim()).length;
  const grades = latest.grades || {};
  const graded = Object.keys(grades).length;
  const total = Object.values(grades).reduce((sum, g) => sum + (typeof g.score === 'number' ? g.score : 0), 0);
  return {
    answered,
    graded,
    total: Math.round(total * 10) / 10,
    max: latest.summary ? latest.summary.max : null,
    status: latest.finishedAt ? 'finished' : answered || graded ? 'doing' : 'new',
    updatedAt: latest.updatedAt
  };
}

function listPapers(uid) {
  return listPaperIndex(uid).map((p) => Object.assign({}, p, paperStats(uid, p.id)));
}

function listHistory(uid) {
  const out = [];
  for (const summary of listPaperIndex(uid)) {
    for (const attemptId of listAttemptIds(uid, summary.id)) {
      const attempt = readJson(attemptFile(uid, summary.id, attemptId), null);
      if (!attempt) continue;
      const answered = Object.values(attempt.answers || {}).filter((a) => a && String(a.answer || '').trim()).length;
      const grades = attempt.grades || {};
      const total = Object.values(grades).reduce((sum, g) => sum + (typeof g.score === 'number' ? g.score : 0), 0);
      out.push({
        paperId: summary.id,
        paperTitle: summary.title,
        subject: summary.subject,
        attemptId,
        model: attempt.model,
        startedAt: attempt.startedAt,
        updatedAt: attempt.updatedAt,
        finishedAt: attempt.finishedAt,
        answered,
        graded: Object.keys(grades).length,
        total: Math.round(total * 10) / 10,
        max: summary.totalScore
      });
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/* ---------------- 提升计划 / 每日任务 ---------------- */

function plansFile(uid) {
  return path.join(userDir(uid), 'plans.json');
}

function tasksDir(uid) {
  return ensureDir(path.join(userDir(uid), 'tasks'));
}

function taskFile(uid, taskId) {
  return path.join(tasksDir(uid), `${String(taskId).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
}

function todayStr(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function listPlans(uid) {
  const list = readJson(plansFile(uid), []);
  return Array.isArray(list) ? list : [];
}

function getPlan(uid, planId) {
  const plan = listPlans(uid).find((p) => p.id === planId);
  if (!plan) throw new Error('提升计划不存在');
  return plan;
}

function savePlan(uid, patch = {}) {
  const list = listPlans(uid);
  const now = nowIso();
  const id = String(patch.id || rid('plan'));
  const exist = list.find((p) => p.id === id);
  const plan = Object.assign(
    { id, title: '未命名计划', subject: '', goal: '', days: 0, createdAt: now },
    exist || {},
    patch,
    { id, updatedAt: now }
  );
  if (exist) list[list.indexOf(exist)] = plan;
  else list.unshift(plan);
  writeJson(plansFile(uid), list);
  return plan;
}

function deletePlan(uid, planId) {
  const list = listPlans(uid).filter((p) => p.id !== planId);
  writeJson(plansFile(uid), list);
  listTasks(uid)
    .filter((t) => t.planId === planId)
    .forEach((t) => deleteTask(uid, t.id));
  return true;
}

function normalizeTaskQuestions(rawQuestions) {
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  return list
    .map((q, i) => {
      if (!q || typeof q !== 'object') return null;
      const stem = String(q.stem || '').trim();
      const passage = String(q.passage || '').trim();
      const blanks = Array.isArray(q.blanks)
        ? q.blanks
            .map((b, bi) => {
              if (b == null) return null;
              if (typeof b === 'string') return { key: String(bi + 1), answer: b, maxScore: 0, width: 0 };
              return {
                key: String(b.key || b.id || bi + 1),
                answer: String(b.answer || b.referenceAnswer || ''),
                maxScore: Number(b.maxScore || b.score) || 0,
                width: Number(b.width) || 0
              };
            })
            .filter(Boolean)
        : [];
      if (!stem && !passage) return null;
      const options = Array.isArray(q.options)
        ? q.options
            .map((o) => (typeof o === 'string' ? { key: '', text: o } : { key: String(o.key || ''), text: String(o.text || '') }))
            .filter((o) => o.text)
        : [];
      return {
        id: String(q.id || `tq${i + 1}`),
        type: String(q.type || (blanks.length ? 'fill_blank' : options.length ? 'choice' : 'short_answer')),
        layout: String(q.layout || (blanks.length ? 'inline' : 'block')) === 'inline' ? 'inline' : 'block',
        stem,
        passage,
        blanks,
        options,
        maxScore: Number(q.maxScore) || 0,
        referenceAnswer: String(q.referenceAnswer || ''),
        rubric: Array.isArray(q.rubric) ? q.rubric : [],
        knowledgePoints: Array.isArray(q.knowledgePoints) ? q.knowledgePoints : [],
        difficulty: String(q.difficulty || '')
      };
    })
    .filter(Boolean);
}

function saveTask(uid, patch = {}) {
  const now = nowIso();
  const id = String(patch.id || rid('task'));
  const file = taskFile(uid, id);
  const exist = readJson(file, null);
  const questions = normalizeTaskQuestions(patch.questions || (exist && exist.questions));
  const task = Object.assign(
    {
      id,
      planId: '',
      title: '每日一练',
      date: todayStr(),
      subject: '',
      note: '',
      questions,
      answers: {},
      grades: {},
      createdAt: now
    },
    exist || {},
    patch,
    { id, questions, updatedAt: now }
  );
  if (!task.answers) task.answers = {};
  if (!task.grades) task.grades = {};
  writeJson(file, task);
  return task;
}

function listTasks(uid) {
  let names = [];
  try {
    names = fs.readdirSync(tasksDir(uid)).filter((n) => /\.json$/i.test(n));
  } catch {
    return [];
  }
  return names
    .map((n) => readJson(path.join(tasksDir(uid), n), null))
    .filter(Boolean)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getTask(uid, taskId) {
  const task = readJson(taskFile(uid, taskId), null);
  if (!task) throw new Error('任务不存在或已删除');
  return task;
}

function deleteTask(uid, taskId) {
  fs.rmSync(taskFile(uid, taskId), { force: true });
  fs.rmSync(path.join(tasksDir(uid), 'chats', String(taskId).replace(/[^a-zA-Z0-9_-]/g, '')), { recursive: true, force: true });
  return true;
}

function setTaskAnswer(uid, taskId, questionId, answer, blanks) {
  const task = getTask(uid, taskId);
  const record = { answer: answer == null ? '' : String(answer), updatedAt: nowIso() };
  if (blanks && typeof blanks === 'object') {
    record.blanks = Object.fromEntries(Object.entries(blanks).map(([k, v]) => [String(k), v == null ? '' : String(v)]));
  }
  task.answers[questionId] = record;
  return saveTask(uid, task);
}

function setTaskGrade(uid, taskId, questionId, grade) {
  const task = getTask(uid, taskId);
  task.grades[questionId] = grade;
  return saveTask(uid, task);
}

function finishTask(uid, taskId) {
  const task = getTask(uid, taskId);
  const ids = task.questions.map((q) => q.id);
  let score = 0;
  let max = 0;
  ids.forEach((qid) => {
    const q = task.questions.find((x) => x.id === qid);
    max += Number(q.maxScore) || 0;
    const g = task.grades[qid];
    if (g && typeof g.score === 'number') score += g.score;
  });
  task.completedAt = nowIso();
  task.summary = { score: Math.round(score * 10) / 10, max, graded: Object.keys(task.grades || {}).length, total: ids.length };
  return saveTask(uid, task);
}

function taskChatFile(uid, taskId, questionId) {
  const dir = ensureDir(path.join(tasksDir(uid), 'chats', String(taskId).replace(/[^a-zA-Z0-9_-]/g, '')));
  return path.join(dir, `${String(questionId).replace(/[^a-zA-Z0-9_-]/g, '')}.jsonl`);
}

function readTaskChat(uid, taskId, questionId) {
  try {
    return fs
      .readFileSync(taskChatFile(uid, taskId, questionId), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function appendTaskChat(uid, taskId, questionId, message) {
  fs.appendFileSync(taskChatFile(uid, taskId, questionId), `${JSON.stringify(message)}\n`, 'utf8');
  return message;
}

/* ---------------- AI 对话会话 ---------------- */

function conversationsFile(uid) {
  return path.join(userDir(uid), 'conversations.json');
}

function listConversations(uid) {
  const list = readJson(conversationsFile(uid), []);
  return Array.isArray(list) ? list : [];
}

function getConversation(uid, id) {
  const conv = listConversations(uid).find((c) => c.id === id);
  if (!conv) throw new Error('对话不存在或已删除');
  return conv;
}

function saveConversation(uid, patch = {}) {
  const list = listConversations(uid);
  const now = nowIso();
  const id = String(patch.id || rid('conv'));
  const exist = list.find((c) => c.id === id);
  const conv = Object.assign(
    { id, title: '新对话', messages: [], createdAt: now },
    exist || {},
    patch,
    { id, updatedAt: now }
  );
  if (!Array.isArray(conv.messages)) conv.messages = [];
  if (conv.messages.length > 400) conv.messages = conv.messages.slice(-400);
  if (exist) list[list.indexOf(exist)] = conv;
  else list.unshift(conv);
  writeJson(conversationsFile(uid), list);
  return conv;
}

function appendConversationMessage(uid, id, message) {
  const conv = getConversation(uid, id);
  conv.messages.push(message);
  return saveConversation(uid, conv);
}

function deleteConversation(uid, id) {
  const list = listConversations(uid).filter((c) => c.id !== id);
  writeJson(conversationsFile(uid), list);
  return true;
}

function listConversationBriefs(uid) {
  return listConversations(uid)
    .map((c) => {
      const messages = Array.isArray(c.messages) ? c.messages : [];
      const last = [...messages].reverse().find((m) => String(m.text || '').trim());
      return {
        id: c.id,
        title: c.title || '新对话',
        updatedAt: c.updatedAt || c.createdAt,
        messageCount: messages.length,
        preview: last ? String(last.text).replace(/\s+/g, ' ').slice(0, 60) : ''
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/* ---------------- 统一载体（试卷 / 练习 / 提升计划） ---------------- */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function carriersRoot(uid) {
  return ensureDir(path.join(userDir(uid), 'carriers'));
}

function carrierDir(uid, code) {
  return path.join(carriersRoot(uid), String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase());
}

function carrierFile(uid, code) {
  return path.join(carrierDir(uid, code), 'carrier.json');
}

/* ---- 载体在放题目录中的「家」：<学科>/<题目名>/paper.json + attempts/ ---- */

function exportRoot(uid) {
  return path.resolve(readUserSettings(uid).exportDir);
}

function isInsideExportRoot(uid, absPath) {
  try {
    const root = exportRoot(uid);
    const target = path.resolve(absPath);
    return target === root || target.startsWith(`${root}${path.sep}`);
  } catch {
    return false;
  }
}

function safeFolderName(value) {
  const cleaned = String(value || '')
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned.slice(0, 80) || '未命名';
}

function codeOf(carrier) {
  return String((carrier && carrier.code) || '').toUpperCase();
}

// 选定载体文件夹；重名时加编号区分
function pickCarrierHome(uid, carrier) {
  const existing = String((carrier && carrier.homeDir) || '').trim();
  if (existing) return existing;
  const root = exportRoot(uid);
  const base = path.join(
    root,
    safeFolderName((carrier && carrier.subject) || '综合'),
    safeFolderName((carrier && carrier.title) || '未命名')
  );
  const code = codeOf(carrier);
  let home = base;
  for (let i = 0; i < 30 && fs.existsSync(home); i += 1) {
    const owner = readJson(path.join(home, 'paper.json'), null);
    if (!owner || codeOf(owner) === code) break;
    home = `${base} (${code || i + 1})`;
  }
  return home;
}

function carrierHomeDir(uid, carrier) {
  return ensureDir(pickCarrierHome(uid, carrier));
}

// 把载体正文同步一份到题目文件夹，并记住位置
function exportCarrierFile(uid, carrier) {
  const home = carrierHomeDir(uid, carrier);
  const file = path.join(home, 'paper.json');
  // 题目正文的权威副本在应用数据里，这里的 paper.json 不需要 .bak
  writeJson(file, Object.assign({}, carrier, { homeDir: home, sourceFile: file }), { backup: false });
  try {
    fs.rmSync(`${file}.bak`, { force: true });
  } catch {
    /* ignore */
  }
  if (String(carrier.homeDir || '') !== home || String(carrier.sourceFile || '') !== file) {
    carrier.homeDir = home;
    carrier.sourceFile = file;
    writeJson(carrierFile(uid, carrier.code), carrier);
  }
  return file;
}

function newCarrierCode(uid) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    if (!fs.existsSync(carrierDir(uid, code))) return code;
  }
  throw new Error('生成载体编号失败，请重试');
}

function listCarriers(uid) {
  let names = [];
  try {
    names = fs.readdirSync(carriersRoot(uid)).filter((n) => fs.existsSync(path.join(carriersRoot(uid), n, 'carrier.json')));
  } catch {
    return [];
  }
  return names
    .map((n) => readJson(path.join(carriersRoot(uid), n, 'carrier.json'), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function getCarrier(uid, code) {
  const carrier = readJson(carrierFile(uid, code), null);
  if (!carrier) throw new Error('载体不存在或已删除');
  return carrier;
}

function saveCarrier(uid, patch = {}) {
  const exist = patch.code ? readJson(carrierFile(uid, patch.code), null) : null;
  const code = String(patch.code || (exist && exist.code) || newCarrierCode(uid)).toUpperCase();
  const carrier = papersLib.normalizeCarrier(
    Object.assign({}, exist || {}, patch, { code, createdAt: (exist && exist.createdAt) || patch.createdAt || nowIso() })
  );
  writeJson(carrierFile(uid, code), carrier);
  // 同时维护放题目录里的文件夹，让题目与作答始终在一起
  try {
    exportCarrierFile(uid, carrier);
  } catch {
    /* 放题目录不可写时不阻塞内部保存 */
  }
  return carrier;
}

function deleteCarrier(uid, code) {
  const carrier = readJson(carrierFile(uid, code), null);
  // 优先整夹删除；没有 homeDir 的老数据再退回删源文件
  if (carrier && carrier.homeDir) {
    try {
      const home = path.resolve(carrier.homeDir);
      if (isInsideExportRoot(uid, home)) fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* 删除失败不影响后面的内部清理 */
    }
  } else if (carrier && carrier.sourceFile) {
    try {
      const abs = path.resolve(carrier.sourceFile);
      if (isInsideExportRoot(uid, abs) && /\.json$/i.test(abs)) fs.rmSync(abs, { force: true });
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(carrierDir(uid, code), { recursive: true, force: true });
  return true;
}

/* ---------------- 载体作答 ---------------- */

function carrierAttemptsDir(uid, code) {
  const carrier = getCarrier(uid, code);
  let base;
  try {
    base = carrier.homeDir ? carrierHomeDir(uid, carrier) : path.dirname(exportCarrierFile(uid, carrier));
  } catch {
    // 放题目录不可用时退回内部目录，至少不丢作答
    base = carrierDir(uid, code);
  }
  return ensureDir(path.join(base, 'attempts'));
}

function listCarrierAttemptIds(uid, code) {
  try {
    return fs
      .readdirSync(carrierAttemptsDir(uid, code))
      .filter((n) => fs.existsSync(path.join(carrierAttemptsDir(uid, code), n, 'attempt.json')));
  } catch {
    return [];
  }
}

function newCarrierAttempt(uid, code) {
  const carrier = getCarrier(uid, code);
  const attempt = {
    id: rid('att'),
    carrierCode: carrier.code,
    kind: carrier.kind,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    finishedAt: null,
    answers: {},
    grades: {},
    chatSessions: {},
    summary: null
  };
  writeJson(path.join(carrierAttemptsDir(uid, code), attempt.id, 'attempt.json'), attempt);
  return attempt;
}

function latestCarrierAttempt(uid, code) {
  const ids = listCarrierAttemptIds(uid, code);
  if (!ids.length) return null;
  return (
    ids
      .map((id) => readJson(path.join(carrierAttemptsDir(uid, code), id, 'attempt.json'), null))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null
  );
}

function activeCarrierAttempt(uid, code) {
  const latest = latestCarrierAttempt(uid, code);
  if (latest && !latest.finishedAt) return latest;
  return newCarrierAttempt(uid, code);
}

function getCarrierAttempt(uid, code, attemptId) {
  const attempt = readJson(path.join(carrierAttemptsDir(uid, code), String(attemptId), 'attempt.json'), null);
  if (!attempt) throw new Error('作答记录不存在');
  return attempt;
}

function saveCarrierAttempt(uid, code, attempt) {
  attempt.updatedAt = nowIso();
  writeJson(path.join(carrierAttemptsDir(uid, code), attempt.id, 'attempt.json'), attempt);
  return attempt;
}

function setCarrierAnswer(uid, code, attemptId, questionId, answer, blanks) {
  const attempt = getCarrierAttempt(uid, code, attemptId);
  const record = { answer: answer == null ? '' : String(answer), updatedAt: nowIso() };
  if (blanks && typeof blanks === 'object') {
    record.blanks = Object.fromEntries(Object.entries(blanks).map(([k, v]) => [String(k), v == null ? '' : String(v)]));
  }
  attempt.answers[questionId] = record;
  return saveCarrierAttempt(uid, code, attempt);
}

function setCarrierGrade(uid, code, attemptId, questionId, grade) {
  const attempt = getCarrierAttempt(uid, code, attemptId);
  attempt.grades[questionId] = grade;
  return saveCarrierAttempt(uid, code, attempt);
}

function finishCarrierAttempt(uid, code, attemptId) {
  const attempt = getCarrierAttempt(uid, code, attemptId);
  const carrier = getCarrier(uid, code);
  const questions = papersLib.carrierQuestions(carrier).map((x) => x.question);
  let total = 0;
  let graded = 0;
  questions.forEach((q) => {
    const g = attempt.grades[q.id];
    if (g && typeof g.score === 'number') {
      total += g.score;
      graded += 1;
    }
  });
  attempt.finishedAt = nowIso();
  attempt.summary = {
    total: Math.round(total * 10) / 10,
    max: carrier.totalScore,
    graded,
    totalQuestions: questions.length
  };
  return saveCarrierAttempt(uid, code, attempt);
}

/* ---------------- 载体对话 ---------------- */

function carrierChatFile(uid, code, attemptId, questionId) {
  return path.join(
    carrierAttemptsDir(uid, code),
    String(attemptId),
    'chats',
    `${String(questionId).replace(/[^a-zA-Z0-9_-]/g, '')}.jsonl`
  );
}

function readCarrierChat(uid, code, attemptId, questionId) {
  try {
    return fs
      .readFileSync(carrierChatFile(uid, code, attemptId, questionId), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function appendCarrierChat(uid, code, attemptId, questionId, message) {
  const file = carrierChatFile(uid, code, attemptId, questionId);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(message)}\n`, 'utf8');
  return message;
}

function carrierGlobalChatFile(uid, code) {
  const carrier = getCarrier(uid, code);
  let base;
  try {
    base = carrier.homeDir ? carrierHomeDir(uid, carrier) : path.dirname(exportCarrierFile(uid, carrier));
  } catch {
    base = carrierDir(uid, code);
  }
  return path.join(base, 'global-chat.jsonl');
}

function readCarrierGlobalChat(uid, code) {
  try {
    return fs
      .readFileSync(carrierGlobalChatFile(uid, code), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function appendCarrierGlobalChat(uid, code, message) {
  const file = carrierGlobalChatFile(uid, code);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(message)}\n`, 'utf8');
  return message;
}

/* ---------------- 每日任务聚合 ---------------- */

function carrierQuestionDate(section, question) {
  return String((question && question.date) || (section && section.date) || '').trim();
}

function carrierProgress(uid, carrier) {
  const attempt = latestCarrierAttempt(uid, carrier.code);
  const questions = papersLib.carrierQuestions(carrier);
  let answered = 0;
  questions.forEach(({ question }) => {
    if (String(((attempt && attempt.answers && attempt.answers[question.id]) || {}).answer || '').trim()) answered += 1;
  });
  return {
    questionCount: questions.length,
    answered,
    totalScore: carrier.totalScore,
    finishedAt: attempt ? attempt.finishedAt : null,
    summary: attempt ? attempt.summary : null
  };
}

function listCarrierBriefs(uid, kind = '') {
  return listCarriers(uid)
    .filter((c) => !kind || c.kind === kind)
    .map((c) => papersLib.carrierSummary(c, carrierProgress(uid, c)));
}

function listCarrierHistory(uid) {
  const out = [];
  listCarriers(uid).forEach((carrier) => {
    listCarrierAttemptIds(uid, carrier.code).forEach((attemptId) => {
      const attempt = readJson(path.join(carrierAttemptsDir(uid, carrier.code), attemptId, 'attempt.json'), null);
      if (!attempt) return;
      const answers = attempt.answers || {};
      const grades = attempt.grades || {};
      let total = 0;
      Object.values(grades).forEach((g) => {
        if (g && typeof g.score === 'number') total += g.score;
      });
      out.push({
        code: carrier.code,
        kind: carrier.kind,
        title: carrier.title,
        subject: carrier.subject,
        attemptId,
        startedAt: attempt.startedAt,
        updatedAt: attempt.updatedAt,
        finishedAt: attempt.finishedAt,
        answered: Object.values(answers).filter((a) => String((a || {}).answer || '').trim()).length,
        graded: Object.keys(grades).length,
        total: Math.round(total * 10) / 10,
        max: carrier.totalScore
      });
    });
  });
  return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function carrierDaily(uid, date) {
  const today = date || todayStr();
  const items = [];
  listCarriers(uid).forEach((carrier) => {
    const attempt = latestCarrierAttempt(uid, carrier.code);
    const due = [];
    papersLib.carrierQuestions(carrier).forEach(({ question, section }) => {
      const day = carrierQuestionDate(section, question);
      if (!day || day > today) return;
      const answered = String(((attempt && attempt.answers && attempt.answers[question.id]) || {}).answer || '').trim().length > 0;
      due.push({ question, section, day, answered });
    });
    if (!due.length) return;
    const pending = due.filter((x) => !x.answered);
    items.push({
      code: carrier.code,
      kind: carrier.kind,
      title: carrier.title,
      subject: carrier.subject,
      goal: carrier.goal,
      date: today,
      questionIds: due.map((x) => x.question.id),
      pendingIds: pending.map((x) => x.question.id),
      doneIds: due.filter((x) => x.answered).map((x) => x.question.id),
      total: due.length,
      done: due.length - pending.length
    });
  });
  return {
    today,
    pending: items.filter((i) => i.pendingIds.length),
    done: items.filter((i) => !i.pendingIds.length)
  };
}

/* ---------------- 旧数据迁移到载体 ---------------- */

function migrationMarker(uid) {
  return path.join(userDir(uid), 'migrated-carriers-v2.json');
}

function migrateToCarriers(uid) {
  if (fs.existsSync(migrationMarker(uid))) return { migrated: false };
  ensureDir(carriersRoot(uid));
  const created = [];

  // 1) 旧试卷
  try {
    listPaperIndex(uid).forEach((summary) => {
      try {
        const paper = getPaper(uid, summary.id);
        const qById = new Map((paper.questions || []).map((q) => [q.id, q]));
        const sections = (paper.sections || []).map((section, si) => ({
          id: `s${si + 1}`,
          name: section.name || `第 ${si + 1} 部分`,
          passage: section.passage || '',
          date: '',
          questions: (section.questionIds || []).map((qid) => qById.get(qid)).filter(Boolean)
        }));
        const carrier = saveCarrier(uid, {
          kind: 'paper',
          title: paper.title,
          subject: paper.subject,
          grade: paper.grade,
          difficulty: paper.difficulty,
          instructions: paper.instructions,
          durationMinutes: paper.durationMinutes,
          createdAt: paper.createdAt,
          sections
        });
        const srcAttempts = path.join(userDir(uid), 'papers', paper.id, 'attempts');
        if (fs.existsSync(srcAttempts)) {
          fs.cpSync(srcAttempts, path.join(carrierDir(uid, carrier.code), 'attempts'), { recursive: true });
        }
        created.push(carrier.code);
      } catch {
        /* 单套失败不影响其它 */
      }
    });
  } catch {
    /* ignore */
  }

  // 2) 旧计划 + 3) 独立每日任务
  let tasks = [];
  try {
    tasks = listTasks(uid);
  } catch {
    tasks = [];
  }
  const plans = listPlans(uid);
  plans.forEach((plan) => {
    const own = tasks.filter((t) => t.planId === plan.id).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!own.length) return;
    const sections = [];
    const answers = {};
    const grades = {};
    const chatCopies = [];
    own.forEach((task, ti) => {
      const prefix = `t${ti + 1}_`;
      const questions = (task.questions || []).map((q) => {
        const id = `${prefix}${q.id}`;
        if (task.answers[q.id]) answers[id] = task.answers[q.id];
        if (task.grades[q.id]) grades[id] = task.grades[q.id];
        chatCopies.push({ oldTaskId: task.id, oldQid: q.id, newQid: id });
        return Object.assign({}, q, { id, date: task.date });
      });
      sections.push({
        id: `s${ti + 1}`,
        name: task.title || `第 ${ti + 1} 天`,
        passage: '',
        date: task.date,
        questions
      });
    });
    try {
      const carrier = saveCarrier(uid, {
        kind: 'plan',
        title: plan.title,
        subject: plan.subject,
        goal: plan.goal,
        createdAt: plan.createdAt,
        sections
      });
      const attempt = {
        id: rid('att'),
        carrierCode: carrier.code,
        kind: 'plan',
        startedAt: plan.createdAt || nowIso(),
        updatedAt: nowIso(),
        finishedAt: null,
        answers,
        grades,
        chatSessions: {},
        summary: null
      };
      writeJson(path.join(carrierAttemptsDir(uid, carrier.code), attempt.id, 'attempt.json'), attempt);
      chatCopies.forEach(({ oldTaskId, oldQid, newQid }) => {
        const src = path.join(userDir(uid), 'tasks', 'chats', oldTaskId, `${oldQid}.jsonl`);
        if (!fs.existsSync(src)) return;
        const dest = carrierChatFile(uid, carrier.code, attempt.id, newQid);
        ensureDir(path.dirname(dest));
        fs.copyFileSync(src, dest);
      });
      created.push(carrier.code);
    } catch {
      /* ignore */
    }
  });

  tasks
    .filter((t) => !t.planId)
    .forEach((task) => {
      try {
        const carrier = saveCarrier(uid, {
          kind: 'practice',
          title: task.title,
          subject: task.subject,
          createdAt: task.createdAt,
          sections: [
            {
              id: 's1',
              name: task.title,
              passage: '',
              date: task.date,
              questions: (task.questions || []).map((q) => Object.assign({}, q, { date: task.date }))
            }
          ]
        });
        const attempt = {
          id: rid('att'),
          carrierCode: carrier.code,
          kind: 'practice',
          startedAt: task.createdAt || nowIso(),
          updatedAt: nowIso(),
          finishedAt: task.completedAt || null,
          answers: task.answers || {},
          grades: task.grades || {},
          chatSessions: {},
          summary: task.summary || null
        };
        writeJson(path.join(carrierAttemptsDir(uid, carrier.code), attempt.id, 'attempt.json'), attempt);
        (task.questions || []).forEach((q) => {
          const src = path.join(userDir(uid), 'tasks', 'chats', task.id, `${q.id}.jsonl`);
          if (!fs.existsSync(src)) return;
          const dest = carrierChatFile(uid, carrier.code, attempt.id, q.id);
          ensureDir(path.dirname(dest));
          fs.copyFileSync(src, dest);
        });
        created.push(carrier.code);
      } catch {
        /* ignore */
      }
    });

  writeJson(migrationMarker(uid), { migratedAt: nowIso(), codes: created });
  return { migrated: true, count: created.length, codes: created };
}

/* ---------------- 迁移：把作答搬进题目文件夹 ---------------- */

function homeMigrationMarker(uid) {
  return path.join(userDir(uid), 'migrated-carrier-homes-v1.json');
}

// 每套题在放题目录里一个文件夹：paper.json + attempts + 会话。
// 旧数据（题目平铺 JSON、内部 attempts）会复制到新位置，原始文件保留作备份。
function migrateCarrierHomes(uid) {
  if (fs.existsSync(homeMigrationMarker(uid))) return { migrated: false };

  const moved = [];
  listCarriers(uid).forEach((carrier) => {
    try {
      const code = codeOf(carrier);
      let home = String(carrier.homeDir || '').trim();
      let source = String(carrier.sourceFile || '').trim();

      if (!home) {
        if (source && isInsideExportRoot(uid, source)) {
          if (path.basename(source).toLowerCase() === 'paper.json') {
            home = path.dirname(source);
          } else {
            const folder = path.join(path.dirname(source), safeFolderName(path.basename(source, path.extname(source))));
            const target = path.join(folder, 'paper.json');
            home = folder;
            try {
              if (!fs.existsSync(target)) {
                ensureDir(folder);
                fs.renameSync(source, target);
              }
            } catch {
              /* 移动失败就用原目录 */
            }
          }
        } else {
          home = pickCarrierHome(uid, carrier);
        }
      }

      ensureDir(home);

      // 旧作答：复制到题目文件夹，内部原件保留，避免任何丢失
      const legacyAttempts = path.join(carrierDir(uid, code), 'attempts');
      const homeAttempts = path.join(home, 'attempts');
      if (fs.existsSync(legacyAttempts)) {
        ensureDir(homeAttempts);
        fs.readdirSync(legacyAttempts, { withFileTypes: true }).forEach((entry) => {
          if (!entry.isDirectory()) return;
          const from = path.join(legacyAttempts, entry.name);
          const to = path.join(homeAttempts, entry.name);
          if (fs.existsSync(to)) return;
          try {
            fs.cpSync(from, to, { recursive: true });
          } catch {
            /* 单条失败不影响其它 */
          }
        });
      }

      const legacyGlobal = path.join(carrierDir(uid, code), 'global-chat.jsonl');
      const homeGlobal = path.join(home, 'global-chat.jsonl');
      if (fs.existsSync(legacyGlobal) && !fs.existsSync(homeGlobal)) {
        try {
          fs.copyFileSync(legacyGlobal, homeGlobal);
        } catch {
          /* ignore */
        }
      }

      saveCarrier(uid, Object.assign({}, carrier, {
        code,
        homeDir: home,
        sourceFile: path.join(home, 'paper.json')
      }));
      moved.push(code);
    } catch {
      /* 单套失败不影响启动 */
    }
  });

  writeJson(homeMigrationMarker(uid), { migratedAt: nowIso(), codes: moved });
  return { migrated: true, count: moved.length, codes: moved };
}

/* ---------------- 导出 ---------------- */

function exportPaper(uid, paperId, dir) {
  const paper = getPaper(uid, paperId);
  const target = path.resolve(dir || readUserSettings(uid).exportDir);
  const subjectDir = path.join(target, paper.subject || '未分类');
  ensureDir(subjectDir);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeTitle = String(paper.title || '试卷').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const file = path.join(subjectDir, `${stamp}-${safeTitle}.json`);
  writeJson(file, paper);
  return file;
}

function init() {
  ensureDir(root());
  ensureDir(path.join(root(), 'settings'));
  ensureDir(path.join(root(), 'users'));
  if (!fs.existsSync(globalFile())) writeJson(globalFile(), defaultGlobal());
  migrateLegacyUsers();
}

module.exports = {
  init,
  root,
  rid,
  nowIso,
  readGlobalRaw,
  readProfiles,
  publicProfiles,
  activeProfile,
  profileById,
  saveProfile,
  deleteProfile,
  setActiveProfile,
  listLegacyUsers,
  localUser,
  migrateLegacyUsers,
  syncCarrierFolder,
  readUserSettings,
  saveUserSettings,
  userDir,
  workspaceDir,
  listPapers,
  getPaper,
  savePaper,
  deletePaper,
  touchPaper,
  upsertPaperIndex,
  listPaperIndex,
  newAttempt,
  latestAttempt,
  activeAttempt,
  getAttempt,
  saveAttempt,
  setAnswer,
  setModel,
  setGrade,
  finishAttempt,
  readChat,
  appendChat,
  readAllChats,
  listHistory,
  listPlans,
  getPlan,
  savePlan,
  deletePlan,
  listTasks,
  getTask,
  saveTask,
  deleteTask,
  setTaskAnswer,
  setTaskGrade,
  finishTask,
  readTaskChat,
  appendTaskChat,
  listConversations,
  getConversation,
  saveConversation,
  appendConversationMessage,
  deleteConversation,
  listConversationBriefs,
  listCarriers,
  getCarrier,
  saveCarrier,
  deleteCarrier,
  newCarrierCode,
  listCarrierBriefs,
  listCarrierHistory,
  carrierDaily,
  carrierQuestionDate,
  activeCarrierAttempt,
  latestCarrierAttempt,
  listCarrierAttemptIds,
  getCarrierAttempt,
  saveCarrierAttempt,
  newCarrierAttempt,
  setCarrierAnswer,
  setCarrierGrade,
  finishCarrierAttempt,
  readCarrierChat,
  appendCarrierChat,
  readCarrierGlobalChat,
  appendCarrierGlobalChat,
  migrateToCarriers,
  migrateCarrierHomes,
  todayStr,
  exportPaper,
  paperStats
};
