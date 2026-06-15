/* lib/clipboard.js
 * 剪贴板写入（含降级 execCommand）+ HTML→Markdown 转换。
 * 挂全局 AISA.clipboard；同时支持 service worker 用。
 */

(function () {
  // ---------- 写剪贴板 ----------
  async function copyText(text) {
    // 优先使用 navigator.clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // 失败则降级
      }
    }
    // 降级：execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // 同时写入纯文本 + HTML（保留简单格式）
  async function copyRich(text, html) {
    if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
      try {
        const items = {
          'text/plain': new Blob([text], { type: 'text/plain' })
        };
        if (html) items['text/html'] = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem(items)]);
        return true;
      } catch (e) {
        // 失败降级
      }
    }
    return copyText(text);
  }

  // ---------- HTML → Markdown ----------
  function htmlToMarkdown(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    function walk(node, depth) {
      if (depth > 50) return '';
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      const kids = () =>
        Array.from(node.childNodes).map((c) => walk(c, depth + 1)).join('');

      switch (tag) {
        case 'br':
          return '  \n';
        case 'hr':
          return '\n---\n';
        case 'h1': return '\n# ' + kids().trim() + '\n';
        case 'h2': return '\n## ' + kids().trim() + '\n';
        case 'h3': return '\n### ' + kids().trim() + '\n';
        case 'h4': return '\n#### ' + kids().trim() + '\n';
        case 'h5': return '\n##### ' + kids().trim() + '\n';
        case 'h6': return '\n###### ' + kids().trim() + '\n';
        case 'b':
        case 'strong':
          return '**' + kids() + '**';
        case 'i':
        case 'em':
          return '*' + kids() + '*';
        case 's':
        case 'del':
          return '~~' + kids() + '~~';
        case 'code':
          return '`' + kids() + '`';
        case 'pre': {
          const code = node.querySelector('code');
          const txt = (code ? code.textContent : node.textContent).replace(/\n$/, '');
          return '\n```\n' + txt + '\n```\n';
        }
        case 'blockquote':
          return '\n' + kids().split('\n').map((l) => '> ' + l).join('\n') + '\n';
        case 'a': {
          const href = node.getAttribute('href') || '';
          const txt = kids().trim();
          if (!href) return txt;
          return '[' + txt + '](' + href + ')';
        }
        case 'img': {
          const alt = node.getAttribute('alt') || '';
          const src = node.getAttribute('src') || '';
          return '![' + alt + '](' + src + ')';
        }
        case 'ul': {
          return '\n' + Array.from(node.children)
            .filter((li) => li.tagName.toLowerCase() === 'li')
            .map((li) => '- ' + walk(li, depth + 1).trim())
            .join('\n') + '\n';
        }
        case 'ol': {
          return '\n' + Array.from(node.children)
            .filter((li) => li.tagName.toLowerCase() === 'li')
            .map((li, i) => (i + 1) + '. ' + walk(li, depth + 1).trim())
            .join('\n') + '\n';
        }
        case 'table':
          return '\n' + tableToMarkdown(node) + '\n';
        case 'p':
        case 'div':
          return kids() + '\n';
        default:
          return kids();
      }
    }

    function tableToMarkdown(table) {
      const rows = table.querySelectorAll('tr');
      if (!rows.length) return '';
      const data = [];
      rows.forEach((tr) => {
        const cells = tr.querySelectorAll('th,td');
        data.push(Array.from(cells).map((c) => (c.textContent || '').trim()));
      });
      const cols = Math.max.apply(null, data.map((r) => r.length));
      const norm = data.map((r) => {
        const out = r.slice();
        while (out.length < cols) out.push('');
        return out;
      });
      const header = norm[0];
      const sep = header.map(() => '---');
      const body = norm.slice(1);
      const lines = [header, sep].concat(body).map((r) => '| ' + r.join(' | ') + ' |');
      return lines.join('\n');
    }

    let md = walk(tmp, 0);
    // 清理多余空行
    md = md.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
    return md;
  }

  // 从当前选区提取纯文本与（可选）HTML
  function getSelectionText(asFormat) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    const text = sel.toString();
    if (asFormat !== 'markdown') return text;
    const range = sel.getRangeAt(0);
    const fragment = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(fragment);
    return htmlToMarkdown(div.innerHTML);
  }

  const api = {
    copyText,
    copyRich,
    htmlToMarkdown,
    getSelectionText
  };

  if (typeof window !== 'undefined') {
    window.AISA = window.AISA || {};
    window.AISA.clipboard = api;
  }
  if (typeof self !== 'undefined') {
    self.AISA = self.AISA || {};
    self.AISA.clipboard = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
