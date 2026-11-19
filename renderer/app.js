import { call } from './api.js';
import { h, toast, modal } from './ui.js';
import { renderHome } from './views/home.js';
import { renderHistory } from './views/history.js';
import { renderSettings } from './views/settings.js';
import { renderChat } from './views/chat.js';
import { renderCarrier } from './views/carrier.js';
import { mountInk } from './ink.js';

export const state = {
  boot: null,
  user: null,
  settings: null,
  models: null,
  route: '',
  params: {},
  cleanup: null
};

const root = document.getElementById('root');
let booted = false;

function topbar(route) {
  const nav = [
    { key: 'home', label: '学习' },
    { key: 'chat', label: '对话' }
  ];

  const bar = h(
    'div',
    { class: 'topbar' },
    h(
      'div',
      { class: 'brand', onclick: () => go('home') },
      h('div', { class: 'brand-mark' }, '问'),
      h(
        'div',
        {},
        h('div', { class: 'brand-name' }, '问学'),
        h('div', { class: 'brand-sub' }, 'AI 学伴')
      )
    ),
    h(
      'div',
      { class: 'nav' },
      nav.map((item) =>
        h(
          'button',
          {
            class: `nav-btn ${(route === 'carrier' ? 'home' : route) === item.key ? 'active' : ''}`,
            type: 'button',
            onclick: () => go(item.key)
          },
          item.label
        )
      )
    ),
    h(
      'div',
      { class: 'topbar-right' },
      h('button', { class: 'icon-btn', type: 'button', title: '作答记录', onclick: () => go('history') }, '记录'),
      h('button', { class: 'icon-btn', type: 'button', title: '设置', onclick: () => go('settings') }, '设置'),
      h(
        'div',
        { class: 'user-chip', onclick: openFolderInfo, title: '放题目录与数据位置' },
        h('div', { class: 'avatar' }, state.user.initial || '本'),
        h('div', { class: 'uname' }, state.user.name)
      )
    )
  );
  return bar;
}

function openFolderInfo() {
  const folder = (state.settings && state.settings.exportDir) || (state.boot.folderSync && state.boot.folderSync.dir) || '';
  const body = h(
    'div',
    {},
    h('div', { class: 'kv' }, h('span', {}, '放题目录'), h('b', {}, folder || '—')),
    h(
      'div',
      { class: 'desc', style: 'margin:6px 0 14px' },
      '把试卷 JSON 放进这个文件夹（可以建学科子文件夹），回到应用点「同步」即可收录。'
    ),
    h('div', { class: 'kv' }, h('span', {}, '数据目录'), h('b', {}, state.boot.dataRoot || '')),
    (() => {
      const list = state.boot.providers || [];
      const active = list.find((p) => p.id === state.boot.activeProfileId) || list[0];
      return active
        ? h('div', { class: 'kv' }, h('span', {}, 'AI 接口'), h('b', {}, `${active.name} · ${active.model}`))
        : h('div', { class: 'kv' }, h('span', {}, 'AI 接口'), h('b', { style: 'color:var(--danger)' }, '未配置'));
    })()
  );
  const ref = modal({
    title: '文件位置',
    size: 'narrow',
    body,
    footer: [
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            const res = await call('carrier:syncFolder', {});
            toast(res.added ? `已同步 ${res.added} 个新载体` : '没有发现新内容', res.added ? 'ok' : '');
            ref.close();
            go(state.route === 'carrier' ? 'home' : state.route || 'home');
          }
        },
        '同步放题文件夹'
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => { ref.close(); go('settings'); } }, '打开设置')
    ]
  });
}

export async function go(route, params = {}) {
  if (state.cleanup) {
    try {
      state.cleanup();
    } catch {
      /* ignore */
    }
    state.cleanup = null;
  }

  state.route = route;
  state.params = params || {};
  root.innerHTML = '';

  if (route === 'carrier') {
    const view = h('div', { class: 'layout' });
    const content = h('div', { class: 'content carrier-shell' });
    view.appendChild(topbar(route));
    view.appendChild(content);
    root.appendChild(view);
    const cleanup = await renderCarrier(content, { go, state, params: state.params });
    state.cleanup = cleanup || null;
    return;
  }

  const view = h('div', { class: 'layout' });
  const content = h('div', { class: 'content' });
  view.appendChild(topbar(route));
  view.appendChild(content);
  root.appendChild(view);

  const renderers = {
    home: renderHome,
    chat: renderChat,
    history: renderHistory,
    settings: renderSettings
  };

  const render = renderers[route] || renderHome;
  try {
    state.cleanup = (await render(content, { go, state, params: state.params })) || null;
  } catch (err) {
    content.appendChild(
      h(
        'div',
        { class: 'page' },
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'icon' }, '!'),
          h('div', { class: 'empty-title' }, '页面加载失败'),
          h('div', { class: 'empty-desc' }, err.message || String(err)),
          h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '返回首页')
        )
      )
    );
  }
}

async function boot() {
  if (booted) return;
  booted = true;
  root.appendChild(h('div', { class: 'loading-screen' }, '正在唤醒问学…'));
  try {
    const data = await call('app:bootstrap');
    state.boot = data;
    state.user = data.user;
    document.body.dataset.platform = data.platform || '';
    root.innerHTML = '';
    state.settings = (await call('settings:get')).settings;
    if (data.folderSync && data.folderSync.added) {
      toast(`已从放题目录收录 ${data.folderSync.added} 个新载体`, 'ok');
    }
    go('home', { welcome: true });
  } catch (err) {
    root.innerHTML = '';
    root.appendChild(
      h(
        'div',
        { class: 'loading-screen' },
        h(
          'div',
          {},
          h('div', { style: 'margin-bottom:10px;color:var(--danger)' }, `启动失败：${err.message || err}`),
          h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, '重新加载')
        )
      )
    );
  }
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  toast(reason && reason.message ? reason.message : String(reason || '发生未知错误'), 'error');
});

boot();
mountInk();
