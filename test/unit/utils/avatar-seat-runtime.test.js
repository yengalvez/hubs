import test from "ava";
import * as Three from "three";

// Execute the real waypoint controller, childMatch and IK. Only browser/event,
// unrelated renderer and network effects are isolated in this Node fixture.
const Module = require("module");
global.THREE = Three;
global.window = { APP: { store: { state: { preferences: {} } } } };
global.document = { getElementById: () => null };
const definitions = {};
global.AFRAME = {
  utils: { device: { isMobile: () => false } },
  registerComponent: (name, definition) => {
    definitions[name] = definition;
  },
  scenes: []
};
const neverDOM = { waitForDOMContentLoaded: () => new Promise(() => {}) };
const stubs = {
  "../utils/async-utils": neverDOM,
  "./material-utils": { forEachMaterial() {} },
  "../camera-layers": { Layers: {} },
  "../loaders/HubsTextureLoader": { TEXTURES_FLIP_Y: false },
  "../bit-components": { CameraTool: {}, MediaVideo: {} },
  "troika-three-text": { Text: class {} },
  bitecs: { defineQuery: () => () => [], hasComponent: () => false, removeEntity() {} },
  "./userinput/paths": { paths: { actions: {} } },
  "./sound-effects-system": {},
  "../utils/mat4-pool": { getPooledMatrix4: () => new Three.Matrix4(), freePooledMatrix4() {} },
  "../utils/get-current-player-height": { getCurrentPlayerHeight: () => 1.6 },
  "../utils/qs_truthy": () => false,
  "../bit-systems/waypoint": { releaseOccupiedWaypoint() {} },
  "../utils/bit-utils": { shouldUseNewLoader: () => false }
};
const originalLoad = Module._load;
let CharacterControllerSystem;
try {
  Module._load = function (request, parent, isMain) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  };
  require("../../../src/components/ik-controller");
  ({ CharacterControllerSystem } = require("../../../src/systems/character-controller-system"));
} finally {
  Module._load = originalLoad;
}
const { SPOKE_SEAT_CONTACT } = require("../../../src/utils/avatar-seat-anchor");

function fixture(contact, size = 1, creator = true) {
  const scene = {
    is: name => name === "entered",
    emit() {},
    addEventListener() {},
    systems: {
      nav: { pathfinder: { zones: {} } },
      userinput: { get: () => null },
      "frame-scheduler": { schedule() {} },
      "hubs-systems": { soundEffectsSystem: { playSoundOneShot() {} }, waypointSystem: {} }
    }
  };
  AFRAME.scenes = [scene];
  const rig = new Three.Object3D();
  rig.position.set(-2, 0, 3);
  rig.rotation.y = 0.3;
  rig.scale.setScalar(1.2);
  const camera = new Three.Object3D();
  camera.position.set(0, 1.6, 0);
  camera.rotation.y = 0.4;
  rig.add(camera);
  const avatar = new Three.Object3D();
  avatar.scale.setScalar(size);
  for (const [name, y] of [
    ["Spine", 0.8],
    ["Neck", 1.4],
    ["Head", 1.6],
    ["LeftArm", 1.1],
    ["Hips", 1]
  ]) {
    const bone = new Three.Object3D();
    bone.name = name;
    bone.position.set(0, y, name === "Head" ? 0.027 : 0);
    if (name === "Hips" && creator) bone.userData.yenhubsCreatorRig = "makehuman-mixamo-v1";
    avatar.add(bone);
  }
  rig.add(avatar);
  rig.updateMatrixWorld(true);
  const rigEl = {
    object3D: rig,
    components: { "player-info": { data: { isSitting: false } } },
    setAttribute(name, value) {
      Object.assign(this.components[name].data, value);
    }
  };
  const cameraEl = { object3D: camera };
  rigEl.components["ik-root"] = { el: rigEl, camera: cameraEl };
  const entity = {
    object3D: avatar,
    parentNode: rigEl,
    sceneEl: scene,
    components: {},
    closest: () => rigEl,
    emit() {}
  };
  rigEl.querySelector = () => entity;
  const ik = Object.create(definitions["ik-controller"]);
  ik.el = entity;
  ik.data = Object.fromEntries(Object.entries(ik.schema).map(([key, value]) => [key, value.default]));
  ik.data.alwaysUpdate = true;
  ik.init();
  ik.update({});
  entity.components["ik-controller"] = ik;
  entity.components["fullbody-locomotion"] = { _shared: { ready: true, seatContact: creator ? contact : null } };
  const controller = new CharacterControllerSystem(scene);
  controller.avatarRig = rigEl;
  controller.avatarPOV = cameraEl;
  const settle = () => {
    for (let frame = 0; frame < 160; frame++) {
      ik.tick(frame * 16, 16);
      rig.updateMatrixWorld(true);
    }
  };
  return { controller, rig, camera, avatar, rigEl, entity, ik, settle };
}

