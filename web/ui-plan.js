(function () {
  const App = window.App;
  const utils = App.utils;

  function getPlanInputs() {
    const el = App.elements;
    return [el.frameSizeInput, el.focalLengthInput, el.scaleInput, el.longOverlapInput, el.latOverlapInput, el.speedInput];
  }

  function getPlanOptions() {
    const el = App.elements;
    const parse = utils.parseNumber;
    const clamp = utils.clamp;
    const frame = Math.max(parse(el.frameSizeInput, 200), 0.1);
    const focal = Math.max(parse(el.focalLengthInput, 200), 0.1);
    const scale = Math.max(parse(el.scaleInput, 25000), 1);
    const overlapLong = clamp(parse(el.longOverlapInput, 60), 0, 95);
    const overlapLat = clamp(parse(el.latOverlapInput, 30), 0, 90);
    const speed = Math.max(parse(el.speedInput, 5), 0.1);
    return {
      frameSize: frame,
      focalLengthMM: focal,
      scaleDenominator: scale,
      overlapLongitudinal: overlapLong / 100,
      overlapLateral: overlapLat / 100,
      speedMPS: speed,
      overlapLongitudinalPercent: overlapLong,
      overlapLateralPercent: overlapLat
    };
  }

  function handlePlanInputChange() {
    if (!App.state.rectMetrics) { return; }
    const el = App.elements;
    App.state.planNeedsUpdate = true;
    el.planStatus.textContent = App.state.flightPlan ? "参数已修改，请点击“生成/隐藏航迹”重新生成。" : "参数已设置，请点击“生成/隐藏航迹”生成航迹。";
    el.toggleFootprintsBtn.style.display = "none";
  }

  function syncPlanDisplayState() {
    const el = App.elements;
    el.toggleFootprintsBtn.style.display = App.state.planDisplayState === "visible" ? "inline-block" : "none";
  }

  function resetPlanInfo() {
    const el = App.elements;
    if (!el.planInfoPanel) { return; }
    el.planInfoPanel.style.display = "none";
    el.planInfoDetails.innerHTML = "";
    el.savePhotoCentersBtn.style.display = "none";
    el.savePhotoCentersBtn.disabled = false;
    el.savePhotoCentersBtn.textContent = "保存摄影点经纬度坐标";
    el.planInfoMessage.textContent = "";
    el.planInfoMessage.style.display = "none";
    el.planInfoMessage.classList.remove("status-success", "status-error");
  }

  function updatePlanInfoDisplay(context) {
    if (!context || !context.plan || !context.metrics) {
      resetPlanInfo();
      return;
    }
    const plan = context.plan;
    const geometry = context.geometry;
    const spacingText = plan.numLines > 1 ? utils.formatDistance(plan.adjustedSpacing) : "—";
    const exposureText = plan.exposureInterval ? plan.exposureInterval.toFixed(2) + " 秒" : "—";
    const coverageText = utils.formatDistance(plan.groundCoverage);
    const advanceText = utils.formatDistance(plan.advance);
    const heightText = plan.flightHeight ? utils.formatDistance(plan.flightHeight) : "—";
    const totalBefore = geometry ? geometry.totalPhotosBeforeFilter : plan.totalPhotosBeforeFilter;
    const removed = geometry ? geometry.removedPhotos : plan.removedPhotos;
    const effectiveLines = geometry ? geometry.activeLines : plan.effectiveLineCount;
    const details = [
      "航迹方向：" + plan.directionLabel,
      "航高：" + heightText,
      (effectiveLines !== plan.numLines ? "有效航线数：" : "航线数：") + effectiveLines + " 条",
      "每条航线照片数（规划）：" + plan.numPhotosPerLine + " 张",
      removed > 0 ? "有效照片数：" + plan.totalPhotos + " 张（原始 " + totalBefore + " 张，剔除冗余 " + removed + " 张）" : "预计总照片数：" + plan.totalPhotos + " 张",
      "航向推进量：" + advanceText,
      "调整后航线间距：" + spacingText,
      "曝光间隔：" + exposureText,
      "地面覆盖边长：" + coverageText
    ];
    const el = App.elements;
  if (!el.planInfoPanel) { return; }
    el.planInfoDetails.innerHTML = details.join("<br>");
    const hasPhotoCenters = Boolean(geometry && Array.isArray(geometry.photoCenters) && geometry.photoCenters.length);
    if (hasPhotoCenters) {
      el.savePhotoCentersBtn.style.display = "block";
      el.savePhotoCentersBtn.disabled = Boolean(App.state.isSavingPhotoCenters);
      el.savePhotoCentersBtn.textContent = App.state.isSavingPhotoCenters ? "保存中..." : "保存摄影点经纬度坐标";
    } else {
      el.savePhotoCentersBtn.style.display = "none";
    }
    const status = App.state.lastSaveStatus;
    if (status && status.message) {
      el.planInfoMessage.textContent = status.message;
      el.planInfoMessage.style.display = "block";
      el.planInfoMessage.classList.remove("status-success", "status-error");
      if (status.type === "success") {
        el.planInfoMessage.classList.add("status-success");
      } else if (status.type === "error") {
        el.planInfoMessage.classList.add("status-error");
      }
    } else {
      el.planInfoMessage.textContent = "";
      el.planInfoMessage.style.display = "none";
      el.planInfoMessage.classList.remove("status-success", "status-error");
    }
    el.planInfoPanel.style.display = "block";
  }

  App.uiPlan = {
    getPlanInputs: getPlanInputs,
    getPlanOptions: getPlanOptions,
    handlePlanInputChange: handlePlanInputChange,
    syncPlanDisplayState: syncPlanDisplayState,
    resetPlanInfo: resetPlanInfo,
    updatePlanInfoDisplay: updatePlanInfoDisplay
  };
})();
