"""Simple Gaode/Amap polygon picker served via a local HTTP server."""

from __future__ import annotations

import csv
import datetime
import http.server
import json
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path


AMAP_KEY = '60b2864c46eff4ea2281844056898312'

if not AMAP_KEY:
    error = (
        "缺少环境变量 AMAP_WEB_KEY。请先在环境中设置高德 Web 服务 key，然后重新运行脚本。"
    )
    raise RuntimeError(error)


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang=\"zh\">
<head>
	<meta charset=\"utf-8\">
	<title>航迹规划工具</title>
	<style>
		html, body { height: 100%; margin: 0; }
		#map { width: 100%; height: 100%; }
		#controls {
			position: absolute;
			top: 16px;
			left: 16px;
			background: rgba(255, 255, 255, 0.92);
			padding: 12px;
			border-radius: 6px;
			box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
			font-family: Arial, sans-serif;
			line-height: 1.4;
			max-width: 260px;
		}
		#controls button {
			margin-right: 6px;
			margin-top: 4px;
		}
		#points {
			margin: 10px 0 0 0;
			padding-left: 18px;
			max-height: 160px;
			overflow-y: auto;
			font-size: 12px;
		}
		#rectContainer {
			margin-top: 8px;
			font-size: 12px;
		}
		#rectPoints {
			margin: 6px 0 0 0;
			padding-left: 18px;
		}
		#status { font-size: 13px; }
		.controls-group {
			margin-top: 12px;
			font-size: 12px;
		}
		.controls-group label {
			display: block;
			margin-top: 6px;
		}
		.controls-group input {
			width: 100%;
			box-sizing: border-box;
			margin-top: 2px;
			padding: 4px;
			font-size: 12px;
		}
		#planActions {
			margin-top: 8px;
		}
		#planActions button {
			margin-top: 0;
		}
		#planInfo {
			margin-top: 8px;
			font-size: 12px;
			line-height: 1.5;
		}
	</style>
