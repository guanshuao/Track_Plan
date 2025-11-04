(function () {
  const App = window.App || (window.App = {});
  App.state = {
    map: null,
    baseLayers: {},
    layerConfig: {},
    points: [],
    markers: [],
    polygon: null,
    boundingRect: null,
    rectVertices: [],
    rectEdgeLabels: [],
    selectionFinished: false,
    rectMetrics: null,
    routePolyline: null,
    footprintPolygons: [],
    showFootprints: true,
    flightPlan: null,
    planNeedsUpdate: false,
    lastPlanContext: null,
    lastSaveStatus: null,
    isSavingPhotoCenters: false,
    planDisplayState: "idle"
  };
  App.elements = {};
  App.constants = {
    EARTH_RADIUS: 6378137,
    GEOMETRY_EPSILON: 1e-9
  };
})();
