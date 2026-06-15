/* src/background/service-worker.js
 * 后台 service worker：
 *  - 点击 action 图标打开/聚焦侧边栏
 *  - content → sidepanel 的引用消息转发
 *  - 快捷键命令（Alt+1/2/3/4）
 *  - 右键菜单（复制标签页、超级复制切换等）
 *  - 通知
 */

// ===== 默认站点（与 sidepanel.js 一致；供 service worker 单独使用）=====
const DEFAULT_SITES = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: '🤖' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', icon: '🦙' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', icon: '✦' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: '🐳' },
  { id: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/', icon: '🧠' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', icon: '🌙' },
  { id: 'glm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail', icon: '🟢' },
  { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com/', icon: '🍃' }
];

const SETTINGS_KEY = 'aisa_settings';
const DEFAULT_SETTINGS = {
  superCopy: false,
  autoCopy: true,
  autoCopyFormat: 'plain',
  minChars: 1,
  showFloatBtn: true,
  copyFormat: 'title-url',
  historyLimit: 100,
  siteOverrides: {}
};

async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULT_SETTINGS, data[SETTINGS_KEY] || {});
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign({}, cur, patch);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  // 通知所有 content script 与 sidepanel 设置已变
  broadcast({ type: 'AISA_SETTINGS_CHANGED', settings: next });
  return next;
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // sidepanel 未打开会报错，忽略即可
  });
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) => {
      if (t.id && /^https?:|^file:/.test(t.url || '')) {
        chrome.tabs.sendMessage(t.id, msg).catch(() => {});
      }
    });
  });
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'),
    title: title,
    message: message || '',
    priority: 2
  });
}

// ===== 启动时设置：点击图标打开侧边栏 =====
chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (e) {
      // 某些版本不支持，忽略
    }
  }
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

// ===== 右键菜单 =====
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'aisa-open-panel',
      title: 'AI 侧边栏助手：打开侧边栏',
      contexts: ['action', 'page']
    });
    chrome.contextMenus.create({
      id: 'aisa-send-quote',
      title: '将选中内容发到 AI 侧边栏',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'aisa-copy-tab',
      title: '复制当前标签页（标题 + URL）',
      contexts: ['action', 'page']
    });
    chrome.contextMenus.create({
      id: 'aisa-toggle-super',
      title: '切换超级复制（破解禁止复制）',
      contexts: ['action', 'page']
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'aisa-open-panel':
      openSidePanel(tab && tab.windowId);
      break;
    case 'aisa-send-quote':
      if (info.selectionText) {
        await chrome.storage.local.set({
          aisa_last_quote: { text: info.selectionText, source: tab ? tab.title : '', time: Date.now() }
        });
        openSidePanel(tab && tab.windowId);
        // 也尝试直接通过消息推送给已打开的 sidepanel
        chrome.runtime.sendMessage({
          type: 'AISA_QUOTE',
          text: info.selectionText,
          source: tab ? tab.title : ''
        }).catch(() => {});
      }
      break;
    case 'aisa-copy-tab':
      if (tab) await copyCurrentTab(tab);
      break;
    case 'aisa-toggle-super': {
      const s = await getSettings();
      const next = await saveSettings({ superCopy: !s.superCopy });
      notify('AI 侧边栏助手', '超级复制已' + (next.superCopy ? '开启' : '关闭'));
      break;
    }
  }
});

async function openSidePanel(windowId) {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      if (windowId != null) {
        await chrome.sidePanel.open({ windowId });
      } else {
        await chrome.sidePanel.open();
      }
    } catch (e) {
      // 兜底：setOptions
      try {
        await chrome.sidePanel.setOptions({
          path: 'src/sidepanel/sidepanel.html',
          enabled: true
        });
      } catch (_) {}
    }
  }
}

// 点击 action 图标（部分版本仍会触发；setPanelBehavior 已处理）
chrome.action.onClicked.addListener((tab) => {
  openSidePanel(tab.windowId);
});

