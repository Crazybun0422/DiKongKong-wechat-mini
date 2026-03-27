function onCityReportStateChange(page, event = {}) {
  const detail = event?.detail || {};
  page.setData({
    cityReportBlockerVisible: !!detail.blockMap
  }, () => {
    page.updateMapBlockerVisible();
  });
}

function onCityReportDialogChange(page, event = {}) {
  const detail = event?.detail || {};
  const visible = !!detail.visible;
  const text = typeof detail.text === "string" ? detail.text : "";
  page.setData({
    cityReportDialogVisible: visible,
    cityReportDialogText: text
  });
}

function onCityReportDialogClose(page) {
  const dashboard = page.selectComponent("#preflight-dashboard");
  if (dashboard && typeof dashboard.closeCityReportDialog === "function") {
    dashboard.closeCityReportDialog();
  } else {
    const popup = page.selectComponent("#city-report-h5-entry");
    if (popup && typeof popup.closeDialog === "function") {
      popup.closeDialog();
    }
  }
  if (page.data.cityReportDialogVisible) {
    page.setData({ cityReportDialogVisible: false });
  }
}

module.exports = {
  onCityReportStateChange,
  onCityReportDialogChange,
  onCityReportDialogClose
};
