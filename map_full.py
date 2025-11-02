"""Simple Gaode/Amap polygon picker served via a local HTTP server."""

from __future__ import annotations

import http.server
import socketserver
import sys
import threading
import webbrowser


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
				<button id="updatePlanBtn" type="button">生成航迹</button>
				<button id="clearPlanBtn" type="button">清除航迹</button>
				<button id="toggleFootprintsBtn" type="button">隐藏成像区域</button>
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
			background: 'rgba(255,255,255,0.8)',
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
		const updatePlanBtn = document.getElementById('updatePlanBtn');
		const clearPlanBtn = document.getElementById('clearPlanBtn');
		const toggleFootprintsBtn = document.getElementById('toggleFootprintsBtn');
		const planInputs = [frameSizeInput, focalLengthInput, scaleInput, longOverlapInput, latOverlapInput, speedInput];

		function handlePlanInputChange() {
			if (!rectMetrics) {
				return;
			}
			planNeedsUpdate = true;
			const message = flightPlan ? '参数已修改，请点击“生成航迹”重新生成。' : '参数已设置，请点击“生成航迹”生成航迹。';
			planInfo.textContent = message;
		}

		planInputs.forEach(function (input) {
			input.addEventListener('change', handlePlanInputChange);
			input.addEventListener('input', handlePlanInputChange);
		});

		updatePlanBtn.addEventListener('click', function () {
			if (!rectMetrics) {
				planContainer.style.display = 'block';
				planInfo.textContent = '请先在地图上选取至少三个点以生成航迹。';
				return;
			}
			updateFlightPlan();
		});

		clearPlanBtn.addEventListener('click', function () {
			clearFlightPlanOverlays();
			planNeedsUpdate = Boolean(rectMetrics);
			planInfo.textContent = '航迹已清除，如需重新生成请点击“生成航迹”。';
			planContainer.style.display = rectMetrics ? 'block' : 'none';
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
					strokeOpacity: 0.9,
					strokeWeight: 2,
					fillColor: '#ff0000',
					fillOpacity: 0.35
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
					strokeOpacity: 0.8,
					strokeWeight: 2,
					fillColor: '#0066ff',
					fillOpacity: 0.2
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
					planInfo.textContent = '外接矩形已更新，请点击“生成航迹”生成航迹。';
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

		function generateFlightGeometry(plan, metrics) {
			if (!plan) {
				return { path: [], photoCenters: [], footprints: [] };
			}
			const xPositions = linspace(0, plan.longSide, plan.numPhotosPerLine);
			const yPositions = linspace(0, plan.shortSide, plan.numLines);
			const pathPlanCoords = [];
			const photoPlanCoords = [];
			const turnRadius = plan.adjustedSpacing / 2;
			for (let i = 0; i < yPositions.length; i += 1) {
				const y = yPositions[i];
				const xLine = (i % 2 === 0) ? xPositions : xPositions.slice().reverse();
				for (let j = 0; j < xLine.length; j += 1) {
					const x = xLine[j];
					pathPlanCoords.push({ x: x, y: y });
					photoPlanCoords.push({ x: x, y: y });
				}
				if (i < yPositions.length - 1 && plan.numLines > 1 && turnRadius > 0) {
					const cx = (i % 2 === 0) ? xPositions[xPositions.length - 1] : xPositions[0];
					const cy = y + turnRadius;
					const startAngle = (i % 2 === 0) ? -90 : 270;
					const angles = linspace(startAngle, 90, 30);
					for (let k = 0; k < angles.length; k += 1) {
						const theta = angles[k] * Math.PI / 180;
						const arcX = cx + turnRadius * Math.cos(theta);
						const arcY = cy + turnRadius * Math.sin(theta);
						pathPlanCoords.push({ x: arcX, y: arcY });
					}
				}
			}
			const path = pathPlanCoords.map(function (coord) {
				return planToLngLat(coord.x, coord.y, plan, metrics);
			});
			const photoCenters = photoPlanCoords.map(function (coord) {
				return planToLngLat(coord.x, coord.y, plan, metrics);
			});
			const halfSize = plan.groundCoverage / 2;
			const footprints = photoPlanCoords.map(function (center) {
				const cornersPlan = [
					{ x: center.x - halfSize, y: center.y - halfSize },
					{ x: center.x + halfSize, y: center.y - halfSize },
					{ x: center.x + halfSize, y: center.y + halfSize },
					{ x: center.x - halfSize, y: center.y + halfSize }
				];
				return cornersPlan.map(function (coord) {
					return planToLngLat(coord.x, coord.y, plan, metrics);
				});
			});
			return {
				path: path,
				photoCenters: photoCenters,
				footprints: footprints
			};
		}

		function clearFlightPlanOverlays() {
			if (routePolyline) {
				map.remove(routePolyline);
				routePolyline = null;
			}
			if (footprintPolygons.length) {
				map.remove(footprintPolygons);
				footprintPolygons = [];
			}
			flightPlan = null;
		}

		function setFootprintVisibility(shouldShow) {
			showFootprints = shouldShow;
			if (toggleFootprintsBtn) {
				toggleFootprintsBtn.textContent = shouldShow ? '隐藏成像区域' : '显示成像区域';
			}
			if (!footprintPolygons.length) {
				return;
			}
			if (shouldShow) {
				map.add(footprintPolygons);
			} else {
				map.remove(footprintPolygons);
			}
		}

		function updatePlanInfoDisplay(plan, metrics, options) {
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
			const details = [
				'外接矩形：东西 ' + widthText + ' · 南北 ' + heightText,
				'相机焦距：' + focalText,
				'航迹方向：' + plan.directionLabel,
				'航高：' + heightFlightText,
				'航线数：' + plan.numLines + ' 条',
				'每条航线照片数：' + plan.numPhotosPerLine + ' 张',
				'预计总照片数：' + plan.totalPhotos + ' 张',
				'航向推进量：' + advanceText,
				'调整后航线间距：' + spacingText,
				'曝光间隔：' + exposureText,
				'地面覆盖边长：' + coverageText,
				'航向重叠：' + options.overlapLongitudinalPercent.toFixed(0) + '% · 旁向重叠：' + options.overlapLateralPercent.toFixed(0) + '%',
				'航速：' + options.speedMPS.toFixed(2) + ' m/s'
			];
			planInfo.innerHTML = details.join('<br>');
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
			const geometry = generateFlightGeometry(plan, rectMetrics);
			clearFlightPlanOverlays();
			if (geometry.path.length) {
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
						strokeOpacity: 0.6,
						strokeWeight: 1,
						fillColor: '#ff9900',
						fillOpacity: 0.23,
						zIndex: 60
					});
				});
				if (showFootprints) {
					map.add(footprintPolygons);
				}
			}
			planContainer.style.display = 'block';
			updatePlanInfoDisplay(plan, rectMetrics, options);
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
