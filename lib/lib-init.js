/* lib/lib-init.js
 * 最先加载，建立全局命名空间 window.AISA。
 * 供后续 lib.js / content.js 共用。
 */
(function () {
  if (window.AISA) return;
  window.AISA = {
    // 运行时缓存：当前页设置（由 background 下发）
    settings: null,
    // 标记是否已初始化（防止重复注入）
    initialized: false,
    // 浮动按钮元素
    floatBtn: null,
    // 当前选中文本
    lastSelection: '',
    // 内部工具
    util: {}
  };
})();
