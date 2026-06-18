/* src/options/options.js
 * 高级设置页：保存所有设置 + 站点管理（增删/排序）+ 站点级 overrides。
 */
(function () {
  const storage = window.AISA.storage;

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

  let settings = null;
  let sites = null;
  let prompts = [];

  // 编辑站点时暂存置顶态（edit 是「删后重加」模式，需手动带回 pinned/pinnedAt）
  let editingPinned = null;   // { pinned, pinnedAt }

  const $ = (id) => document.getElementById(id);

  let saveTimeout = null;
  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        const overrides = {};
        const lines = $('opt-overrides').value.split(/\r?\n/);
        lines.forEach((line) => {
          line = line.trim();
          if (!line) return;
          const m = line.match(/^([+-])\s*(.+)$/);
          if (m) {
            overrides[m[2].trim()] = { superCopy: m[1] === '+' };
          } else {
            overrides[line] = { superCopy: true };
          }
        });

        const patch = {
          copyFormat: $('opt-copyFormat').value,
          autoCopyFormat: $('opt-autoCopyFormat').value,
          minChars: Math.max(1, parseInt($('opt-minChars').value, 10) || 1),
          historyLimit: Math.max(10, parseInt($('opt-historyLimit').value, 10) || 100),
          superCopy: $('opt-superCopy').checked,
          autoCopy: $('opt-autoCopy').checked,
          showFloatBtn: $('opt-showFloatBtn').checked,
          showLauncher: $('opt-showLauncher').checked,
          siteOverrides: overrides
        };

        await storage.saveSettings(patch);
        await storage.saveSites(sites);
        await storage.savePrompts(prompts);
        chrome.runtime.sendMessage({ type: 'AISA_SETTINGS_CHANGED' }).catch(() => {});
        status('自动保存成功', false, 2000);
      } catch (e) {
        status('自动保存失败: ' + e.message, true);
      }
    }, 500);
  }

  function status(msg, isErr, duration = 3000) {
    const el = $('status');
    el.textContent = msg || '';
    el.style.color = isErr ? '#dc2626' : '#059669';
    if (msg) {
      setTimeout(() => { 
        if (el.textContent === msg) el.textContent = '已开启自动保存'; 
      }, duration);
    }
  }

  // ---------- 加载 ----------
  async function load() {
    settings = await storage.getSettings();
    sites = (await storage.getSites()) || DEFAULT_SITES.map((s) => Object.assign({}, s));

    $('opt-copyFormat').value = settings.copyFormat || '';
    $('opt-autoCopyFormat').value = settings.autoCopyFormat || '';
    $('opt-minChars').value = settings.minChars || 1;
    $('opt-historyLimit').value = settings.historyLimit || 100;
    $('opt-superCopy').checked = !!settings.superCopy;
    $('opt-autoCopy').checked = !!settings.autoCopy;
    $('opt-showFloatBtn').checked = !!settings.showFloatBtn;
    $('opt-showLauncher').checked = settings.showLauncher !== false;

    prompts = (await storage.getPrompts()) || [];

    renderSites();
    renderPrompts();
    renderOverrides();
    
    ['opt-copyFormat', 'opt-autoCopyFormat', 'opt-minChars', 'opt-historyLimit'].forEach(id => $(id).addEventListener('input', scheduleSave));
    ['opt-superCopy', 'opt-autoCopy', 'opt-showFloatBtn', 'opt-showLauncher'].forEach(id => $(id).addEventListener('change', scheduleSave));
    $('opt-overrides').addEventListener('input', scheduleSave);

    // 检查是否有侧边栏传来的“快捷存为模板”文本
    chrome.storage.local.get(['aisa_temp_prompt'], (data) => {
      if (data.aisa_temp_prompt) {
        $('prompt-content').value = data.aisa_temp_prompt;
        $('prompt-trigger').focus();
        chrome.storage.local.remove('aisa_temp_prompt');
      }
    });

    // 跨页同步：站点列表被其他页面（侧边栏/悬浮窗）改动时，重新加载并刷新列表。
    // 自身的 scheduleSave 也会触发本回调，但内容一致，rerender 幂等无副作用。
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.aisa_sites) return;
      const next = changes.aisa_sites.newValue;
      if (Array.isArray(next)) {
        sites = next;
        renderSites();
      }
    });
  }

  function renderSites() {
    const list = $('sites-list');
    list.innerHTML = '';
    // 渲染前统一排序：置顶区在前（晚置顶更靠前），非置顶区保持现有顺序
    sites = storage.sortSites(sites);
    sites.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'site-row' + (s.pinned ? ' is-pinned' : '');
      let iconHtml = '';
      // 图标路径归一化：兼容 'assets/..'（background 默认值，无 ../）与 '../../assets/..'（本页默认值）。
      // 统一用 getURL 转绝对路径，避免 storage 里混存格式时相对路径解析失败导致裂图。
      const iconSrc = s.icon && /^https?:\/\//.test(s.icon) ? s.icon
        : (s.icon && /(?:^|\/)assets\//.test(s.icon) ? chrome.runtime.getURL(s.icon.replace(/^(\.\.\/)+/, '')) : '');
      if (iconSrc) {
        iconHtml = `<img src="${iconSrc}" class="site-icon-img" alt="${escapeHtml(s.name)}" style="width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;" onerror="this.src='${chrome.runtime.getURL('assets/icons/icon-16.png')}'">`;
      } else {
        iconHtml = escapeHtml(s.icon || '•');
      }

      const pinBtn = s.pinned
        ? '<button data-act="pin" class="active" title="取消置顶">📌</button>'
        : '<button data-act="pin" title="置顶到首位">📍</button>';

      row.innerHTML =
        '<span class="ico">' + iconHtml + '</span>' +
        '<span class="name">' + escapeHtml(s.name || '') + '</span>' +
        '<span class="url">' + escapeHtml(s.url || '') + '</span>' +
        pinBtn +
        '<button data-act="up" title="上移">▲</button>' +
        '<button data-act="down" title="下移">▼</button>' +
        '<button data-act="edit" title="编辑">✎</button>' +
        '<button data-act="del" title="删除">✕</button>';

      if (idx === 0) row.querySelector('[data-act="up"]').disabled = true;
      if (idx === sites.length - 1) row.querySelector('[data-act="down"]').disabled = true;

      row.querySelector('[data-act="pin"]').addEventListener('click', () => {
        sites = storage.togglePin(sites, s.id);
        renderSites();
        scheduleSave();
      });
      row.querySelector('[data-act="up"]').addEventListener('click', () => {
        if (idx === 0) return;
        [sites[idx - 1], sites[idx]] = [sites[idx], sites[idx - 1]];
        renderSites();
        scheduleSave();
      });
      row.querySelector('[data-act="down"]').addEventListener('click', () => {
        if (idx === sites.length - 1) return;
        [sites[idx + 1], sites[idx]] = [sites[idx], sites[idx + 1]];
        renderSites();
        scheduleSave();
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => {
        $('site-name').value = s.name || '';
        $('site-url').value = s.url || '';
        $('site-icon').value = s.icon || '';
        // 暂存置顶态，re-add 时带回（edit 是「删后重加」，否则会丢 pinned）
        editingPinned = { pinned: !!s.pinned, pinnedAt: s.pinnedAt || null };
        sites.splice(idx, 1);
        renderSites();
        scheduleSave();
        $('site-name').focus();
      });
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        sites.splice(idx, 1);
        renderSites();
        scheduleSave();
      });
      list.appendChild(row);
    });
  }

  function renderOverrides() {
    const ov = settings.siteOverrides || {};
    const lines = Object.keys(ov)
      .map((k) => (ov[k].superCopy !== false ? '+' : '-') + k);
    $('opt-overrides').value = lines.join('\n');
  }

  $('btn-site-add').addEventListener('click', () => {
    const name = $('site-name').value.trim();
    const url = $('site-url').value.trim();
    const icon = $('site-icon').value.trim();
    if (!name || !url) {
      status('请填写名称和 URL', true);
      return;
    }
    // 编辑模式：带回原置顶态；新增模式：默认不置顶。用完即清。
    const pin = editingPinned || { pinned: false, pinnedAt: null };
    sites.push({
      id: 'custom_' + Date.now(),
      name,
      url,
      icon: icon || '🔗',
      pinned: !!pin.pinned,
      pinnedAt: pin.pinnedAt || null
    });
    editingPinned = null;
    $('site-name').value = '';
    $('site-url').value = '';
    $('site-icon').value = '';
    renderSites();
    scheduleSave();
  });

  $('btn-site-reset').addEventListener('click', () => {
    if (!confirm('恢复为默认站点列表？当前自定义将丢失。')) return;
    sites = DEFAULT_SITES.map((s) => Object.assign({}, s));
    renderSites();
    scheduleSave();
  });

  // ---------- 数据备份：导出 / 导入 ----------
  $('btn-export').addEventListener('click', async () => {
    try {
      const payload = await storage.exportAll();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `aisa-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      status('已导出备份文件', false, 2500);
    } catch (e) {
      status('导出失败: ' + e.message, true);
    }
  });

  $('btn-import').addEventListener('click', () => $('import-file').click());

  $('import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!confirm('导入将覆盖当前所有设置、提示词与历史，确定继续？')) return;
      await storage.importAll(payload);
      status('导入成功，正在刷新…', false, 1500);
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      status('导入失败: ' + e.message, true);
    }
  });

  // ---------- 提示词模板 ----------
  function renderPrompts() {
    const list = $('prompts-list');
    list.innerHTML = '';
    prompts.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'site-row';
      row.innerHTML =
        '<span class="name" style="width: 80px; color: #4338ca; font-family: monospace;">/' + escapeHtml(p.trigger || '') + '</span>' +
        '<span class="url" style="flex: 1; color: #475569;">' + escapeHtml((p.content || '').substring(0, 30)) + '...</span>' +
        '<button data-act="up" title="上移">▲</button>' +
        '<button data-act="down" title="下移">▼</button>' +
        '<button data-act="edit" title="编辑">✎</button>' +
        '<button data-act="del" title="删除">✕</button>';
      
      if (idx === 0) row.querySelector('[data-act="up"]').disabled = true;
      if (idx === prompts.length - 1) row.querySelector('[data-act="down"]').disabled = true;

      row.querySelector('[data-act="up"]').addEventListener('click', () => {
        if (idx === 0) return;
        [prompts[idx - 1], prompts[idx]] = [prompts[idx], prompts[idx - 1]];
        renderPrompts();
        scheduleSave();
      });
      row.querySelector('[data-act="down"]').addEventListener('click', () => {
        if (idx === prompts.length - 1) return;
        [prompts[idx + 1], prompts[idx]] = [prompts[idx], prompts[idx + 1]];
        renderPrompts();
        scheduleSave();
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => {
        $('prompt-trigger').value = p.trigger || '';
        $('prompt-content').value = p.content || '';
        prompts.splice(idx, 1);
        renderPrompts();
        scheduleSave();
        $('prompt-trigger').focus();
      });
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        prompts.splice(idx, 1);
        renderPrompts();
        scheduleSave();
      });
      list.appendChild(row);
    });
  }

  $('btn-prompt-add').addEventListener('click', () => {
    const trigger = $('prompt-trigger').value.trim();
    const content = $('prompt-content').value.trim();
    if (!trigger || !content) {
      status('标志和内容不能为空', true);
      return;
    }
    if (prompts.find((p) => p.trigger === trigger)) {
      status('标志已存在', true);
      return;
    }
    prompts.push({ trigger, content });
    $('prompt-trigger').value = '';
    $('prompt-content').value = '';
    renderPrompts();
    scheduleSave();
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  load();
})();
