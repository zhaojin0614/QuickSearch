/* lib/storage.js
 * chrome.storage 封装：设置 / 历史 / 站点列表
 * 同时支持 content script（经典脚本，挂全局 AISA.storage）与 ES module 导入。
 */

(function () {
  const DEFAULT_SETTINGS = {
    superCopy: false, // 超级复制（破解禁止复制）全局开关
    autoCopy: true, // 选中文字自动复制
    autoCopyFormat: 'plain', // plain | markdown
    minChars: 1, // 自动复制最小字符数
    showFloatBtn: true, // 选中后显示浮动按钮
    showLauncher: true, // 页面常驻悬浮启动器
    copyFormat: 'title-url', // 标签页复制格式
    historyLimit: 100, // 剪贴板历史最大条数
    siteOverrides: {} // 站点级开关覆盖：{ 'chat.openai.com': { superCopy: true } }
  };

  const KEYS = {
    settings: 'aisa_settings', // sync
    history: 'aisa_history', // local
    sites: 'aisa_sites', // local（用户自定义站点）
    lastSite: 'aisa_last_site', // local（全局上次选中的 AI 站点，兜底用）
    lastQuote: 'aisa_last_quote', // local（上次引用文本）
    windowSites: 'aisa_window_sites', // local（按 windowId 记的站点+URL 映射，兜底）
    tabSites: 'aisa_tab_sites', // local（按 tabId 记的站点+URL 映射，主用）
    prompts: 'aisa_prompts' // sync（用户自定义提示词模板）
  };

  const isExtension =
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;

  // 兜底内存存储（非扩展环境，例如纯本地测试 HTML）
  const memStore = {};

  async function getSettings() {
    if (isExtension) {
      const data = await chrome.storage.sync.get(KEYS.settings);
      return Object.assign({}, DEFAULT_SETTINGS, data[KEYS.settings] || {});
    }
    return Object.assign({}, DEFAULT_SETTINGS, memStore[KEYS.settings] || {});
  }

  async function saveSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    if (isExtension) {
      await chrome.storage.sync.set({ [KEYS.settings]: next });
    } else {
      memStore[KEYS.settings] = next;
    }
    return next;
  }

  // 按域名取该站点实际生效设置（站点覆盖 > 全局）
  async function getEffectiveSettings(hostname) {
    const s = await getSettings();
    const ov = (s.siteOverrides || {})[hostname];
    return Object.assign({}, s, ov || {});
  }

  async function getHistory() {
    if (isExtension) {
      const data = await chrome.storage.local.get(KEYS.history);
      return data[KEYS.history] || [];
    }
    return memStore[KEYS.history] || [];
  }

  async function addHistoryItem(text, source) {
    const list = await getHistory();
    const item = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      text: String(text).slice(0, 5000),
      source: source || '',
      url: typeof location !== 'undefined' ? location.href : '',
      time: Date.now()
    };
    list.unshift(item);
    const limit = (await getSettings()).historyLimit;
    if (list.length > limit) list.length = limit;
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.history]: list });
    } else {
      memStore[KEYS.history] = list;
    }
    return item;
  }

  async function removeHistoryItem(id) {
    const list = await getHistory();
    const next = list.filter((i) => i.id !== id);
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.history]: next });
    } else {
      memStore[KEYS.history] = next;
    }
  }

  async function clearHistory() {
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.history]: [] });
    } else {
      memStore[KEYS.history] = [];
    }
  }

  async function getSites() {
    if (isExtension) {
      const data = await chrome.storage.local.get(KEYS.sites);
      return data[KEYS.sites] || null; // null 表示用默认
    }
    return memStore[KEYS.sites] || null;
  }

  async function saveSites(sites) {
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.sites]: sites });
    } else {
      memStore[KEYS.sites] = sites;
    }
  }

  async function getLastSite() {
    if (isExtension) {
      const data = await chrome.storage.local.get(KEYS.lastSite);
      return data[KEYS.lastSite] || null;
    }
    return memStore[KEYS.lastSite] || null;
  }

  async function saveLastSite(id) {
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.lastSite]: id });
    } else {
      memStore[KEYS.lastSite] = id;
    }
  }

  // ---- 按窗口（windowId）记站点 + URL ----
  // 数据结构：{ "<windowId>": { siteId, url, time }, ... }
  async function getWindowSites() {
    if (isExtension) {
      const data = await chrome.storage.local.get(KEYS.windowSites);
      return data[KEYS.windowSites] || {};
    }
    return memStore[KEYS.windowSites] || {};
  }
  async function getWindowSite(windowId) {
    const map = await getWindowSites();
    return map[String(windowId)] || null;
  }
  async function saveWindowSite(windowId, siteId, url) {
    const map = await getWindowSites();
    map[String(windowId)] = { siteId: siteId, url: url, time: Date.now() };
    // 控制条目数，避免无限增长（保留最近 30 个窗口）
    const entries = Object.entries(map).sort((a, b) => (b[1].time || 0) - (a[1].time || 0));
    const trimmed = entries.slice(0, 30);
    const next = {};
    trimmed.forEach(([k, v]) => { next[k] = v; });
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.windowSites]: next });
    } else {
      memStore[KEYS.windowSites] = next;
    }
    return next[String(windowId)];
  }

  // ---- 按标签页（tabId）记站点 + URL（分标签记忆，主用）----
  // 数据结构：{ "<tabId>": { siteId, url, time }, ... }
  async function getTabSites() {
    if (isExtension) {
      const data = await chrome.storage.local.get(KEYS.tabSites);
      return data[KEYS.tabSites] || {};
    }
    return memStore[KEYS.tabSites] || {};
  }
  async function getTabSite(tabId) {
    const map = await getTabSites();
    return map[String(tabId)] || null;
  }
  async function saveTabSite(tabId, siteId, url) {
    const map = await getTabSites();
    map[String(tabId)] = { siteId: siteId, url: url, time: Date.now() };
    // 保留最近 100 个标签（标签开得比窗口多）
    const entries = Object.entries(map).sort((a, b) => (b[1].time || 0) - (a[1].time || 0));
    const trimmed = entries.slice(0, 100);
    const next = {};
    trimmed.forEach(([k, v]) => { next[k] = v; });
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.tabSites]: next });
    } else {
      memStore[KEYS.tabSites] = next;
    }
    return next[String(tabId)];
  }
  async function removeTabSite(tabId) {
    const map = await getTabSites();
    delete map[String(tabId)];
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.tabSites]: map });
    } else {
      memStore[KEYS.tabSites] = map;
    }
  }

  async function getLastQuote() {
    if (isExtension) {
      const data = await chrome.storage.local.get(KEYS.lastQuote);
      return data[KEYS.lastQuote] || null;
    }
    return memStore[KEYS.lastQuote] || null;
  }

  async function saveLastQuote(text, source) {
    const v = text ? { text: String(text).slice(0, 5000), source: source || '', time: Date.now() } : null;
    if (isExtension) {
      await chrome.storage.local.set({ [KEYS.lastQuote]: v });
    } else {
      memStore[KEYS.lastQuote] = v;
    }
  }

  // ---------- 提示词模板 ----------
  async function getPrompts() {
    if (isExtension) {
      const data = await chrome.storage.sync.get(KEYS.prompts);
      return data[KEYS.prompts] || [];
    }
    return memStore[KEYS.prompts] || [];
  }

  async function savePrompts(promptsArray) {
    if (isExtension) {
      await chrome.storage.sync.set({ [KEYS.prompts]: promptsArray });
    } else {
      memStore[KEYS.prompts] = promptsArray;
    }
  }

  // ---------- 备份：导出 / 导入 ----------
  // 导出全部用户数据为一个可序列化对象（用于本地 JSON 备份，防止误删/重装丢数据）。
  // 不会导出临时键（如 aisa_temp_prompt）。
  async function exportAll() {
    const data = {};
    // sync 区：设置 + 提示词
    // local 区：历史 + 站点 + 各种记忆映射
    const allKeys = Object.values(KEYS);
    let syncData = {}, localData = {};
    if (isExtension) {
      syncData = await chrome.storage.sync.get([KEYS.settings, KEYS.prompts]);
      localData = await chrome.storage.local.get(allKeys);
    } else {
      allKeys.forEach((k) => { data[k] = memStore[k]; });
    }
    const out = {
      _meta: {
        app: 'aisa',
        version: 2,
        exportedAt: new Date().toISOString()
      },
      sync: isExtension ? syncData : null,
      local: isExtension ? localData : null,
      data: isExtension ? null : data
    };
    return out;
  }

  // 导入：将 exportAll 产出的对象写回 chrome.storage（覆盖式）。
  // 接受三种来源：v2 结构（{sync, local}）或旧版平铺（{data:{...}}）。
  async function importAll(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('备份文件格式无效');
    }
    const known = new Set(Object.values(KEYS));

    // v2 结构
    if (payload.sync && isExtension) {
      const syncKeys = Object.keys(payload.sync).filter((k) => known.has(k));
      if (syncKeys.length) {
        const patch = {};
        syncKeys.forEach((k) => { patch[k] = payload.sync[k]; });
        await chrome.storage.sync.set(patch);
      }
    }
    if (payload.local && isExtension) {
      const localKeys = Object.keys(payload.local).filter((k) => known.has(k));
      if (localKeys.length) {
        const patch = {};
        localKeys.forEach((k) => { patch[k] = payload.local[k]; });
        await chrome.storage.local.set(patch);
      }
    }

    // 旧版/非扩展：平铺 data
    const flat = payload.data || (isExtension ? null : payload);
    if (flat && typeof flat === 'object') {
      Object.keys(flat).forEach((k) => {
        if (!known.has(k)) return;
        if (isExtension) {
          // 平铺结构无法区分 sync/local，全部落 local（设置/提示词会读不到，但保底不丢）
          chrome.storage.local.set({ [k]: flat[k] });
        } else {
          memStore[k] = flat[k];
        }
      });
    }
    return true;
  }

  const api = {
    DEFAULT_SETTINGS,
    KEYS,
    getSettings,
    saveSettings,
    getEffectiveSettings,
    getHistory,
    addHistoryItem,
    removeHistoryItem,
    clearHistory,
    getSites,
    saveSites,
    getLastSite,
    saveLastSite,
    getWindowSites,
    getWindowSite,
    saveWindowSite,
    getTabSites,
    getTabSite,
    saveTabSite,
    removeTabSite,
    getLastQuote,
    saveLastQuote,
    getPrompts,
    savePrompts,
    exportAll,
    importAll
  };

  // 挂全局（content script）
  if (typeof window !== 'undefined') {
    window.AISA = window.AISA || {};
    window.AISA.storage = api;
  }
  // 挂全局（service worker 无 window）
  if (typeof self !== 'undefined') {
    self.AISA = self.AISA || {};
    self.AISA.storage = api;
  }
  // ES module 导出
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
