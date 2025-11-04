(function () {
  const App = window.App;

  function ensurePlanPanelVisibility(show) {
    App.elements.planContainer.style.display = show ? "block" : "none";
    if (!show) {
      App.elements.planStatus.textContent = "";
      App.ui.resetPlanInfo();
    }
  }

  function updateFlightPlan() {
    if (!App.state.rectMetrics) {
      ensurePlanPanelVisibility(false);
      App.planVisuals.clearFlightPlanOverlays();
      return;
    }
    const options = App.ui.getPlanOptions();
    const plan = App.flightPlan.compute(App.state.rectMetrics, options);
    ensurePlanPanelVisibility(true);
    if (!plan) {
      App.state.planNeedsUpdate = true;
      App.elements.planStatus.textContent = "参数无效，无法生成航迹。请检查输入。";
      App.planVisuals.clearFlightPlanOverlays();
      return;
    }
    const geometry = App.flightPlan.generateGeometry(plan, App.state.rectMetrics, App.state.points.slice());
    plan.totalPhotosBeforeFilter = geometry.totalPhotosBeforeFilter;
    plan.totalPhotos = geometry.photoCenters.length;
    plan.removedPhotos = geometry.removedPhotos;
    plan.effectiveLineCount = geometry.activeLines;
    App.planVisuals.applyGeometry(plan, geometry);
    App.state.lastPlanContext = { plan: plan, metrics: App.state.rectMetrics, options: options, geometry: geometry };
    App.ui.updatePlanInfoDisplay(App.state.lastPlanContext);
    App.elements.planStatus.textContent = "";
  }

  function handlePlanButtonClick() {
    if (!App.state.rectMetrics) {
      ensurePlanPanelVisibility(true);
      App.elements.planStatus.textContent = "请先在地图上选取至少三个点以生成航迹。";
      return;
    }
    if (App.state.planNeedsUpdate || !App.state.flightPlan) {
      updateFlightPlan();
      return;
    }
    if (App.state.planDisplayState === "idle") {
      updateFlightPlan();
      return;
    }
    if (App.state.planDisplayState === "visible") {
      App.planVisuals.hideFlightPlan();
      return;
    }
    App.planVisuals.showFlightPlan();
  }

  function toggleFootprints() {
    App.planVisuals.setFootprintVisibility(!App.state.showFootprints);
  }

  function addPoint(lng, lat) {
    if (App.state.selectionFinished) { return; }
    App.state.points.push([lng, lat]);
    App.selection.refreshOverlays();
    App.uiCore.updateLists();
  }

  function finalizeSelection() {
    if (App.state.points.length < 3) {
      window.alert("至少需要 3 个点才能结束。");
      return;
    }
    App.state.selectionFinished = true;
    App.elements.finishBtn.style.display = "none";
    App.selection.refreshOverlays();
    App.uiCore.updateLists();
    ensurePlanPanelVisibility(true);
    App.elements.planStatus.textContent = "外接矩形已更新，请点击“生成/隐藏航迹”生成航迹。";
  }

  function resetSelection() {
    App.selection.resetSelection();
    App.elements.finishBtn.style.display = "";
    ensurePlanPanelVisibility(false);
    App.state.showFootprints = true;
    App.state.planNeedsUpdate = false;
    App.uiCore.updateLists();
    App.planVisuals.clearFlightPlanOverlays();
  }

  function savePhotoCenters() {
    if (App.state.isSavingPhotoCenters) { return; }
    const context = App.state.lastPlanContext;
    const geometry = context && context.geometry;
    const photoCenters = geometry && geometry.photoCenters;
    if (!context || !Array.isArray(photoCenters) || !photoCenters.length) {
      App.state.lastSaveStatus = { type: "error", message: "当前航迹没有摄影点可以保存。" };
      if (context) {
        App.ui.updatePlanInfoDisplay(context);
      }
      return;
    }
    App.planStorage.savePhotoCenters(photoCenters, context);
  }

  App.actions = {
    updateFlightPlan: updateFlightPlan,
    handlePlanButtonClick: handlePlanButtonClick,
    toggleFootprints: toggleFootprints,
    addPoint: addPoint,
    finalizeSelection: finalizeSelection,
    resetSelection: resetSelection,
    savePhotoCenters: savePhotoCenters
  };
})();
