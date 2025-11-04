(function () {
  const App = window.App;
  function detachOverlays() {
    const map = App.state.map;
    if (!map) { return; }
    if (App.state.routePolyline) { map.remove(App.state.routePolyline); }
    if (App.state.footprintPolygons.length) { map.remove(App.state.footprintPolygons); }
  }
  function attachOverlays() {
    const map = App.state.map;
    if (!map) { return; }
    if (App.state.routePolyline) { map.add(App.state.routePolyline); }
    if (App.state.footprintPolygons.length && App.state.showFootprints) { map.add(App.state.footprintPolygons); }
  }
  function setPlanDisplayState(state) {
    App.state.planDisplayState = state;
    if (App.ui && App.ui.syncPlanDisplayState) { App.ui.syncPlanDisplayState(); }
  }
  function clearFlightPlanOverlays() {
    detachOverlays();
    App.state.routePolyline = null;
    App.state.footprintPolygons = [];
    App.state.flightPlan = null;
    App.state.planNeedsUpdate = Boolean(App.state.rectMetrics);
    App.state.lastPlanContext = null;
    App.state.lastSaveStatus = null;
    App.state.isSavingPhotoCenters = false;
    setPlanDisplayState("idle");
    if (App.ui && App.ui.resetPlanInfo) { App.ui.resetPlanInfo(); }
  }
  function hideFlightPlan() {
    detachOverlays();
    setPlanDisplayState("hidden");
  }
  function showFlightPlan() {
    if (App.state.planNeedsUpdate || !App.state.flightPlan) {
      App.actions.updateFlightPlan();
      return;
    }
    attachOverlays();
    setPlanDisplayState("visible");
  }
  function applyGeometry(plan, geometry) {
    const map = App.state.map;
    if (!map) { return; }
    clearFlightPlanOverlays();
    if (geometry.path.length >= 2) {
      App.state.routePolyline = new AMap.Polyline({ path: geometry.path, strokeColor: "#1f77b4", strokeOpacity: 0.9, strokeWeight: 2, showDir: true, zIndex: 80 });
      map.add(App.state.routePolyline);
    }
    if (geometry.footprints.length) {
      App.state.footprintPolygons = geometry.footprints.map(function (coords) {
        return new AMap.Polygon({ path: coords, strokeColor: "#555555", strokeOpacity: 0.5, strokeWeight: 1, fillColor: "#ff9900", fillOpacity: 0.1, zIndex: 60 });
      });
      if (App.state.showFootprints) { map.add(App.state.footprintPolygons); }
    }
    App.state.flightPlan = plan;
    App.state.planNeedsUpdate = false;
    setPlanDisplayState("visible");
  }
  function setFootprintVisibility(visible) {
    App.state.showFootprints = visible;
    const map = App.state.map;
    if (!map || !App.state.footprintPolygons.length) { return; }
    if (visible && App.state.planDisplayState === "visible") { map.add(App.state.footprintPolygons); } else { map.remove(App.state.footprintPolygons); }
  }
  App.planVisuals = {
    clearFlightPlanOverlays: clearFlightPlanOverlays,
    hideFlightPlan: hideFlightPlan,
    showFlightPlan: showFlightPlan,
    applyGeometry: applyGeometry,
    setFootprintVisibility: setFootprintVisibility,
    detachOverlays: detachOverlays,
    attachOverlays: attachOverlays,
    setPlanDisplayState: setPlanDisplayState
  };
})();
