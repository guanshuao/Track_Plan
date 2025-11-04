(function () {
  const App = window.App;

  function savePhotoCenters(photoCenters, context) {
    if (!Array.isArray(photoCenters) || !photoCenters.length) {
      App.state.isSavingPhotoCenters = false;
      App.state.lastSaveStatus = { type: "error", message: "当前航迹没有摄影点可以保存。" };
      if (context) {
        App.ui.updatePlanInfoDisplay(context);
      }
      return;
    }
    App.state.lastSaveStatus = null;
    App.state.isSavingPhotoCenters = true;
    if (context) {
      App.ui.updatePlanInfoDisplay(context);
    }
    fetch("/save_flight_plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoCenters: photoCenters })
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("请求失败");
      }
      return response.json();
    }).then(function (data) {
      App.state.isSavingPhotoCenters = false;
      if (data && data.status === "ok" && data.filename) {
        App.state.lastSaveStatus = { type: "success", message: "摄影点坐标已保存为: " + data.filename };
      } else {
        App.state.lastSaveStatus = { type: "error", message: "摄影点坐标保存失败，请检查终端输出。" };
      }
      if (context) {
        App.ui.updatePlanInfoDisplay(context);
      }
    }).catch(function () {
      App.state.isSavingPhotoCenters = false;
      App.state.lastSaveStatus = { type: "error", message: "摄影点坐标保存失败，请检查终端输出。" };
      if (context) {
        App.ui.updatePlanInfoDisplay(context);
      }
    });
  }

  App.planStorage = {
    savePhotoCenters: savePhotoCenters
  };
})();
