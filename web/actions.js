(function () {
  const App = window.App;

  function ensurePlanPanelVisibility(show) {
    App.elements.planContainer.classList.toggle("is-hidden", !show);
    if (!show) {
      App.elements.planStatus.textContent = "";
      App.uiPlan.resetPlanInfo();
    }
  }

  function fitMissionView(includeRoute) {
    const map = App.state.map;
    if (!map || typeof map.setFitView !== "function") { return; }
    const overlays = [App.state.polygon, App.state.boundingRect];
    if (includeRoute) { overlays.push(App.state.routePolyline); }
    const visibleOverlays = overlays.filter(Boolean);
    if (!visibleOverlays.length) { return; }
    const padding = window.innerWidth <= 720 ? [78, 30, 46, 30] : [96, 370, 76, 410];
    try { map.setFitView(visibleOverlays, false, padding, 18); } catch (error) { /* Auto-fit is optional. */ }
  }

  function updateFlightPlan() {
    if (!App.state.rectMetrics) {
      ensurePlanPanelVisibility(false);
      App.planVisuals.clearFlightPlanOverlays();
      return;
    }
    let options;
    try {
      options = App.uiPlan.getPlanOptions();
    } catch (error) {
      App.elements.planStatus.textContent = error.message;
      App.elements.planStatus.classList.add("status-error");
      return;
    }
    const plan = App.flightPlan.compute(App.state.rectMetrics, options);
    ensurePlanPanelVisibility(true);
    if (!plan || plan.error) {
      App.state.planContext = null;
      App.elements.planStatus.textContent = plan && plan.error ? plan.error : "参数无效，无法生成航迹。";
      App.elements.planStatus.classList.add("status-error");
      App.planVisuals.clearFlightPlanOverlays();
      return;
    }
    let geometry;
    try {
      geometry = App.flightPlan.generateGeometry(plan, App.state.rectMetrics);
    } catch (error) {
      App.state.planContext = null;
      App.elements.planStatus.textContent = error.message || "航迹生成失败。";
      App.elements.planStatus.classList.add("status-error");
      return;
    }
    plan.totalPhotosBeforeFilter = geometry.totalPhotosBeforeFilter;
    plan.totalPhotos = geometry.photoRecords.length;
    plan.removedPhotos = geometry.removedPhotos;
    plan.effectiveLineCount = geometry.activeLines;
    App.state.planContext = { revision: App.state.planRevision, plan: plan, metrics: App.state.rectMetrics, options: options, geometry: geometry };
    try {
      App.planVisuals.applyGeometry(geometry);
    } catch (error) {
      App.planVisuals.clearFlightPlanOverlays();
      App.state.planContext = null;
      App.state.planVisible = false;
      App.elements.planStatus.textContent = "航迹已计算，但地图渲染失败，请重试或重新连接地图。";
      App.elements.planStatus.classList.add("status-error");
      App.uiPlan.resetPlanInfo();
      App.uiPlan.syncPlanDisplayState();
      return;
    }
    App.uiPlan.updatePlanInfoDisplay(App.state.planContext);
    App.elements.planStatus.textContent = "航迹已生成，共 " + plan.totalPhotos + " 个摄影点。";
    App.elements.planStatus.classList.remove("status-error");
    fitMissionView(true);
  }

  function invalidateFlightPlan(message) {
    App.state.planRevision += 1;
    App.planStorage.cancelPendingSave();
    App.planVisuals.clearFlightPlanOverlays();
    App.state.planContext = null;
    App.state.planVisible = false;
    App.state.saveStatus = null;
    App.uiPlan.resetPlanInfo();
    if (App.elements.planStatus) {
      App.elements.planStatus.classList.remove("status-error");
      if (message) { App.elements.planStatus.textContent = message; }
    }
    App.uiPlan.syncPlanDisplayState();
  }

  function handlePlanButtonClick() {
    if (!App.state.rectMetrics) {
      ensurePlanPanelVisibility(true);
      App.elements.planStatus.textContent = "请先在地图上选取至少三个点以生成航迹。";
      return;
    }
    if (!App.state.planContext || App.state.planContext.revision !== App.state.planRevision) {
      updateFlightPlan();
      return;
    }
    if (App.state.planVisible) {
      App.planVisuals.hideFlightPlan();
      return;
    }
    App.planVisuals.showFlightPlan();
  }

  function toggleFootprints() {
    App.planVisuals.setFootprintVisibility(!App.state.showFootprints);
  }

  function addPoint(lng, lat) {
    if (App.state.selectionFinished) { return { ok: false, message: "选区已完成，请先撤销或重新开始。" }; }
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      App.state.selectionError = "请输入有效的经纬度范围。";
      App.uiCore.updateStatus();
      return { ok: false, message: App.state.selectionError };
    }
    if (App.state.points.length >= App.constants.MAX_SELECTION_POINTS) {
      App.state.selectionError = "选区顶点已达到 " + App.constants.MAX_SELECTION_POINTS + " 个上限。";
      App.uiCore.updateStatus();
      return { ok: false, message: App.state.selectionError };
    }
    const tooClose = App.state.points.some(function (point) {
      return App.utils.haversineDistance(point[0], point[1], lng, lat) < 0.05;
    });
    if (tooClose) {
      App.state.selectionError = "该点与已有顶点重复或距离过近。";
      App.uiCore.updateStatus();
      return { ok: false, message: App.state.selectionError };
    }
    App.state.selectionError = null;
    App.state.points.push([lng, lat]);
    App.selection.refreshOverlays();
    App.uiCore.updateLists();
    return { ok: true };
  }

  function removePoint(index) {
    if (App.state.selectionFinished || !Number.isInteger(index) || index < 0 || index >= App.state.points.length) { return; }
    App.state.points.splice(index, 1);
    App.state.selectionError = null;
    App.selection.refreshOverlays();
    App.uiCore.updateLists();
  }

  function undoLastPoint() {
    if (!App.state.points.length) { return; }
    if (App.state.selectionFinished) {
      App.state.selectionFinished = false;
      App.elements.finishBtn.classList.remove("is-hidden");
      invalidateFlightPlan("");
    }
    App.state.points.pop();
    App.state.selectionError = null;
    App.selection.refreshOverlays();
    App.uiCore.updateLists();
    ensurePlanPanelVisibility(false);
  }

  function finalizeSelection() {
    const analysis = App.selection.analyzePoints(App.state.points);
    if (!analysis.ok) {
      App.state.selectionError = analysis.message;
      App.uiCore.updateStatus();
      return;
    }
    App.state.selectionError = null;
    App.state.selectionFinished = true;
    App.elements.finishBtn.classList.add("is-hidden");
    App.elements.manualLngInput.value = "";
    App.elements.manualLatInput.value = "";
    App.elements.manualPointError.textContent = "";
    App.elements.manualPointDetails.open = false;
    App.selection.refreshOverlays(analysis);
    App.uiCore.updateLists();
    ensurePlanPanelVisibility(true);
    invalidateFlightPlan("优化边界已建立，请生成航迹。");
    fitMissionView(false);
    App.elements.planPrimaryBtn.focus();
  }

  function resetSelection(skipConfirmation) {
    if (skipConfirmation !== true && App.state.points.length && !window.confirm("确定清空当前选区和规划结果吗？")) { return; }
    App.planStorage.cancelPendingSave();
    App.planVisuals.clearFlightPlanOverlays();
    App.state.planContext = null;
    App.state.saveStatus = null;
    App.selection.resetSelection();
    App.elements.finishBtn.classList.remove("is-hidden");
    ensurePlanPanelVisibility(false);
    App.state.showFootprints = true;
    App.state.planVisible = false;
    App.uiCore.updateLists();
    App.state.planRevision += 1;
    App.uiPlan.syncPlanDisplayState();
    App.elements.manualLngInput.value = "";
    App.elements.manualLatInput.value = "";
    App.elements.manualPointError.textContent = "";
    App.elements.manualPointDetails.open = false;
    App.elements.resetBtn.focus();
  }

  function savePhotoCenters() {
    if (App.state.isSavingPhotoCenters) { return; }
    const context = App.state.planContext;
    const geometry = context && context.geometry;
    const photoRecords = geometry && geometry.photoRecords;
    if (!context || context.revision !== App.state.planRevision || !Array.isArray(photoRecords) || !photoRecords.length) {
      App.state.saveStatus = { type: "error", message: "当前航迹没有摄影点可以保存。" };
      if (context) {
        App.uiPlan.updatePlanInfoDisplay(context);
      }
      return;
    }
    App.planStorage.savePhotoCenters(context);
  }

  function addManualPoint() {
    const lngInput = App.elements.manualLngInput;
    const latInput = App.elements.manualLatInput;
    const invalidInput = [lngInput, latInput].find(function (input) {
      return input.value.trim() === "" || !input.checkValidity();
    });
    if (invalidInput) {
      App.elements.manualPointError.textContent = "请填写有效的经度和纬度。";
      invalidInput.reportValidity();
      invalidInput.focus();
      return;
    }
    const lng = Number(lngInput.value);
    const lat = Number(latInput.value);
    const result = addPoint(lng, lat);
    App.elements.manualPointError.textContent = result.ok ? "" : result.message;
    if (result.ok) {
      lngInput.value = "";
      latInput.value = "";
      lngInput.focus();
    }
  }

  function shutdownServer() {
    if (!window.confirm("关闭本地服务后，本页面将无法继续使用。确定关闭吗？")) { return; }
    const tokenElement = document.querySelector('meta[name="track-plan-token"]');
    App.runtime.serviceState = "stopping";
    App.runtime.mapInitAttempt += 1;
    App.runtime.amapAttempt += 1;
    App.elements.shutdownBtn.disabled = true;
    fetch("/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenElement ? tokenElement.content : "", reason: "explicit_user_action" })
    }).then(function (response) {
      if (!response.ok) { throw new Error("关闭请求失败"); }
      App.runtime.serviceState = "stopped";
      App.elements.mapStatusOverlay.classList.remove("is-hidden");
      App.elements.mapStatusOverlay.querySelector(".loading-spinner").classList.add("is-hidden");
      App.elements.mapStatusText.textContent = "本地服务已关闭，可以安全关闭此页面。";
      App.elements.mapStatusText.setAttribute("role", "status");
      App.elements.mapStatusText.setAttribute("aria-live", "polite");
      App.elements.retryMapBtn.classList.add("is-hidden");
      App.elements.basemapSelect.disabled = true;
    }).catch(function () {
      App.runtime.serviceState = "active";
      App.elements.shutdownBtn.disabled = false;
      App.elements.planStatus.textContent = "无法关闭服务，请在终端按 Ctrl+C。";
      App.elements.planStatus.classList.add("status-error");
      if (!App.state.map) { App.bootstrap.initializeMap(true); }
    });
  }

  App.actions = {
    updateFlightPlan: updateFlightPlan,
    invalidateFlightPlan: invalidateFlightPlan,
    handlePlanButtonClick: handlePlanButtonClick,
    toggleFootprints: toggleFootprints,
    addPoint: addPoint,
    removePoint: removePoint,
    undoLastPoint: undoLastPoint,
    addManualPoint: addManualPoint,
    finalizeSelection: finalizeSelection,
    resetSelection: resetSelection,
    savePhotoCenters: savePhotoCenters,
    shutdownServer: shutdownServer,
    fitMissionView: fitMissionView
  };
})();
