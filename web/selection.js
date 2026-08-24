(function () {
  const App = window.App;
  const utils = App.utils;
  const geom = App.geometry;

  function updateMarkers() {
    const map = App.state.map;
    if (!map) { return; }
    if (App.state.markers.length) { map.remove(App.state.markers); }
    App.state.markers = App.state.points.map(function (lnglat, index) {
      return new AMap.Marker({
        position: lnglat,
        label: { content: String(index + 1), direction: "bottom" }
      });
    });
    if (App.state.markers.length) { map.add(App.state.markers); }
  }

  function clearPolygon() {
    if (App.state.polygon && App.state.map) { App.state.map.remove(App.state.polygon); }
    App.state.polygon = null;
  }

  function updatePolygon() {
    clearPolygon();
    if (!App.state.map || App.state.points.length < 3) { return; }
    App.state.polygon = new AMap.Polygon({
      path: App.state.points,
      strokeColor: "#ff0000",
      strokeOpacity: 0.3,
      strokeWeight: 2,
      fillColor: "#ff0000",
      fillOpacity: 0.1
    });
    App.state.map.add(App.state.polygon);
  }

  function clearRect() {
    if (App.state.boundingRect && App.state.map) { App.state.map.remove(App.state.boundingRect); }
    if (App.state.rectEdgeLabels.length && App.state.map) { App.state.map.remove(App.state.rectEdgeLabels); }
    App.state.boundingRect = null;
    App.state.rectEdgeLabels = [];
    App.state.rectMetrics = null;
  }

  function analyzePoints(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return { ok: false, message: "至少需要 3 个点才能形成选区。" };
    }
    const invalidCoordinate = points.some(function (point) {
      return !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
        point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90;
    });
    if (invalidCoordinate) { return { ok: false, message: "选区包含超出经纬度范围的坐标。" }; }
    const projection = utils.createLocalProjection(points);
    if (!projection) { return { ok: false, message: "选区跨度过大，无法建立稳定的局部坐标系。" }; }
    const projectedPolygon = points.map(function (point) { return utils.projectLngLat(point, projection); });
    const maximumRadius = projectedPolygon.reduce(function (current, point) {
      return Math.max(current, Math.hypot(point[0], point[1]));
    }, 0);
    if (!Number.isFinite(maximumRadius) || maximumRadius > App.constants.MAX_SELECTION_RADIUS_METERS) {
      return { ok: false, message: "选区距中心最远不得超过 250 公里，请拆分为多个任务。" };
    }
    const validation = geom.validateSimplePolygon(projectedPolygon, App.constants.MIN_SELECTION_AREA_SQM);
    if (!validation.ok) { return validation; }
    const rectangle = geom.minimumAreaRectangle(projectedPolygon);
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) {
      return { ok: false, message: "无法计算有效的旋转外接矩形。" };
    }
    return {
      ok: true,
      metrics: {
        projection: projection,
        projectedPolygon: projectedPolygon,
        polygonBounds: geom.polygonBoundingBox(projectedPolygon),
        projectedCorners: rectangle.corners,
        origin: rectangle.origin,
        axisX: rectangle.axisX,
        axisY: rectangle.axisY,
        width: rectangle.width,
        height: rectangle.height,
        cornerLngLats: rectangle.corners.map(function (point) { return utils.unprojectXY(point, projection); })
      }
    };
  }

  function addRectLabels(metrics) {
    if (!App.state.map || !metrics) { return; }
    const midpoint = function (a, b) {
      return utils.unprojectXY([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], metrics.projection);
    };
    const corners = metrics.projectedCorners;
    App.state.rectEdgeLabels = [
      new AMap.Text({ text: "边长 " + utils.formatDistance(metrics.width), position: midpoint(corners[0], corners[1]), offset: new AMap.Pixel(-48, -18) }),
      new AMap.Text({ text: "边长 " + utils.formatDistance(metrics.height), position: midpoint(corners[1], corners[2]), offset: new AMap.Pixel(8, -10) })
    ];
    App.state.map.add(App.state.rectEdgeLabels);
  }

  function updateBoundingRect(precomputedAnalysis) {
    clearRect();
    if (!App.state.selectionFinished || App.state.points.length < 3) { return; }
    const analysis = precomputedAnalysis || analyzePoints(App.state.points);
    if (!analysis.ok) {
      App.state.selectionError = analysis.message;
      return;
    }
    App.state.selectionError = null;
    App.state.rectMetrics = analysis.metrics;
    if (!App.state.map) { return; }
    App.state.boundingRect = new AMap.Polygon({
      path: analysis.metrics.cornerLngLats,
      strokeColor: "#0066ff",
      strokeOpacity: 0.75,
      strokeWeight: 2,
      fillColor: "#0066ff",
      fillOpacity: 0.07,
      strokeStyle: "dashed"
    });
    App.state.map.add(App.state.boundingRect);
    addRectLabels(analysis.metrics);
  }

  function refreshOverlays(precomputedAnalysis) {
    updateMarkers();
    if (App.state.selectionFinished) {
      updatePolygon();
      updateBoundingRect(precomputedAnalysis);
    } else {
      clearPolygon();
      clearRect();
    }
  }

  function resetSelection() {
    App.state.selectionFinished = false;
    App.state.selectionError = null;
    App.state.points.length = 0;
    refreshOverlays();
  }

  App.selection = {
    analyzePoints: analyzePoints,
    refreshOverlays: refreshOverlays,
    resetSelection: resetSelection
  };
})();
