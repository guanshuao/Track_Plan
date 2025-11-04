(function () {
  const App = window.App;
  if (!App) { return; }
  App.ui = {
    cacheElements: function () { App.uiCore.cacheElements(); },
    updateLists: function () { App.uiCore.updateLists(); },
    updateStatus: function () { App.uiCore.updateStatus(); },
    getPlanInputs: function () { return App.uiPlan.getPlanInputs(); },
    getPlanOptions: function () { return App.uiPlan.getPlanOptions(); },
    handlePlanInputChange: function () { App.uiPlan.handlePlanInputChange(); },
    updatePlanInfoDisplay: function (context) { App.uiPlan.updatePlanInfoDisplay(context); },
    resetPlanInfo: function () { App.uiPlan.resetPlanInfo(); },
    syncPlanDisplayState: function () { App.uiPlan.syncPlanDisplayState(); }
  };
})();
