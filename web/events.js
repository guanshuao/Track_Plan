(function () {
  const App = window.App;

  function registerPlanInputListeners() {
    App.uiPlan.getPlanInputs().forEach(function (input) {
      input.addEventListener("input", App.uiPlan.handlePlanInputChange);
    });
  }

  function bindMapEvents() {
    const map = App.state.map;
    if (!map || App.runtime.mapClickHandler) { return; }
    App.runtime.mapClickHandler = function (e) {
      App.actions.addPoint(e.lnglat.getLng(), e.lnglat.getLat());
    };
    map.on("click", App.runtime.mapClickHandler);
  }

  function bindEvents() {
    if (App.runtime.domEventsBound) { return; }
    App.runtime.domEventsBound = true;
    App.elements.finishBtn.addEventListener("click", App.actions.finalizeSelection);
    App.elements.resetBtn.addEventListener("click", function () { App.actions.resetSelection(false); });
    App.elements.undoPointBtn.addEventListener("click", App.actions.undoLastPoint);
    App.elements.manualPointForm.addEventListener("submit", function (event) {
      event.preventDefault();
      App.actions.addManualPoint();
    });
    App.elements.pointsList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-point-index]");
      if (button) { App.actions.removePoint(Number(button.dataset.pointIndex)); }
    });
    App.elements.planPrimaryBtn.addEventListener("click", App.actions.handlePlanButtonClick);
    App.elements.toggleFootprintsBtn.addEventListener("click", App.actions.toggleFootprints);
    App.elements.savePhotoCentersBtn.addEventListener("click", App.actions.savePhotoCenters);
    App.elements.basemapSelect.addEventListener("change", function () {
      App.mapSetup.switchBaseLayer(App.elements.basemapSelect.value);
    });
    App.elements.retryMapBtn.addEventListener("click", function () { App.bootstrap.initializeMap(true); });
    App.elements.shutdownBtn.addEventListener("click", App.actions.shutdownServer);
    registerPlanInputListeners();
  }

  App.events = {
    bind: bindEvents,
    bindMap: bindMapEvents
  };
})();