</head>
<body>
	<div id=\"map\"></div>
	<div id=\"controls\">
		<strong>多边形选点</strong>
		<div id=\"status\"></div>
		<div>
			<button id=\"finishBtn\">结束选点</button>
			<button id=\"resetBtn\">重新开始</button>
		</div>
		<ul id=\"points\"></ul>
		<div id="rectContainer" style="display: none;">
			<strong>外接矩形顶点</strong>
			<ul id="rectPoints"></ul>
		</div>
		<div id="planContainer" class="controls-group" style="display: none;">
			<strong>航迹规划</strong>
			<label for="frameSizeInput">像幅（mm）</label>
			<input id="frameSizeInput" type="number" min="10" step="1" value="200">
			<label for="focalLengthInput">焦距（mm）</label>
			<input id="focalLengthInput" type="number" min="1" step="0.1" value="200">
			<label for="scaleInput">比例尺分母</label>
			<input id="scaleInput" type="number" min="1000" step="100" value="25000">
			<label for="longOverlapInput">航向重叠（%）</label>
			<input id="longOverlapInput" type="number" min="0" max="95" step="1" value="60">
			<label for="latOverlapInput">旁向重叠（%）</label>
			<input id="latOverlapInput" type="number" min="0" max="90" step="1" value="30">
			<label for="speedInput">航速（m/s）</label>
			<input id="speedInput" type="number" min="0.1" step="0.1" value="5">
			<div id="planActions">
				<button id="planPrimaryBtn" type="button">生成/隐藏航迹</button>
				<button id="toggleFootprintsBtn" type="button" style="display: none;">显示/隐藏成像区域</button>
			</div>
			<div id="planInfo"></div>
		</div>
	</div>
	<script src=\"https://webapi.amap.com/maps?v=2.0&key=__AMAP_KEY__\"></script>
	<script>
		const map = new AMap.Map('map', {
			zoom: 5,
			center: [105.0, 35.0]
		});
		AMap.plugin('AMap.Text');

		const EARTH_RADIUS = 6378137;
		const LABEL_STYLE = {
			background: 'rgba(255,255,255,0.5)',
			padding: '2px 4px',
			borderRadius: '4px'
		};

		const points = [];
		let markers = [];
		let polygon = null;
		let boundingRect = null;
		let rectVertices = [];
		let rectEdgeLabels = [];
		let selectionFinished = false;
		let rectMetrics = null;
		let routePolyline = null;
		let footprintPolygons = [];
		let showFootprints = true;
		let flightPlan = null;
		let planNeedsUpdate = false;
		let lastPlanDisplayContext = null;
		let lastPlanSaveStatus = null;

		const pointsList = document.getElementById('points');
		const rectContainer = document.getElementById('rectContainer');
		const rectList = document.getElementById('rectPoints');
		const statusEl = document.getElementById('status');
		const planContainer = document.getElementById('planContainer');
		const planInfo = document.getElementById('planInfo');
		const frameSizeInput = document.getElementById('frameSizeInput');
		const focalLengthInput = document.getElementById('focalLengthInput');
		const scaleInput = document.getElementById('scaleInput');
		const longOverlapInput = document.getElementById('longOverlapInput');
		const latOverlapInput = document.getElementById('latOverlapInput');
		const speedInput = document.getElementById('speedInput');
		const planPrimaryBtn = document.getElementById('planPrimaryBtn');
		const toggleFootprintsBtn = document.getElementById('toggleFootprintsBtn');
		const planInputs = [frameSizeInput, focalLengthInput, scaleInput, longOverlapInput, latOverlapInput, speedInput];
		let planDisplayState = 'idle';

		function handlePlanInputChange() {
			if (!rectMetrics) {
				return;
			}
			planNeedsUpdate = true;
			const message = flightPlan ? '参数已修改，请点击“生成/隐藏航迹”重新生成。' : '参数已设置，请点击“生成/隐藏航迹”生成航迹。';
			planInfo.textContent = message;
		}

		planInputs.forEach(function (input) {
			input.addEventListener('change', handlePlanInputChange);
			input.addEventListener('input', handlePlanInputChange);
		});

		planPrimaryBtn.addEventListener('click', function () {
			if (!rectMetrics) {
				planContainer.style.display = 'block';
				planInfo.textContent = '请先在地图上选取至少三个点以生成航迹。';
				return;
			}
			if (planDisplayState === 'idle') {
				updateFlightPlan();
				return;
			}
			if (planDisplayState === 'visible') {
				hideFlightPlan();
				return;
			}
			if (planDisplayState === 'hidden') {
				if (planNeedsUpdate || !flightPlan) {
					updateFlightPlan();
					return;
				}
				showFlightPlan();
			}
		});

		toggleFootprintsBtn.addEventListener('click', function () {
			setFootprintVisibility(!showFootprints);
		});

		function haversineDistance(lng1, lat1, lng2, lat2) {
			const rad = Math.PI / 180;
			const phi1 = lat1 * rad;
			const phi2 = lat2 * rad;
			const deltaPhi = (lat2 - lat1) * rad;
			const deltaLambda = (lng2 - lng1) * rad;
			const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
				Math.cos(phi1) * Math.cos(phi2) *
				Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
			const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
			return EARTH_RADIUS * c;
		}

		function formatDistance(meters) {
			return meters >= 1000
				? (meters / 1000).toFixed(2) + ' 公里'
				: meters.toFixed(0) + ' 米';
		}

		function clearRectEdgeLabels() {
			if (rectEdgeLabels.length) {
				map.remove(rectEdgeLabels);
				rectEdgeLabels = [];
			}
		}

		function createDistanceLabel(text, position, offset) {
			return new AMap.Text({ text: text, position: position, offset: offset, style: LABEL_STYLE });
		}

		function updatePolygon() {
			if (polygon) {
				map.remove(polygon);
				polygon = null;
			}
			if (points.length >= 3) {
				polygon = new AMap.Polygon({
					path: points,
					strokeColor: '#ff0000',
					strokeOpacity: 0.3,
					strokeWeight: 2,
					fillColor: '#ff0000',
					fillOpacity: 0.1
				});
				map.add(polygon);
			}
		}

		function addRectEdgeLabels(west, east, south, north) {
			const horiz = formatDistance((
				haversineDistance(west, north, east, north) +
				haversineDistance(west, south, east, south)
			) / 2);
			const vert = formatDistance((
				haversineDistance(west, north, west, south) +
				haversineDistance(east, north, east, south)
			) / 2);
			rectEdgeLabels = [
				createDistanceLabel('东西长: ' + horiz, [(west + east) / 2, north], new AMap.Pixel(-60, -20)),
				createDistanceLabel('东西长: ' + horiz, [(west + east) / 2, south], new AMap.Pixel(-60, 4)),
				createDistanceLabel('南北长: ' + vert, [west, (north + south) / 2], new AMap.Pixel(-80, -10)),
				createDistanceLabel('南北长: ' + vert, [east, (north + south) / 2], new AMap.Pixel(12, -10))
			];
			map.add(rectEdgeLabels);
		}

		function updateBoundingRect() {
			if (boundingRect) {
				map.remove(boundingRect);
				boundingRect = null;
			}
			rectVertices = [];
			clearRectEdgeLabels();
			rectMetrics = null;
			clearFlightPlanOverlays();
			if (!selectionFinished) {
				planNeedsUpdate = false;
				planContainer.style.display = 'none';
				planInfo.textContent = '';
				return;
			}
			if (points.length >= 3) {
				const lngs = points.map(function (lnglat) { return lnglat[0]; });
				const lats = points.map(function (lnglat) { return lnglat[1]; });
				const west = Math.min.apply(null, lngs);
				const east = Math.max.apply(null, lngs);
				const south = Math.min.apply(null, lats);
				const north = Math.max.apply(null, lats);
				const bounds = new AMap.Bounds([west, south], [east, north]);
				boundingRect = new AMap.Rectangle({
					bounds: bounds,
					strokeColor: '#0066ff',
					strokeOpacity: 0.5,
					strokeWeight: 2,
					fillColor: '#0066ff',
					fillOpacity: 0.1
				});
				map.add(boundingRect);
				rectVertices = [
					[west, north],
					[east, north],
					[east, south],
					[west, south]
				];
				addRectEdgeLabels(west, east, south, north);
				const widthNorth = haversineDistance(west, north, east, north);
				const widthSouth = haversineDistance(west, south, east, south);
				const heightWest = haversineDistance(west, north, west, south);
				const heightEast = haversineDistance(east, north, east, south);
				rectMetrics = {
					west: west,
					east: east,
					south: south,
					north: north,
					width: (widthNorth + widthSouth) / 2,
					height: (heightWest + heightEast) / 2
				};
				planNeedsUpdate = true;
				if (selectionFinished) {
					planContainer.style.display = 'block';
					planInfo.textContent = '外接矩形已更新，请点击“生成/隐藏航迹”生成航迹。';
				}
			} else {
				planNeedsUpdate = false;
				planContainer.style.display = 'none';
				planInfo.textContent = '';
			}
		}

		function updateMarkers() {
			if (markers.length) {
				map.remove(markers);
			}
			markers = points.map(function (lnglat, index) {
				return new AMap.Marker({
					position: lnglat,
					label: {
						content: (index + 1).toString(),
						direction: 'bottom'
					}
				});
			});
			if (markers.length) {
				map.add(markers);
			}
		}

		function updateStatus() {
			if (selectionFinished) {
				statusEl.textContent = '选点已结束，共 ' + points.length + ' 个点。';
			} else if (points.length >= 3) {
				statusEl.textContent = '可以点击“结束选点”按钮完成选择。当前 ' + points.length + ' 个点。';
			} else {
				statusEl.textContent = '请继续在地图上点击添加点，至少需要 3 个点。当前 ' + points.length + ' 个点。';
			}
		}

		function renderCoordinateList(listElement, coords) {
			listElement.innerHTML = '';
			coords.forEach(function (lnglat, index) {
				const item = document.createElement('li');
				item.textContent = (index + 1) + ': ' + lnglat[0].toFixed(6) + ', ' + lnglat[1].toFixed(6);
				listElement.appendChild(item);
			});
		}

		function updateLists() {
			renderCoordinateList(pointsList, points);
			if (rectVertices.length) {
				rectContainer.style.display = 'block';
				renderCoordinateList(rectList, rectVertices);
			} else {
				rectContainer.style.display = 'none';
				rectList.innerHTML = '';
			}
			updateStatus();
		}

		function updateOverlays() {
			updateMarkers();
			if (selectionFinished) {
				updatePolygon();
				updateBoundingRect();
			} else {
				if (polygon) {
					map.remove(polygon);
					polygon = null;
				}
				if (boundingRect) {
					map.remove(boundingRect);
					boundingRect = null;
				}
				rectVertices = [];
				clearRectEdgeLabels();
				rectMetrics = null;
				clearFlightPlanOverlays();
				planContainer.style.display = 'none';
				planInfo.textContent = '';
			}
		}

		// === 航迹规划逻辑：改编 track.py 计算并将结果投影到地图坐标 ===

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

		const GEOMETRY_EPSILON = 1e-9;

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
				if (p[0] < minX) {
					minX = p[0];
				}
				if (p[0] > maxX) {
					maxX = p[0];
				}
				if (p[1] < minY) {
					minY = p[1];
				}
				if (p[1] > maxY) {
					maxY = p[1];
				}
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

		function getPlanOptions() {
			function parse(input, fallback) {
				const value = Number.parseFloat(input.value);
				return Number.isFinite(value) ? value : fallback;
			}
			const frame = Math.max(parse(frameSizeInput, 200), 0.1);
			const focal = Math.max(parse(focalLengthInput, 200), 0.1);
			const scale = Math.max(parse(scaleInput, 25000), 1);
			const overlapLongPercent = clamp(parse(longOverlapInput, 60), 0, 95);
			const overlapLatPercent = clamp(parse(latOverlapInput, 30), 0, 90);
			const speed = Math.max(parse(speedInput, 5), 0.1);
			return {
				frameSize: frame,
				focalLengthMM: focal,
				scaleDenominator: scale,
				overlapLongitudinal: overlapLongPercent / 100,
				overlapLateral: overlapLatPercent / 100,
				speedMPS: speed,
				overlapLongitudinalPercent: overlapLongPercent,
				overlapLateralPercent: overlapLatPercent
			};
		}

		function computeFlightPlan(metrics, options) {
			if (!metrics || metrics.width <= 0 || metrics.height <= 0) {
				return null;
			}
			const direction = metrics.height >= metrics.width ? 'NS' : 'EW';
			const longSide = direction === 'NS' ? metrics.height : metrics.width;
			const shortSide = direction === 'NS' ? metrics.width : metrics.height;
			const focalLength = options.focalLengthMM;
			if (!Number.isFinite(focalLength) || focalLength <= 0) {
				return null;
			}
			const flightHeight = focalLength * options.scaleDenominator / 1000;
			if (!Number.isFinite(flightHeight) || flightHeight <= 0) {
				return null;
			}
			const groundCoverage = (options.frameSize / focalLength) * flightHeight;
			if (!Number.isFinite(groundCoverage) || groundCoverage <= 0) {
				return null;
			}
			const advanceRaw = groundCoverage * (1 - options.overlapLongitudinal);
			const advance = advanceRaw > 0 ? advanceRaw : groundCoverage * 0.1;
			const numPhotosPerLine = Math.max(1, Math.ceil(longSide / advance) + 2);
			const lineSpacingRaw = groundCoverage * (1 - options.overlapLateral);
			const lineSpacing = lineSpacingRaw > 0 ? lineSpacingRaw : groundCoverage * 0.5;
			const numLines = Math.max(1, Math.ceil(shortSide / lineSpacing) + 1);
			const adjustedSpacing = numLines > 1 ? shortSide / (numLines - 1) : shortSide;
			const totalPhotos = numPhotosPerLine * numLines;
			const exposureInterval = options.speedMPS > 0 ? advance / options.speedMPS : null;
			return {
				direction: direction,
				directionLabel: direction === 'NS' ? '南北方向（航线沿南北布置）' : '东西方向（航线沿东西布置）',
				longSide: longSide,
				shortSide: shortSide,
				numPhotosPerLine: numPhotosPerLine,
				numLines: numLines,
				adjustedSpacing: adjustedSpacing,
				groundCoverage: groundCoverage,
				advance: advance,
				totalPhotos: totalPhotos,
				exposureInterval: exposureInterval,
				flightHeight: flightHeight
			};
		}

		function planToLngLat(x, y, plan, metrics) {
			const ratioX = plan.longSide > 0 ? x / plan.longSide : 0;
			const ratioY = plan.shortSide > 0 ? y / plan.shortSide : 0;
			let lat;
			let lng;
			if (plan.direction === 'NS') {
				lat = metrics.south + ratioX * (metrics.north - metrics.south);
				lng = metrics.west + ratioY * (metrics.east - metrics.west);
			} else {
				lng = metrics.west + ratioX * (metrics.east - metrics.west);
				lat = metrics.south + ratioY * (metrics.north - metrics.south);
			}
			return [lng, lat];
		}

		function generateFlightGeometry(plan, metrics, targetPolygon) {
			if (!plan) {
				return {
					path: [],
					photoCenters: [],
					footprints: [],
					removedPhotos: 0,
					totalPhotosBeforeFilter: 0,
					activeLines: 0
				};
			}
			const xPositions = linspace(0, plan.longSide, plan.numPhotosPerLine);
			const yPositions = linspace(0, plan.shortSide, plan.numLines);
			const photoCenters = [];
			const footprints = [];
			const lineSegments = [];
			let totalPhotosBeforeFilter = 0;
			let keptPhotos = 0;
			const halfSize = plan.groundCoverage / 2;
			for (let i = 0; i < yPositions.length; i += 1) {
				const y = yPositions[i];
				const xLine = (i % 2 === 0) ? xPositions : xPositions.slice().reverse();
				const linePathPoints = [];
				totalPhotosBeforeFilter += xLine.length;
				for (let j = 0; j < xLine.length; j += 1) {
					const x = xLine[j];
					const centerPlan = { x: x, y: y };
					const centerLngLat = planToLngLat(centerPlan.x, centerPlan.y, plan, metrics);
					const cornersPlan = [
						{ x: centerPlan.x - halfSize, y: centerPlan.y - halfSize },
						{ x: centerPlan.x + halfSize, y: centerPlan.y - halfSize },
						{ x: centerPlan.x + halfSize, y: centerPlan.y + halfSize },
						{ x: centerPlan.x - halfSize, y: centerPlan.y + halfSize }
					];
					const footprintLngLat = cornersPlan.map(function (coord) {
						return planToLngLat(coord.x, coord.y, plan, metrics);
					});
					let keep = true;
					if (targetPolygon && targetPolygon.length >= 3) {
						keep = polygonsIntersect(footprintLngLat, targetPolygon);
					}
					if (keep) {
						linePathPoints.push({ x: centerPlan.x, y: centerPlan.y });
						photoCenters.push(centerLngLat);
						footprints.push(footprintLngLat);
						keptPhotos += 1;
					}
				}
				if (linePathPoints.length) {
					lineSegments.push({
						lineIndex: i,
						direction: (i % 2 === 0) ? 1 : -1,
						pathPoints: linePathPoints,
						turnArc: []
					});
				}
			}
			// Extend neighbouring flight lines to align their endpoints and insert smooth turn arcs.
			for (let idx = 0; idx < lineSegments.length - 1; idx += 1) {
				const line = lineSegments[idx];
				const nextLine = lineSegments[idx + 1];
				if (!line || !nextLine || !line.pathPoints.length || !nextLine.pathPoints.length) {
					continue;
				}
				const currentPoints = line.pathPoints;
				const nextPoints = nextLine.pathPoints;
				const currentEnd = currentPoints[currentPoints.length - 1];
				const nextStart = nextPoints[0];
				const connectAtHigh = line.direction === 1;
				const currentCoord = currentEnd.x;
				const nextCoord = nextStart.x;
				const targetCoord = connectAtHigh ? Math.max(currentCoord, nextCoord) : Math.min(currentCoord, nextCoord);
				if (Math.abs(currentCoord - targetCoord) > GEOMETRY_EPSILON) {
					currentPoints.push({ x: targetCoord, y: currentEnd.y });
				}
				if (Math.abs(nextCoord - targetCoord) > GEOMETRY_EPSILON) {
					nextPoints.unshift({ x: targetCoord, y: nextStart.y });
				}
				const adjustedCurrentEnd = currentPoints[currentPoints.length - 1];
				const adjustedNextStart = nextPoints[0];
				const deltaSecondary = adjustedNextStart.y - adjustedCurrentEnd.y;
				if (Math.abs(deltaSecondary) < GEOMETRY_EPSILON) {
					line.turnArc = [];
					continue;
				}
				const radius = Math.abs(deltaSecondary) / 2;
				const center = {
					x: targetCoord,
					y: adjustedCurrentEnd.y + deltaSecondary / 2
				};
				let startAngle;
				let endAngle;
				if (line.direction === 1) {
					startAngle = -Math.PI / 2;
					endAngle = Math.PI / 2;
				} else {
					startAngle = Math.PI * 3 / 2;
					endAngle = Math.PI / 2;
				}
				const steps = 32;
				const angles = linspace(startAngle, endAngle, steps);
				const arcPoints = [];
				for (let a = 0; a < angles.length; a += 1) {
					const theta = angles[a];
					const px = center.x + radius * Math.cos(theta);
					const py = center.y + radius * Math.sin(theta);
					arcPoints.push({ x: px, y: py });
				}
				if (arcPoints.length) {
					arcPoints.shift();
				}
				line.turnArc = arcPoints;
			}
			const pathPlanCoords = [];
			// Assemble the final flight path from line passes and turn arcs.
			function addPlanPoint(point) {
				if (!pathPlanCoords.length) {
					pathPlanCoords.push(point);
					return;
				}
				const last = pathPlanCoords[pathPlanCoords.length - 1];
				if (!pointsAlmostEqual(last, point)) {
					pathPlanCoords.push(point);
				}
			}
			for (let idx = 0; idx < lineSegments.length; idx += 1) {
				const segment = lineSegments[idx];
				if (!segment.pathPoints.length) {
					continue;
				}
				for (let p = 0; p < segment.pathPoints.length; p += 1) {
					addPlanPoint(segment.pathPoints[p]);
				}
				if (segment.turnArc && segment.turnArc.length) {
					for (let a = 0; a < segment.turnArc.length; a += 1) {
						addPlanPoint(segment.turnArc[a]);
					}
				}
			}
			const path = pathPlanCoords.map(function (coord) {
				return planToLngLat(coord.x, coord.y, plan, metrics);
			});
			const removedPhotos = Math.max(0, totalPhotosBeforeFilter - keptPhotos);
			return {
				path: path,
				photoCenters: photoCenters,
				footprints: footprints,
				removedPhotos: removedPhotos,
				totalPhotosBeforeFilter: totalPhotosBeforeFilter,
				activeLines: lineSegments.length
			};
		}

		function setPlanDisplayState(state) {
			planDisplayState = state;
			if (!planPrimaryBtn) {
				return;
			}
			if (state === 'visible') {
				planPrimaryBtn.textContent = '生成/隐藏航迹';
				toggleFootprintsBtn.style.display = 'inline-block';
			} else if (state === 'hidden') {
				planPrimaryBtn.textContent = '生成/隐藏航迹';
				toggleFootprintsBtn.style.display = 'none';
			} else {
				planPrimaryBtn.textContent = '生成/隐藏航迹';
				toggleFootprintsBtn.style.display = 'none';
			}
		}

		function detachFlightPlanOverlays() {
			if (routePolyline) {
				map.remove(routePolyline);
			}
			if (footprintPolygons.length) {
				map.remove(footprintPolygons);
			}
		}

		function attachFlightPlanOverlays() {
			if (routePolyline) {
				map.add(routePolyline);
			}
			if (footprintPolygons.length && showFootprints) {
				map.add(footprintPolygons);
			}
		}

		function hideFlightPlan() {
			detachFlightPlanOverlays();
			setPlanDisplayState('hidden');
		}

		function showFlightPlan() {
			if (planNeedsUpdate || !flightPlan) {
				updateFlightPlan();
				return;
			}
			attachFlightPlanOverlays();
			setPlanDisplayState('visible');
		}

		function clearFlightPlanOverlays() {
			detachFlightPlanOverlays();
			routePolyline = null;
			footprintPolygons = [];
			flightPlan = null;
			planNeedsUpdate = Boolean(rectMetrics);
			lastPlanDisplayContext = null;
			lastPlanSaveStatus = null;
			setPlanDisplayState('idle');
		}

		function setFootprintVisibility(shouldShow) {
			showFootprints = shouldShow;
			if (!footprintPolygons.length) {
				return;
			}
			if (shouldShow && planDisplayState === 'visible') {
				map.add(footprintPolygons);
			} else {
				map.remove(footprintPolygons);
			}
		}

		function updatePlanInfoDisplay(plan, metrics, options, geometryStats) {
			if (!plan || !metrics) {
				planInfo.textContent = '';
				return;
			}
			const widthText = formatDistance(metrics.width);
			const heightText = formatDistance(metrics.height);
			const advanceText = formatDistance(plan.advance);
			const coverageText = formatDistance(plan.groundCoverage);
			const spacingText = plan.numLines > 1 ? formatDistance(plan.adjustedSpacing) : '—';
			const exposureText = plan.exposureInterval ? plan.exposureInterval.toFixed(2) + ' 秒' : '—';
			const heightFlightText = plan.flightHeight ? formatDistance(plan.flightHeight) : '—';
			const focalText = options.focalLengthMM.toFixed(1) + ' mm';
			const totalBefore = geometryStats && Number.isFinite(geometryStats.totalPhotosBeforeFilter)
				? geometryStats.totalPhotosBeforeFilter
				: (plan.totalPhotosBeforeFilter ?? plan.totalPhotos);
			const removedPhotos = geometryStats ? geometryStats.removedPhotos : (plan.removedPhotos ?? 0);
			const effectiveLines = geometryStats ? geometryStats.activeLines : (plan.effectiveLineCount ?? plan.numLines);
			if (!plan.totalPhotos || plan.totalPhotos <= 0) {
				const detailsNoCoverage = [
					'外接矩形：东西 ' + widthText + ' · 南北 ' + heightText,
					'相机焦距：' + focalText,
					'航迹方向：' + plan.directionLabel,
					'提示：当前参数下没有任何成像覆盖选区，请调整参数或重新选择区域。'
				];
				if (lastPlanSaveStatus) {
					detailsNoCoverage.push(lastPlanSaveStatus.message);
				}
				planInfo.innerHTML = detailsNoCoverage.join('<br>');
				return;
			}
			const photoSummary = removedPhotos > 0
				? '有效照片数：' + plan.totalPhotos + ' 张（原始 ' + totalBefore + ' 张，剔除冗余 ' + removedPhotos + ' 张）'
				: '预计总照片数：' + plan.totalPhotos + ' 张';
			const details = [
				'外接矩形：东西 ' + widthText + ' · 南北 ' + heightText,
				'相机焦距：' + focalText,
				'航迹方向：' + plan.directionLabel,
				'航高：' + heightFlightText,
				'规划航线数：' + plan.numLines + ' 条'
			];
			if (effectiveLines !== plan.numLines) {
				details.push('有效航线数：' + effectiveLines + ' 条');
			} else {
				details.push('航线数：' + effectiveLines + ' 条');
			}
			details.push(
				'每条航线照片数（规划）：' + plan.numPhotosPerLine + ' 张'
			);
			details.push(photoSummary);
			details.push('航向推进量：' + advanceText);
			details.push('调整后航线间距：' + spacingText);
			details.push('曝光间隔：' + exposureText);
			details.push('地面覆盖边长：' + coverageText);
			details.push('航向重叠：' + options.overlapLongitudinalPercent.toFixed(0) + '% · 旁向重叠：' + options.overlapLateralPercent.toFixed(0) + '%');
			details.push('航速：' + options.speedMPS.toFixed(2) + ' m/s');
			if (lastPlanSaveStatus) {
				details.push(lastPlanSaveStatus.message);
			}
			planInfo.innerHTML = details.join('<br>');
		}

		function savePhotoCenters(photoCenters, context) {
			lastPlanSaveStatus = null;
			if (!Array.isArray(photoCenters)) {
				return;
			}
			fetch('/save_flight_plan', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ photoCenters: photoCenters })
			}).then(function (response) {
				if (!response.ok) {
					throw new Error('请求失败');
				}
				return response.json();
			}).then(function (data) {
				if (data && data.status === 'ok' && data.filename) {
					lastPlanSaveStatus = { type: 'success', message: '摄影点已保存为: ' + data.filename };
				} else {
					lastPlanSaveStatus = { type: 'error', message: '摄影点保存失败，请检查终端输出。' };
				}
				if (context) {
					updatePlanInfoDisplay(context.plan, context.metrics, context.options, context.geometry);
				}
			}).catch(function (error) {
				console.error('保存摄影点失败:', error);
				lastPlanSaveStatus = { type: 'error', message: '摄影点保存失败，请检查终端输出。' };
				if (context) {
					updatePlanInfoDisplay(context.plan, context.metrics, context.options, context.geometry);
				}
			});
		}

		function updateFlightPlan() {
			if (!rectMetrics) {
				clearFlightPlanOverlays();
				planNeedsUpdate = false;
				planContainer.style.display = 'none';
				planInfo.textContent = '';
				return;
			}
			const options = getPlanOptions();
			const plan = computeFlightPlan(rectMetrics, options);
			if (!plan) {
				clearFlightPlanOverlays();
				planNeedsUpdate = true;
				planContainer.style.display = 'block';
				planInfo.textContent = '参数无效，无法生成航迹。请检查输入。';
				return;
			}
			plan.plannedTotalPhotos = plan.totalPhotos;
			const geometry = generateFlightGeometry(plan, rectMetrics, points.slice());
			clearFlightPlanOverlays();
			if (geometry.path.length >= 2) {
				routePolyline = new AMap.Polyline({
					path: geometry.path,
					strokeColor: '#1f77b4',
					strokeOpacity: 0.9,
					strokeWeight: 2,
					showDir: true,
					zIndex: 80
				});
				map.add(routePolyline);
			}
			if (geometry.footprints.length) {
				footprintPolygons = geometry.footprints.map(function (coords) {
					return new AMap.Polygon({
						path: coords,
						strokeColor: '#555555',
						strokeOpacity: 0.5,
						strokeWeight: 1,
						fillColor: '#ff9900',
						fillOpacity: 0.1,
						zIndex: 60
					});
				});
				if (showFootprints) {
					map.add(footprintPolygons);
				}
			}
			planContainer.style.display = 'block';
			setPlanDisplayState('visible');
			plan.totalPhotosBeforeFilter = geometry.totalPhotosBeforeFilter;
			plan.totalPhotos = geometry.photoCenters.length;
			plan.removedPhotos = geometry.removedPhotos;
			plan.effectiveLineCount = geometry.activeLines;
			lastPlanDisplayContext = {
				plan: plan,
				metrics: rectMetrics,
				options: options,
				geometry: geometry
			};
			lastPlanSaveStatus = null;
			updatePlanInfoDisplay(plan, rectMetrics, options, geometry);
			savePhotoCenters(geometry.photoCenters, lastPlanDisplayContext);
			flightPlan = plan;
			planNeedsUpdate = false;
		}

		map.on('click', function (e) {
			if (selectionFinished) {
				return;
			}
			const lnglat = [e.lnglat.getLng(), e.lnglat.getLat()];
			points.push(lnglat);
			updateOverlays();
			updateLists();
		});

		document.getElementById('finishBtn').addEventListener('click', function () {
			if (points.length < 3) {
				alert('至少需要 3 个点才能结束。');
				return;
			}
			selectionFinished = true;
			updateStatus();
			updateOverlays();
		});

		document.getElementById('resetBtn').addEventListener('click', function () {
			selectionFinished = false;
			points.length = 0;
			if (polygon) {
				map.remove(polygon);
				polygon = null;
			}
			if (boundingRect) {
				map.remove(boundingRect);
				boundingRect = null;
			}
			if (markers.length) {
				map.remove(markers);
				markers = [];
			}
			rectVertices = [];
			clearRectEdgeLabels();
			rectMetrics = null;
			clearFlightPlanOverlays();
			planNeedsUpdate = false;
			planContainer.style.display = 'none';
			planInfo.textContent = '';
			updateLists();
		});

		updateStatus();
		setFootprintVisibility(showFootprints);
		setPlanDisplayState(planDisplayState);
	</script>
