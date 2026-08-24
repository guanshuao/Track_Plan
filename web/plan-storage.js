(function () {
  const App = window.App;

  function sessionToken() {
    const element = document.querySelector('meta[name="track-plan-token"]');
    return element ? element.content : "";
  }

  function cancelPendingSave() {
    if (App.runtime.saveController) { App.runtime.saveController.abort(); }
    App.runtime.saveController = null;
    App.runtime.saveRequestId += 1;
    App.state.isSavingPhotoCenters = false;
  }

  function savePhotoCenters(context) {
    const records = context && context.geometry && context.geometry.photoRecords;
    if (!context || context !== App.state.planContext || context.revision !== App.state.planRevision ||
      !Array.isArray(records) || !records.length) {
      App.state.isSavingPhotoCenters = false;
      App.state.saveStatus = { type: "error", message: "当前航迹已失效或没有摄影点，请重新生成。" };
      if (context) { App.uiPlan.updatePlanInfoDisplay(context); }
      return Promise.resolve();
    }
    cancelPendingSave();
    const requestId = App.runtime.saveRequestId + 1;
    App.runtime.saveRequestId = requestId;
    const controller = new AbortController();
    App.runtime.saveController = controller;
    App.state.saveStatus = null;
    App.state.isSavingPhotoCenters = true;
    App.uiPlan.updatePlanInfoDisplay(context);
    let timedOut = false;
    const timeoutId = window.setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, 15000);
    return fetch("/save_flight_plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionToken(), photoRecords: records }),
      signal: controller.signal
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) { throw new Error(data.message || "保存请求失败（" + response.status + "）"); }
        return data;
      });
    }).then(function (data) {
      if (requestId !== App.runtime.saveRequestId || context.revision !== App.state.planRevision ||
        context !== App.state.planContext) { return; }
      if (!data || data.status !== "ok" || !data.filename || data.count !== records.length) {
        throw new Error("后端返回的摄影点数量与当前任务不一致。");
      }
      App.state.saveStatus = { type: "success", message: "已保存 " + data.count + " 个摄影点：" + data.filename };
    }).catch(function (error) {
      if (requestId !== App.runtime.saveRequestId) { return; }
      if (error.name === "AbortError") {
        if (timedOut) {
          App.state.saveStatus = { type: "error", message: "保存请求超时；文件可能已写入，请先检查输出目录，确认后再重试。" };
        }
        return;
      }
      App.state.saveStatus = { type: "error", message: error.message || "摄影点坐标保存失败。" };
    }).finally(function () {
      window.clearTimeout(timeoutId);
      if (requestId !== App.runtime.saveRequestId) { return; }
      App.runtime.saveController = null;
      App.state.isSavingPhotoCenters = false;
      if (context === App.state.planContext && context.revision === App.state.planRevision) {
        App.uiPlan.updatePlanInfoDisplay(context);
      }
    });
  }

  App.planStorage = {
    savePhotoCenters: savePhotoCenters,
    cancelPendingSave: cancelPendingSave
  };
})();
