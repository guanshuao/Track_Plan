(function () {
  const App = window.App;
  const utils = App.utils;

  function cacheElements() {
    const el = App.elements;
    el.pointsList = document.getElementById("points");
    el.rectContainer = document.getElementById("rectContainer");
    el.rectList = document.getElementById("rectPoints");
    el.status = document.getElementById("status");
    el.finishBtn = document.getElementById("finishBtn");
    el.undoPointBtn = document.getElementById("undoPointBtn");
    el.resetBtn = document.getElementById("resetBtn");
    el.pointCountBadge = document.getElementById("pointCountBadge");
    el.selectionStepBadge = document.getElementById("selectionStepBadge");
    el.manualPointForm = document.getElementById("manualPointForm");
    el.manualPointDetails = document.querySelector(".precision-entry");
    el.manualPointSubmit = el.manualPointForm.querySelector('button[type="submit"]');
    el.manualLngInput = document.getElementById("manualLngInput");
    el.manualLatInput = document.getElementById("manualLatInput");
    el.manualPointError = document.getElementById("manualPointError");
    el.basemapSelect = document.getElementById("basemapSelect");
    el.planContainer = document.getElementById("planContainer");
    el.planStatus = document.getElementById("planStatus");
    el.planInfoPanel = document.getElementById("planInfoPanel");
    el.planInfoDetails = document.getElementById("planInfoDetails");
    el.planWarnings = document.getElementById("planWarnings");
    el.planInfoMessage = document.getElementById("planInfoMessage");
    el.frameAlongInput = document.getElementById("frameAlongInput");
    el.frameAcrossInput = document.getElementById("frameAcrossInput");
    el.focalLengthInput = document.getElementById("focalLengthInput");
    el.scaleInput = document.getElementById("scaleInput");
    el.longOverlapInput = document.getElementById("longOverlapInput");
    el.latOverlapInput = document.getElementById("latOverlapInput");
    el.speedInput = document.getElementById("speedInput");
    el.planPrimaryBtn = document.getElementById("planPrimaryBtn");
    el.toggleFootprintsBtn = document.getElementById("toggleFootprintsBtn");
    el.savePhotoCentersBtn = document.getElementById("savePhotoCentersBtn");
    el.mapStatusOverlay = document.getElementById("mapStatusOverlay");
    el.mapStatusText = document.getElementById("mapStatusText");
    el.retryMapBtn = document.getElementById("retryMapBtn");
    el.shutdownBtn = document.getElementById("shutdownBtn");
  }

  function updateStatus() {
    const el = App.elements;
    el.status.classList.toggle("status-error", Boolean(App.state.selectionError));
    if (App.state.selectionError) {
      el.status.textContent = App.state.selectionError;
    } else if (App.state.selectionFinished) {
      el.status.textContent = "选点已结束，共 " + App.state.points.length + " 个点。";
    } else if (App.state.points.length >= 3) {
      el.status.textContent = "可以点击“完成选区”按钮继续。当前 " + App.state.points.length + " 个点。";
    } else {
      el.status.textContent = "请在地图上点击添加点，至少需要 3 个点。当前 " + App.state.points.length + " 个点。";
    }
    el.finishBtn.disabled = App.state.selectionFinished || App.state.points.length < 3;
    el.undoPointBtn.disabled = App.state.points.length === 0;
    el.manualLngInput.disabled = App.state.selectionFinished;
    el.manualLatInput.disabled = App.state.selectionFinished;
    el.manualPointSubmit.disabled = App.state.selectionFinished;
    el.pointCountBadge.textContent = String(App.state.points.length);
    el.selectionStepBadge.textContent = App.state.selectionFinished ? "步骤 3 / 3" : "步骤 1 / 3";
  }

  function renderSelectionPoints() {
    const list = App.elements.pointsList;
    list.innerHTML = "";
    App.state.points.forEach(function (lnglat, index) {
      const item = document.createElement("li");
      const coordinate = document.createElement("span");
      coordinate.textContent = (index + 1) + ": " + lnglat[0].toFixed(6) + ", " + lnglat[1].toFixed(6);
      item.appendChild(coordinate);
      if (!App.state.selectionFinished) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-point";
        remove.dataset.pointIndex = String(index);
        remove.setAttribute("aria-label", "删除第 " + (index + 1) + " 个点");
        remove.textContent = "删除";
        item.appendChild(remove);
      }
      list.appendChild(item);
    });
  }

  function updateLists() {
    const el = App.elements;
    renderSelectionPoints();
    const rectVertices = App.state.rectMetrics ? App.state.rectMetrics.cornerLngLats : [];
    if (rectVertices.length) {
      el.rectContainer.classList.remove("is-hidden");
      utils.renderCoordinateList(el.rectList, rectVertices);
    } else {
      el.rectContainer.classList.add("is-hidden");
      el.rectList.innerHTML = "";
    }
    updateStatus();
  }

  App.uiCore = {
    cacheElements: cacheElements,
    updateStatus: updateStatus,
    updateLists: updateLists
  };
})();
