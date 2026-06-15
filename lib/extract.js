/* lib/extract.js
 * 网页正文提取 + 元信息。
 * 挂全局 AISA.extract；content script 上下文使用。
 *
 * 策略（轻量启发式，不依赖第三方库）：
 *  1. 优先读取 <article> / <main> / role=main / 常见正文容器
 *  2. 退化：对 <body> 下所有块级元素按文本密度打分取最高分容器
 *  3. 清理 script/style/nav/footer/aside/广告等噪音节点
 *  4. 保留段落换行、链接、基本结构
 */
(function () {
  const NOISE_TAGS = new Set([
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'form',
    'button', 'input', 'textarea', 'select', 'nav', 'footer', 'header',
    'aside'
  ]);
  const NOISE_ROLES = new Set([
    'navigation', 'banner', 'contentinfo', 'search', 'complementary', 'menu', 'menubar'
  ]);
  const NOISE_CLASS = /nav|menu|footer|header|sidebar|comment|share|social|advert|banner|cookie|popup|modal|related|recommend|breadcrumb/i;
  const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'li', 'blockquote', 'pre', 'td', 'dd', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  function cleanClone(node) {
    const clone = node.cloneNode(true);
    // 移除噪音节点
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        const tag = el.tagName && el.tagName.toLowerCase();
        if (NOISE_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
        if (el.getAttribute && NOISE_ROLES.has(el.getAttribute('role'))) return NodeFilter.FILTER_REJECT;
        const cls = (el.className && typeof el.className === 'string') ? el.className : '';
        const id = el.id || '';
        if (NOISE_CLASS.test(cls) || NOISE_CLASS.test(id)) return NodeFilter.FILTER_REJECT;
        if (tag === 'a' && el.getAttribute) {
          const href = el.getAttribute('href');
          if (href && (href.indexOf('javascript:') === 0 || href.charAt(0) === '#')) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const toRemove = [];
    while (walker.nextNode()) {
      // 已经在 acceptNode 里 REJECT，这里只需额外处理：display:none / hidden
      const el = walker.currentNode;
      const style = el.style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        toRemove.push(el);
      }
      if (el.hasAttribute && el.hasAttribute('hidden')) toRemove.push(el);
    }
    toRemove.forEach((el) => el.parentNode && el.parentNode.removeChild(el));
    return clone;
  }

  // 查找正文容器
  function findMainContainer() {
    // 1. 显式语义容器
    const candidates = [
      'article',
      'main',
      '[role="main"]',
      '#content', '#main', '#article', '#post', '#body', '#doc',
      '.post-content', '.article-content', '.entry-content', '.markdown-body',
      '.content', '.main-content', '.article-body', '.rich-text'
    ];
    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      if (els.length === 1) {
        const el = els[0];
        if (el.innerText && el.innerText.trim().length >= 200) return el;
      }
      if (els.length > 1) {
        // 取文本最长的一个
        let best = null, bestLen = 0;
        els.forEach((el) => {
          const len = el.innerText ? el.innerText.length : 0;
          if (len > bestLen) { bestLen = len; best = el; }
        });
        if (best && bestLen >= 200) return best;
      }
    }
    // 2. 打分：body 下块级元素取文本密度最高
    let best = null, bestScore = 0;
    const blocks = document.body.querySelectorAll('div, section, article, td');
    blocks.forEach((el) => {
      if (el.querySelectorAll(BLOCK_SELECTOR).length > 50) return; // 跳过过大的容器
      const text = el.innerText || '';
      if (text.length < 200) return;
      const links = el.querySelectorAll('a').length;
      const score = text.length - links * 20; // 链接多则降权
      if (score > bestScore) { bestScore = score; best = el; }
    });
    return best || document.body;
  }
  const BLOCK_SELECTOR = 'p, div, section, article, li';

  // 容器 → 结构化文本
  function containerToText(container) {
    const clean = cleanClone(container);
    const lines = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/\s+/g, ' ');
        if (t.trim()) lines.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') { lines.push('\n'); return; }
      if (/^h[1-6]$/.test(tag)) {
        lines.push('\n\n## ' + (node.textContent || '').trim() + '\n');
        return;
      }
      if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
        lines.push('\n');
        Array.from(node.childNodes).forEach(walk);
        lines.push('\n');
        return;
      }
      if (tag === 'pre') {
        lines.push('\n```\n' + (node.textContent || '').replace(/\n+$/, '') + '\n```\n');
        return;
      }
      Array.from(node.childNodes).forEach(walk);
    }
    walk(clean);
    // 合并空白
    return lines.join('').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  // 提取页面元信息 + 正文
  function extractPage(maxLength) {
    const limit = maxLength || 12000;
    const container = findMainContainer();
    const content = containerToText(container);

    // 描述：meta description
    let desc = '';
    const metaDesc = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
    if (metaDesc) desc = metaDesc.getAttribute('content') || '';

    const result = {
      url: location.href,
      title: document.title || '',
      description: desc.trim(),
      content: content.length > limit ? content.slice(0, limit) + '\n…(已截断)' : content,
      length: content.length,
      truncated: content.length > limit
    };
    return result;
  }

  // 当前选中文本
  function extractSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    return sel.toString();
  }

  const api = { extractPage, extractSelection };

  if (typeof window !== 'undefined') {
    window.AISA = window.AISA || {};
    window.AISA.extract = api;
  }
  if (typeof self !== 'undefined') {
    self.AISA = self.AISA || {};
    self.AISA.extract = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
