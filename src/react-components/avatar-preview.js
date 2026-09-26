import React, { Component } from "react";
import PropTypes from "prop-types";
import { injectIntl, FormattedMessage } from "react-intl";
import { onThemeChanged, getThemeColor } from "../utils/theme";
import classNames from "classnames";

import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

import { createDefaultEnvironmentMap } from "../components/environment-map";
import { loadGLTF } from "../components/gltf-model-plus";
import { findNode } from "../utils/three-utils";
import { ensureAvatarMaterial, MAT_NAME } from "../utils/avatar-utils";
import {
  fitAvatarPreviewCamera,
  getAvatarPreviewBounds,
  resizeAvatarPreviewCamera
} from "../utils/avatar-preview-bounds";
import { fitCreatorJackets } from "../utils/avatar-creator-garment-fit";
import { createImageBitmap, disposeImageBitmap } from "../utils/image-bitmap-utils";
import { proxiedUrlFor } from "../utils/media-url-utils";
import styles from "../assets/stylesheets/avatar-preview.scss";

import warningIconUrl from "../assets/images/warning_icon.png";
import warningIcon2xUrl from "../assets/images/warning_icon@2x.png";

const TEXTURE_PROPS = {
  base_map: ["map"],
  emissive_map: ["emissiveMap"],
  normal_map: ["normalMap"],
  orm_map: ["aoMap", "roughnessMap", "metalnessMap"]
};

const ALL_MAPS = Object.keys(TEXTURE_PROPS);

