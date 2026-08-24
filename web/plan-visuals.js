(function () {
  const App = window.App;
  function detachOverlays() {
    const map = App.state.map;
    if (!map) { return; }
    try {
      if (App.state.routePolyline) { map.remove(App.state.routePolyline); }
    } catch (error) { /* State is cleared even if AMap rejects a stale overlay. */ }
    try {
      if (App.state.footprintPolygons.length) { map.remove(App.state.footprintPolygons); }
    } catch (error) { /* State is cleared even if AMap rejects stale overlays. */ }
  }
  function attachOverlays() {
    const map = App.state.map;
    if (!map) { return; }
    if (App.state.routePolyline) { map.add(App.state.routePolyline); }
    if (App.state.footprintPolygons.length && App.state.showFootprints) { map.add(App.state.footprintPolygons); }
  }
  function setPlanVisible(visible) {
    App.state.planVisible = visible;
    if (App.uiPlan) { App.uiPlan.syncPlanDisplayState(); }
  }
  function clearFlightPlanOverlays() {
    detachOverlays();
    App.state.routePolyline = null;
    App.state.footprintPolygons = [];
  }
  function hideFlightPlan() {
    detachOverlays();
    setPlanVisible(false);
  }
  function showFlightPlan() {
    if (!App.state.planContext || App.state.planContext.revision !== App.state.planRevision) {
      App.actions.updateFlightPlan();
      return;
    }
    attachOverlays();
    setPlanVisible(true);
  }
  function applyGeometry(geometry) {
    const map = App.state.map;
    clearFlightPlanOverlays();
    if (!map) {
      setPlanVisible(true);
      return;
    }
    if (geometry.path.length >= 2) {
      App.state.routePolyline = new AMap.Polyline({ path: geometry.path, strokeColor: "#0d7f78", strokeOpacity: 0.95, strokeWeight: 3, showDir: true, zIndex: 80 });
      map.add(App.state.routePolyline);
    }
    if (geometry.footprints.length) {
      App.state.footprintPolygons = geometry.footprints.map(function (coords) {
        return new AMap.Polygon({ path: coords, strokeColor: "#d68a25", strokeOpacity: 0.58, strokeWeight: 1, fillColor: "#f2a43a", fillOpacity: 0.12, zIndex: 60 });
      });
      if (App.state.showFootprints) { map.add(App.state.footprintPolygons); }
    }
    setPlanVisible(true);
  }
  function setFootprintVisibility(visible) {
    App.state.showFootprints = visible;
    const map = App.state.map;
    if (map && App.state.footprintPolygons.length) {
      if (visible && App.state.planVisible) { map.add(App.state.footprintPolygons); } else { map.remove(App.state.footprintPolygons); }
    }
    if (App.uiPlan) { App.uiPlan.syncPlanDisplayState(); }
  }
  App.planVisuals = {
    clearFlightPlanOverlays: clearFlightPlanOverlays,
    hideFlightPlan: hideFlightPlan,
    showFlightPlan: showFlightPlan,
    applyGeometry: applyGeometry,
    setFootprintVisibility: setFootprintVisibility
  };
})();
