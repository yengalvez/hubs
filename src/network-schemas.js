function registerNetworkSchemas() {
  const vectorRequiresUpdate = epsilon => {
    return () => {
      let prev = null;

      return curr => {
        if (prev === null) {
          prev = new THREE.Vector3(curr.x, curr.y, curr.z);
          return true;
        } else if (!NAF.utils.almostEqualVec3(prev, curr, epsilon)) {
          prev.copy(curr);
          return true;
        }

        return false;
      };
    };
  };

  const botPathRequiresUpdate = (posEpsilon, yawEpsilonDeg, timeEpsilonMs) => {
    const angleDeltaDeg = (a, b) => {
      // Smallest absolute delta in degrees accounting for wrap at 360.
      const delta = ((a - b + 540) % 360) - 180;
      return Math.abs(delta);
    };

    return () => {
      let prev = null;

      return curr => {
        if (!curr) return false;

        const sx = Number(curr.sx) || 0;
        const sy = Number(curr.sy) || 0;
        const sz = Number(curr.sz) || 0;
        const ex = Number(curr.ex) || 0;
        const ey = Number(curr.ey) || 0;
        const ez = Number(curr.ez) || 0;
        const t0 = Number(curr.t0) || 0;
        const dur = Number(curr.dur) || 0;
        const yaw0 = Number(curr.yaw0) || 0;
        const yaw1 = Number(curr.yaw1) || 0;

        if (prev === null) {
          prev = { sx, sy, sz, ex, ey, ez, t0, dur, yaw0, yaw1 };
          return true;
        }

        if (
          Math.abs(sx - prev.sx) > posEpsilon ||
          Math.abs(sy - prev.sy) > posEpsilon ||
          Math.abs(sz - prev.sz) > posEpsilon ||
          Math.abs(ex - prev.ex) > posEpsilon ||
          Math.abs(ey - prev.ey) > posEpsilon ||
          Math.abs(ez - prev.ez) > posEpsilon ||
          Math.abs(t0 - prev.t0) > timeEpsilonMs ||
          Math.abs(dur - prev.dur) > timeEpsilonMs ||
          angleDeltaDeg(yaw0, prev.yaw0) > yawEpsilonDeg ||
          angleDeltaDeg(yaw1, prev.yaw1) > yawEpsilonDeg
        ) {
          prev.sx = sx;
          prev.sy = sy;
          prev.sz = sz;
          prev.ex = ex;
          prev.ey = ey;
          prev.ez = ez;
          prev.t0 = t0;
          prev.dur = dur;
          prev.yaw0 = yaw0;
          prev.yaw1 = yaw1;
          return true;
        }

        return false;
      };
    };
  };

  // Note: networked template ids are semantically important. We use the template suffix as a filter
  // for allowing and authorizing messages in reticulum.
  // See `spawn_permitted?` in https://github.com/Hubs-Foundation/reticulum/blob/master/lib/ret_web/channels/hub_channel.ex

  // NAF schemas have been extended with a custom nonAuthorizedComponents property that is used to skip authorization
  // on certain components and properties regardless of hub or user permissions. See permissions-utils.js.

  NAF.schemas.add({
    template: "#remote-avatar",
    components: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      "player-info",
      "networked-avatar",
      {
        selector: ".camera",
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        selector: ".camera",
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        selector: ".left-controller",
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        selector: ".left-controller",
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        selector: ".left-controller",
        component: "visible"
      },
      {
        selector: ".right-controller",
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        selector: ".right-controller",
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        selector: ".right-controller",
        component: "visible"
      }
    ]
  });

  NAF.schemas.add({
    template: "#remote-bot-avatar",
    components: [
      {
        component: "bot-path",
        requiresNetworkUpdate: botPathRequiresUpdate(0.005, 0.5, 5)
      },
      "bot-info"
    ]
  });

  NAF.schemas.add({
    template: "#interactable-media",
    components: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      // TODO: Optimize checking mediaOptions with requiresNetworkUpdate.
      "media-loader",
      {
        component: "media-video",
        property: "time"
      },
      {
        component: "media-video",
        property: "videoPaused"
      },
      {
        component: "media-pdf",
        property: "index"
      },
      "pinnable"
    ],
    nonAuthorizedComponents: [
      {
        component: "media-video",
        property: "time"
      },
      {
        component: "media-video",
        property: "videoPaused"
      },
      {
        component: "media-pager",
        property: "index"
      }
    ]
  });

  NAF.schemas.add({
    template: "#interactable-emoji",
    components: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "emoji",
        property: "emitEndTime"
      },
      {
        component: "emoji",
        property: "particleEmitterConfig"
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      "media-loader",
      "pinnable",
      {
        selector: ".particle-emitter",
        component: "particle-emitter"
      }
    ]
  });

  NAF.schemas.add({
    template: "#static-media",
    components: [
      // TODO: Optimize checking mediaOptions with requiresNetworkUpdate.
      "media-loader",
      {
        component: "media-video",
        property: "time"
      }
    ],
    nonAuthorizedComponents: [
      {
        component: "media-video",
        property: "time"
      }
    ]
  });

  NAF.schemas.add({
    template: "#static-controlled-media",
    components: [
      // TODO: Optimize checking mediaOptions with requiresNetworkUpdate.
      "media-loader",
      {
        component: "media-video",
        property: "time"
      },
      {
        component: "media-video",
        property: "videoPaused"
      },
      {
        component: "media-pdf",
        property: "index"
      }
    ],
    nonAuthorizedComponents: [
      {
        component: "media-video",
        property: "time"
      },
      {
        component: "media-video",
        property: "videoPaused"
      },
      {
        component: "media-pager",
        property: "index"
      }
    ]
  });

  NAF.schemas.add({
    template: "#interactable-drawing",
    components: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      "networked-drawing"
    ]
  });

  NAF.schemas.add({
    template: "#template-waypoint-avatar",
    components: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      "waypoint"
    ],
    nonAuthorizedComponents: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      "waypoint"
    ]
  });

  NAF.schemas.add({
    template: "#interactable-pen",
    components: [
      {
        component: "position",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        component: "rotation",
        requiresNetworkUpdate: vectorRequiresUpdate(0.5)
      },
      {
        component: "scale",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        selector: "#pen",
        component: "pen",
        property: "radius"
      },
      {
        selector: "#pen",
        component: "pen",
        property: "color"
      },
      {
        selector: "#pen",
        component: "pen",
        property: "drawMode"
      },
      {
        selector: "#pen",
        component: "pen",
        property: "penVisible"
      },
      {
        selector: "#pen",
        component: "pen-laser",
        property: "laserVisible"
      },
      {
        selector: "#pen",
        component: "pen-laser",
        property: "remoteLaserOrigin",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      },
      {
        selector: "#pen",
        component: "pen-laser",
        property: "laserTarget",
        requiresNetworkUpdate: vectorRequiresUpdate(0.001)
      }
    ]
  });
}

export default registerNetworkSchemas;
