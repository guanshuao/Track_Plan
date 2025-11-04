(function () {
  const App = window.App;
  if (!App) { return; }
  App.selection = {
    refreshOverlays: function () {
      App.selectionMarkers.updateMarkers();
      if (App.state.selectionFinished) {
        App.selectionMarkers.updatePolygon();
        App.selectionBounds.updateBoundingRect();
      } else {
        App.selectionMarkers.clearPolygon();
        App.selectionBounds.clearRectAnnotations();
        if (App.planVisuals) {
          App.planVisuals.clearFlightPlanOverlays();
        }
      }
    },
    resetSelection: function () {
      App.state.selectionFinished = false;
      App.state.points.length = 0;
      this.refreshOverlays();
    }
  };
})();
