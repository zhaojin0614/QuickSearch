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
    copyFormat: 'title-url', // 标签页复制格式
    historyLimit: 100, // 剪贴板历史最大条数
    siteOverrides: {} // 站点级开关覆盖：{ 'chat.openai.com': { superCopy: true } }
  };

  const KEYS = {
    settings: 'aisa_settings', // sync
    history: 'aisa_history', // local
    sites: 'aisa_sites', // local（用户自定义站点）
    lastSite: 'aisa_last_site', // local（上次选中的 AI 站点）
    lastQuote: 'aisa_last_quote' // local（上次引用文本）
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
    getLastQuote,
    saveLastQuote
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
