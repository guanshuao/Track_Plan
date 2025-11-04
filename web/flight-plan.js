(function () {
  const App = window.App;
  const utils = App.utils;
  const geom = App.geometry;
  const EPS = App.constants.GEOMETRY_EPSILON;

  function computeFlightPlan(metrics, options) {
    if (!metrics || metrics.width <= 0 || metrics.height <= 0) { return null; }
    const direction = metrics.height >= metrics.width ? "NS" : "EW";
    const longSide = direction === "NS" ? metrics.height : metrics.width;
    const shortSide = direction === "NS" ? metrics.width : metrics.height;
    const focal = options.focalLengthMM;
    if (!Number.isFinite(focal) || focal <= 0) { return null; }
    const flightHeight = focal * options.scaleDenominator / 1000;
    if (!Number.isFinite(flightHeight) || flightHeight <= 0) { return null; }
    const groundCoverage = (options.frameSize / focal) * flightHeight;
    if (!Number.isFinite(groundCoverage) || groundCoverage <= 0) { return null; }
    const advanceRaw = groundCoverage * (1 - options.overlapLongitudinal);
    const advance = advanceRaw > 0 ? advanceRaw : groundCoverage * 0.1;
    const photosPerLine = Math.max(1, Math.ceil(longSide / advance) + 2);
    const lineSpacingRaw = groundCoverage * (1 - options.overlapLateral);
    const lineSpacing = lineSpacingRaw > 0 ? lineSpacingRaw : groundCoverage * 0.5;
    const numLines = Math.max(1, Math.ceil(shortSide / lineSpacing) + 1);
    const adjustedSpacing = numLines > 1 ? shortSide / (numLines - 1) : shortSide;
    const exposure = options.speedMPS > 0 ? advance / options.speedMPS : null;
    return {
      direction: direction,
      directionLabel: direction === "NS" ? "南北方向（航线沿南北布置）" : "东西方向（航线沿东西布置）",
      longSide: longSide,
      shortSide: shortSide,
      numPhotosPerLine: photosPerLine,
      numLines: numLines,
      adjustedSpacing: adjustedSpacing,
      groundCoverage: groundCoverage,
      advance: advance,
      totalPhotos: photosPerLine * numLines,
      exposureInterval: exposure,
      flightHeight: flightHeight
    };
  }

  function planToLngLat(x, y, plan, metrics) {
    const ratioX = plan.longSide > 0 ? x / plan.longSide : 0;
    const ratioY = plan.shortSide > 0 ? y / plan.shortSide : 0;
    if (plan.direction === "NS") {
      return [metrics.west + ratioY * (metrics.east - metrics.west), metrics.south + ratioX * (metrics.north - metrics.south)];
    }
    return [metrics.west + ratioX * (metrics.east - metrics.west), metrics.south + ratioY * (metrics.north - metrics.south)];
  }

  function buildFootprint(center, halfSize) {
    return [
      { x: center.x - halfSize, y: center.y - halfSize },
      { x: center.x + halfSize, y: center.y - halfSize },
      { x: center.x + halfSize, y: center.y + halfSize },
      { x: center.x - halfSize, y: center.y + halfSize }
    ];
  }

  function extendSegments(segments) {
    for (let idx = 0; idx < segments.length - 1; idx += 1) {
      const line = segments[idx];
      const nextLine = segments[idx + 1];
      if (!line || !nextLine || !line.pathPoints.length || !nextLine.pathPoints.length) { continue; }
      const currentPoints = line.pathPoints;
      const nextPoints = nextLine.pathPoints;
      const currentEnd = currentPoints[currentPoints.length - 1];
      const nextStart = nextPoints[0];
      const targetX = line.direction === 1 ? Math.max(currentEnd.x, nextStart.x) : Math.min(currentEnd.x, nextStart.x);
      if (Math.abs(currentEnd.x - targetX) > EPS) { currentPoints.push({ x: targetX, y: currentEnd.y }); }
      if (Math.abs(nextStart.x - targetX) > EPS) { nextPoints.unshift({ x: targetX, y: nextStart.y }); }
      const adjustedCurrent = currentPoints[currentPoints.length - 1];
      const adjustedNext = nextPoints[0];
      const deltaY = adjustedNext.y - adjustedCurrent.y;
      if (Math.abs(deltaY) < EPS) { line.turnArc = []; continue; }
      const radius = Math.abs(deltaY) / 2;
      const center = { x: targetX, y: adjustedCurrent.y + deltaY / 2 };
      const startAngle = line.direction === 1 ? -Math.PI / 2 : Math.PI * 3 / 2;
      const endAngle = Math.PI / 2;
      const angles = utils.linspace(startAngle, endAngle, 32);
      const arc = [];
      for (let a = 0; a < angles.length; a += 1) {
        const theta = angles[a];
        arc.push({ x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) });
      }
      if (arc.length) { arc.shift(); }
      line.turnArc = arc;
    }
  }

  function assemblePath(segments, plan, metrics) {
    const seq = [];
    function addPoint(point) {
      if (!seq.length || !geom.pointsAlmostEqual(seq[seq.length - 1], point)) {
        seq.push(point);
      }
    }
    segments.forEach(function (segment) {
      segment.pathPoints.forEach(addPoint);
      (segment.turnArc || []).forEach(addPoint);
    });
    return seq.map(function (coord) {
      return planToLngLat(coord.x, coord.y, plan, metrics);
    });
  }

  function generateFlightGeometry(plan, metrics, polygonPoints) {
    if (!plan) {
      return { path: [], photoCenters: [], footprints: [], removedPhotos: 0, totalPhotosBeforeFilter: 0, activeLines: 0 };
    }
    const xPositions = utils.linspace(0, plan.longSide, plan.numPhotosPerLine);
    const yPositions = utils.linspace(0, plan.shortSide, plan.numLines);
    const halfSize = plan.groundCoverage / 2;
    const photoCenters = [];
    const footprints = [];
    const segments = [];
    let totalPhotosBeforeFilter = 0;
    let keptPhotos = 0;
    for (let i = 0; i < yPositions.length; i += 1) {
      const y = yPositions[i];
      const xLine = (i % 2 === 0) ? xPositions : xPositions.slice().reverse();
      const pathPoints = [];
      totalPhotosBeforeFilter += xLine.length;
      for (let j = 0; j < xLine.length; j += 1) {
        const center = { x: xLine[j], y: y };
        const footprint = buildFootprint(center, halfSize).map(function (corner) {
          return planToLngLat(corner.x, corner.y, plan, metrics);
        });
        let keep = true;
        if (polygonPoints && polygonPoints.length >= 3) {
          keep = geom.polygonsIntersect(footprint, polygonPoints);
        }
        if (keep) {
          pathPoints.push({ x: center.x, y: center.y });
          photoCenters.push(planToLngLat(center.x, center.y, plan, metrics));
          footprints.push(footprint);
          keptPhotos += 1;
        }
      }
      if (pathPoints.length) {
        segments.push({ lineIndex: i, direction: (i % 2 === 0) ? 1 : -1, pathPoints: pathPoints, turnArc: [] });
      }
    }
    extendSegments(segments);
    const path = assemblePath(segments, plan, metrics);
    return {
      path: path,
      photoCenters: photoCenters,
      footprints: footprints,
      removedPhotos: Math.max(0, totalPhotosBeforeFilter - keptPhotos),
      totalPhotosBeforeFilter: totalPhotosBeforeFilter,
      activeLines: segments.length
    };
  }

  App.flightPlan = {
    compute: computeFlightPlan,
    planToLngLat: planToLngLat,
    generateGeometry: generateFlightGeometry
  };
})();
