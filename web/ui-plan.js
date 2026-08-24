(function () {
  const App = window.App;
  const utils = App.utils;

  function getPlanInputs() {
    const el = App.elements;
    return [el.frameAlongInput, el.frameAcrossInput, el.focalLengthInput, el.scaleInput,
      el.longOverlapInput, el.latOverlapInput, el.speedInput];
  }

  function getPlanOptions() {
    const el = App.elements;
    const invalidInput = getPlanInputs().find(function (input) {
      return !input.checkValidity() || input.value.trim() === "" || !Number.isFinite(Number(input.value));
    });
    if (invalidInput) {
      invalidInput.reportValidity();
      invalidInput.focus();
      throw new Error("请修正标出的航摄参数后再生成航迹。");
    }
    const frameAlong = Number(el.frameAlongInput.value);
    const frameAcross = Number(el.frameAcrossInput.value);
    const focal = Number(el.focalLengthInput.value);
    const scale = Number(el.scaleInput.value);
    const overlapLong = Number(el.longOverlapInput.value);
    const overlapLat = Number(el.latOverlapInput.value);
    const speed = Number(el.speedInput.value);
    return {
      frameAlongMM: frameAlong,
      frameAcrossMM: frameAcross,
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
    App.actions.invalidateFlightPlan("参数已修改，请重新生成航迹。");
  }

  function syncPlanDisplayState() {
    const el = App.elements;
    const hasSelection = Boolean(App.state.rectMetrics);
    const context = App.state.planContext;
    const hasCurrentPlan = Boolean(context && context.revision === App.state.planRevision);
    el.planPrimaryBtn.disabled = !hasSelection;
    if (!hasCurrentPlan) {
      el.planPrimaryBtn.textContent = "生成航迹";
      el.planPrimaryBtn.removeAttribute("aria-pressed");
    } else if (App.state.planVisible) {
      el.planPrimaryBtn.textContent = "隐藏航迹";
      el.planPrimaryBtn.setAttribute("aria-pressed", "true");
    } else {
      el.planPrimaryBtn.textContent = "显示航迹";
      el.planPrimaryBtn.setAttribute("aria-pressed", "false");
    }
    const canToggleFootprints = hasCurrentPlan && App.state.planVisible &&
      context.geometry && context.geometry.footprints.length > 0 && !context.geometry.footprintsSuppressed;
    el.toggleFootprintsBtn.classList.toggle("is-hidden", !canToggleFootprints);
    el.toggleFootprintsBtn.textContent = App.state.showFootprints ? "隐藏成像区域" : "显示成像区域";
    el.toggleFootprintsBtn.setAttribute("aria-pressed", String(App.state.showFootprints));
  }

  function resetPlanInfo() {
    const el = App.elements;
    if (!el.planInfoPanel) { return; }
    el.planInfoPanel.classList.add("is-hidden");
    el.planInfoDetails.innerHTML = "";
    el.planWarnings.innerHTML = "";
    el.savePhotoCentersBtn.classList.add("is-hidden");
    el.savePhotoCentersBtn.disabled = false;
    el.savePhotoCentersBtn.textContent = "保存摄影点坐标（GCJ-02）";
    el.savePhotoCentersBtn.setAttribute("aria-busy", "false");
    el.planInfoMessage.textContent = "";
    el.planInfoMessage.classList.add("is-hidden");
    el.planInfoMessage.classList.remove("status-success", "status-error");
  }

  function updatePlanInfoDisplay(context) {
    if (!context || !context.plan || !context.metrics) {
      resetPlanInfo();
      return;
    }
    const plan = context.plan;
    const geometry = context.geometry;
    const spacingText = Number.isFinite(plan.adjustedSpacing) ? utils.formatDistance(plan.adjustedSpacing) : "单航线";
    const exposureText = plan.exposureInterval ? plan.exposureInterval.toFixed(2) + " 秒" : "—";
    const coverageText = utils.formatDistance(plan.coverageAlong) + " × " + utils.formatDistance(plan.coverageAcross);
    const advanceText = Number.isFinite(plan.advance) ? utils.formatDistance(plan.advance) : "单点覆盖";
    const heightText = plan.flightHeight ? utils.formatDistance(plan.flightHeight) : "—";
    const totalBefore = geometry ? geometry.totalPhotosBeforeFilter : plan.totalPhotosBeforeFilter;
    const removed = geometry ? geometry.removedPhotos : plan.removedPhotos;
    const effectiveLines = geometry ? geometry.activeLines : plan.effectiveLineCount;
    const details = [
      ["航迹方向", plan.directionLabel],
      ["相对航高", heightText + " AGL（平坦地面假设）"],
      [effectiveLines !== plan.numLines ? "有效航线" : "航线数量", effectiveLines + " 条"],
      ["有效摄影点", plan.totalPhotos + " 张" + (removed > 0 ? " / 候选 " + totalBefore : "")],
      ["实际航向点距", advanceText],
      ["实际旁向间距", spacingText],
      ["格网曝光间隔", exposureText],
      ["单幅地面覆盖", coverageText]
    ];
    const el = App.elements;
    if (!el.planInfoPanel) { return; }
    el.planInfoDetails.innerHTML = "";
    el.planWarnings.innerHTML = "";
    details.forEach(function (detail) {
      const row = document.createElement("div");
      row.className = "metric-row";
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = detail[0];
      value.textContent = detail[1];
      row.appendChild(term);
      row.appendChild(value);
      el.planInfoDetails.appendChild(row);
    });
    const warningMessages = Array.isArray(plan.warnings) ? plan.warnings.slice() : [];
    if (geometry && geometry.footprintsSuppressed) {
      warningMessages.push("摄影点较多，已停止渲染单幅成像区域，以保护浏览器性能。");
    }
    if (warningMessages.length) {
      const warnings = document.createElement("ul");
      warnings.className = "plan-warning-list";
      warningMessages.forEach(function (message) {
        const item = document.createElement("li");
        item.textContent = message;
        warnings.appendChild(item);
      });
      el.planWarnings.appendChild(warnings);
    }
    const hasPhotoCenters = Boolean(geometry && Array.isArray(geometry.photoRecords) && geometry.photoRecords.length &&
      context === App.state.planContext && context.revision === App.state.planRevision);
    if (hasPhotoCenters) {
      el.savePhotoCentersBtn.classList.remove("is-hidden");
      el.savePhotoCentersBtn.disabled = Boolean(App.state.isSavingPhotoCenters);
      el.savePhotoCentersBtn.textContent = App.state.isSavingPhotoCenters ? "保存中…" : "保存摄影点坐标（GCJ-02）";
      el.savePhotoCentersBtn.setAttribute("aria-busy", String(App.state.isSavingPhotoCenters));
    } else {
      el.savePhotoCentersBtn.classList.add("is-hidden");
    }
    const status = App.state.saveStatus;
    if (status && status.message) {
      el.planInfoMessage.textContent = status.message;
      el.planInfoMessage.classList.remove("is-hidden");
      el.planInfoMessage.classList.remove("status-success", "status-error");
      if (status.type === "success") {
        el.planInfoMessage.classList.add("status-success");
      } else if (status.type === "error") {
        el.planInfoMessage.classList.add("status-error");
      }
    } else {
      el.planInfoMessage.textContent = "";
      el.planInfoMessage.classList.add("is-hidden");
      el.planInfoMessage.classList.remove("status-success", "status-error");
    }
    el.planInfoPanel.classList.remove("is-hidden");
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
