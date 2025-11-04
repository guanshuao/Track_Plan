(function () {
  const App = window.App;

  function registerPlanInputListeners() {
    App.ui.getPlanInputs().forEach(function (input) {
      input.addEventListener("change", App.ui.handlePlanInputChange);
      input.addEventListener("input", App.ui.handlePlanInputChange);
    });
  }

  function bindEvents() {
    const map = App.state.map;
    if (map) {
      map.on("click", function (e) {
        App.actions.addPoint(e.lnglat.getLng(), e.lnglat.getLat());
      });
    }
    App.elements.finishBtn.addEventListener("click", App.actions.finalizeSelection);
    App.elements.resetBtn.addEventListener("click", App.actions.resetSelection);
    App.elements.planPrimaryBtn.addEventListener("click", App.actions.handlePlanButtonClick);
    App.elements.toggleFootprintsBtn.addEventListener("click", App.actions.toggleFootprints);
    App.elements.savePhotoCentersBtn.addEventListener("click", App.actions.savePhotoCenters);
    App.elements.basemapSelect.addEventListener("change", function () {
      App.mapSetup.switchBaseLayer(App.elements.basemapSelect.value);
    });
    registerPlanInputListeners();
  }

  App.events = {
    bind: bindEvents
  };
})();
