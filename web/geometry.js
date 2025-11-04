(function () {
  const App = window.App;
  const { GEOMETRY_EPSILON } = App.constants;
  const utils = App.utils;

  function orientation(a, b, c) {
    const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(value) < GEOMETRY_EPSILON) {
      return 0;
    }
    return value > 0 ? 1 : -1;
  }

  function onSegment(a, b, p) {
    if (Math.abs(orientation(a, b, p)) > 0) {
      return false;
    }
    const minX = Math.min(a[0], b[0]) - GEOMETRY_EPSILON;
    const maxX = Math.max(a[0], b[0]) + GEOMETRY_EPSILON;
    const minY = Math.min(a[1], b[1]) - GEOMETRY_EPSILON;
    const maxY = Math.max(a[1], b[1]) + GEOMETRY_EPSILON;
    return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
  }

  function segmentsIntersect(a1, a2, b1, b2) {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);
    if (o1 !== o2 && o3 !== o4) {
      return true;
    }
    if (o1 === 0 && onSegment(a1, a2, b1)) {
      return true;
    }
    if (o2 === 0 && onSegment(a1, a2, b2)) {
      return true;
    }
    if (o3 === 0 && onSegment(b1, b2, a1)) {
      return true;
    }
    if (o4 === 0 && onSegment(b1, b2, a2)) {
      return true;
    }
    return false;
  }

  function pointsAlmostEqual(a, b) {
    if (!a || !b) {
      return false;
    }
    const ax = Array.isArray(a) ? a[0] : a.x;
    const ay = Array.isArray(a) ? a[1] : a.y;
    const bx = Array.isArray(b) ? b[0] : b.x;
    const by = Array.isArray(b) ? b[1] : b.y;
    return Math.abs(ax - bx) < GEOMETRY_EPSILON && Math.abs(ay - by) < GEOMETRY_EPSILON;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const pi = polygon[i];
      const pj = polygon[j];
      if (onSegment(pj, pi, point)) {
        return true;
      }
      const intersects = ((pi[1] > point[1]) !== (pj[1] > point[1])) &&
        (point[0] < (pj[0] - pi[0]) * (point[1] - pi[1]) / (pj[1] - pi[1] + 0.0) + pi[0]);
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  function polygonBoundingBox(polygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < polygon.length; i += 1) {
      const p = polygon[i];
      if (p[0] < minX) { minX = p[0]; }
      if (p[0] > maxX) { maxX = p[0]; }
      if (p[1] < minY) { minY = p[1]; }
      if (p[1] > maxY) { maxY = p[1]; }
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function boundingBoxesOverlap(boxA, boxB) {
    return !(boxA.maxX < boxB.minX || boxA.minX > boxB.maxX || boxA.maxY < boxB.minY || boxA.minY > boxB.maxY);
  }

  function polygonsIntersect(polyA, polyB) {
    if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) {
      return false;
    }
    const boxA = polygonBoundingBox(polyA);
    const boxB = polygonBoundingBox(polyB);
    if (!boundingBoxesOverlap(boxA, boxB)) {
      return false;
    }
    for (let i = 0; i < polyA.length; i += 1) {
      if (pointInPolygon(polyA[i], polyB)) {
        return true;
      }
    }
    for (let i = 0; i < polyB.length; i += 1) {
      if (pointInPolygon(polyB[i], polyA)) {
        return true;
      }
    }
    for (let i = 0; i < polyA.length; i += 1) {
      const a1 = polyA[i];
      const a2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j += 1) {
        const b1 = polyB[j];
        const b2 = polyB[(j + 1) % polyB.length];
        if (segmentsIntersect(a1, a2, b1, b2)) {
          return true;
        }
      }
    }
    return false;
  }

  App.geometry = {
    orientation: orientation,
    onSegment: onSegment,
    segmentsIntersect: segmentsIntersect,
    pointsAlmostEqual: pointsAlmostEqual,
    pointInPolygon: pointInPolygon,
    polygonBoundingBox: polygonBoundingBox,
    boundingBoxesOverlap: boundingBoxesOverlap,
    polygonsIntersect: polygonsIntersect
  };
})();
