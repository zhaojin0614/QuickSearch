/* lib/format.js
 * 标签页信息多格式化输出。
 * 挂全局 AISA.format；同时支持 service worker。
 *
 * 支持格式：
 *   title-url   "标题 - URL"
 *   title       仅标题
 *   url         仅 URL
 *   markdown    [标题](URL)
 *   html        <a href="URL">标题</a>
 *   bracket     [标题] URL
 *   csv         "标题","URL"
 *   json        {"title":"","url":""}
 *   htmltable   <table>...</table>
 */

(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeCsv(s) {
    s = String(s == null ? '' : s);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function formatOne(tab, fmt) {
    const title = tab.title || '';
    const url = tab.url || '';
    switch (fmt) {
      case 'title':
        return title;
      case 'url':
        return url;
      case 'markdown':
        return '[' + title + '](' + url + ')';
      case 'html':
        return '<a href="' + escapeHtml(url) + '">' + escapeHtml(title) + '</a>';
      case 'bracket':
        return '[' + title + '] ' + url;
      case 'csv':
        return escapeCsv(title) + ',' + escapeCsv(url);
      case 'json':
        return JSON.stringify({ title: title, url: url });
      case 'htmltable':
        return (
          '<table><tr><th>标题</th><th>URL</th></tr><tr><td>' +
          escapeHtml(title) +
          '</td><td>' +
          escapeHtml(url) +
          '</td></tr></table>'
        );
      case 'title-url':
      default:
        return title + ' - ' + url;
    }
  }

  function formatTabs(tabs, fmt) {
    if (fmt === 'json') {
      return JSON.stringify(
        tabs.map((t) => ({ title: t.title || '', url: t.url || '' })),
        null,
        2
      );
    }
    if (fmt === 'htmltable') {
      const rows = tabs
        .map(
          (t) =>
            '<tr><td>' +
            escapeHtml(t.title || '') +
            '</td><td>' +
            escapeHtml(t.url || '') +
            '</td></tr>'
        )
        .join('');
      return (
        '<table><tr><th>标题</th><th>URL</th></tr>' + rows + '</table>'
      );
    }
    return tabs.map((t) => formatOne(t, fmt)).join('\n');
  }

  const api = { formatOne, formatTabs, escapeHtml, escapeCsv };

  if (typeof window !== 'undefined') {
    window.AISA = window.AISA || {};
    window.AISA.format = api;
  }
  if (typeof self !== 'undefined') {
    self.AISA = self.AISA || {};
    self.AISA.format = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
