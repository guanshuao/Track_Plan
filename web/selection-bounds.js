(function () {
  const App = window.App;
  const utils = App.utils;

  function clearRectAnnotations() {
    if (App.state.boundingRect) {
      App.state.map.remove(App.state.boundingRect);
      App.state.boundingRect = null;
    }
    if (App.state.rectEdgeLabels.length) {
      App.state.map.remove(App.state.rectEdgeLabels);
      App.state.rectEdgeLabels = [];
    }
    App.state.rectVertices = [];
    App.state.rectMetrics = null;
  }

  function addRectEdgeLabels(metrics) {
    const map = App.state.map;
    if (!map || !metrics) { return; }
    const midLng = (metrics.west + metrics.east) / 2;
    const midLat = (metrics.north + metrics.south) / 2;
    const horiz = utils.formatDistance(metrics.width);
    const vert = utils.formatDistance(metrics.height);
    App.state.rectEdgeLabels = [
      new AMap.Text({ text: "东西长: " + horiz, position: [midLng, metrics.north], offset: new AMap.Pixel(-60, -20) }),
      new AMap.Text({ text: "东西长: " + horiz, position: [midLng, metrics.south], offset: new AMap.Pixel(-60, 4) }),
      new AMap.Text({ text: "南北长: " + vert, position: [metrics.west, midLat], offset: new AMap.Pixel(-80, -10) }),
      new AMap.Text({ text: "南北长: " + vert, position: [metrics.east, midLat], offset: new AMap.Pixel(12, -10) })
    ];
    map.add(App.state.rectEdgeLabels);
  }

  function updateBoundingRect() {
    clearRectAnnotations();
    if (!App.state.map || !App.state.selectionFinished || App.state.points.length < 3) {
      if (App.planVisuals) {
        App.planVisuals.clearFlightPlanOverlays();
      }
      return;
    }
    const lngs = App.state.points.map(function (p) { return p[0]; });
    const lats = App.state.points.map(function (p) { return p[1]; });
    const west = Math.min.apply(null, lngs);
    const east = Math.max.apply(null, lngs);
    const south = Math.min.apply(null, lats);
    const north = Math.max.apply(null, lats);
    const bounds = new AMap.Bounds([west, south], [east, north]);
    App.state.boundingRect = new AMap.Rectangle({
      bounds: bounds,
      strokeColor: "#0066ff",
      strokeOpacity: 0.5,
      strokeWeight: 2,
      fillColor: "#0066ff",
      fillOpacity: 0.1
    });
    App.state.map.add(App.state.boundingRect);
    App.state.rectVertices = [[west, north], [east, north], [east, south], [west, south]];
    const widthNorth = utils.haversineDistance(west, north, east, north);
    const widthSouth = utils.haversineDistance(west, south, east, south);
    const heightWest = utils.haversineDistance(west, north, west, south);
    const heightEast = utils.haversineDistance(east, north, east, south);
    App.state.rectMetrics = {
      west: west,
      east: east,
      south: south,
      north: north,
      width: (widthNorth + widthSouth) / 2,
      height: (heightWest + heightEast) / 2
    };
    App.state.planNeedsUpdate = true;
    addRectEdgeLabels(App.state.rectMetrics);
    if (App.planVisuals) {
      App.planVisuals.clearFlightPlanOverlays();
    }
  }

  App.selectionBounds = {
    clearRectAnnotations: clearRectAnnotations,
    updateBoundingRect: updateBoundingRect
  };
})();
