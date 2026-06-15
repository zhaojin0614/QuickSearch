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

  const $ = (id) => document.getElementById(id);

  function status(msg, isErr) {
    const el = $('status');
    el.textContent = msg || '';
    el.style.color = isErr ? '#dc2626' : '#059669';
    if (msg) {
      setTimeout(() => { el.textContent = ''; }, 2500);
    }
  }

  // ---------- 加载 ----------
  async function load() {
    settings = await storage.getSettings();
    sites = (await storage.getSites()) || DEFAULT_SITES.map((s) => Object.assign({}, s));

    $('opt-copyFormat').value = settings.copyFormat;
    $('opt-autoCopyFormat').value = settings.autoCopyFormat;
    $('opt-minChars').value = settings.minChars;
    $('opt-historyLimit').value = settings.historyLimit;
    $('opt-superCopy').checked = !!settings.superCopy;
    $('opt-autoCopy').checked = !!settings.autoCopy;
    $('opt-showFloatBtn').checked = !!settings.showFloatBtn;
    $('opt-showLauncher').checked = settings.showLauncher !== false;

    renderSites();
    renderOverrides();
  }

  function renderSites() {
    const list = $('sites-list');
    list.innerHTML = '';
    sites.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'site-row';
      let iconHtml = '';
      if (s.icon && s.icon.includes('/')) {
        iconHtml = `<img src="${s.icon}" class="site-icon-img" alt="${escapeHtml(s.name)}" style="width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;" onerror="this.src='../../assets/icons/icon-16.png'">`;
      } else {
        iconHtml = escapeHtml(s.icon || '•');
      }

      row.innerHTML =
        '<span class="ico">' + iconHtml + '</span>' +
        '<span class="name">' + escapeHtml(s.name || '') + '</span>' +
        '<span class="url">' + escapeHtml(s.url || '') + '</span>' +
        '<button data-act="up" title="上移">↑</button>' +
        '<button data-act="down" title="下移">↓</button>' +
        '<button data-act="del" title="删除">✕</button>';

      if (idx === 0) row.querySelector('[data-act="up"]').disabled = true;
      if (idx === sites.length - 1) row.querySelector('[data-act="down"]').disabled = true;

      row.querySelector('[data-act="up"]').addEventListener('click', () => move(idx, -1));
      row.querySelector('[data-act="down"]').addEventListener('click', () => move(idx, 1));
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        sites.splice(idx, 1);
        renderSites();
      });
      list.appendChild(row);
    });
  }

  function move(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= sites.length) return;
    const tmp = sites[idx];
    sites[idx] = sites[j];
    sites[j] = tmp;
    renderSites();
  }

  function renderOverrides() {
    const ov = settings.siteOverrides || {};
    const lines = Object.keys(ov)
      .filter((k) => typeof ov[k].superCopy === 'boolean')
      .map((k) => (ov[k].superCopy ? '+' : '-') + k);
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
    sites.push({ id: 'custom_' + Date.now(), name: name, url: url, icon: icon || '🔗' });
    $('site-name').value = '';
    $('site-url').value = '';
    $('site-icon').value = '';
    renderSites();
  });

  $('btn-site-reset').addEventListener('click', () => {
    if (!confirm('恢复为默认站点列表？当前自定义将丢失。')) return;
    sites = DEFAULT_SITES.map((s) => Object.assign({}, s));
    renderSites();
  });

  // ---------- 保存 ----------
  $('btn-save').addEventListener('click', async () => {
    // 解析 overrides
    const overrides = {};
    const lines = $('opt-overrides').value.split(/\r?\n/);
    lines.forEach((line) => {
      line = line.trim();
      if (!line) return;
      const m = line.match(/^([+-])\s*(.+)$/);
      if (m) {
        overrides[m[2].trim()] = { superCopy: m[1] === '+' };
      } else if (line) {
        // 无前缀默认为开启
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

    try {
      await storage.saveSettings(patch);
      await storage.saveSites(sites);
      chrome.runtime.sendMessage({ type: 'AISA_SETTINGS_CHANGED' }).catch(() => {});
      status('所有设置已保存成功！');
    } catch (e) {
      status('保存失败：' + e.message, true);
    }
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  load();
})();