function waypoint(yaw, size) {
  return new Three.Matrix4().compose(
    new Three.Vector3(1.566, -0.406, 0.416),
    new Three.Quaternion().setFromAxisAngle(new Three.Vector3(0, 1, 0), yaw),
    new Three.Vector3(size, size, size)
  );
}

test.serial("real childMatch and IK place both calibrated surfaces; direct seat-to-seat and stand", t => {
  for (const coords of [
    [0.004174, 0.392541, 0.027001],
    [-0.013369, 0.374873, 0.048524]
  ]) {
    const contact = new Three.Vector3(...coords);
    const f = fixture(contact, 0.9);
    for (const [yaw, scale] of [
      [0, 1],
      [(-106.112 * Math.PI) / 180, 1.3],
      [Math.PI / 2, 0.8]
    ]) {
      const destination = waypoint(yaw, scale);
      f.controller.travelByWaypoint(destination, false, false, true);
      f.controller.setSittingState(true);
      f.settle();
      const expected = new Three.Vector3(...SPOKE_SEAT_CONTACT).applyMatrix4(destination);
      const actual = f.avatar.localToWorld(contact.clone());
      t.true(
        actual.distanceTo(expected) < 0.00001,
        JSON.stringify({
          actual: actual.toArray(),
          expected: expected.toArray(),
          root: f.avatar.position.toArray(),
          inv: f.ik.invHipsToHeadVector.toArray(),
          scale: f.rig.scale.toArray()
        })
      );
      t.true(f.ik._hasSittingPositionLock);
    }
    f.controller.setSittingState(false);
    f.settle();
    t.false(f.ik._hasSittingPositionLock);
    t.is(f.controller.pendingCreatorSeat, null);
  }
});

test.serial("arrival before the model mounts is corrected by the actual next controller tick", t => {
  const contact = new Three.Vector3(-0.013369, 0.374873, 0.048524);
  const f = fixture(contact);
  f.rigEl.querySelector = () => null;
  const destination = waypoint(-1.852, 1);
  f.controller.travelByWaypoint(destination, false, false, true);
  f.controller.setSittingState(true);
  f.controller.isMotionDisabled = true;
  t.truthy(f.controller.pendingCreatorSeat);
  f.rigEl.querySelector = () => f.entity;
  f.controller.tick(0, 16);
  f.settle();
  t.is(f.controller.pendingCreatorSeat, null);
  const expected = new Three.Vector3(...SPOKE_SEAT_CONTACT).applyMatrix4(destination);
  const actual = f.avatar.localToWorld(contact.clone());
  t.true(
    actual.distanceTo(expected) < 0.00001,
    JSON.stringify({
      actual: actual.toArray(),
      expected: expected.toArray(),
      root: f.avatar.position.toArray(),
      inv: f.ik.invHipsToHeadVector.toArray()
    })
  );
});

test.serial("legacy avatar preserves the same destination for seat and ordinary waypoint", t => {
  const f = fixture(new Three.Vector3(), 1, false);
  const destination = waypoint(-1.852, 1);
  f.controller.travelByWaypoint(destination, false, false, false);
  f.rig.updateMatrixWorld(true);
  const legacy = f.camera.matrixWorld.clone();
  f.controller.travelByWaypoint(destination, false, false, true);
  f.rig.updateMatrixWorld(true);
  t.true(f.camera.matrixWorld.near(legacy, 1e-10));
});

test.serial("animated waypoint arrival and remote transform/state order preserve seated contact", t => {
  const contact = new Three.Vector3(-0.013369, 0.374873, 0.048524);
  const local = fixture(contact);
  const destination = waypoint((-106.112 * Math.PI) / 180, 1);
  local.controller.enqueueWaypointTravelTo(destination, false, {
    willDisableMotion: true,
    willDisableTeleporting: false,
    willMaintainInitialOrientation: false,
    snapToNavMesh: false
  });
  for (let time = 0; time <= 1500; time += 16) {
    local.controller.tick(time, 16);
    local.ik.tick(time, 16);
    local.rig.updateMatrixWorld(true);
  }
  t.falsy(local.controller.activeWaypoint);
  t.true(local.rigEl.components["player-info"].data.isSitting);
  const expected = new Three.Vector3(...SPOKE_SEAT_CONTACT).applyMatrix4(destination);
  t.true(local.avatar.localToWorld(contact.clone()).distanceTo(expected) < 0.00001);
  for (const stateFirst of [false, true]) {
    const remote = fixture(contact);
    if (stateFirst) {
      remote.controller.setSittingState(true);
      remote.settle();
    }
    // The existing NAF schema replicates rig and camera separately; no new field.
    remote.rig.position.copy(local.rig.position);
    remote.rig.quaternion.copy(local.rig.quaternion);
    remote.rig.scale.copy(local.rig.scale);
    remote.camera.position.copy(local.camera.position);
    remote.camera.quaternion.copy(local.camera.quaternion);
    remote.rig.updateMatrixWorld(true);
    if (!stateFirst) remote.controller.setSittingState(true);
    remote.settle();
    t.true(remote.avatar.localToWorld(contact.clone()).distanceTo(expected) < 0.00001);
  }
});
