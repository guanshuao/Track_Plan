(function () {
  const App = window.App;

  function updateMarkers() {
    const map = App.state.map;
    if (!map) { return; }
    if (App.state.markers.length) {
      map.remove(App.state.markers);
    }
    App.state.markers = App.state.points.map(function (lnglat, index) {
      return new AMap.Marker({
        position: lnglat,
        label: { content: (index + 1).toString(), direction: "bottom" }
      });
    });
    if (App.state.markers.length) {
      map.add(App.state.markers);
    }
  }

  function clearPolygon() {
    if (App.state.polygon) {
      App.state.map.remove(App.state.polygon);
      App.state.polygon = null;
    }
  }

  function updatePolygon() {
    const map = App.state.map;
    clearPolygon();
    if (!map || App.state.points.length < 3) {
      return;
    }
    App.state.polygon = new AMap.Polygon({
      path: App.state.points,
      strokeColor: "#ff0000",
      strokeOpacity: 0.3,
      strokeWeight: 2,
      fillColor: "#ff0000",
      fillOpacity: 0.1
    });
    map.add(App.state.polygon);
  }

  App.selectionMarkers = {
    updateMarkers: updateMarkers,
    updatePolygon: updatePolygon,
    clearPolygon: clearPolygon
  };
})();
