/*签到提醒:u7UIqZNGIwCiDWdxXht1yNg-7dhApk_N3fLHxbjZyds
运营活动通知:xkKkpiG1HkMXHfvBWzf4DyisFCsSP3LNFQ1bgMv0zeE
新功能上线通知:Hd_GCFIvN4376aSMP-eZIylf7I2K0pF-CqFYRN_tQas*/
const SUBSCRIPTION_TEMPLATE_IDS = {
  checkinReminder: "u7UIqZNGIwCiDWdxXht1yNg-7dhApk_N3fLHxbjZyds",
  opsActivity: "xkKkpiG1HkMXHfvBWzf4DyisFCsSP3LNFQ1bgMv0zeE",
  newFeature: "Hd_GCFIvN4376aSMP-eZIylf7I2K0pF-CqFYRN_tQas"
};

const REQUIRED_SUBSCRIPTION_TEMPLATE_IDS = [
  SUBSCRIPTION_TEMPLATE_IDS.opsActivity,
  SUBSCRIPTION_TEMPLATE_IDS.newFeature
];


module.exports = {
  SUBSCRIPTION_TEMPLATE_IDS,
  REQUIRED_SUBSCRIPTION_TEMPLATE_IDS
};
