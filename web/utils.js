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

  function normalizeLongitude(lng) {
    return ((lng + 180) % 360 + 360) % 360 - 180;
  }

  function normalizeRadians(angle) {
    const circle = Math.PI * 2;
    return ((angle + Math.PI) % circle + circle) % circle - Math.PI;
  }

  function createLocalProjection(coords) {
    if (!Array.isArray(coords) || !coords.length) { return null; }
    const rad = Math.PI / 180;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    coords.forEach(function (coord) {
      const longitude = coord[0] * rad;
      const latitude = coord[1] * rad;
      const cosLatitude = Math.cos(latitude);
      sumX += cosLatitude * Math.cos(longitude);
      sumY += cosLatitude * Math.sin(longitude);
      sumZ += Math.sin(latitude);
    });
    const horizontal = Math.hypot(sumX, sumY);
    const magnitude = Math.hypot(horizontal, sumZ);
    if (!Number.isFinite(magnitude) || magnitude < 1e-10) { return null; }
    const referenceLatRadians = Math.atan2(sumZ, horizontal);
    const referenceLngRadians = Math.atan2(sumY, sumX);
    return {
      longitude: referenceLngRadians,
      latitude: referenceLatRadians,
      sinLatitude: Math.sin(referenceLatRadians),
      cosLatitude: Math.cos(referenceLatRadians)
    };
  }

  function projectLngLat(coord, projection) {
    const rad = Math.PI / 180;
    const phi = coord[1] * rad;
    const deltaLambda = normalizeRadians(coord[0] * rad - projection.longitude);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const cosC = clamp(projection.sinLatitude * sinPhi + projection.cosLatitude * cosPhi * Math.cos(deltaLambda), -1, 1);
    const c = Math.acos(cosC);
    if (c < 1e-12) { return [0, 0]; }
    const sinC = Math.sin(c);
    if (Math.abs(sinC) < 1e-12) { return [NaN, NaN]; }
    const scale = EARTH_RADIUS * c / sinC;
    return [
      scale * cosPhi * Math.sin(deltaLambda),
      scale * (projection.cosLatitude * sinPhi - projection.sinLatitude * cosPhi * Math.cos(deltaLambda))
    ];
  }

  function unprojectXY(point, projection) {
    const rad = Math.PI / 180;
    const deg = 1 / rad;
    const rho = Math.hypot(point[0], point[1]);
    if (rho < 1e-9) {
      return [normalizeLongitude(projection.longitude * deg), projection.latitude * deg];
    }
    const c = rho / EARTH_RADIUS;
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const latitude = Math.asin(clamp(cosC * projection.sinLatitude + point[1] * sinC * projection.cosLatitude / rho, -1, 1));
    const longitude = projection.longitude + Math.atan2(
      point[0] * sinC,
      rho * projection.cosLatitude * cosC - point[1] * projection.sinLatitude * sinC
    );
    return [
      normalizeLongitude(longitude * deg),
      latitude * deg
    ];
  }

  function haversineDistance(lng1, lat1, lng2, lat2) {
    const rad = Math.PI / 180;
    const phi1 = lat1 * rad;
    const phi2 = lat2 * rad;
    const deltaPhi = (lat2 - lat1) * rad;
    const deltaLambda = (lng2 - lng1) * rad;
    const a = clamp(Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2, 0, 1);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS * c;
  }

  function formatDistance(meters) {
    return meters >= 1000 ? (meters / 1000).toFixed(2) + " 公里" : meters.toFixed(0) + " 米";
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
    linspace: linspace,
    createLocalProjection: createLocalProjection,
    projectLngLat: projectLngLat,
    unprojectXY: unprojectXY,
    haversineDistance: haversineDistance,
    formatDistance: formatDistance,
    renderCoordinateList: renderCoordinateList
  };
})();
