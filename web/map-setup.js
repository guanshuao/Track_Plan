(function () {
  const App = window.App;
  let layerConfig = {};

  function metaContent(name) {
    const element = document.querySelector('meta[name="' + name + '"]');
    return element ? element.content.trim() : "";
  }

  function loadApi(forceRetry) {
    if (window.AMap) { return Promise.resolve(window.AMap); }
    if (App.runtime.amapLoadPromise && !forceRetry) { return App.runtime.amapLoadPromise; }
    const key = metaContent("amap-web-key");
    const securityCode = metaContent("amap-security-code");
    if (!key || key === "__AMAP_KEY__") { return Promise.reject(new Error("未配置高德 Web 端 Key。")); }
    if (securityCode && securityCode !== "__AMAP_SECURITY_CODE__") {
      window._AMapSecurityConfig = { securityJsCode: securityCode };
    }
    const previous = document.getElementById("amap-api-script");
    if (previous) { previous.remove(); }
    const attempt = App.runtime.amapAttempt + 1;
    App.runtime.amapAttempt = attempt;
    App.runtime.amapLoadPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      const timeoutId = window.setTimeout(function () {
        script.remove();
        reject(new Error("地图服务连接超时，请检查网络和 Key 配置。"));
      }, 15000);
      script.id = "amap-api-script";
      script.src = "https://webapi.amap.com/maps?v=2.0&key=" + encodeURIComponent(key);
      script.async = true;
      script.onload = function () {
        window.clearTimeout(timeoutId);
        if (attempt !== App.runtime.amapAttempt) { return; }
        if (window.AMap) { resolve(window.AMap); } else { reject(new Error("地图脚本已加载，但 AMap 未初始化。")); }
      };
      script.onerror = function () {
        window.clearTimeout(timeoutId);
        reject(new Error("地图服务加载失败，请检查网络、Key 与安全密钥。"));
      };
      document.head.appendChild(script);
    }).catch(function (error) {
      if (attempt === App.runtime.amapAttempt) { App.runtime.amapLoadPromise = null; }
      throw error;
    });
    return App.runtime.amapLoadPromise;
  }

  function destroyMap() {
    const map = App.state.map;
    if (!map) { return; }
    if (App.runtime.mapClickHandler && typeof map.off === "function") {
      map.off("click", App.runtime.mapClickHandler);
    }
    try { map.destroy(); } catch (error) { /* A failed map can still be discarded. */ }
    App.runtime.mapClickHandler = null;
    App.state.map = null;
    layerConfig = {};
    App.state.markers = [];
    App.state.polygon = null;
    App.state.boundingRect = null;
    App.state.rectEdgeLabels = [];
    App.state.routePolyline = null;
    App.state.footprintPolygons = [];
  }

  function initMap(forceRetry) {
    if (!window.AMap) { throw new Error("地图 API 尚未加载。") ; }
    if (forceRetry) { destroyMap(); }
    if (App.state.map) { return Promise.resolve(App.state.map); }
    const baseLayers = {
      standard: AMap.createDefaultLayer(),
      satellite: new AMap.TileLayer.Satellite(),
      roadNet: new AMap.TileLayer.RoadNet(),
      traffic: new AMap.TileLayer.Traffic({ zIndex: 20, autoRefresh: true, interval: 180 })
    };
    layerConfig = {
      standard: [baseLayers.standard],
      satellite: [baseLayers.satellite, baseLayers.roadNet],
      traffic: [baseLayers.standard, baseLayers.traffic]
    };
    const map = new AMap.Map("map", {
      layers: layerConfig.standard,
      zoom: 5,
      center: [105.0, 35.0],
      resizeEnable: true
    });
    App.state.map = map;
    AMap.plugin("AMap.Text");
    return new Promise(function (resolve, reject) {
      let settled = false;
      const finish = function (error) {
        if (settled) { return; }
        settled = true;
        window.clearTimeout(timeoutId);
        if (typeof map.off === "function") { map.off("complete", handleComplete); }
        if (error) {
          if (App.state.map === map) { destroyMap(); }
          reject(error);
        } else {
          resolve(map);
        }
      };
      const handleComplete = function () { finish(null); };
      const timeoutId = window.setTimeout(function () {
        finish(new Error("地图资源加载超时，请检查网络、Key 与安全密钥。"));
      }, 15000);
      map.on("complete", handleComplete);
    });
  }

  function switchBaseLayer(key) {
    const map = App.state.map;
    if (!map) { return; }
    const layers = layerConfig[key] || layerConfig.standard;
    map.setLayers(layers);
  }

  App.mapSetup = {
    loadApi: loadApi,
    initMap: initMap,
    switchBaseLayer: switchBaseLayer
  };
})();