// This should match our aframe renderer="antialias: true; colorManagement: true; sortObjects: true;
// physicallyCorrectLights: true; webgl2: true; multiview: false;"
function createRenderer(canvas, alpha = false, useDevicePixelRatio = true) {
  const context = canvas.getContext("webgl2", {
    alpha,
    depth: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "default"
  });

  const renderer = new THREE.WebGLRenderer({ alpha, canvas, context, forceWebVR: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.physicallyCorrectLights = true;
  if (useDevicePixelRatio) {
    renderer.setPixelRatio(window.devicePixelRatio);
  }
  return renderer;
}

const createImageBitmapFromURL = url =>
  fetch(url)
    .then(r => r.blob())
    .then(createImageBitmap);

const ORBIT_ANGLE = new THREE.Euler(-30 * THREE.MathUtils.DEG2RAD, 30 * THREE.MathUtils.DEG2RAD, 0);

function getThemeBackground() {
  return new THREE.Color(getThemeColor("background3-color") || 0xeaeaea);
}

export class AvatarPreview extends Component {
  static propTypes = {
    avatarGltfUrl: PropTypes.string,
    className: PropTypes.string,
    onGltfLoaded: PropTypes.func,
    onGltfLoading: PropTypes.func,
    onGltfLoadError: PropTypes.func
  };
  constructor(props) {
    super(props);
    this.state = { loading: true, error: null };
    this.avatar = null;
    this.previewLoads = new Map();
    this.disposedAvatars = new WeakSet();
    this.mounted = false;
  }

  componentDidMount = () => {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(55, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 1000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.screenSpacePanning = true;
    this.controls.enableKeys = true;

    const light = new THREE.DirectionalLight(0xf7f6ef, 1);
    light.position.set(0, 10, 10);
    this.scene.add(light);
    this.scene.add(new THREE.HemisphereLight(0xb1e3ff, 0xb1e3ff, 2.5));

    this.loadId = 0;

    this.camera.position.set(-0.2, 0.5, 0.5);
    this.camera.matrixAutoUpdate = true;

    this.controls.target.set(0, 0.45, 0);
    this.controls.update();

    if (this.props.avatarGltfUrl) {
      this.loadCurrentAvatarGltfUrl();
    }

    const clock = new THREE.Clock();

    this.snapshotCanvas = document.createElement("canvas");
    this.snapshotCanvas.width = 720;
    this.snapshotCanvas.height = 1280;
    this.snapshotCamera = new THREE.PerspectiveCamera(55, 720 / 1280, 0.1, 1000);
    this.snapshotCamera.matrixAutoUpdate = true;
    this.snapshotRenderer = createRenderer(this.snapshotCanvas, true, false);
    this.snapshotRenderer.setClearAlpha(0);

    this.previewRenderer = createRenderer(this.canvas);
    this.previewRenderer.setClearColor(getThemeBackground());
    this.previewRenderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      this.mixer && this.mixer.update(dt);
      this.previewRenderer.render(this.scene, this.camera);
    });
    this.removeThemeChangedListener = onThemeChanged(() => this.previewRenderer.setClearColor(getThemeBackground()));
    window.addEventListener("resize", this.resize);
    this.resize();

    this.mounted = true;
  };

  resize = () => {
    const width = this.canvas.parentElement.offsetWidth;
    const height = this.canvas.parentElement.offsetHeight;
    if (width <= 0 || height <= 0) return;
    this.previewRenderer.setSize(width, height);
    resizeAvatarPreviewCamera(this.camera, this.previewBounds, this.controls.target, width / height);
  };

  setAvatar = avatar => {
    if (!avatar) return;
    this.avatar = avatar;
    this.scene.add(avatar);
    this.resetCamera();
    this.setState({ error: null, loading: false });
  };

  resetCamera = (() => {
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    return () => {
      getAvatarPreviewBounds(this.avatar, box);
      this.previewBounds = box.clone();
      box.getCenter(center);

      // Shift the center vertically in order to frame the avatar nicely.
      center.y = (box.max.y - box.min.y) * 0.6 + box.min.y;

      fitAvatarPreviewCamera(this.camera, box, center, ORBIT_ANGLE);
      fitAvatarPreviewCamera(this.snapshotCamera, box, center, ORBIT_ANGLE);

      this.controls.target.copy(center);
      this.controls.update();
    };
  })();

  componentWillUnmount = () => {
    this.mounted = false;
    this.loadId++;

    // Gotta be particularly careful about disposing things here since we will likely create many avatar
    // previews during a session and Chrome will eventually discard the oldest webgl context if we leak
    // contexts by holding on to them directly or indirectly.

    this.releaseAvatar();
    if (this.previewRenderer) {
      this.previewRenderer.setAnimationLoop(null);
      this.previewRenderer.dispose();
    }
    if (this.snapshotRenderer) {
      this.snapshotRenderer.dispose();
    }
    if (this.controls) {
      this.controls.dispose();
      this.controls.domElement = null;
    }

    window.removeEventListener("resize", this.resize);
    if (this.removeThemeChangedListener) this.removeThemeChangedListener();
  };

  disposePreviewAvatar = avatar => {
    if (!avatar || this.disposedAvatars.has(avatar)) return;
    this.disposedAvatars.add(avatar);
    const resources = this.previewLoads.get(avatar);
    if (resources) {
      if (resources.disposed) return;
      resources.disposed = true;
      if (resources.mixer) {
        resources.mixer.stopAllAction();
        resources.mixer.uncacheRoot(avatar);
      }
      resources.extraGeometries.forEach(geometry => geometry.dispose());
      resources.skeletons.forEach(skeleton => skeleton.dispose());
      // Environment maps are created per load, not taken from the room/cache.
      // Detach ours before the loader disposer visits the material.
      if (resources.environmentMap) {
        resources.previewMesh.material.envMap = null;
        resources.environmentMap.dispose();
      }
      new Set([...resources.originalImages, ...Object.values(resources.imageBitmaps)]).forEach(disposeImageBitmap);
      this.previewLoads.delete(avatar);
    }
    // Direct loadGLTF owns this scene; its disposer also covers loader resources
    // no longer present in the scene graph (e.g. replaced jacket geometry).
    if (avatar.dispose) avatar.dispose();
  };

  releaseAvatar = () => {
    if (this.avatar) {
      this.scene.remove(this.avatar);
      this.disposePreviewAvatar(this.avatar);
    }
    // Also retire parsed models still waiting for maps. Their late dependencies
    // see the disposed flag and clean themselves up without touching a new load.
    for (const avatar of this.previewLoads.keys()) this.disposePreviewAvatar(avatar);
    this.avatar = null;
    this.previewResources = null;
    this.previewBounds = null;
    this.mixer = null;
    this.idleAnimationAction = null;
  };

  componentDidUpdate = async oldProps => {
    if (oldProps.avatarGltfUrl !== this.props.avatarGltfUrl) {
      // Clearing a selection must also invalidate an in-flight load. Otherwise
      // its late callback can restore and validate a file the user discarded.
      if (!this.props.avatarGltfUrl) this.loadId++;
      this.releaseAvatar();
      if (this.props.avatarGltfUrl) {
        this.setState({ error: null, loading: true });
        await this.loadCurrentAvatarGltfUrl();
      }
      return;
    }
    this.applyMaps(oldProps, this.props);
  };

  async loadCurrentAvatarGltfUrl() {
    const newLoadId = ++this.loadId;
    if (this.props.onGltfLoading) this.props.onGltfLoading();
    const url = proxiedUrlFor(this.props.avatarGltfUrl);
    let gltf;
    try {
      gltf = await this.loadPreviewAvatar(url, newLoadId);
      // If we had started loading another avatar while we were loading this one, throw this one away
      if (!this.mounted || newLoadId !== this.loadId) {
        if (gltf) this.disposePreviewAvatar(gltf.scene);
        return;
      }
      if (!gltf) throw new Error("Avatar preview load returned no model.");
      const resources = this.previewLoads.get(gltf.scene);
      let mapProps = resources && resources.mapProps;
      // Map props can change while the model waits for its initial maps or
      // environment. Reconcile them before publishing the ready preview; keep
      // ownership local so updates during this await cannot touch another load.
      while (resources && ALL_MAPS.some(name => mapProps[name] !== this.props[name])) {
        const latestProps = this.props;
        await this.applyMaps(mapProps, latestProps, resources);
        mapProps = latestProps;
        if (!this.mounted || newLoadId !== this.loadId) {
          this.disposePreviewAvatar(gltf.scene);
          return;
        }
      }
      this.previewResources = resources;
      this.mixer = this.previewResources && this.previewResources.mixer;
      this.idleAnimationAction = this.previewResources && this.previewResources.idleAnimationAction;
      this.setAvatar(gltf.scene);
      if (this.props.onGltfLoaded) this.props.onGltfLoaded(gltf);
    } catch (error) {
      if (gltf && this.avatar !== gltf.scene) this.disposePreviewAvatar(gltf.scene);
      if (!this.mounted || newLoadId !== this.loadId) return;
      console.error("Failed to load avatar preview", error);
      this.setState({ loading: false, error: true });
      if (this.props.onGltfLoadError) this.props.onGltfLoadError(error);
    }
  }

  applyMaps(oldProps, newProps, resources = this.previewResources) {
    if (!resources || resources.disposed) return Promise.resolve();
    return Promise.all(
      ALL_MAPS.map(mapName => {
        if (oldProps[mapName] != newProps[mapName]) {
          const version = (resources.mapVersions[mapName] || 0) + 1;
          resources.mapVersions[mapName] = version;
          const applyMap = image => {
            if (resources.disposed || resources.mapVersions[mapName] !== version) {
              disposeImageBitmap(image);
              return;
            }
            this.applyMapToPreview(mapName, image, resources);
          };
          if (newProps[mapName] instanceof File) {
            return createImageBitmap(newProps[mapName]).then(applyMap);
          } else if (newProps[mapName]) {
            return createImageBitmapFromURL(newProps[mapName]).then(applyMap);
          } else {
            return this.revertMap(mapName, resources);
          }
        }
      })
    );
  }

  loadPreviewAvatar = async (avatarGltfUrl, loadId) => {
    const gltf = await loadGLTF(avatarGltfUrl, "model/gltf", null, ensureAvatarMaterial);
    const resources = {
      imageBitmaps: {},
      originalImages: new Set(),
      extraGeometries: new Set(),
      skeletons: new Set(),
      mapVersions: {},
      disposed: false
    };
    this.previewLoads.set(gltf.scene, resources);
    try {
      const loaderGeometries = new Set();
      gltf.scene.traverse(node => {
        if (node.geometry) loaderGeometries.add(node.geometry);
        if (node.skeleton) resources.skeletons.add(node.skeleton);
        for (const material of [].concat(node.material || [])) {
          for (const value of Object.values(material)) {
            if (value && value.isTexture && value.image) resources.originalImages.add(value.image);
          }
        }
      });
      if (!this.mounted || loadId !== this.loadId) return gltf;
      fitCreatorJackets(gltf.scene);
      gltf.scene.traverse(node => {
        if (node.geometry && !loaderGeometries.has(node.geometry)) resources.extraGeometries.add(node.geometry);
      });

      // TODO Check for "Bot_Skinned" here is a hack for legacy avatars which only has a name one of the MOZ_alt_material nodes
      resources.previewMesh = findNode(
        gltf.scene,
        n => (n.isMesh && n.material && n.material.name === MAT_NAME) || n.name === "Bot_Skinned"
      );

      if (!resources.previewMesh) {
        throw new Error("Failed to find avatar preview mesh.");
      }

      const idleAnimation = gltf.animations && gltf.animations.find(({ name }) => name === "idle_eyes");
      if (idleAnimation) {
        resources.mixer = new THREE.AnimationMixer(gltf.scene);
        const action = resources.mixer.clipAction(idleAnimation);
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity).play();
        resources.idleAnimationAction = action;
      }

      gltf.scene.traverse(node => {
        // Camera in preview is pretty tight, and skinned meshes tend to have poor bounding boxes
        if (node.isSkinnedMesh) {
          node.frustumCulled = false;
        }

        // We delete onUpdate here to opt out of the auto texture cleanup after GPU upload.
        for (const material of [].concat(node.material || [])) {
          const removeOnUpdate = p => material[p] && delete material[p].onUpdate;
          TEXTURE_PROPS["base_map"].forEach(removeOnUpdate);
          TEXTURE_PROPS["emissive_map"].forEach(removeOnUpdate);
          TEXTURE_PROPS["normal_map"].forEach(removeOnUpdate);
          TEXTURE_PROPS["orm_map"].forEach(removeOnUpdate);
        }
      });

      const { material } = resources.previewMesh;
      resources.mapProps = this.props;
      if (material) {
        const getImage = p => material[p] && material[p].image;
        resources.originalMaps = {
          base_map: TEXTURE_PROPS["base_map"].map(getImage),
          emissive_map: TEXTURE_PROPS["emissive_map"].map(getImage),
          normal_map: TEXTURE_PROPS["normal_map"].map(getImage),
          orm_map: TEXTURE_PROPS["orm_map"].map(getImage)
        };

        const dependencies = [
          this.applyMaps({}, resources.mapProps, resources) // Apply initial maps
        ];

        // Low and medium quality materials don't use environment maps
        if (window.APP.store.state.preferences.materialQualitySetting === "high") {
          dependencies.push(
            // TODO apply environment map to secondary materials as well
            createDefaultEnvironmentMap().then(t => {
              if (resources.disposed) {
                t.dispose();
                return;
              }
              resources.environmentMap = t;
              resources.previewMesh.material.envMap = t;
              resources.previewMesh.material.needsUpdate = true;
            })
          );
        }

        await Promise.all(dependencies);
      } else {
        resources.originalMaps = {};
      }

      return gltf;
    } catch (error) {
      this.disposePreviewAvatar(gltf.scene);
      throw error;
    }
  };

  applyMapToPreview = (name, image, resources = this.previewResources) => {
    if (resources.imageBitmaps[name]) {
      disposeImageBitmap(resources.imageBitmaps[name]);
    }
    resources.imageBitmaps[name] = image;
    TEXTURE_PROPS[name].forEach(prop => {
      const texture = resources.previewMesh.material[prop];

      // Low quality materials are missing normal maps
      if (prop === "normalMap" && window.APP.store.state.preferences.materialQualitySetting === "low") {
        return;
      }

      // Medium Quality materials are missing metalness and roughness maps
      if (
        (prop === "roughnessMap" || prop === "metalnessMap") &&
        window.APP.store.state.preferences.materialQualitySetting !== "high"
      ) {
        return;
      }

      if (texture) {
        texture.image = image;
        texture.needsUpdate = true;
      }
    });
  };

  revertMap = (name, resources = this.previewResources) => {
    if (resources.imageBitmaps[name]) {
      disposeImageBitmap(resources.imageBitmaps[name]);
    }
    delete resources.imageBitmaps[name];
    resources.originalMaps[name].forEach((bm, i) => {
      const texture = resources.previewMesh.material[TEXTURE_PROPS[name][i]];

      if (texture) {
        texture.image = bm;
        texture.needsUpdate = true;
      }
    });
  };

  snapshot = () => {
    return new Promise((resolve, reject) => {
      if (!this.avatar || this.state.loading || this.state.error) {
        reject(new Error("La vista previa del avatar todavía no está lista."));
        return;
      }

      if (this.idleAnimationAction) this.idleAnimationAction.stop();
      this.snapshotCamera.position.copy(this.camera.position);
      this.snapshotCamera.rotation.copy(this.camera.rotation);
      this.snapshotRenderer.render(this.scene, this.snapshotCamera);
      this.snapshotCanvas.toBlob(blob => {
        if (this.idleAnimationAction) this.idleAnimationAction.play();
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("No se pudo generar la miniatura del avatar."));
        }
      });
    });
  };

  render() {
    return (
      <div className={classNames(styles.preview, this.props.className)}>
        {!this.props.avatarGltfUrl ||
          (this.state.loading && !this.state.error && (
            <div className="loader">
              <div className="loader-center" />
            </div>
          ))}
        {this.props.avatarGltfUrl && this.state.error && !this.state.loading && (
          <div className="error">
            <img src={warningIconUrl} srcSet={`${warningIcon2xUrl} 2x`} className="error-icon" />
            <FormattedMessage
              id="avatar-preview.loading-failed"
              defaultMessage="Loading failed{linebreak}Please choose another avatar"
              values={{ linebreak: <br /> }}
            />
          </div>
        )}
        <canvas ref={c => (this.canvas = c)} />
      </div>
    );
  }
}

export default injectIntl(AvatarPreview, { forwardRef: true });
