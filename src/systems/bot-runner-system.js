import { defineQuery } from "bitecs";
import * as THREE from "three";
import { Waypoint, SceneRoot } from "../bit-components";
import { WaypointFlags } from "../bit-systems/waypoint";
import { findAncestorWithComponent, shouldUseNewLoader } from "../utils/bit-utils";
import configs from "../utils/configs";
import { fetchReticulumAuthenticated } from "../utils/phoenix-utils";
import qsTruthy from "../utils/qs_truthy";

const NETWORK_PUBLISH_INTERVAL_MS = 100;
const CONFIG_REFRESH_INTERVAL_MS = 3000;
const FEATURED_AVATARS_REFRESH_INTERVAL_MS = 60000;
const BOT_COMMAND_TYPE = "bot_command";

const bitWaypointQuery = defineQuery([Waypoint]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeBotsConfig(config) {
  const normalized = {
    enabled: !!(config && config.enabled),
    count: clamp(Number((config && config.count) || 0) || 0, 0, 5),
    mobility: (config && config.mobility) || "medium",
    chatEnabled: !!(config && config.chat_enabled)
  };

  if (!["low", "medium", "high"].includes(normalized.mobility)) {
    normalized.mobility = "medium";
  }

  return normalized;
}

const MOBILITY_BEHAVIOR = {
  low: {
    speedMps: 0.9,
    idleMinMs: 5000,
    idleMaxMs: 12000
  },
  medium: {
    speedMps: 1.4,
    idleMinMs: 3000,
    idleMaxMs: 8000
  },
  high: {
    speedMps: 2.0,
    idleMinMs: 1000,
    idleMaxMs: 3500
  }
};

AFRAME.registerSystem("bot-runner-system", {
  init() {
    this.enabled = !!configs.feature("enable_room_bots") && qsTruthy("bot_runner");
    this.bots = new Map();
    this.avatarRefs = [];
    this.patrolPoints = [];
    this.lastConfigRefreshAt = 0;
    this.lastNetworkPublishAt = 0;
    this.lastFeaturedAvatarRefreshAt = 0;
    this._tmpDir = new THREE.Vector3();

    this.onHubUpdated = this.onHubUpdated.bind(this);
    this.onMessage = this.onMessage.bind(this);

    if (!this.enabled) return;

    this.el.sceneEl.addEventListener("hub_updated", this.onHubUpdated);

    if (window.APP && window.APP.messageDispatch) {
      window.APP.messageDispatch.addEventListener("message", this.onMessage);
    }

    this.refreshFeaturedAvatarIds();
  },

  remove() {
    this.el.sceneEl.removeEventListener("hub_updated", this.onHubUpdated);

    if (window.APP && window.APP.messageDispatch) {
      window.APP.messageDispatch.removeEventListener("message", this.onMessage);
    }

    this.clearBots();
  },

  onHubUpdated() {
    this.refreshPatrolPoints();
    this.reconcileBots(true);
  },

  onMessage(e) {
    if (!this.enabled) return;

    const message = e && e.detail;
    if (!message || message.type !== BOT_COMMAND_TYPE) return;

    const body = message.body;
    if (!body || typeof body !== "object") return;

    this.handleBotCommand(body);
  },

  getRoomBotsConfig() {
    const userData = (window.APP && window.APP.hub && window.APP.hub.user_data) || {};
    return normalizeBotsConfig(userData.bots || {});
  },

  async refreshFeaturedAvatarIds() {
    try {
      const res = await fetchReticulumAuthenticated("/api/v1/media/search?source=avatar_listings&filter=featured");
      this.avatarRefs = ((res && res.entries) || [])
        .map(entry => (entry && entry.gltfs && entry.gltfs.avatar) || null)
        .filter(Boolean);
    } catch (e) {
      console.warn("Failed to fetch featured avatars for bots", e);
      this.avatarRefs = [];
    }
  },

  refreshPatrolPoints() {
    const points = [];

    if (shouldUseNewLoader()) {
      const world = window.APP && window.APP.world;
      if (world) {
        const eids = bitWaypointQuery(world);

        for (let i = 0; i < eids.length; i++) {
          const eid = eids[i];
          if (!findAncestorWithComponent(world, SceneRoot, eid)) continue;

          const flags = Waypoint.flags[eid];

          const obj = world.eid2obj.get(eid);
          if (!obj) continue;
          const pointName = (obj.name || `spawn-${eid}`).trim();
          const isNamedSpawbot = pointName.toLowerCase().startsWith("spawbot-");
          if (!isNamedSpawbot && !(flags & WaypointFlags.canBeSpawnPoint)) continue;

          obj.updateMatrices();
          const pos = obj.getWorldPosition(new THREE.Vector3());
          points.push({
            name: pointName,
            position: pos
          });
        }
      }
    } else {
      const waypointSystem = this.el.sceneEl.systems?.["hubs-systems"]?.waypointSystem;
      const ready = (waypointSystem && waypointSystem.ready) || [];

      for (let i = 0; i < ready.length; i++) {
        const component = ready[i];
        if (!component || !component.data) continue;

        const obj = component.el && component.el.object3D;
        if (!obj) continue;
        const pointName = (obj.name || component.el?.id || `spawn-${i}`).trim();
        const isNamedSpawbot = pointName.toLowerCase().startsWith("spawbot-");
        if (!isNamedSpawbot && !component.data.canBeSpawnPoint) continue;

        obj.updateMatrices();
        const pos = obj.getWorldPosition(new THREE.Vector3());
        points.push({
          name: pointName,
          position: pos
        });
      }
    }

    const namedSpawbots = points.filter(point => (point.name || "").toLowerCase().startsWith("spawbot-"));
    this.patrolPoints = namedSpawbots.length ? namedSpawbots : points;
  },

  pickAvatarId() {
    if (this.avatarRefs.length) {
      return this.avatarRefs[Math.floor(Math.random() * this.avatarRefs.length)];
    }

    const fallbackProfileAvatarId = window.APP?.store?.state?.profile?.avatarId;
    return fallbackProfileAvatarId || "";
  },

  pickPatrolPoint(excludeName) {
    if (!this.patrolPoints.length) return null;

    const candidates = this.patrolPoints.filter(point => point.name !== excludeName);
    const source = candidates.length ? candidates : this.patrolPoints;
    return source[Math.floor(Math.random() * source.length)];
  },

  createBot(botId, config) {
    const startPoint = this.pickPatrolPoint();
    const startPos = startPoint ? startPoint.position.clone() : new THREE.Vector3();
    const avatarId = this.pickAvatarId();

    const el = document.createElement("a-entity");
    el.setAttribute("networked", "template: #remote-bot-avatar; attachTemplateToLocal: false;");
    el.setAttribute("position", startPos);
    el.setAttribute("rotation", { x: 0, y: Math.random() * 360, z: 0 });
    el.setAttribute("bot-info", {
      botId,
      avatarId,
      displayName: botId
    });
    this.el.sceneEl.appendChild(el);

    const idleDuration = this.randomIdleDurationMs(config.mobility);

    this.bots.set(botId, {
      id: botId,
      el,
      state: "idle",
      position: startPos,
      yawDeg: Number(el.getAttribute("rotation")?.y || 0),
      destination: null,
      stateEndsAt: performance.now() + idleDuration,
      mobility: config.mobility
    });
  },

  removeBot(botId) {
    const record = this.bots.get(botId);
    if (!record) return;

    if (record.el && record.el.parentNode) {
      record.el.parentNode.removeChild(record.el);
    }

    this.bots.delete(botId);
  },

  clearBots() {
    Array.from(this.bots.keys()).forEach(botId => this.removeBot(botId));
  },

  randomIdleDurationMs(mobility) {
    const behavior = MOBILITY_BEHAVIOR[mobility] || MOBILITY_BEHAVIOR.medium;
    const range = behavior.idleMaxMs - behavior.idleMinMs;
    return behavior.idleMinMs + Math.floor(Math.random() * Math.max(range, 1));
  },

  reconcileBots(force = false) {
    if (!this.enabled) return;

    const config = this.getRoomBotsConfig();
    if (!config.enabled || config.count === 0) {
      this.clearBots();
      return;
    }

    if (!this.patrolPoints.length || force) {
      this.refreshPatrolPoints();
    }

    for (let i = 0; i < config.count; i++) {
      const botId = `bot-${i + 1}`;
      if (!this.bots.has(botId)) {
        this.createBot(botId, config);
      }
    }

    Array.from(this.bots.keys()).forEach(botId => {
      const index = Number(botId.replace("bot-", ""));
      if (index > config.count) {
        this.removeBot(botId);
      }
    });

    this.bots.forEach(record => {
      if (record.mobility !== config.mobility) {
        record.mobility = config.mobility;
      }
    });
  },

  startWalking(record, waypointName) {
    let target = null;

    if (waypointName) {
      target = this.patrolPoints.find(
        point => point.name === waypointName || point.name?.toLowerCase() === waypointName
      );
    }

    if (!target) {
      target = this.pickPatrolPoint(record.destination?.name);
    }

    if (!target) {
      record.state = "idle";
      record.stateEndsAt = performance.now() + this.randomIdleDurationMs(record.mobility);
      return;
    }

    record.state = "walk";
    record.destination = {
      name: target.name,
      position: target.position.clone()
    };
  },

  setIdle(record) {
    record.state = "idle";
    record.destination = null;
    record.stateEndsAt = performance.now() + this.randomIdleDurationMs(record.mobility);
  },

  handleBotCommand(command) {
    const botId = command.bot_id || command.botId;
    if (!botId) return;

    const record = this.bots.get(botId);
    if (!record) return;

    if (command.type === "go_to_waypoint" && command.waypoint) {
      this.startWalking(record, String(command.waypoint).toLowerCase());
    }
  },

  tick(t, dt) {
    if (!this.enabled) return;
    if (!this.el.sceneEl.is("entered")) return;

    if (t - this.lastConfigRefreshAt > CONFIG_REFRESH_INTERVAL_MS) {
      this.lastConfigRefreshAt = t;
      this.reconcileBots();
    }

    if (t - this.lastFeaturedAvatarRefreshAt > FEATURED_AVATARS_REFRESH_INTERVAL_MS) {
      this.lastFeaturedAvatarRefreshAt = t;
      this.refreshFeaturedAvatarIds();
    }

    const shouldPublishNetwork = t - this.lastNetworkPublishAt > NETWORK_PUBLISH_INTERVAL_MS;
    if (shouldPublishNetwork) {
      this.lastNetworkPublishAt = t;
    }

    this.bots.forEach(record => {
      const behavior = MOBILITY_BEHAVIOR[record.mobility] || MOBILITY_BEHAVIOR.medium;

      if (record.state === "idle") {
        if (t >= record.stateEndsAt) {
          this.startWalking(record);
        }
      } else if (record.state === "walk" && record.destination) {
        this._tmpDir.copy(record.destination.position).sub(record.position);
        const distance = this._tmpDir.length();

        if (distance <= 0.08) {
          record.position.copy(record.destination.position);
          this.setIdle(record);
        } else {
          const step = Math.min(distance, (behavior.speedMps * dt) / 1000);
          this._tmpDir.normalize().multiplyScalar(step);
          record.position.add(this._tmpDir);
          record.yawDeg = THREE.MathUtils.radToDeg(Math.atan2(this._tmpDir.x, this._tmpDir.z));
        }
      }

      record.el.object3D.position.copy(record.position);
      record.el.object3D.rotation.set(0, THREE.MathUtils.degToRad(record.yawDeg), 0);
      record.el.object3D.matrixNeedsUpdate = true;

      if (shouldPublishNetwork) {
        record.el.setAttribute("position", record.position);
        record.el.setAttribute("rotation", { x: 0, y: record.yawDeg, z: 0 });
      }
    });
  }
});
