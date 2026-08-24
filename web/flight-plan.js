(function () {
  const App = window.App;
  const utils = App.utils;
  const geom = App.geometry;
  const EPS = App.constants.LENGTH_EPSILON_METERS;

  function finitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function ceilWithTolerance(value) {
    return Math.ceil(value - Math.max(1, Math.abs(value)) * 1e-12);
  }

  function measureCoverageAxis(length, footprint, overlap) {
    const nominalStep = footprint * (1 - overlap);
    if (!finitePositive(length) || !finitePositive(footprint) || !finitePositive(nominalStep)) { return null; }
    if (length <= footprint + EPS) {
      return { first: length / 2, last: length / 2, count: 1, actualStep: null };
    }
    const first = footprint / 2;
    const last = length - footprint / 2;
    const intervals = Math.max(1, ceilWithTolerance((last - first) / nominalStep));
    if (!Number.isSafeInteger(intervals) || intervals >= Number.MAX_SAFE_INTEGER) {
      return { first: first, last: last, count: Infinity, actualStep: null, overflow: true };
    }
    return {
      first: first,
      last: last,
      count: intervals + 1,
      actualStep: (last - first) / intervals
    };
  }

  function materializePositions(layout) {
    return layout.count === 1 ? [layout.first] : utils.linspace(layout.first, layout.last, layout.count);
  }

  function orientationCandidate(metrics, useWidthAsAlong, coverageAlong, coverageAcross, options) {
    const alongLength = useWidthAsAlong ? metrics.width : metrics.height;
    const acrossLength = useWidthAsAlong ? metrics.height : metrics.width;
    const alongAxis = useWidthAsAlong ? metrics.axisX : metrics.axisY;
    const acrossAxis = useWidthAsAlong ? metrics.axisY : metrics.axisX;
    const alongLayout = measureCoverageAxis(alongLength, coverageAlong, options.overlapLongitudinal);
    const acrossLayout = measureCoverageAxis(acrossLength, coverageAcross, options.overlapLateral);
    if (!alongLayout || !acrossLayout) { return null; }
    const totalPhotos = alongLayout.overflow || acrossLayout.overflow ||
      alongLayout.count > Math.floor(Number.MAX_SAFE_INTEGER / acrossLayout.count)
      ? Infinity
      : alongLayout.count * acrossLayout.count;
    const lineSpan = alongLayout.actualStep ? alongLayout.actualStep * (alongLayout.count - 1) : 0;
    const crossSpan = acrossLayout.actualStep ? acrossLayout.actualStep * (acrossLayout.count - 1) : 0;
    return {
      alongLength: alongLength,
      acrossLength: acrossLength,
      alongAxis: alongAxis,
      acrossAxis: acrossAxis,
      alongLayout: alongLayout,
      acrossLayout: acrossLayout,
      totalPhotos: totalPhotos,
      // The displayed connector is a half-circle whose radius is half the
      // line spacing, so its length is π/2 times the cross-track transition.
      estimatedPathLength: lineSpan * acrossLayout.count + Math.PI / 2 * crossSpan
    };
  }

  function chooseOrientation(candidates) {
    return candidates.filter(Boolean).sort(function (a, b) {
      if (a.estimatedPathLength !== b.estimatedPathLength) {
        return a.estimatedPathLength - b.estimatedPathLength;
      }
      if (a.totalPhotos !== b.totalPhotos) { return a.totalPhotos - b.totalPhotos; }
      if (a.acrossLayout.count !== b.acrossLayout.count) {
        return a.acrossLayout.count - b.acrossLayout.count;
      }
      return b.alongLength - a.alongLength;
    })[0] || null;
  }

  function computeFlightPlan(metrics, options) {
    if (!metrics || !options || !finitePositive(metrics.width) || !finitePositive(metrics.height)) {
      return { error: "选区尺寸无效。" };
    }
    const required = [options.frameAlongMM, options.frameAcrossMM, options.focalLengthMM,
      options.scaleDenominator, options.speedMPS];
    if (!required.every(finitePositive) || !Number.isFinite(options.overlapLongitudinal) ||
      !Number.isFinite(options.overlapLateral) || options.overlapLongitudinal < 0 ||
      options.overlapLongitudinal >= 1 || options.overlapLateral < 0 || options.overlapLateral >= 1) {
      return { error: "航摄参数超出有效范围。" };
    }
    const flightHeight = options.focalLengthMM * options.scaleDenominator / 1000;
    const coverageAlong = options.frameAlongMM * options.scaleDenominator / 1000;
    const coverageAcross = options.frameAcrossMM * options.scaleDenominator / 1000;
    const candidates = [
      orientationCandidate(metrics, true, coverageAlong, coverageAcross, options),
      orientationCandidate(metrics, false, coverageAlong, coverageAcross, options)
    ].filter(Boolean);
    if (!candidates.length || !finitePositive(flightHeight)) {
      return { error: "无法根据当前参数计算覆盖范围。" };
    }
    const maxCandidates = App.constants.MAX_CANDIDATE_PHOTOS;
    const photoCountCandidates = candidates.filter(function (candidate) {
      return Number.isSafeInteger(candidate.totalPhotos) && candidate.totalPhotos <= maxCandidates;
    });
    if (!photoCountCandidates.length) {
      const estimate = chooseOrientation(candidates);
      return {
        error: "预计候选摄影点超过 " + maxCandidates.toLocaleString("zh-CN") + " 个，请缩小选区或降低重叠率。",
        estimatedTotalPhotos: estimate ? estimate.totalPhotos : Infinity
      };
    }
    const polygonVertices = Array.isArray(metrics.projectedPolygon) ? metrics.projectedPolygon.length : 4;
    const workFeasibleCandidates = photoCountCandidates.filter(function (candidate) {
      return candidate.totalPhotos * polygonVertices <= App.constants.MAX_GEOMETRY_WORK_UNITS;
    });
    if (!workFeasibleCandidates.length) {
      return { error: "选区边界与候选摄影点组合过于复杂，请简化边界或减少摄影点。" };
    }
    const chosen = chooseOrientation(workFeasibleCandidates);
    const alongLayout = chosen.alongLayout;
    const acrossLayout = chosen.acrossLayout;
    const bearing = (Math.atan2(chosen.alongAxis[0], chosen.alongAxis[1]) * 180 / Math.PI + 360) % 360;
    const exposure = alongLayout.actualStep ? alongLayout.actualStep / options.speedMPS : null;
    return {
      directionLabel: "自动优化方位 " + bearing.toFixed(1) + "° / " + ((bearing + 180) % 360).toFixed(1) + "°",
      longAxis: chosen.alongAxis,
      shortAxis: chosen.acrossAxis,
      xPositions: materializePositions(alongLayout),
      yPositions: materializePositions(acrossLayout),
      numLines: acrossLayout.count,
      adjustedSpacing: acrossLayout.actualStep,
      coverageAlong: coverageAlong,
      coverageAcross: coverageAcross,
      advance: alongLayout.actualStep,
      exposureInterval: exposure,
      flightHeight: flightHeight,
      warnings: ["转弯曲线仅作航迹连线示意；导出的文件只包含摄影触发点，不可直接视为飞控任务文件。"]
    };
  }

  function planToLngLat(x, y, plan, metrics) {
    return utils.unprojectXY(planToProjected(x, y, plan, metrics), metrics.projection);
  }

  function planToProjected(x, y, plan, metrics) {
    return [
      metrics.origin[0] + plan.longAxis[0] * x + plan.shortAxis[0] * y,
      metrics.origin[1] + plan.longAxis[1] * x + plan.shortAxis[1] * y
    ];
  }

  function buildFootprint(center, halfAlong, halfAcross) {
    return [
      { x: center.x - halfAlong, y: center.y - halfAcross },
      { x: center.x + halfAlong, y: center.y - halfAcross },
      { x: center.x + halfAlong, y: center.y + halfAcross },
      { x: center.x - halfAlong, y: center.y + halfAcross }
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

  function generateFlightGeometry(plan, metrics) {
    if (!plan || plan.error || !metrics || !Array.isArray(metrics.projectedPolygon)) {
      return { path: [], photoRecords: [], footprints: [], removedPhotos: 0, totalPhotosBeforeFilter: 0, activeLines: 0 };
    }
    const xPositions = plan.xPositions;
    const yPositions = plan.yPositions;
    const candidateCount = Array.isArray(xPositions) && Array.isArray(yPositions)
      ? xPositions.length * yPositions.length : NaN;
    if (!Number.isSafeInteger(candidateCount) || candidateCount > App.constants.MAX_CANDIDATE_PHOTOS) {
      throw new Error("候选摄影点数量无效或超过安全上限。");
    }
    const halfAlong = plan.coverageAlong / 2;
    const halfAcross = plan.coverageAcross / 2;
    const photoRecords = [];
    const footprints = [];
    const segments = [];
    const polygon = metrics.projectedPolygon;
    const polygonBounds = metrics.polygonBounds || geom.polygonBoundingBox(polygon);
    const totalPhotosBeforeFilter = candidateCount;
    let footprintsSuppressed = false;
    for (let i = 0; i < yPositions.length; i += 1) {
      const y = yPositions[i];
      const keptAscending = [];
      for (let j = 0; j < xPositions.length; j += 1) {
        const center = { x: xPositions[j], y: y };
        const footprintProjected = buildFootprint(center, halfAlong, halfAcross).map(function (corner) {
          return planToProjected(corner.x, corner.y, plan, metrics);
        });
        if (!geom.polygonsIntersect(footprintProjected, polygon, polygonBounds)) { continue; }
        keptAscending.push({ center: center, footprintProjected: footprintProjected });
      }
      if (!keptAscending.length) { continue; }
      const activeIndex = segments.length;
      const direction = activeIndex % 2 === 0 ? 1 : -1;
      const ordered = direction === 1 ? keptAscending : keptAscending.slice().reverse();
      const pathPoints = ordered.map(function (item) { return { x: item.center.x, y: item.center.y }; });
      segments.push({ direction: direction, pathPoints: pathPoints, turnArc: [] });
      ordered.forEach(function (item) {
        const lngLat = planToLngLat(item.center.x, item.center.y, plan, metrics);
        photoRecords.push({
          sequence: photoRecords.length + 1,
          line: activeIndex + 1,
          longitude: lngLat[0],
          latitude: lngLat[1]
        });
        if (!footprintsSuppressed) {
          if (footprints.length >= App.constants.MAX_RENDERED_FOOTPRINTS) {
            footprints.length = 0;
            footprintsSuppressed = true;
          } else {
            footprints.push(item.footprintProjected.map(function (point) {
              return utils.unprojectXY(point, metrics.projection);
            }));
          }
        }
      });
    }
    extendSegments(segments);
    const path = assemblePath(segments, plan, metrics);
    return {
      path: path,
      photoRecords: photoRecords,
      footprints: footprints,
      footprintsSuppressed: footprintsSuppressed,
      removedPhotos: Math.max(0, totalPhotosBeforeFilter - photoRecords.length),
      totalPhotosBeforeFilter: totalPhotosBeforeFilter,
      activeLines: segments.length
    };
  }

  App.flightPlan = {
    compute: computeFlightPlan,
    generateGeometry: generateFlightGeometry
  };
})();
