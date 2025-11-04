(function () {
  const App = window.App;

  function initMap() {
    const baseLayers = {
      standard: AMap.createDefaultLayer(),
      satellite: new AMap.TileLayer.Satellite(),
      roadNet: new AMap.TileLayer.RoadNet(),
      traffic: new AMap.TileLayer.Traffic({ zIndex: 20, autoRefresh: true, interval: 180 })
    };
    const layerConfig = {
      standard: [baseLayers.standard],
      satellite: [baseLayers.satellite, baseLayers.roadNet],
      traffic: [baseLayers.standard, baseLayers.traffic]
    };
    App.state.baseLayers = baseLayers;
    App.state.layerConfig = layerConfig;
    App.state.map = new AMap.Map("map", {
      layers: layerConfig.standard,
      zoom: 5,
      center: [105.0, 35.0]
    });
    AMap.plugin("AMap.Text");
  }

  function switchBaseLayer(key) {
    const map = App.state.map;
    if (!map) { return; }
    const layers = App.state.layerConfig[key] || App.state.layerConfig.standard;
    map.setLayers(layers);
  }

  App.mapSetup = {
    initMap: initMap,
    switchBaseLayer: switchBaseLayer
  };
})();
