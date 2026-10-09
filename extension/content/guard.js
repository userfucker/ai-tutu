/**
 * AI图图 · 拖图保护（document_start 时加载，比网页自己的代码先注册）
 *
 * Copilot 在整个窗口上监听拖放：图片拖到我们的面板上，Copilot 也会收一份当附件（Lee 2026-10-09 反馈）。
 * 这里在 window 的捕获阶段最先拿到拖放事件：如果是拖在面板上，就不再往下传（网页收不到），
 * 交给面板（panel.js 设置的 window.__aitutuDragHook）处理。拖在面板外面的不管，网页照常处理。
 */
(() => {
  if (window.__aitutuGuard) return;
  window.__aitutuGuard = true;
  const onPanel = (e) => e.composedPath().some((n) => n && n.id === "aitutu-panel-host");
  let wasOnPanel = false;
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    window.addEventListener(
      type,
      (e) => {
        if (!onPanel(e)) {
          if (wasOnPanel && type !== "dragleave" && window.__aitutuDragLeave) window.__aitutuDragLeave();
          wasOnPanel = false;
          return;
        }
        wasOnPanel = type !== "drop";
        e.stopImmediatePropagation();
        if (type === "dragleave") return;
        if (window.__aitutuDragHook) window.__aitutuDragHook(e);
        if (type === "drop") {
          // 让网页把自己的“拖放提示层”收起来（它没收到 drop）
          setTimeout(() => {
            document.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
            window.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
          }, 0);
        }
      },
      true,
    );
  }
})();