// ===== content → sidepanel 引用转发 =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'AISA_QUOTE') {
    // 转发给 sidepanel（若已打开）以及其他监听者
    chrome.runtime.sendMessage(msg).catch(() => {});
    // 同时持久化，sidepanel 打开后可恢复
    chrome.storage.local.set({
      aisa_last_quote: { text: msg.text, source: msg.source || '', time: Date.now() }
    });
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'AISA_COPY_TAB') {
    // 来自 content/popup 的复制请求
    if (sender.tab) copyCurrentTab(sender.tab).then(() => sendResponse({ ok: true }));
    else sendResponse({ ok: false });
  } else if (msg && msg.type === 'AISA_GET_SETTINGS') {
    getSettings().then((s) => sendResponse({ settings: s }));
    return true; // 异步
  } else if (msg && msg.type === 'AISA_SAVE_SETTINGS') {
    saveSettings(msg.patch || {}).then((s) => sendResponse({ settings: s }));
    return true;
  } else if (msg && msg.type === 'AISA_NOTIFY') {
    notify(msg.title || 'AI 侧边栏助手', msg.message || '');
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'AISA_GET_DEFAULT_SITES') {
    sendResponse({ sites: DEFAULT_SITES });
    return false;
  } else if (msg && msg.type === 'AISA_OPEN_PANEL') {
    openSidePanel(msg.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  } else if (msg && msg.type === 'AISA_COPY_ALL_TABS') {
    const tabs = Array.isArray(msg.tabs) ? msg.tabs : [];
    copyAllTabs(tabs).then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg && msg.type === 'AISA_SEND_TO_TAB') {
    // 把任意消息转发到指定 tabId（供 sidepanel 向其他标签页要数据）
    const tabId = msg.tabId;
    const inner = msg.message;
    if (!tabId || !inner) {
      sendResponse({ ok: false, error: 'missing tabId or message' });
      return false;
    }
    chrome.tabs.sendMessage(tabId, inner)
      .then((resp) => sendResponse(resp || { ok: false }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  } else if (msg && msg.type === 'AISA_QUERY_TABS') {
    // 查询当前窗口标签页列表（供 @ 菜单"其他标签页"）
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      sendResponse({
        ok: true,
        tabs: (tabs || []).map((t) => ({ id: t.id, title: t.title || '', url: t.url || '', favIconUrl: t.favIconUrl || '', active: t.active }))
      });
    });
    return true;
  }
  return true;
});

// ===== 快捷键命令 =====
chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'copy-current-tab': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await copyCurrentTab(tab);
      break;
    }
    case 'copy-all-tabs': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      await copyAllTabs(tabs);
      break;
    }
    case 'toggle-autocopy': {
      const s = await getSettings();
      const next = await saveSettings({ autoCopy: !s.autoCopy });
      notify('AI 侧边栏助手', '自动复制已' + (next.autoCopy ? '开启' : '关闭'));
      break;
    }
    case 'open-history':
      chrome.tabs.create({ url: chrome.runtime.getURL('src/history/history.html') });
      break;
  }
});

// ===== 标签页复制 =====
async function copyCurrentTab(tab) {
  const s = await getSettings();
  const text = formatOne(tab, s.copyFormat);
  await copyInTab(text);
  notify('已复制标签页', text);
}

async function copyAllTabs(tabs) {
  const s = await getSettings();
  const text = formatTabs(tabs, s.copyFormat);
  await copyInTab(text);
  notify('已复制全部标签页', '共 ' + tabs.length + ' 个标签页');
}

function formatOne(tab, fmt) {
  const title = tab.title || '';
  const url = tab.url || '';
  switch (fmt) {
    case 'title': return title;
    case 'url': return url;
    case 'markdown': return '[' + title + '](' + url + ')';
    case 'bracket': return '[' + title + '] ' + url;
    case 'csv': return '"' + title.replace(/"/g, '""') + '","' + url.replace(/"/g, '""') + '"';
    case 'json': return JSON.stringify({ title: title, url: url });
    case 'html': return '<a href="' + url + '">' + title + '</a>';
    case 'title-url':
    default: return title + ' - ' + url;
  }
}

function formatTabs(tabs, fmt) {
  if (fmt === 'json') {
    return JSON.stringify(tabs.map((t) => ({ title: t.title || '', url: t.url || '' })), null, 2);
  }
  return tabs.map((t) => formatOne(t, fmt)).join('\n');
}

// service worker 没有 DOM，使用 offscreen document 或注入 content script 来写剪贴板
// 这里用一个轻量方案：在当前激活 tab 注入一段脚本执行 execCommand copy
async function copyInTab(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:|^file:/.test(tab.url || '')) {
    // 无合适 tab，写入 storage 以便用户手动取
    await chrome.storage.local.set({ aisa_pending_copy: text });
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: copyViaExec,
      args: [text]
    });
  } catch (e) {
    await chrome.storage.local.set({ aisa_pending_copy: text });
  }
}

function copyViaExec(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  return ok;
}
