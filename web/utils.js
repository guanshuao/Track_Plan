(function () {
  const App = window.App;
  const { EARTH_RADIUS } = App.constants;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function linspace(start, end, count) {
    if (count <= 1) {
      return [start];
    }
    const step = (end - start) / (count - 1);
    const result = [];
    for (let i = 0; i < count; i += 1) {
      result.push(start + step * i);
    }
    return result;
  }

  function haversineDistance(lng1, lat1, lng2, lat2) {
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lng2 - lng1) * rad;
    const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS * c;
  }

  function formatDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toFixed(2) + " 公里" : meters.toFixed(0) + " 米";
  }

  function parseNumber(input, fallback) {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function renderCoordinateList(listElement, coords) {
    listElement.innerHTML = "";
    coords.forEach(function (lnglat, index) {
      const item = document.createElement("li");
      item.textContent = (index + 1) + ": " + lnglat[0].toFixed(6) + ", " + lnglat[1].toFixed(6);
      listElement.appendChild(item);
    });
  }

  App.utils = {
    clamp: clamp,
    linspace: linspace,
    haversineDistance: haversineDistance,
    formatDistance: formatDistance,
    parseNumber: parseNumber,
    renderCoordinateList: renderCoordinateList
  };
})();
