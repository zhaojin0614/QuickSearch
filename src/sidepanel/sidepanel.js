/* src/sidepanel/sidepanel.js
 * 侧边栏主逻辑：
 *  - 渲染 AI 站点 tab
 *  - 切换 iframe 加载（DNR 已移除反嵌入头）
 *  - 监听 content script 传来的引用消息，显示在顶部预览条
 */
(function () {
  const storage = window.AISA.storage;
  const clipboard = window.AISA.clipboard;

  // 默认站点（与 lib/sites.js 保持同步；此处内联以防未加载该文件）
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
      btn.innerHTML = '<span class="ico">' + (site.icon || '•') + '</span><span>' + escapeHtml(site.name) + '</span>';
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
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'AISA_SETTINGS_CHANGED') {
      // 设置变更，无需特殊处理
      sendResponse({ ok: true });
    }
    return true;
  });

  // ---------- 启动 ----------
  (async function init() {
    await loadSites();
    // 恢复上次选中的站点
    const lastId = await storage.getLastSite();
    const last = currentSites.find((s) => s.id === lastId) || currentSites[0];
    if (last) selectSite(last);
    // 恢复上次引用
    const lastQuote = await storage.getLastQuote();
    if (lastQuote && lastQuote.text) setQuote(lastQuote);
    // 初始化提示词组装区
    if (window.AISA && window.AISA.initComposer) window.AISA.initComposer();
  })();
})();