</body>
</html>
"""


class _InMemoryHandler(http.server.SimpleHTTPRequestHandler):
    """Serve a static HTML page from memory."""

    def do_GET(self) -> None:  # noqa: N802 - SimpleHTTPRequestHandler signature
        if self.path in ("/", "/index.html"):
            page = HTML_TEMPLATE.replace("__AMAP_KEY__", AMAP_KEY)
            encoded = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
        else:
            self.send_error(404, "Not Found")

    def do_POST(self) -> None:  # noqa: N802 - SimpleHTTPRequestHandler signature
        if self.path == "/save_flight_plan":
            self._handle_save_flight_plan()
        else:
            self.send_error(404, "Not Found")

    def _handle_save_flight_plan(self) -> None:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            self.send_error(400, "Missing Content-Length")
            return
        try:
            length = int(length_header)
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return
        raw_body = self.rfile.read(length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
            return
        centers = payload.get("photoCenters")
        if not isinstance(centers, list):
            self.send_error(400, "Invalid payload structure")
            return
        rows = []
        for entry in centers:
            lng = None
            lat = None
            if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                lng, lat = entry[0], entry[1]
            elif isinstance(entry, dict):
                lng = entry.get("lng") or entry.get("lon") or entry.get("longitude")
                lat = entry.get("lat") or entry.get("latitude")
            try:
                lng_value = float(lng)
                lat_value = float(lat)
            except (TypeError, ValueError):
                continue
            rows.append((lng_value, lat_value))
        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        filename = f"{timestamp}.csv"
        output_path = Path.cwd() / filename
        counter = 1
        while output_path.exists():
            filename = f"{timestamp}_{counter}.csv"
            output_path = Path.cwd() / filename
            counter += 1
        try:
            with output_path.open("w", newline="", encoding="utf-8") as csv_file:
                writer = csv.writer(csv_file)
                writer.writerow(["longitude", "latitude"])
                writer.writerows(rows)
        except OSError as exc:
            self.send_error(500, f"Failed to write CSV: {exc}")
            return
        body = json.dumps({"status": "ok", "filename": filename, "count": len(rows)}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        # Quieter server logs while still accessible for debugging via stderr.
        sys.stderr.write("[INFO] " + fmt % args + "\n")


def main() -> None:
    # Use an ephemeral port to avoid clashes, bind to localhost only for safety.
    with socketserver.TCPServer(("127.0.0.1", 0), _InMemoryHandler) as httpd:
        port = httpd.server_address[1]
        url = f"http://127.0.0.1:{port}/"
        print("已启动本地服务，用于地图选点界面：")
        print(f"  {url}")
        print("按 Ctrl+C 停止服务。")

        # Launch the default browser in a background thread to avoid blocking.
        threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n收到中断，正在退出...")


if __name__ == "__main__":
    main()
