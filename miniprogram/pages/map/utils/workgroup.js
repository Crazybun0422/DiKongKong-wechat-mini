const { loadStoredProfile } = require("../../../utils/profile");
const { joinWorkGroup } = require("../../../utils/workGroups");
const { decodeParamValue, parseSceneParams } = require("./launch-shared");

const decodeMaybeURI = (text = "") => {
  if (typeof text !== "string") return "";
  let current = text.replace(/\+/g, " ");
  for (let i = 0; i < 3; i += 1) {
    try {
      if (/%[0-9a-fA-F]{2}/.test(current)) {
        const decoded = decodeURIComponent(current);
        if (decoded === current) break;
        current = decoded;
        continue;
      }
    } catch (err) {
      console.warn("decodeMaybeURI failed", err);
      break;
    }
    break;
  }
  return current;
};

const extractWorkGroupInvite = (options = {}) => {
  const readFromObject = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    const invitationCode = decodeParamValue(obj.ic || obj.invitationCode || obj.inviteCode);
    const groupId = decodeParamValue(obj.groupId || obj.workGroupId);
    const groupName = decodeParamValue(obj.groupName);
    if (!invitationCode || !groupId) return null;
    return { invitationCode, groupId, groupName };
  };

  const direct = readFromObject(options);
  if (direct) return direct;
  if (options.query) {
    const fromQuery = readFromObject(options.query);
    if (fromQuery) return fromQuery;
  }
  const sceneParams = parseSceneParams(options.scene);
  const fromScene = readFromObject(sceneParams);
  if (fromScene) return fromScene;
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const fromQ = readFromObject(qParams);
    if (fromQ) return fromQ;
  }
  return null;
};

function handleWorkGroupInviteOptions(page, options = {}) {
  const payload = extractWorkGroupInvite(options);
  if (!payload) return;
  const normalized = {
    invitationCode: payload.invitationCode,
    groupId: payload.groupId,
    groupName: decodeMaybeURI(payload.groupName || payload.groupId || "")
  };
  if (isSelfWorkGroupInvite(page, normalized.invitationCode)) {
    page.setData({ joinInvitePrompt: null, joinInviting: false, joinInviteLoginPending: false });
    clearWorkGroupInviteParams(page);
    navigateToWorkGroupCenter(page);
    return;
  }
  setPendingWorkGroupInvite(page, normalized);
  clearWorkGroupInviteParams(page);
  navigateToWorkGroupCenter(page);
}

function clearWorkGroupInviteParams() {
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const currentPage = Array.isArray(pages) && pages.length ? pages[pages.length - 1] : null;
    if (currentPage && currentPage.options) {
      ["invitationCode", "inviteCode", "groupId", "workGroupId", "groupName"].forEach((key) => {
        if (key in currentPage.options) {
          delete currentPage.options[key];
        }
      });
    }
  } catch (err) {
    console.warn("clearWorkGroupInviteParams failed", err);
  }
}

function setPendingWorkGroupInvite(page, payload = null) {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.pendingWorkGroupInvite = payload;
    }
  } catch (err) {
    console.warn("setPendingWorkGroupInvite failed", err);
  }
}

function isSelfWorkGroupInvite(page, invitationCode = "") {
  const code = `${invitationCode || ""}`.trim();
  if (!code) return false;
  try {
    const shareCode = page.getShareInviteCodeValue ? page.getShareInviteCodeValue() : "";
    if (shareCode && `${shareCode}`.trim() === code) {
      return true;
    }
  } catch (err) {
    console.warn("compare invite code with share code failed", err);
  }
  try {
    const stored = typeof loadStoredProfile === "function" ? loadStoredProfile() : null;
    const storedCode = `${stored?.inviteCode || ""}`.trim();
    if (storedCode && storedCode === code) {
      return true;
    }
  } catch (err) {
    console.warn("compare invite code with stored profile failed", err);
  }
  return false;
}

function promptJoinWorkGroup(page, promptPayload) {
  const prompt = promptPayload || page.data.joinInvitePrompt;
  if (!prompt?.invitationCode || !prompt?.groupId) return;
  const name = decodeMaybeURI(prompt.groupName || prompt.groupId || "");
  page.setData({
    joinInvitePrompt: { invitationCode: prompt.invitationCode, groupId: prompt.groupId, groupName: name },
    joinInviting: false,
    joinInviteLoginPending: false
  });
}

function confirmJoinWorkGroup(page, promptPayload) {
  const evt = promptPayload && promptPayload.currentTarget ? promptPayload : null;
  const ds = (evt && evt.currentTarget && evt.currentTarget.dataset) || {};
  const prompt =
    (ds.invitationCode && ds.groupId && {
      invitationCode: ds.invitationCode,
      groupId: ds.groupId,
      groupName: ds.groupName
    }) ||
    page.data.joinInvitePrompt ||
    {};
  console.log("confirmJoinWorkGroup", prompt);
  if (!prompt.invitationCode || !prompt.groupId || page.data.joinInviting) return;
  const run = () => {
    page.setData({ joinInviting: true });
    joinWorkGroup(prompt.groupId, prompt.invitationCode, { apiBase: page.apiBase })
      .then(() => {
        wx.showToast({ title: "已加入工作组", icon: "success" });
        clearWorkGroupInviteParams(page);
        page.setData({ joinInvitePrompt: null });
        navigateToWorkGroupCenter(page);
      })
      .catch((err) => {
        console.error("加入工作组失败", err);
        const message = err?.message || "";
        if (/已加入/.test(message) || /already/i.test(message)) {
          wx.showToast({ title: "已在工作组中", icon: "success" });
          clearWorkGroupInviteParams(page);
          page.setData({ joinInvitePrompt: null });
          navigateToWorkGroupCenter(page);
          return;
        }
        wx.showToast({ title: message || "加入失败", icon: "none" });
      })
      .finally(() => page.setData({ joinInviting: false }));
  };
  run();
}

function cancelJoinWorkGroup(page) {
  clearWorkGroupInviteParams(page);
  page.setData({ joinInvitePrompt: null, joinInviting: false, joinInviteLoginPending: false });
}

function navigateToWorkGroupCenter() {
  const url = "/pages/markers/index";
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.targetMarkersCenterTab = "WORKGROUP";
    }
  } catch (err) {
    console.warn("set targetMarkersCenterTab failed", err);
  }
  if (typeof wx?.switchTab === "function") {
    wx.switchTab({
      url,
      success: () => {
        console.log("switchTab to markers succeeded");
      },
      fail: (err) => {
        console.warn("switchTab to markers failed, fallback to navigateTo", err);
        if (typeof wx?.navigateTo === "function") {
          wx.navigateTo({ url });
        }
      }
    });
    return;
  }
  if (typeof wx?.navigateTo === "function") {
    wx.navigateTo({ url });
  }
}

module.exports = {
  handleWorkGroupInviteOptions,
  clearWorkGroupInviteParams,
  setPendingWorkGroupInvite,
  isSelfWorkGroupInvite,
  promptJoinWorkGroup,
  confirmJoinWorkGroup,
  cancelJoinWorkGroup,
  navigateToWorkGroupCenter
};
