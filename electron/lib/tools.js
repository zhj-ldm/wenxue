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

function makeTools(baseDir, hooks = {}) {
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

  const taskTools = [];
  if (hooks.createCarrier) {
    taskTools.push(
      {
        name: 'create_carrier',
        label: 'CreateCarrier',
        description:
          '创建一个载体：kind=paper（整套试卷）、practice（专项练习）、plan（提升计划）。sections 里每个大题可写 date（YYYY-MM-DD），题目也可单独写 date；到期后会自动进入每日任务。题目支持 actions（控制批改/讲解/对话按钮）和 answerMode（fixed 固定答案 / open 答案不唯一）。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'paper / practice / plan' },
            title: { type: 'string' },
            subject: { type: 'string' },
            grade: { type: 'string' },
            goal: { type: 'string', description: '计划目标，practice/paper 可留空' },
            instructions: { type: 'string' },
            durationMinutes: { type: 'number', description: 'paper 可填，其它填 0' },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  passage: { type: 'string' },
                  date: { type: 'string' },
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        layout: { type: 'string', description: 'block / inline' },
                        stem: { type: 'string' },
                        passage: { type: 'string' },
                        blanks: { type: 'array', items: { type: 'object' } },
                        options: { type: 'array', items: { type: 'object' } },
                        maxScore: { type: 'number' },
                        referenceAnswer: { type: 'string' },
                        sampleAnswer: {
                          type: 'string',
                          description: '示范标准答案，仅供讲解与对话参考，不参与自动批改'
                        },
                        rubric: { type: 'array', items: { type: 'object' } },
                        knowledgePoints: { type: 'array', items: { type: 'string' } },
                        difficulty: { type: 'number' },
                        date: { type: 'string' },
                        answerMode: { type: 'string', description: 'fixed / open' },
                        actions: { type: 'object', description: '{ grade, explain, chat } 布尔值' }
                      },
                      required: ['stem', 'maxScore']
                    }
                  }
                },
                required: ['questions']
              }
            }
          },
          required: ['kind', 'title', 'sections']
        },
        executionMode: 'sequential',
        execute: async (_id, params) => {
          const res = await hooks.createCarrier(params || {});
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], details: res };
        }
      },
      {
        name: 'update_carrier',
        label: 'UpdateCarrier',
        description: '按 8 位编号更新载体：可改标题、目标、章节与题目（传入完整 sections 会整体替换，传入部分字段则合并）。',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '载体 8 位编号' },
            patch: { type: 'object', description: '要更新的字段，如 { title, goal, sections }' }
          },
          required: ['code', 'patch']
        },
        executionMode: 'sequential',
        execute: async (_id, params) => {
          const res = await hooks.updateCarrier(params || {});
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], details: res };
        }
      },
      {
        name: 'find_carrier',
        label: 'FindCarrier',
        description: '按 8 位编号或标题关键词查找载体，返回其结构与完成情况。',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            title: { type: 'string' }
          }
        },
        executionMode: 'parallel',
        execute: async (_id, params) => {
          const res = await hooks.findCarrier(params || {});
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], details: {} };
        }
      },
      {
        name: 'list_carriers',
        label: 'ListCarriers',
        description: '列出全部试卷、练习与提升计划（含编号、题量、完成情况）。',
        parameters: { type: 'object', properties: { kind: { type: 'string' } } },
        executionMode: 'parallel',
        execute: async (_id, params) => {
          const res = await hooks.listCarriers(params || {});
          return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], details: {} };
        }
      },
      {
        name: 'delete_carrier',
        label: 'DeleteCarrier',
        description: '按 8 位编号删除一个载体（含作答与对话记录）。',
        parameters: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code']
        },
        executionMode: 'sequential',
        execute: async (_id, params) => {
          const res = await hooks.deleteCarrier(params || {});
          return { content: [{ type: 'text', text: JSON.stringify(res) }], details: {} };
        }
      }
    );
  }

  if (hooks.webSearch) {
    taskTools.push({
      name: 'web_search',
      label: 'WebSearch',
      description: '联网搜索（内置 Aggr Search，多引擎聚合）。需要查资料、确认最新信息、找题目素材时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          count: { type: 'number', description: '返回条数，默认 6' }
        },
        required: ['query']
      },
      executionMode: 'parallel',
      execute: async (_id, params) => {
        const res = await hooks.webSearch(params || {});
        return { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }], details: {} };
      }
    });
  }

  if (hooks.webFetch) {
    taskTools.push({
      name: 'web_fetch',
      label: 'WebFetch',
      description: '抓取网页正文（内置 Aggr Search）。搜到合适的链接后，用它读取完整内容。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的网页地址' }
        },
        required: ['url']
      },
      executionMode: 'parallel',
      execute: async (_id, params) => {
        const res = await hooks.webFetch(params || {});
        return { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }], details: {} };
      }
    });
  }

  return [read, write, edit, bash, ...taskTools];
}

module.exports = { makeTools, resolvePath };
