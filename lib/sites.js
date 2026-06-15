/* lib/sites.js
 * 默认 AI 站点配置。
 * 在 content_script / sidepanel 中通过 <script> 顺序加载，挂到全局 AISA_SITES。
 * 也通过 ES import 给 service worker 使用。
 */

// 直接定义全局变量，content script 经典脚本上下文可直接读取
var AISA_DEFAULT_SITES = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    icon: 'assets/site-icons/chatgpt.png',
    color: '#10a37f'
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai/new',
    icon: 'assets/site-icons/claude.png',
    color: '#d97757'
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    icon: 'assets/site-icons/gemini.png',
    color: '#4285f4'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    icon: 'assets/site-icons/deepseek.png',
    color: '#4d6bfe'
  },
  {
    id: 'tongyi',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen/',
    icon: 'assets/site-icons/tongyi.png',
    color: '#615ced'
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    icon: 'assets/site-icons/kimi.png',
    color: '#1f1f1f'
  },
  {
    id: 'glm',
    name: '智谱清言',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    icon: 'assets/site-icons/glm.png',
    color: '#0052ff'
  },
  {
    id: 'yiyan',
    name: '文心一言',
    url: 'https://yiyan.baidu.com/',
    icon: 'assets/site-icons/yiyan.png',
    color: '#2932e1'
  }
];

// 同时导出为 ES module（service worker 用 import）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AISA_DEFAULT_SITES;
}
