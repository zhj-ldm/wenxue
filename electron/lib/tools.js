'use strict';

// pi Agent 的四个工具：read / write / edit / bash
// 与 pi 官方 coding agent 保持一致的极简工具集，全部限制在用户目录内。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const MAX_READ = 200 * 1024;
const MAX_OUTPUT = 64 * 1024;

function resolvePath(input, baseDir) {
  let p = String(input || '').trim();
  if (!p) throw new Error('缺少路径');
  if (p === '~') p = os.homedir();
  else if (p.startsWith('~/')) p = path.join(os.homedir(), p.slice(2));
  const abs = path.resolve(baseDir || os.homedir(), p);
  const home = os.homedir();
  if (abs !== home && !abs.startsWith(home + path.sep)) {
    throw new Error(`只能访问用户目录内的文件：${abs}`);
  }
  return abs;
}

function truncate(text, max = MAX_OUTPUT) {
  const s = String(text == null ? '' : text);
  return s.length > max ? `${s.slice(0, max)}\n…（已截断，共 ${s.length} 字符）` : s;
}

function listDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
    .sort()
    .join('\n');
}

function makeTools(baseDir) {
  const read = {
    name: 'read',
    label: 'Read',
    description: '读取文件内容。path 可为绝对路径或相对放题目录的路径；path 指向目录时列出目录内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录路径' },
        offset: { type: 'number', description: '起始行号（从 1 开始，可选）' },
        limit: { type: 'number', description: '最多读取的行数（可选）' }
      },
      required: ['path']
    },
    executionMode: 'parallel',
    execute: async (_id, params) => {
      const abs = resolvePath(params.path, baseDir);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        return { content: [{ type: 'text', text: `${abs}\n${listDir(abs) || '（空目录）'}` }], details: { path: abs } };
      }
      if (stat.size > MAX_READ) {
        throw new Error(`文件过大（${Math.round(stat.size / 1024)} KB），请用 offset/limit 分段读取`);
      }
      const raw = fs.readFileSync(abs, 'utf8');
      let text = raw;
      const offset = Math.max(0, Number(params.offset || 0) - 1);
      const limit = Number(params.limit || 0);
      if (offset || limit) {
        const lines = raw.split('\n');
        text = lines.slice(offset, limit ? offset + limit : undefined).join('\n');
      }
      return {
        content: [{ type: 'text', text: truncate(`${abs}\n${text}`) }],
        details: { path: abs, size: stat.size }
      };
    }
  };

  const write = {
    name: 'write',
    label: 'Write',
    description: '写入文件（覆盖）。目录不存在会自动创建。path 可为绝对路径或相对放题目录的路径。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '完整文件内容' }
      },
      required: ['path', 'content']
    },
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const abs = resolvePath(params.path, baseDir);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(params.content == null ? '' : params.content), 'utf8');
      return { content: [{ type: 'text', text: `已写入 ${abs}` }], details: { path: abs } };
    }
  };

  const edit = {
    name: 'edit',
    label: 'Edit',
    description: '按原文精确替换文件中的一段文本，oldText 必须在文件中唯一存在。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        oldText: { type: 'string', description: '要被替换的原文' },
        newText: { type: 'string', description: '替换后的文本' }
      },
      required: ['path', 'oldText', 'newText']
    },
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const abs = resolvePath(params.path, baseDir);
      const raw = fs.readFileSync(abs, 'utf8');
      const oldText = String(params.oldText || '');
      if (!oldText) throw new Error('oldText 不能为空');
      const count = raw.split(oldText).length - 1;
      if (count === 0) throw new Error('文件里找不到这段原文');
      if (count > 1) throw new Error(`原文在文件中出现 ${count} 次，请提供更长的唯一片段`);
      fs.writeFileSync(abs, raw.replace(oldText, String(params.newText || '')), 'utf8');
      return { content: [{ type: 'text', text: `已修改 ${abs}` }], details: { path: abs } };
    }
  };

  const bash = {
    name: 'bash',
    label: 'Bash',
    description: '在放题目录下执行一条 shell 命令，返回标准输出与标准错误。适合列目录、查找文件、格式化 JSON。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeout: { type: 'number', description: '超时秒数，默认 60' }
      },
      required: ['command']
    },
    executionMode: 'sequential',
    execute: async (_id, params, signal) => {
      const command = String(params.command || '').trim();
      if (!command) throw new Error('命令为空');
      const timeout = Math.min(300, Math.max(5, Number(params.timeout || 60))) * 1000;
      const output = await new Promise((resolve, reject) => {
        const child = exec(
          command,
          { cwd: baseDir, timeout, maxBuffer: 4 * 1024 * 1024, env: Object.assign({}, process.env, { HOME: os.homedir() }) },
          (err, stdout, stderr) => {
            if (err && err.killed) return reject(new Error(`命令超时（${timeout / 1000}s）`));
            const text = [String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean).join('\n');
            if (err && err.code) return reject(new Error(text || `命令退出码 ${err.code}`));
            resolve(text || '（无输出）');
          }
        );
        if (signal) signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
      });
      return { content: [{ type: 'text', text: truncate(output) }], details: { command } };
    }
  };

  return [read, write, edit, bash];
}

module.exports = { makeTools, resolvePath };
