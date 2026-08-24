(function () {
  const App = window.App;
  async function initializeMap(forceRetry) {
    if (App.runtime.serviceState !== "active") { return; }
    const initAttempt = App.runtime.mapInitAttempt + 1;
    App.runtime.mapInitAttempt = initAttempt;
    const overlay = App.elements.mapStatusOverlay;
    const spinner = overlay.querySelector(".loading-spinner");
    overlay.classList.remove("is-hidden");
    spinner.classList.remove("is-hidden");
    App.elements.retryMapBtn.classList.add("is-hidden");
    App.elements.mapStatusText.textContent = "正在连接地图服务…";
    App.elements.mapStatusText.setAttribute("role", "status");
    App.elements.mapStatusText.setAttribute("aria-live", "polite");
    App.elements.basemapSelect.disabled = true;
    try {
      await App.mapSetup.loadApi(Boolean(forceRetry));
      if (initAttempt !== App.runtime.mapInitAttempt || App.runtime.serviceState !== "active") { return; }
      await App.mapSetup.initMap(Boolean(forceRetry));
      if (initAttempt !== App.runtime.mapInitAttempt || App.runtime.serviceState !== "active") { return; }
      App.selection.refreshOverlays();
      App.uiCore.updateLists();
      if (App.state.selectionFinished && App.state.rectMetrics) {
        App.elements.planContainer.classList.remove("is-hidden");
        if (forceRetry && App.state.planContext) {
          App.actions.invalidateFlightPlan("地图已重新连接，请重新生成航迹。");
        } else if (App.state.planContext && App.state.planContext.revision === App.state.planRevision) {
          const restorePlanVisible = App.state.planVisible;
          try {
            App.planVisuals.applyGeometry(App.state.planContext.geometry);
            if (!restorePlanVisible) { App.planVisuals.hideFlightPlan(); }
          } catch (error) {
            App.actions.invalidateFlightPlan("地图已连接，但航迹渲染失败，请重新生成。");
          }
        }
        App.uiPlan.syncPlanDisplayState();
      }
      App.mapSetup.switchBaseLayer(App.elements.basemapSelect.value);
      App.events.bindMap();
      App.actions.fitMissionView(Boolean(App.state.planVisible && App.state.routePolyline));
      App.elements.basemapSelect.disabled = false;
      overlay.classList.add("is-hidden");
    } catch (error) {
      if (initAttempt !== App.runtime.mapInitAttempt || App.runtime.serviceState !== "active") { return; }
      spinner.classList.add("is-hidden");
      App.elements.mapStatusText.textContent = error.message || "地图初始化失败。";
      App.elements.mapStatusText.setAttribute("role", "alert");
      App.elements.mapStatusText.setAttribute("aria-live", "assertive");
      App.elements.retryMapBtn.classList.remove("is-hidden");
    }
  }

  function initialize() {
    App.uiCore.cacheElements();
    App.uiCore.updateLists();
    App.elements.planContainer.classList.add("is-hidden");
    App.elements.planStatus.textContent = "";
    App.planVisuals.setFootprintVisibility(App.state.showFootprints);
    App.events.bind();
    initializeMap(false);
  }

  App.bootstrap = { initializeMap: initializeMap };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
