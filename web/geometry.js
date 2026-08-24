(function () {
  const App = window.App;
  const LENGTH_EPSILON = App.constants.LENGTH_EPSILON_METERS;

  function orientation(a, b, c) {
    const left = (b[0] - a[0]) * (c[1] - a[1]);
    const right = (b[1] - a[1]) * (c[0] - a[0]);
    const value = left - right;
    const tolerance = Number.EPSILON * 64 * (Math.abs(left) + Math.abs(right) + 1);
    if (Math.abs(value) <= tolerance) { return 0; }
    return value > 0 ? 1 : -1;
  }

  function onSegment(a, b, p) {
    if (orientation(a, b, p) !== 0) { return false; }
    const minX = Math.min(a[0], b[0]) - LENGTH_EPSILON;
    const maxX = Math.max(a[0], b[0]) + LENGTH_EPSILON;
    const minY = Math.min(a[1], b[1]) - LENGTH_EPSILON;
    const maxY = Math.max(a[1], b[1]) + LENGTH_EPSILON;
    return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;
  }

  function segmentsIntersect(a1, a2, b1, b2) {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);
    if (o1 * o2 < 0 && o3 * o4 < 0) {
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

  function pointsAlmostEqual(a, b, tolerance) {
    if (!a || !b) {
      return false;
    }
    const ax = Array.isArray(a) ? a[0] : a.x;
    const ay = Array.isArray(a) ? a[1] : a.y;
    const bx = Array.isArray(b) ? b[0] : b.x;
    const by = Array.isArray(b) ? b[1] : b.y;
    const epsilon = Number.isFinite(tolerance) ? tolerance : LENGTH_EPSILON;
    return Math.abs(ax - bx) <= epsilon && Math.abs(ay - by) <= epsilon;
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
    return !(boxA.maxX < boxB.minX - LENGTH_EPSILON || boxA.minX > boxB.maxX + LENGTH_EPSILON ||
      boxA.maxY < boxB.minY - LENGTH_EPSILON || boxA.minY > boxB.maxY + LENGTH_EPSILON);
  }

  function polygonsIntersect(polyA, polyB, cachedBoxB) {
    if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) {
      return false;
    }
    const boxA = polygonBoundingBox(polyA);
    const boxB = cachedBoxB || polygonBoundingBox(polyB);
    if (!boundingBoxesOverlap(boxA, boxB)) {
      return false;
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
    return pointInPolygon(polyA[0], polyB) || pointInPolygon(polyB[0], polyA);
  }

  function polygonArea(polygon) {
    let twiceArea = 0;
    for (let i = 0; i < polygon.length; i += 1) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      twiceArea += current[0] * next[1] - next[0] * current[1];
    }
    return twiceArea / 2;
  }

  function validateSimplePolygon(polygon, minimumArea) {
    if (!Array.isArray(polygon) || polygon.length < 3) {
      return { ok: false, message: "至少需要 3 个互不相同的点。" };
    }
    for (let i = 0; i < polygon.length; i += 1) {
      const point = polygon[i];
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return { ok: false, message: "选区包含无效坐标。" };
      }
      for (let j = 0; j < i; j += 1) {
        if (pointsAlmostEqual(point, polygon[j], 0.05)) {
          return { ok: false, message: "选区包含重复或距离过近的点。" };
        }
      }
    }
    const area = Math.abs(polygonArea(polygon));
    if (area < minimumArea) {
      return { ok: false, message: "选区面积过小或所有点接近共线。" };
    }
    const count = polygon.length;
    for (let i = 0; i < count; i += 1) {
      const a1 = polygon[i];
      const a2 = polygon[(i + 1) % count];
      for (let j = i + 1; j < count; j += 1) {
        const adjacent = Math.abs(i - j) <= 1 || (i === 0 && j === count - 1);
        if (adjacent) { continue; }
        const b1 = polygon[j];
        const b2 = polygon[(j + 1) % count];
        if (segmentsIntersect(a1, a2, b1, b2)) {
          return { ok: false, message: "选区边界发生自交，请调整点的顺序。" };
        }
      }
    }
    return { ok: true };
  }

  function convexHull(points) {
    const sorted = points.map(function (point) { return [point[0], point[1]]; }).sort(function (a, b) {
      return a[0] === b[0] ? a[1] - b[1] : a[0] - b[0];
    });
    if (sorted.length <= 2) { return sorted; }
    function cross(a, b, c) {
      return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    }
    const lower = [];
    sorted.forEach(function (point) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) { lower.pop(); }
      lower.push(point);
    });
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) { upper.pop(); }
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function minimumAreaRectangle(points) {
    const hull = convexHull(points);
    if (hull.length < 3) { return null; }
    let best = null;
    for (let i = 0; i < hull.length; i += 1) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length <= LENGTH_EPSILON) { continue; }
      const axisX = [dx / length, dy / length];
      const axisY = [-axisX[1], axisX[0]];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      hull.forEach(function (point) {
        const x = point[0] * axisX[0] + point[1] * axisX[1];
        const y = point[0] * axisY[0] + point[1] * axisY[1];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
      const width = maxX - minX;
      const height = maxY - minY;
      const area = width * height;
      if (!best || area < best.area) {
        const origin = [axisX[0] * minX + axisY[0] * minY, axisX[1] * minX + axisY[1] * minY];
        best = { origin: origin, axisX: axisX, axisY: axisY, width: width, height: height, area: area };
      }
    }
    if (!best) { return null; }
    best.corners = [
      best.origin,
      [best.origin[0] + best.axisX[0] * best.width, best.origin[1] + best.axisX[1] * best.width],
      [best.origin[0] + best.axisX[0] * best.width + best.axisY[0] * best.height, best.origin[1] + best.axisX[1] * best.width + best.axisY[1] * best.height],
      [best.origin[0] + best.axisY[0] * best.height, best.origin[1] + best.axisY[1] * best.height]
    ];
    return best;
  }

  App.geometry = {
    pointsAlmostEqual: pointsAlmostEqual,
    polygonBoundingBox: polygonBoundingBox,
    polygonsIntersect: polygonsIntersect,
    validateSimplePolygon: validateSimplePolygon,
    minimumAreaRectangle: minimumAreaRectangle
  };
})();
