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
    el.resetBtn = document.getElementById("resetBtn");
    el.basemapSelect = document.getElementById("basemapSelect");
    el.planContainer = document.getElementById("planContainer");
    el.planStatus = document.getElementById("planStatus");
    el.planInfoPanel = document.getElementById("planInfoPanel");
    el.planInfoDetails = document.getElementById("planInfoDetails");
    el.planInfoMessage = document.getElementById("planInfoMessage");
    el.frameSizeInput = document.getElementById("frameSizeInput");
    el.focalLengthInput = document.getElementById("focalLengthInput");
    el.scaleInput = document.getElementById("scaleInput");
    el.longOverlapInput = document.getElementById("longOverlapInput");
    el.latOverlapInput = document.getElementById("latOverlapInput");
    el.speedInput = document.getElementById("speedInput");
    el.planPrimaryBtn = document.getElementById("planPrimaryBtn");
    el.toggleFootprintsBtn = document.getElementById("toggleFootprintsBtn");
    el.savePhotoCentersBtn = document.getElementById("savePhotoCentersBtn");
  }

  function updateStatus() {
    const el = App.elements;
    if (App.state.selectionFinished) {
      el.status.textContent = "选点已结束，共 " + App.state.points.length + " 个点。";
    } else if (App.state.points.length >= 3) {
      el.status.textContent = "可以点击“结束选点”按钮完成选择。当前 " + App.state.points.length + " 个点。";
    } else {
      el.status.textContent = "请在地图上点击添加点，至少需要 3 个点。当前 " + App.state.points.length + " 个点。";
    }
  }

  function updateLists() {
    const el = App.elements;
    utils.renderCoordinateList(el.pointsList, App.state.points);
    if (App.state.rectVertices.length) {
      el.rectContainer.style.display = "block";
      utils.renderCoordinateList(el.rectList, App.state.rectVertices);
    } else {
      el.rectContainer.style.display = "none";
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
