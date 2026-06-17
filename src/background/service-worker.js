/* src/background/service-worker.js
 * 后台 service worker：
 *  - 点击 action 图标打开/聚焦侧边栏
 *  - content → sidepanel 的引用消息转发
 *  - 快捷键命令（Alt+1/2/3/4）
 *  - 右键菜单（复制标签页、超级复制切换等）
 *  - 通知
 */

// ===== 默认站点（与 sidepanel.js 一致；供 service worker 单独使用）=====
const AISA_DEFAULT_SITES = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'assets/site-icons/chatgpt.png' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', icon: 'assets/site-icons/claude.png' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', icon: 'assets/site-icons/gemini.png' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: 'assets/site-icons/deepseek.png' },
  { id: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/', icon: 'assets/site-icons/tongyi.png' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', icon: 'assets/site-icons/kimi.png' },
  { id: 'glm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail', icon: 'assets/site-icons/glm.png' },
  { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com/', icon: 'assets/site-icons/yiyan.png' }
];

const SETTINGS_KEY = 'aisa_settings';
const DEFAULT_SETTINGS = {
  superCopy: false,
  autoCopy: true,
  autoCopyFormat: 'plain',
  minChars: 1,
  showFloatBtn: true,
  showLauncher: true,
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
// 策略：全局 enabled: false → 新标签页绝对不会出现侧边栏（从根源杜绝）。
// openPanelOnActionClick: true → 已 enabled 的标签页点图标直接开；
//   未 enabled 的标签页 Chrome 会触发 action.onClicked 兜底 → 手动 enable + open。
const PANEL_PATH = 'src/sidepanel/sidepanel.html';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.remove('aisa_sites');

  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (e) {}
  }
  if (chrome.sidePanel && chrome.sidePanel.setOptions) {
    try {
      await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: false });
    } catch (e) {}
  }
  createContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (e) {}
  }
  if (chrome.sidePanel && chrome.sidePanel.setOptions) {
    try {
      await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: false });
    } catch (e) {}
  }
  createContextMenu();
});

// 页面加载完成：只对已打开过侧边栏的标签页保持 enabled
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId > 0) {
    pendingTabs.delete(tabId);
    if (panelOpenTabs.has(tabId) && chrome.sidePanel && chrome.sidePanel.setOptions) {
      chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
    }
  }
});

// ===== 侧边栏按标签页独立管理 =====

const panelOpenTabs = new Set();
const pendingTabs = new Set();

// 监听 sidepanel 长连接（感知侧边栏关闭）
chrome.runtime.onConnect.addListener((port) => {
  if (port.name && port.name.startsWith('aisa-sidepanel-')) {
    const tabId = parseInt(port.name.split('-')[2], 10);
    if (tabId && tabId > 0) {
      panelOpenTabs.add(tabId);
      if (chrome.sidePanel && chrome.sidePanel.setOptions) {
        chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
      }
      
      port.onDisconnect.addListener(async () => {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab && tab.active) {
            panelOpenTabs.delete(tabId);
            if (chrome.sidePanel && chrome.sidePanel.setOptions) {
              chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
            }
          }
        } catch (e) {
          panelOpenTabs.delete(tabId);
        }
      });
    }
  }
});

// 新建标签页：显式 per-tab disabled（双重保障，配合全局 disabled）
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id && tab.id > 0) {
    pendingTabs.add(tab.id);
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => {});
    }
  }
});

// 切换标签页
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  if (!tabId || tabId <= 0) return;
  if (!chrome.sidePanel || !chrome.sidePanel.setOptions) return;

  if (panelOpenTabs.has(tabId)) {
    // 切回之前打开过侧边栏的标签页 → 确保 enabled
    chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  panelOpenTabs.delete(tabId);
  pendingTabs.delete(tabId);
});

async function openSidePanel(windowId, tabId) {
  if (tabId && tabId > 0) {
    panelOpenTabs.add(tabId);
    pendingTabs.delete(tabId);
  }
  // 先 open()（保留用户手势时效），再 setOptions(enabled: true)。
  // open() 不要求 tab 是 enabled 的；setOptions 放后面确保切标签时侧边栏能正常显示。
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open(windowId != null ? { windowId } : {});
    } catch (e) {}
  }
  if (tabId && tabId > 0 && chrome.sidePanel && chrome.sidePanel.setOptions) {
    chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
  }
}

// 点击扩展图标：
// - 标签页已 enabled → openPanelOnActionClick 直接打开，此回调不触发
// - 标签页未 enabled → openPanelOnActionClick 无效，Chrome 触发此回调 → 手动 enable + open
chrome.action.onClicked.addListener(async (tab) => {
  await openSidePanel(tab.windowId, tab.id);
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
      openSidePanel(tab && tab.windowId, tab && tab.id);
      break;
    case 'aisa-send-quote':
      if (info.selectionText) {
        await chrome.storage.local.set({
          aisa_last_quote: { text: info.selectionText, source: tab ? tab.title : '', time: Date.now() }
        });
        openSidePanel(tab && tab.windowId, tab && tab.id);
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


// ===== content → sidepanel 引用转发 =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'AISA_PANEL_OPENED') {
    // 侧边栏页面加载时通知：标记当前活动标签已打开侧边栏
    const tabId = msg.tabId;
    if (tabId && tabId > 0) {
      panelOpenTabs.add(tabId);
      pendingTabs.delete(tabId);
      // 确保该 tab 的 panel 是启用的
      if (chrome.sidePanel && chrome.sidePanel.setOptions) {
        chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => {});
      }
    }
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'AISA_QUOTE') {
    // 转发给 sidepanel（若已打开）以及其他监听者
    chrome.runtime.sendMessage(msg).catch(() => {});
    // 同时持久化，sidepanel 打开后可恢复
    chrome.storage.local.set({
      aisa_last_quote: { text: msg.text, source: msg.source || '', time: Date.now() }
    });
    
    // 自动打开侧边栏（如果尚未打开）
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    const tabId = sender.tab ? sender.tab.id : undefined;
    openSidePanel(windowId, tabId);
    
    sendResponse({ ok: true });
  } else if (msg && msg.type === 'AISA_OPEN_PANEL_FROM_FLOAT') {
    // 来自页面悬浮启动器：为来源 tab 所在窗口打开侧边栏
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    const tabId = sender.tab ? sender.tab.id : undefined;
    openSidePanel(windowId, tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  } else if (msg && msg.type === 'AISA_ADD_TO_COMPOSER') {
    // 来自网页浮动按钮"加到组装"：
    //  - sidepanel 若已打开，会通过 sendMessage 广播直接收到并插入
    //  - 这里做持久化兜底：sidepanel 未打开时暂存队列，打开后补插
    const item = { label: '网页选中', text: msg.text || '', source: msg.source || '', time: Date.now() };
    chrome.storage.local.get('aisa_pending_compose', (data) => {
      const queue = Array.isArray(data.aisa_pending_compose) ? data.aisa_pending_compose : [];
      queue.push(item);
      if (queue.length > 20) queue.shift(); // 防止无限增长
      chrome.storage.local.set({ aisa_pending_compose: queue });
    });
    
    // 自动打开侧边栏（如果尚未打开）
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    const tabId = sender.tab ? sender.tab.id : undefined;
    openSidePanel(windowId, tabId);
    
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
    sendResponse({ sites: AISA_DEFAULT_SITES });
    return false;
  } else if (msg && msg.type === 'AISA_OPEN_PANEL') {
    openSidePanel(msg.windowId, msg.tabId)
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
