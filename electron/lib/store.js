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
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
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
    defaultModel: '',
    exportDir: path.join(app.getPath('documents'), '问学试卷'),
    timeoutMs: 180000,
    autoGradeChoice: true
  };
}

function readUserSettings(uid) {
  const saved = readJson(userSettingsFile(uid), {});
  const merged = Object.assign(defaultUserSettings(), saved);
  // 旧版遗留的默认模型统一清空，改为跟随接口配置
  if (/opencode|big-pickle/i.test(String(merged.defaultModel || ''))) {
    merged.defaultModel = '';
  }
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
    if (entry.isDirectory()) walkJsonFiles(full, out, depth + 1);
    else if (/\.json$/i.test(entry.name)) out.push(full);
  }
  return out;
}

let scanCache = { at: 0, dir: '', result: null };

// 扫描「放题文件夹」，把其中尚未入库的试卷 JSON 自动收录进试卷库
function syncPaperFolder(uid, { force = false } = {}) {
  const dir = path.resolve(readUserSettings(uid).exportDir);
  if (!force && scanCache.result && scanCache.dir === dir && Date.now() - scanCache.at < 8000) {
    return scanCache.result;
  }

  const files = walkJsonFiles(dir);
  const index = listPaperIndex(uid);
  const seenIds = new Set(index.map((p) => p.id));
  const seenKeys = new Set(index.map((p) => `${p.title}::${p.totalScore}::${p.questionCount}`));
  const added = [];
  let skipped = 0;

  for (const file of files) {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      skipped += 1;
      continue;
    }
    let paper = null;
    try {
      paper = papersLib.normalizePaper(raw);
    } catch {
      skipped += 1;
      continue;
    }
    if (!paper || !paper.questions.length) {
      skipped += 1;
      continue;
    }
    const key = `${paper.title}::${paper.totalScore}::${paper.questions.length}`;
    if (seenIds.has(paper.id) || seenKeys.has(key)) continue;

    paper.importedFrom = file;
    savePaper(uid, paper, papersLib.summary(paper, { importedFrom: file, lastOpenedAt: nowIso() }));
    seenIds.add(paper.id);
    seenKeys.add(key);
    added.push({ id: paper.id, title: paper.title, file });
  }

  const result = { dir, scanned: files.length, added: added.length, papers: added, skipped };
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

function setAnswer(uid, paperId, attemptId, questionId, answer) {
  const attempt = readJson(attemptFile(uid, paperId, attemptId), null);
  if (!attempt) throw new Error('作答记录不存在');
  attempt.answers[questionId] = { answer: answer == null ? '' : String(answer), updatedAt: nowIso() };
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
  syncPaperFolder,
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
  exportPaper,
  paperStats
};
