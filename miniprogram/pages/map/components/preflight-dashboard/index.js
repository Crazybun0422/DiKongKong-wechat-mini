Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    stealthModeActive: { type: Boolean, value: false },
    topPx: { type: Number, value: 0 },
    leftPx: { type: Number, value: 0 },
    uiScaleStyle: { type: String, value: "" },
    dronePickerLabel: { type: String, value: "" },
    temporaryNoFlyZoneInfo: { type: Object, value: null },
    temporaryNoFlyTone: { type: String, value: "" },
    temporaryNoFlyText: { type: String, value: "" },
    uomLoading: { type: Boolean, value: false },
    uomTone: { type: String, value: "" },
    uomStatus: { type: String, value: "" },
    djiTone: { type: String, value: "" },
    djiColor: { type: String, value: "" },
    djiStatus: { type: String, value: "" },
    djiStatusExtra: { type: String, value: "" },
    centerPinTitle: { type: String, value: "" },
    keyword: { type: String, value: "" },
    searchSuggestions: { type: Array, value: [] },
    searchSuggestLoading: { type: Boolean, value: false },
    searchSuggestError: { type: String, value: "" },
    cityReportCenter: { type: Object, value: null },
    cityReportActive: { type: Boolean, value: false },
    cityReportDialogVisible: { type: Boolean, value: false },
    cityReportDialogText: { type: String, value: "" }
  },

  methods: {
    onOpenDronePickerTap() {
      this.triggerEvent("opendronepicker");
    },

    onTemporaryZoneLinkTap(event = {}) {
      const dataset = event.currentTarget?.dataset || {};
      this.triggerEvent("temporaryzonelinktap", {
        path: dataset.path || "",
        link: dataset.link || ""
      });
    },

    onCenterPinIndicatorTap() {
      this.triggerEvent("centerpinindicatortap");
    },

    onKeywordInput(event = {}) {
      this.triggerEvent("keywordinput", event.detail || {});
    },

    onSearchConfirm(event = {}) {
      this.triggerEvent("searchconfirm", event.detail || {});
    },

    onSearchTap() {
      this.triggerEvent("searchtap");
    },

    onSearchCoordinateTipsTap() {
      this.triggerEvent("searchcoordinatetipstap");
    },

    onSuggestionTap(event = {}) {
      const index = Number(event.currentTarget?.dataset?.index);
      this.triggerEvent("suggestiontap", { index });
    },

    onCityReportStateChange(event = {}) {
      this.triggerEvent("cityreportstatechange", event.detail || {});
    },

    onCityReportDialogChange(event = {}) {
      this.triggerEvent("cityreportdialogchange", event.detail || {});
    },

    onCityReportDialogClose() {
      this.triggerEvent("cityreportdialogclose");
    },

    closeCityReportDialog() {
      const host = this.selectComponent("#city-report-h5-entry");
      if (host && typeof host.closeDialog === "function") {
        host.closeDialog();
      }
    }
  }
});
