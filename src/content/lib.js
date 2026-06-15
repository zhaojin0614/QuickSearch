/* src/content/lib.js
 * 共享逻辑（content.js 调用）：
 *  - 超级复制破解（解除禁止复制/右键/选择/粘贴）
 *  - 选中文字自动复制
 *  - 浮动"发到侧边栏"按钮
 *  - 简易 toast
 *  - 把引用发给 sidepanel（经 background 转发）
 *
 * 依赖：lib-init.js（提供 window.AISA）、lib/clipboard.js（AISA.clipboard）、
 *       lib/storage.js（AISA.storage）
 */
(function () {
  const AISA = window.AISA = window.AISA || {};

  // ==================== toast ====================
  let toastEl = null;
  let toastTimer = null;
  function toast(msg, duration) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'aisa-toast';
      toastEl.className = 'hidden';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration || 2000);
  }

  // ==================== 浮动按钮 ====================
  let floatBtn = null;
  function ensureFloatBtn() {
    if (floatBtn) return floatBtn;
    floatBtn = document.createElement('button');
    floatBtn.id = 'aisa-float-btn';
    floatBtn.className = 'hidden';
    floatBtn.innerHTML = '📌 发到侧边栏';
    floatBtn.addEventListener('mousedown', (e) => {
      // 阻止按钮点击导致选区丢失
      e.preventDefault();
    });
    floatBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = currentSelectionText();
      if (text) {
        sendQuote(text);
        toast('已发送到侧边栏（同时已复制，可按 Ctrl+V 粘贴）', 3000);
      }
      hideFloatBtn();
    });
    document.documentElement.appendChild(floatBtn);
    return floatBtn;
  }

  function showFloatBtnAt(rect) {
    const btn = ensureFloatBtn();
    const top = window.scrollY + (rect.top != null ? rect.top : 0) - 36;
    const left = window.scrollX + (rect.left != null ? rect.left : 0) + (rect.width || 0) / 2 - 60;
    btn.style.top = Math.max(8, top) + 'px';
    btn.style.left = Math.max(8, left) + 'px';
    btn.classList.remove('hidden');
  }
  function hideFloatBtn() {
    if (floatBtn) floatBtn.classList.add('hidden');
  }

  // ==================== 选区 ====================
  function currentSelectionText(asFormat) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    if (asFormat === 'markdown' && window.AISA.clipboard) {
      const range = sel.getRangeAt(0);
      const frag = range.cloneContents();
      const div = document.createElement('div');
      div.appendChild(frag);
      return window.AISA.clipboard.htmlToMarkdown(div.innerHTML);
    }
    return sel.toString();
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName && el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable;
  }

  // ==================== 安全消息发送 ====================
  // 扩展开发期重新加载扩展后，旧 content script 残留页面上的 chrome.runtime
  // 会失效，抛 "Extension context invalidated"。
  // 此处统一兜底：context 失效时静默返回，不向用户暴露错误。
  function runtimeAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function safeSendMessage(msg) {
    if (!runtimeAlive()) return Promise.resolve(undefined);
    try {
      const p = chrome.runtime.sendMessage(msg);
      // Promise 形式（MV3）；补充 catch 防止接收端关闭连接抛 reject
      if (p && typeof p.then === 'function') {
        return p.catch(() => undefined);
      }
      return Promise.resolve(p);
    } catch (e) {
      // 同步抛出（context invalidated 等）
      return Promise.resolve(undefined);
    }
  }

  // ==================== 发送引用给 sidepanel ====================
  function sendQuote(text, source) {
    const src = source || document.title || '';
    // 经 background 转发；同时 sidepanel 若已打开会通过 chrome.runtime.onMessage 收到
    safeSendMessage({
      type: 'AISA_QUOTE',
      text: text,
      source: src
    });
  }

  // ==================== 超级复制破解 ====================
  let superCopyActive = false;
  let injectedStyle = null;

  function enableSuperCopy() {
    if (superCopyActive) return;
    superCopyActive = true;

    // 1. CSS：强制允许选择/拖拽
    document.documentElement.classList.add('aisa-supercopy');

    // 2. 清除内联 onXxx 事件处理器
    try {
      ['oncontextmenu', 'oncopy', 'oncut', 'onselectstart', 'ondragstart', 'onpaste', 'onmousedown', 'onkeydown'].forEach((prop) => {
        try { document[prop] = null; } catch (e) {}
        try { document.body && (document.body[prop] = null); } catch (e) {}
      });
    } catch (e) {}

    // 3. 拦截 addEventListener 形式的事件（capture 阶段 + stopImmediatePropagation）
    //    注意：这里只阻止"阻止默认"的行为，让 copy/contextmenu/selectstart 恢复
    ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart', 'paste', 'beforecopy', 'beforecut'].forEach((evName) => {
      window.addEventListener(
        evName,
        function (e) {
          // 允许默认行为：立即停止后续可能 preventDefault 的监听器
          e.stopImmediatePropagation();
        },
        true // capture
      );
      document.addEventListener(
        evName,
        function (e) {
          e.stopImmediatePropagation();
        },
        true
      );
    });

    // 4. 定期清理新增节点上的内联事件（针对动态内容站点，轻量节流）
    if (!injectedStyle) {
      injectedStyle = document.createElement('style');
      injectedStyle.id = 'aisa-supercopy-style';
      injectedStyle.textContent =
        '*, *::before, *::after { -webkit-user-select: text !important; user-select: text !important; }';
      document.documentElement.appendChild(injectedStyle);
    }

    toast('已开启超级复制', 1500);
  }

  function disableSuperCopy() {
    if (!superCopyActive) return;
    superCopyActive = false;
    document.documentElement.classList.remove('aisa-supercopy');
    if (injectedStyle) {
      injectedStyle.remove();
      injectedStyle = null;
    }
    // 事件监听器无法精确移除（匿名函数），但 superCopyActive 标志位足够；下次开启会重新绑定
  }

  // ==================== 自动复制 ====================
  let lastAutoCopied = '';
  async function autoCopySelection(settings) {
    if (!settings.autoCopy) return;
    const text = currentSelectionText(settings.autoCopyFormat);
    if (!text) return;
    if (text.length < (settings.minChars || 1)) return;
    if (text === lastAutoCopied) return; // 避免重复复制
    lastAutoCopied = text;

    const ok = window.AISA.clipboard ? await window.AISA.clipboard.copyText(text) : false;
    // 加入历史（context 失效时跳过，剪贴板写入不受影响）
    if (window.AISA.storage && ok && runtimeAlive()) {
      try { await window.AISA.storage.addHistoryItem(text, document.title || ''); } catch (e) {}
    }
    if (ok) {
      toast('已复制选中内容' + (settings.autoCopyFormat === 'markdown' ? '（Markdown）' : ''), 1200);
    }
  }

  // ==================== 导出给 content.js ====================
  AISA.content = {
    toast,
    ensureFloatBtn,
    showFloatBtnAt,
    hideFloatBtn,
    currentSelectionText,
    isEditableTarget,
    sendQuote,
    enableSuperCopy,
    disableSuperCopy,
    autoCopySelection,
    runtimeAlive,
    safeSendMessage
  };
})();
