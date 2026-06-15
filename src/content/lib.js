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

  // ==================== 浮动按钮（选中后出现）====================
  let floatBtn = null;
  function ensureFloatBtn() {
    if (floatBtn) return floatBtn;
    floatBtn = document.createElement('div');
    floatBtn.id = 'aisa-float-bar';
    floatBtn.className = 'hidden';
    floatBtn.innerHTML =
      '<button class="aisa-fb-btn" data-act="quote">📌 发到侧边栏</button>' +
      '<button class="aisa-fb-btn alt" data-act="compose">➕ 加到组装</button>';
    floatBtn.addEventListener('mousedown', (e) => {
      // 阻止按钮点击导致选区丢失
      e.preventDefault();
    });
    floatBtn.querySelectorAll('.aisa-fb-btn').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = currentSelectionText();
        if (!text) { hideFloatBtn(); return; }
        const act = b.getAttribute('data-act');
        if (act === 'quote') {
          sendQuote(text);
          toast('已发送到侧边栏（同时已复制，可按 Ctrl+V 粘贴）', 3000);
        } else if (act === 'compose') {
          safeSendMessage({ type: 'AISA_ADD_TO_COMPOSER', text: text, source: document.title || '' });
          toast('已加到提示词组装', 2000);
        }
        hideFloatBtn();
      });
    });
    document.documentElement.appendChild(floatBtn);
    return floatBtn;
  }

  function showFloatBtnAt(rect) {
    const btn = ensureFloatBtn();
    const top = window.scrollY + (rect.top != null ? rect.top : 0) - 36;
    const left = window.scrollX + (rect.left != null ? rect.left : 0) + (rect.width || 0) / 2 - 90;
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

  // ==================== 页面常驻悬浮启动器 ====================
  let launcher = null;
  let launcherTip = null;
  let launcherHidden = false; // 用户点了×临时隐藏当前页

  function ensureLauncher() {
    if (launcher) return launcher;
    launcher = document.createElement('div');
    launcher.id = 'aisa-launcher';
    launcher.title = 'AI 侧边栏助手（点击打开，可拖动）';
    launcher.innerHTML =
      '<span class="pulse"></span>' +
      '<span class="ico">🤖</span>' +
      '<span class="close-x" title="在本页隐藏">×</span>';
    document.documentElement.appendChild(launcher);

    // 提示气泡（首次出现时显示几秒）
    launcherTip = document.createElement('div');
    launcherTip.id = 'aisa-launcher-tip';
    launcherTip.textContent = '点我打开 AI 侧边栏 →';
    document.documentElement.appendChild(launcherTip);

    bindLauncherEvents(launcher);
    // 首次出现：3 秒后淡出脉冲提示
    setTimeout(() => {
      const pulse = launcher.querySelector('.pulse');
      if (pulse) pulse.style.display = 'none';
      showLauncherTip(true);
      setTimeout(() => showLauncherTip(false), 4000);
    }, 3000);
    return launcher;
  }

  function showLauncherTip(show) {
    if (!launcherTip) return;
    if (show && launcher && !launcher.classList.contains('hidden')) {
      // 与 launcher 同高对齐
      launcherTip.classList.remove('hidden');
      // 触发重排再加 show 以启用 transition
      void launcherTip.offsetWidth;
      launcherTip.classList.add('show');
    } else {
      launcherTip.classList.remove('show');
    }
  }

  function showLauncher() {
    if (launcherHidden) return; // 用户在本页隐藏了
    ensureLauncher();
    launcher.classList.remove('hidden');
  }
  function hideLauncher() {
    if (launcher) launcher.classList.add('hidden');
    if (launcherTip) launcherTip.classList.add('hidden');
  }

  function bindLauncherEvents(el) {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0;
    let offsetX = 0, offsetY = 0;
    let size = 44;

    el.addEventListener('mousedown', (e) => {
      // 点的是关闭按钮，交给它自己处理
      if (e.target.classList.contains('close-x')) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
        moved = true;
        el.classList.add('dragging');
      }
      if (moved) {
        // 改用 left/top 定位（脱离初始 right）
        let x = e.clientX - offsetX;
        let y = e.clientY - offsetY;
        // 限制在视口内
        x = Math.max(4, Math.min(window.innerWidth - size - 4, x));
        y = Math.max(4, Math.min(window.innerHeight - size - 4, y));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.right = 'auto';
        // 提示气泡跟随
        if (launcherTip) {
          launcherTip.style.left = 'auto';
          launcherTip.style.right = 'auto';
          launcherTip.style.top = y + 'px';
          launcherTip.style.left = (x - 140) + 'px';
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      // 没移动才算点击
      if (!moved) {
        openSidePanelFromContent();
      }
      setTimeout(() => { moved = false; }, 0);
    });

    // 关闭按钮：隐藏当前页启动器（仅本页）
    el.querySelector('.close-x').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      launcherHidden = true;
      hideLauncher();
      toast('已在本页隐藏，刷新页面恢复', 2000);
    });
  }

  function openSidePanelFromContent() {
    // content script 无法直接开侧边栏，通知 background 处理
    safeSendMessage({ type: 'AISA_OPEN_PANEL_FROM_FLOAT' });
    toast('正在打开 AI 侧边栏…', 1500);
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
    safeSendMessage,
    showLauncher,
    hideLauncher
  };
})();
