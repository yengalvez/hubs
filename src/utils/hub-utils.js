import configs from "./configs";
export function getCurrentHubId() {
  const qs = new URLSearchParams(location.search);
  const defaultRoomId = configs.feature("default_room_id");

  return (
    qs.get("hub_id") ||
    (document.location.pathname === "/" && defaultRoomId
      ? defaultRoomId
      : document.location.pathname.substring(1).split("/")[0])
  );
}

function countNonBotRunnerPresences(presenceState) {
  let count = 0;
  for (const presence of Object.values(presenceState || {})) {
    const meta = presence && presence.metas && presence.metas[presence.metas.length - 1];
    if (meta && meta.context && meta.context.bot_runner) continue;
    count += 1;
  }
  return count;
}

export function updateVRHudPresenceCount({ presence }) {
  const occupantCount = countNonBotRunnerPresences(presence.state);
  const vrHudPresenceCount = document.querySelector("#hud-presence-count");
  vrHudPresenceCount.setAttribute("text", "value", occupantCount.toString());
}
export function updateSceneCopresentState(presence, scene) {
  const occupantCount = countNonBotRunnerPresences(presence.state);
  if (occupantCount > 1) {
    scene.addState("copresent");
  } else {
    scene.removeState("copresent");
  }
}

export function createHubChannelParams({
  permsToken,
  profile,
  pushSubscriptionEndpoint,
  isMobile,
  isMobileVR,
  isEmbed,
  hubInviteId,
  authToken,
  botRunner
}) {
  return {
    profile,
    push_subscription_endpoint: pushSubscriptionEndpoint,
    auth_token: authToken || null,
    perms_token: permsToken || null,
    context: {
      mobile: isMobile || isMobileVR,
      embed: isEmbed,
      hmd: isMobileVR,
      bot_runner: !!botRunner
    },
    hub_invite_id: hubInviteId
  };
}

export function isRoomOwner(clientId) {
  const presences = APP.hubChannel.presence.state;
  return presences && presences[clientId] && presences[clientId].metas[0].roles.owner;
}

export function isLockedDownDemoRoom() {
  if (APP.hubChannel?.canOrWillIfCreator("update_hub")) return;
  const hubId = getCurrentHubId();
  if (configs.feature("is_locked_down_demo_room")) {
    const idArr = configs.feature("is_locked_down_demo_room").replace(/\s/g, "").split(",");
    return idArr.includes(hubId);
  } else {
    return false;
  }
}
