(function () {
  const App = window.App;
  let shutdownNotified = false;

  function notifyShutdown() {
    if (shutdownNotified) {
      return;
    }
    shutdownNotified = true;
    const payload = JSON.stringify({ reason: "page_hidden" });
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/shutdown", blob);
      } else {
        fetch("/shutdown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true
        }).catch(function () {
          // Best-effort shutdown; ignore network errors during page unload.
        });
      }
    } catch (err) {
      console.warn("Failed to notify backend shutdown", err);
    }
  }

  function registerShutdownHook() {
    window.addEventListener("pagehide", notifyShutdown);
    window.addEventListener("beforeunload", notifyShutdown);
  }

  function initialize() {
    App.ui.cacheElements();
    App.mapSetup.initMap();
    App.selection.refreshOverlays();
    App.uiCore.updateLists();
    App.elements.planContainer.style.display = "none";
    App.elements.planStatus.textContent = "";
    App.planVisuals.setFootprintVisibility(App.state.showFootprints);
    App.ui.syncPlanDisplayState();
    App.events.bind();
    registerShutdownHook();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
