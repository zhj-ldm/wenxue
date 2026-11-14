'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const cache = new Map();

function promptsDir() {
  // 不依赖 app.isPackaged：部分 Electron 版本在开发模式下也会返回 true，
  // 这里按「先源码目录、再打包资源目录、最后 app 路径」的顺序探测，取第一个真实存在的。
  // 注意：app.getAppPath() 需惰性求值，否则在 Electron 外直接 require 时 app 为 undefined 会抛错。
  const candidates = [
    path.join(__dirname, '..', '..', 'prompts'),
    path.join(process.resourcesPath || '', 'prompts'),
    () => {
      try {
        return path.join(app.getAppPath(), 'prompts');
      } catch {
        return '';
      }
    }
  ];
  for (const c of candidates) {
    const dir = typeof c === 'function' ? c() : c;
    if (!dir) continue;
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* 继续尝试下一个 */
    }
  }
  return candidates[0];
}

function load(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(promptsDir(), `${name}.md`);
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    content = '';
  }
  cache.set(name, content);
  return content;
}

function render(name, vars = {}) {
  const template = load(name);
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    if (value == null) return '';
    return String(value);
  });
}

function list() {
  try {
    return fs
      .readdirSync(promptsDir())
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

module.exports = { load, render, list, promptsDir };
