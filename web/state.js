(function () {
  const App = window.App || (window.App = {});
  App.state = {
    map: null,
    points: [],
    markers: [],
    polygon: null,
    boundingRect: null,
    rectEdgeLabels: [],
    selectionFinished: false,
    selectionError: null,
    rectMetrics: null,
    routePolyline: null,
    footprintPolygons: [],
    showFootprints: true,
    planRevision: 0,
    planContext: null,
    planVisible: false,
    saveStatus: null,
    isSavingPhotoCenters: false,
  };
  App.runtime = {
    saveController: null,
    saveRequestId: 0,
    amapLoadPromise: null,
    amapAttempt: 0,
    mapInitAttempt: 0,
    mapClickHandler: null,
    domEventsBound: false,
    serviceState: "active"
  };
  App.elements = {};
  App.constants = {
    EARTH_RADIUS: 6378137,
    LENGTH_EPSILON_METERS: 1e-6,
    MIN_SELECTION_AREA_SQM: 1,
    MAX_SELECTION_POINTS: 500,
    MAX_SELECTION_RADIUS_METERS: 250000,
    MAX_CANDIDATE_PHOTOS: 20000,
    MAX_GEOMETRY_WORK_UNITS: 2000000,
    MAX_RENDERED_FOOTPRINTS: 1200
  };
})();
