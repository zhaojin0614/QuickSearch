/* src/sidepanel/sidepanel.js
 * 侧边栏主逻辑：
 *  - 渲染 AI 站点 tab
 *  - 切换 iframe 加载（DNR 已移除反嵌入头）
 *  - 监听 content script 传来的引用消息，显示在顶部预览条
 */
(function () {
  const storage = window.AISA.storage;
  const clipboard = window.AISA.clipboard;

  // 默认站点
  const DEFAULT_SITES = [
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: '../../assets/site-icons/chatgpt.png' },
    { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', icon: '../../assets/site-icons/claude.png' },
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', icon: '../../assets/site-icons/gemini.png' },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: '../../assets/site-icons/deepseek.png' },
    { id: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com/qianwen/', icon: '../../assets/site-icons/tongyi.png' },
    { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn/', icon: '../../assets/site-icons/kimi.png' },
    { id: 'glm', name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail', icon: '../../assets/site-icons/glm.png' },
    { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com/', icon: '../../assets/site-icons/yiyan.png' }
  ];

  const tabsEl = document.getElementById('site-tabs');
  const frameEl = document.getElementById('ai-frame');
  const overlayEl = document.getElementById('frame-overlay');
  const overlayTextEl = document.getElementById('overlay-text');
  const quoteBarEl = document.getElementById('quote-bar');
  const quoteTextEl = document.getElementById('quote-text');
  const quoteSourceEl = document.getElementById('quote-source');
  const toastEl = document.getElementById('toast');

  let currentSites = DEFAULT_SITES.slice();
  let currentSite = null;
  let currentQuote = null;
  let currentWindowId = null; // 当前侧边栏所属窗口（兜底记忆）
  let currentTabId = null; // 当前 sidePanel 实例绑定的标签（每个标签独立实例 → 按标签记站点）

  // ---------- 工具 ----------
  function showToast(msg, duration) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), duration || 2000);
  }

  function showOverlay(text) {
    overlayTextEl.textContent = text || '正在加载…';
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  function setQuote(q) {
    currentQuote = q;
    if (q && q.text) {
      // 用 textContent 赋值（覆盖任何已有内容，含用户编辑）
      quoteTextEl.textContent = q.text;
      quoteSourceEl.textContent = q.source ? '来自：' + q.source : '';
      quoteBarEl.classList.remove('hidden');
    } else {
      quoteBarEl.classList.add('hidden');
      quoteTextEl.textContent = '';
    }
    if (typeof updateTopHint === 'function') updateTopHint();
  }

  // 读取当前 quote-bar 文本（用户编辑后的实时值）；stripHtml=true 时只取纯文本
  function getQuoteText() {
    if (quoteBarEl.classList.contains('hidden')) return '';
    // contenteditable，取纯文本（innerText 保留换行，更贴近用户所见）
    const t = quoteTextEl.innerText || quoteTextEl.textContent || '';
    return t.trim();
  }

  // 暴露给 composer.js：读取/写入顶部引用
  window.AISA = window.AISA || {};
  window.AISA.getQuoteText = getQuoteText;
  window.AISA.setQuote = setQuote;

  // 用户在 quote-bar 编辑后，持久化最新文本（只影响后续 +引用 / @ 插入）
  quoteTextEl.addEventListener('input', () => {
    const text = getQuoteText();
    const source = (currentQuote && currentQuote.source) || '';
    currentQuote = { text: text, source: source };
    storage.saveLastQuote(text, source);
  });
  // 阻止 quote-bar 编辑时回车换页等默认行为干扰
  quoteTextEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // 允许换行（contenteditable 默认会换行），仅阻止事件冒泡到 document
      e.stopPropagation();
    }
  });

  // ---------- 站点 tab ----------
  async function loadSites() {
    const custom = await storage.getSites();
    if (custom && Array.isArray(custom) && custom.length) {
      currentSites = custom;
    } else if (typeof AISA_DEFAULT_SITES !== 'undefined') {
      currentSites = AISA_DEFAULT_SITES;
    }
    renderTabs();
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    currentSites.forEach((site) => {
      const btn = document.createElement('button');
      btn.className = 'site-tab';
      btn.dataset.id = site.id;
      
      let iconHtml = '';
      if (site.icon && site.icon.includes('/')) {
        iconHtml = `<img src="${site.icon}" class="site-icon-img" alt="${escapeHtml(site.name)}" onerror="this.src='../../assets/icons/icon-16.png'">`;
      } else {
        iconHtml = site.icon || '•';
      }
      
      btn.innerHTML = '<span class="ico">' + iconHtml + '</span><span>' + escapeHtml(site.name) + '</span>';
      btn.addEventListener('click', () => selectSite(site));
      tabsEl.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function selectSite(site) {
    currentSite = site;
    // 高亮 tab
    Array.from(tabsEl.children).forEach((el) => {
      el.classList.toggle('active', el.dataset.id === site.id);
    });
    showOverlay('正在加载 ' + site.name + ' …');
    frameEl.src = site.url;
    // 按标签记住站点（每个标签是独立 sidePanel 实例，各自记自己的 AI）
    if (currentTabId != null) {
      await storage.saveTabSite(currentTabId, site.id, site.url);
    }
    // 兜底：窗口也记一份
    if (currentWindowId != null) {
      await storage.saveWindowSite(currentWindowId, site.id, site.url);
    }
    // 兜底：全局也记一份站点
    await storage.saveLastSite(site.id);
  }

  // ---------- iframe 事件 ----------
  frameEl.addEventListener('load', () => {
    // 跨域 iframe 无法读取内容，load 触发即视为已加载
    hideOverlay();
  });
  // 加载超时兜底（部分站点可能很慢）
  setTimeout(() => {
    if (!overlayEl.classList.contains('hidden')) {
      overlayTextEl.textContent = '加载时间较长，请稍候…（部分站点需先在新窗口登录）';
    }
  }, 8000);

  // ---------- 引用预览按钮 ----------
  document.getElementById('quote-copy').addEventListener('click', async () => {
    if (!currentQuote) return;
    const ok = await clipboard.copyText(currentQuote.text);
    showToast(ok ? '已复制到剪贴板' : '复制失败');
  });

  document.getElementById('quote-insert').addEventListener('click', async () => {
    if (!currentQuote) return;
    const ok = await clipboard.copyText(currentQuote.text);
    if (ok) {
      showToast('已复制！请点击 AI 输入框，按 Ctrl+V 粘贴', 4000);
    } else {
      showToast('复制失败，请手动复制');
    }
  });

  document.getElementById('quote-clear').addEventListener('click', () => {
    setQuote(null);
    storage.saveLastQuote(null);
  });

  // ---------- 底部工具 ----------
  document.getElementById('btn-reload').addEventListener('click', () => {
    if (currentSite) {
      showOverlay('刷新中…');
      frameEl.src = frameEl.src;
    }
  });

  document.getElementById('btn-open-window').addEventListener('click', async () => {
    if (currentSite) {
      await chrome.tabs.create({ url: currentSite.url });
    }
  });

  document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('btn-history').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/history/history.html') });
  });

  // ---------- 接收 content script 经 background 转发的引用 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'AISA_QUOTE') {
      setQuote({ text: msg.text, source: msg.source || sender.tab?.title || '' });
      storage.saveLastQuote(msg.text, msg.source);
      autoExpandTop(); // 收到引用自动展开顶部面板
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'AISA_SETTINGS_CHANGED') {
      // 设置变更，无需特殊处理
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'AISA_ADD_TO_COMPOSER') {
      // 来自网页浮动按钮"加到组装"：在 composer 插入一个芯片
      if (window.AISA && window.AISA.addRefToComposer) {
        window.AISA.addRefToComposer({ label: '网页选中', text: msg.text || '', source: msg.source || '' });
      }
      autoExpandTop(); // 加到组装也自动展开顶部面板
      sendResponse({ ok: true });
    }
    return true;
  });

  // 收到引用/加到组装时自动展开顶部面板（若当前是折叠状态）
  function autoExpandTop() {
    try {
      if (topPanelEl && topPanelEl.classList.contains('collapsed')) {
        setCollapsed(false);
      }
    } catch (e) {}
  }

  // ---------- 顶部面板折叠 ----------
  const topPanelEl = document.getElementById('top-panel');
  const topToggleEl = document.getElementById('top-toggle');
  const topSummaryEl = document.getElementById('top-summary');
  const topHintEl = document.getElementById('top-hint');

  // 折叠状态持久化
  const COLLAPSE_KEY = 'aisa_top_collapsed';
  async function loadCollapseState() {
    try {
      const data = await chrome.storage.local.get(COLLAPSE_KEY);
      if (data[COLLAPSE_KEY]) setCollapsed(true, true);
    } catch (e) {}
  }
  async function setCollapsed(collapsed, skipSave) {
    topPanelEl.classList.toggle('collapsed', collapsed);
    const btn = document.getElementById('btn-collapse');
    if (btn) btn.textContent = collapsed ? '展开 ▾' : '折叠 ▴';
    if (!skipSave) {
      try { await chrome.storage.local.set({ [COLLAPSE_KEY]: collapsed }); } catch (e) {}
    }
    updateTopHint();
  }
  // 折叠条摘要：显示当前引用/芯片数量，方便折叠后一眼看到状态
  function updateTopHint() {
    let parts = [];
    const quoteText = (quoteTextEl.innerText || '').trim();
    if (quoteText) parts.push('📌引用');
    if (window.AISA && window.AISA.getComposerChipCount) {
      const n = window.AISA.getComposerChipCount();
      if (n > 0) parts.push('💬' + n + '段');
    }
    topHintEl.textContent = parts.length ? parts.join(' · ') : '';
  }
  topToggleEl.addEventListener('click', () => {
    setCollapsed(!topPanelEl.classList.contains('collapsed'));
  });

  // ---------- 启动 ----------
  (async function init() {
    await loadSites();
    // 获取当前窗口 + 活动 tab（每个标签是独立 sidePanel 实例，按 tab 记站点）
    try {
      const win = await chrome.windows.getCurrent();
      currentWindowId = win ? win.id : null;
    } catch (e) {
      currentWindowId = null;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab && tab.id ? tab.id : null;
    } catch (e) {
      currentTabId = null;
    }

    // 通知 service worker：当前 tab 已打开侧边栏（用于跨标签页状态跟踪）
    if (currentTabId) {
      chrome.runtime.sendMessage({ type: 'AISA_PANEL_OPENED', tabId: currentTabId }).catch(() => {});
    }

    // 恢复站点（按 tab → window → global 兜底）。
    // 因为每个标签是独立实例，切标签由 Chrome 切实例完成，不会重载本实例。
    let restoreSite = null;
    if (currentTabId != null) {
      const ts = await storage.getTabSite(currentTabId);
      if (ts && ts.siteId) {
        restoreSite = currentSites.find((s) => s.id === ts.siteId);
      }
    }
    if (!restoreSite && currentWindowId != null) {
      const ws = await storage.getWindowSite(currentWindowId);
      if (ws && ws.siteId) {
        restoreSite = currentSites.find((s) => s.id === ws.siteId);
      }
    }
    if (!restoreSite) {
      const lastId = await storage.getLastSite();
      restoreSite = currentSites.find((s) => s.id === lastId) || currentSites[0];
    }
    if (restoreSite) await selectSite(restoreSite);
    // 不加 onActivated：每个标签是独立 sidePanel 实例，Chrome 切标签时自动切实例，状态各自保留

    // 恢复上次引用
    const lastQuote = await storage.getLastQuote();
    if (lastQuote && lastQuote.text) setQuote(lastQuote);
    // 初始化提示词组装区
    if (window.AISA && window.AISA.initComposer) window.AISA.initComposer();
    // 补插：sidepanel 未打开期间，网页"加到组装"暂存的引用队列
    await flushPendingCompose();
    // 恢复顶部面板折叠状态
    await loadCollapseState();
  })();

  // 读取并补插待加入组装区的引用，然后清空队列
  async function flushPendingCompose() {
    try {
      const data = await chrome.storage.local.get('aisa_pending_compose');
      const queue = Array.isArray(data.aisa_pending_compose) ? data.aisa_pending_compose : [];
      if (!queue.length) return;
      if (window.AISA && window.AISA.addRefToComposer) {
        queue.forEach((it) => {
          window.AISA.addRefToComposer({ label: it.label || '网页选中', text: it.text || '', source: it.source || '' });
        });
        if (typeof showToast === 'function') showToast('已补插 ' + queue.length + ' 条待组装引用', 2500);
        autoExpandTop(); // 有待补插内容，自动展开
      }
      await chrome.storage.local.set({ aisa_pending_compose: [] });
    } catch (e) {}
  }
})();
