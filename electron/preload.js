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
  'agent:chat',
  'agent:conversations',
  'agent:conversation:get',
  'agent:conversation:new',
  'agent:conversation:delete',
  'agent:conversation:rename',
  'carrier:list',
  'carrier:get',
  'carrier:save',
  'carrier:delete',
  'carrier:import',
  'carrier:answer',
  'carrier:finish',
  'carrier:daily',
  'carrier:history',
  'carrier:grade',
  'carrier:qchat',
  'carrier:gchat',
  'carrier:syncFolder',
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
