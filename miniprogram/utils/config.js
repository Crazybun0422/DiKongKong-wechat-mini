const QQMAP_KEY = "YJTBZ-5EBCT-SBAXN-VRUYM-SUXR7-O6FX4"; // TODO: inject your Tencent Map key
const QQMAP_CUSTOM_STYLE_ID = "35416"; // TODO: replace with the custom styleId from Tencent Map if needed

// const QQMAP_KEY = "QQXBZ-BRJKZ-AB4XD-7PUXM-KLXX6-5CFXZ";
const DJI_PROXY = ""; // Optional: prefix to proxy DJI API requests
const CAAC_TOKEN = "1e4b78fc-06bd-45be-8af7-cabd802ea9a8"; // CAAC WMS token
const CITY_REPORT_CITY_CONFIGS = {
  shanghai: {
    label: "上海市飞行申请",
    appId: "wxc5059c3803665d9c",
    path: "suishenban-main-mine/pages/h5/publicJumpH5/index?path=https%3A%2F%2Fsmartgate.ywtbsupappw.sh.gov.cn%2Fsite%2Fact%2FunmannedAerialVehicle%2F%23%2Fhome",
    mpLink: "https://mp.weixin.qq.com/s/828wjvZ7SyWqNi8gdlPH3g"
  },
  nanchang: {
    label: "南昌市飞行申请",
    appId: "wx4e8a0957bbf2ead8",
    path: "",
    mpLink: "https://mp.weixin.qq.com/s/828wjvZ7SyWqNi8gdlPH3g"
  }
};

module.exports = {
  QQMAP_KEY,
  QQMAP_CUSTOM_STYLE_ID,
  DJI_PROXY,
  CAAC_TOKEN,
  CITY_REPORT_CITY_CONFIGS
};
