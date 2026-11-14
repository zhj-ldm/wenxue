'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'app:bootstrap',
  'app:openExternal',
  'settings:get',
  'settings:save',
  'provider:list',
  'provider:save',
  'provider:delete',
  'provider:activate',
  'provider:models',
  'provider:test',
  'dialog:pickFolder',
  'dialog:pickFile',
  'file:read',
  'prompts:list',
  'paper:list',
  'paper:syncFolder',
  'paper:get',
  'paper:delete',
  'paper:export',
  'paper:import',
  'agent:chat',
  'attempt:open',
  'attempt:new',
  'attempt:saveAnswer',
  'attempt:setModel',
  'attempt:finish',
  'attempt:history',
  'ai:grade',
  'ai:chat',
  'ai:explain',
  'ai:cancel'
]);

contextBridge.exposeInMainWorld('api', {
  invoke(channel, payload = {}) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error(`不允许的调用：${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
  onAiEvent(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('ai:event', handler);
    return () => ipcRenderer.removeListener('ai:event', handler);
  },
  platform: process.platform
});
