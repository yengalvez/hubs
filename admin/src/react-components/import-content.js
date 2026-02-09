/* eslint-disable @calm/react-intl/missing-formatted-message*/
/* eslint-disable react/prop-types */
import React, { Component } from "react";
import { withStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import Card from "@material-ui/core/Card";
import CircularProgress from "@material-ui/core/CircularProgress";
import CardContent from "@material-ui/core/CardContent";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import ListItemIcon from "@material-ui/core/ListItemIcon";
import Done from "@material-ui/icons/Done";
import Warning from "@material-ui/icons/Warning";
import Snackbar from "@material-ui/core/Snackbar";
import SnackbarContent from "@material-ui/core/SnackbarContent";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import FormControl from "@material-ui/core/FormControl";
import FormGroup from "@material-ui/core/FormGroup";
import Checkbox from "@material-ui/core/Checkbox";
import Icon from "@material-ui/core/Icon";
import IconButton from "@material-ui/core/IconButton";
import CloseIcon from "@material-ui/icons/Close";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableHead from "@material-ui/core/TableHead";
import TableCell from "@material-ui/core/TableCell";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import { Title, GET_MANY_REFERENCE, GET_ONE } from "react-admin";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";
import { fetchReticulumAuthenticated, getReticulumFetchUrl } from "hubs/src/utils/phoenix-utils";
import { proxiedUrlFor } from "hubs/src/utils/media-url-utils";
import { ensureAvatarMaterial } from "hubs/src/utils/avatar-utils";
import { getAvatarSkeletonMetadata } from "hubs/src/utils/avatar-skeleton-utils";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import clsx from "classnames";
import { sceneApproveNew, sceneApproveExisting, sceneReviewed } from "./scene-actions";
import { avatarApproveNew, avatarApproveExisting, avatarReviewed } from "./avatar-actions";
import withCommonStyles from "../utils/with-common-styles";

const RESULTS = {
  pending: "pending",
  importing: "importing",
  new_listing: "new_listing",
  existing_listing: "existing_listing",
  failed: "failed"
};

const AVATARS_API = "/api/v1/avatars";

// GLTFLoader plugin for splitting glTF and bin from a local GLB.
class GLTFBinarySplitterPlugin {
  constructor(parser) {
    this.parser = parser;
    this.gltf = null;
    this.bin = null;
  }

  beforeRoot() {
    const parser = this.parser;
    const { body } = parser.extensions.KHR_binary_glTF;
    const content = JSON.stringify(ensureAvatarMaterial(parser.json));

    this.gltf = new File([content], "file.gltf", {
      type: "model/gltf"
    });
    this.bin = new File([body], "file.bin", {
      type: "application/octet-stream"
    });

    // This plugin only needs split files and can skip parsing a full scene.
    parser.json = { asset: { version: "2.0" } };
  }

  afterRoot(result) {
    result.files = result.files || {};
    result.files.gltf = this.gltf;
    result.files.bin = this.bin;
  }
}

const styles = withCommonStyles(() => ({}));

class ImportContentComponent extends Component {
  state = {
    urls: "",
    imports: [],
    addBaseTag: false,
    addDefaultTag: false,
    reticulumMeta: {},
    baseAvatarListingId: null
  };

  handleUrlChanged(ev) {
    this.setState({ urls: ev.target.value });
  }

  async componentDidMount() {
    this.updateReticulumMeta();
    this.updateBaseAvatarListingId();
  }

  async updateReticulumMeta() {
    const reticulumMeta = await fetchReticulumAuthenticated(`/api/v1/meta?include_repo`);
    this.setState({ reticulumMeta });
  }

  async updateBaseAvatarListingId() {
    try {
      const { entries } = await fetchReticulumAuthenticated(`/api/v1/media/search?filter=base&source=avatar_listings`);
      const baseAvatarListingId = entries && entries[0] && entries[0].id;
      this.setState({ baseAvatarListingId: baseAvatarListingId || null });
      return baseAvatarListingId || null;
    } catch (e) {
      console.warn("Failed to fetch base avatar listings.", e);
      this.setState({ baseAvatarListingId: null });
      return null;
    }
  }

  normalizeSubmittedUrl(url) {
    const trimmedUrl = (url || "").trim();
    if (!trimmedUrl) return "";
    return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
  }

  getImportDefaults() {
    const hasRepo = !!this.state.reticulumMeta.repo;
    const avatarListings = (this.state.reticulumMeta.repo && this.state.reticulumMeta.repo.avatar_listings) || {};
    const sceneListings = (this.state.reticulumMeta.repo && this.state.reticulumMeta.repo.scene_listings) || {};

    return {
      needsBaseAvatar: hasRepo && !avatarListings.base,
      needsDefaultAvatar: hasRepo && !avatarListings.default,
      needsDefaultScene: hasRepo && !sceneListings.default
    };
  }

  apiInfoForSubmittedUrl(url) {
    try {
      const normalizedUrl = this.normalizeSubmittedUrl(url);
      const parsedUrl = new URL(normalizedUrl);
      const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
      let type;
      let sid;

      if (
        pathParts[0] === "api" &&
        pathParts[1] === "v1" &&
        (pathParts[2] === "avatars" || pathParts[2] === "scenes")
      ) {
        type = pathParts[2];
        sid = pathParts[3];
      } else if (pathParts[0] === "avatars" || pathParts[0] === "scenes") {
        type = pathParts[0];
        sid = pathParts[1];
      }

      if (!type || !sid) return null;

      const isScene = type === "scenes";
      return { url: `${parsedUrl.origin}/api/v1/${type}/${sid}`, isScene, type };
    } catch (e) {
      console.error("in apiInfoForSubmittedUrl:", e);
      return null;
    }
  }

  createFallbackAsset(url) {
    try {
      const parsedUrl = new URL(url);
      const pathName = parsedUrl.pathname.split("/").filter(Boolean).pop();
      return {
        name: pathName ? decodeURIComponent(pathName) : parsedUrl.hostname,
        files: {}
      };
    } catch {
      return {
        name: url,
        files: {}
      };
    }
  }

  addImport(url, importUrl, type, asset, isDefault, isBase, isFeatured, options = {}) {
    const {
      isLocal = false,
      localFile = null,
      previewUnavailable = false,
      autoTags = [],
      skeletonMetadata = null
    } = options;

    this.setState(state => ({
      imports: [
        ...state.imports,
        {
          url,
          importUrl,
          type,
          asset,
          result: RESULTS.pending,
          isDefault,
          isBase,
          isFeatured,
          isImported: false,
          isEnabled: true,
          isLocal,
          localFile,
          previewUnavailable,
          autoTags,
          skeletonMetadata
        }
      ]
    }));
  }

  setImportResult(url, result) {
    this.setImportFields(url, i => (i.result = result));

    if (result === RESULTS.new_listing || result === RESULTS.existing_listing || result === RESULTS.failed) {
      this.setImportFields(url, i => (i.isImported = true));
    }
  }

  setImportIsEnabled(url, isEnabled) {
    this.setImportFields(url, i => (i.isEnabled = isEnabled));
  }

  setImportIsDefault(url, isDefault) {
    this.setImportFields(url, i => (i.isDefault = isDefault));
  }

  setImportIsBase(url, isBase) {
    this.setImportFields(url, i => (i.isBase = isBase));
  }

  setImportIsFeatured(url, isFeatured) {
    this.setImportFields(url, i => (i.isFeatured = isFeatured));
  }

  setImportFields(url, setter) {
    this.setState(state => ({
      imports: state.imports.map(importRecord => {
        if (importRecord.url !== url) return importRecord;
        const updatedImportRecord = { ...importRecord };
        setter(updatedImportRecord);
        return updatedImportRecord;
      })
    }));
  }

  async fetchAssetForPreview(importUrl, type) {
    const response = await fetch(proxiedUrlFor(importUrl));
    if (!response.ok) throw new Error(`Failed to fetch preview for ${importUrl}`);
    const payload = await response.json();
    return payload[type] && payload[type][0];
  }

  async onPreviewImport(e) {
    if (e) e.preventDefault();

    const urls = this.state.urls.split(/[, ]+/).filter(u => u.length > 0);
    if (!urls.find(u => u.length !== 0)) return;

    const { needsBaseAvatar, needsDefaultAvatar, needsDefaultScene } = this.getImportDefaults();

    let hadUrl = false;
    await new Promise(r => this.setState({ imports: [] }, r));
    this.setState({ isLoading: true });

    const importableUrls = [];

    for (let i = 0; i < urls.length; i++) {
      const submittedUrl = this.normalizeSubmittedUrl(urls[i]);
      if (!submittedUrl) continue;

      if (submittedUrl.endsWith(".pack")) {
        try {
          const res = await fetch(proxiedUrlFor(submittedUrl));
          if (!res.ok) throw new Error(`Failed to fetch .pack file ${submittedUrl}`);
          const packUrls = (await res.text()).split("\n");
          for (const packUrl of packUrls) {
            const normalizedPackUrl = this.normalizeSubmittedUrl(packUrl);
            if (normalizedPackUrl) {
              importableUrls.push(normalizedPackUrl);
            }
          }
        } catch (error) {
          console.error(error);
        }
      } else {
        importableUrls.push(submittedUrl);
      }
    }

    let firstAvatar = true;

    for (let i = 0; i < importableUrls.length; i++) {
      const url = importableUrls[i];
      const apiInfo = this.apiInfoForSubmittedUrl(url);
      if (!apiInfo) continue;

      const { url: importUrl, isScene, type } = apiInfo;
      const isAvatar = !isScene;

      if (!importUrl) continue;

      let asset = null;
      let previewUnavailable = false;

      try {
        asset = await this.fetchAssetForPreview(importUrl, type);
      } catch {
        previewUnavailable = true;
        asset = this.createFallbackAsset(url);
      }

      const isDefault = (isScene && needsDefaultScene) || (isAvatar && needsDefaultAvatar);
      const isBase = isAvatar && needsBaseAvatar && firstAvatar; // Only set first avatar to be base by default
      this.addImport(url, importUrl, type, asset, isDefault, isBase, true, { previewUnavailable });
      if (isAvatar) firstAvatar = false;
      hadUrl = true;
    }

    this.setState({ loadFailed: !hadUrl });

    this.setState({ urls: "", isLoading: false });
  }

  async onLocalFilesSelected(e) {
    const files = Array.from((e.target && e.target.files) || []).filter(file =>
      file.name.toLowerCase().endsWith(".glb")
    );
    e.target.value = null;
    if (!files.length) return;

    const hasPendingBaseAvatar = this.state.imports.some(
      importRecord => importRecord.type === "avatars" && importRecord.isBase && !importRecord.isImported
    );
    const { needsBaseAvatar, needsDefaultAvatar } = this.getImportDefaults();

    let setBaseOnThisAvatar = needsBaseAvatar && !hasPendingBaseAvatar;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const importId = `local://${Date.now()}-${i}-${file.name}`;
      const skeletonMetadata = await this.getLocalAvatarSkeletonMetadata(file);
      const autoTags = [];

      if (skeletonMetadata.isRpmLike) autoTags.push("rpm");
      if (skeletonMetadata.isFullBody) autoTags.push("fullbody");

      this.addImport(
        importId,
        null,
        "avatars",
        { name: file.name, files: {} },
        needsDefaultAvatar,
        setBaseOnThisAvatar,
        true,
        { isLocal: true, localFile: file, previewUnavailable: true, autoTags, skeletonMetadata }
      );

      setBaseOnThisAvatar = false;
    }
  }

  async getLocalAvatarSkeletonMetadata(file) {
    const gltfLoader = new GLTFLoader();
    const gltfUrl = URL.createObjectURL(file);

    try {
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(gltfUrl, resolve, undefined, reject);
      });
      return getAvatarSkeletonMetadata(gltf.scene);
    } catch (error) {
      console.warn(`Failed to inspect local avatar ${file.name}.`, error);
      return {
        hasSkeleton: false,
        hasRequiredUpperBody: false,
        isFullBody: false,
        isRpmLike: false,
        boneCount: 0,
        missingUpperBodyBones: []
      };
    } finally {
      URL.revokeObjectURL(gltfUrl);
    }
  }

  async splitGlbIntoFiles(glbFile) {
    const gltfLoader = new GLTFLoader().register(parser => new GLTFBinarySplitterPlugin(parser));
    const gltfUrl = URL.createObjectURL(glbFile);

    try {
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(gltfUrl, resolve, undefined, reject);
      });
      return { gltf: gltf.files.gltf, bin: gltf.files.bin };
    } finally {
      URL.revokeObjectURL(gltfUrl);
    }
  }

  async createPlaceholderThumbnail(fileName) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.fillStyle = "#4b5563";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#d1d5db";
    context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);

    const thumbnailBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    return new File([thumbnailBlob], `${fileName.replace(/\.[^.]+$/, "") || "avatar"}-thumbnail.png`, {
      type: "image/png"
    });
  }

  async uploadOwnedFile(file, desiredContentType) {
    const formData = new FormData();
    formData.append("media", file);
    formData.append("promotion_mode", "with_token");
    if (desiredContentType) {
      formData.append("desired_content_type", desiredContentType);
    }

    const token = window.APP?.store?.state?.credentials?.token;
    const headers = token ? { authorization: `bearer ${token}` } : undefined;

    const response = await fetch(getReticulumFetchUrl("/api/v1/media"), {
      method: "POST",
      headers,
      body: formData
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Media upload failed (${response.status}): ${body}`);
    }

    return response.json();
  }

  avatarNameFromFile(fileName) {
    const baseName = (fileName || "").replace(/\.[^.]+$/, "").trim();
    return baseName || "Imported Avatar";
  }

  tagsForImport(importRecord) {
    const tags = [];

    if (importRecord.type === "avatars" && importRecord.isBase) {
      tags.push("base");
    }

    if (importRecord.isDefault) {
      tags.push("default");
    }

    if (importRecord.isFeatured) {
      tags.push("featured");
    }

    if (Array.isArray(importRecord.autoTags)) {
      tags.push(...importRecord.autoTags);
    }

    return [...new Set(tags)];
  }

  async importLocalAvatar(importRecord) {
    const { localFile } = importRecord;

    let baseAvatarListingId = this.state.baseAvatarListingId;
    if (!baseAvatarListingId) {
      baseAvatarListingId = await this.updateBaseAvatarListingId();
    }
    if (!baseAvatarListingId) {
      throw new Error(
        "No base avatar listing found. Import a base avatar first (Admin > Import Content), then retry local upload."
      );
    }

    const { gltf, bin } = await this.splitGlbIntoFiles(localFile);
    const thumbnail = await this.createPlaceholderThumbnail(localFile.name);

    const uploadResults = await Promise.all([
      this.uploadOwnedFile(gltf, "model/gltf"),
      this.uploadOwnedFile(bin, "application/octet-stream"),
      this.uploadOwnedFile(thumbnail, "image/png")
    ]);

    const avatar = {
      name: this.avatarNameFromFile(localFile.name),
      parent_avatar_listing_id: baseAvatarListingId,
      files: {
        gltf: [uploadResults[0].file_id, uploadResults[0].meta.access_token, uploadResults[0].meta.promotion_token],
        bin: [uploadResults[1].file_id, uploadResults[1].meta.access_token, uploadResults[1].meta.promotion_token],
        thumbnail: [uploadResults[2].file_id, uploadResults[2].meta.access_token, uploadResults[2].meta.promotion_token]
      }
    };

    const response = await fetchReticulumAuthenticated(AVATARS_API, "POST", { avatar });
    return response.avatars[0];
  }

  async resolveImportedObject(dataProvider, type, columnPrefix, asset) {
    const sid = asset[`${columnPrefix}_id`] || asset[`${columnPrefix}_sid`];

    if (sid) {
      const resultBySid = await dataProvider(GET_MANY_REFERENCE, type, {
        sort: { field: "id", order: "desc" },
        target: `${columnPrefix}_sid`,
        id: sid
      });

      if (resultBySid.data.length > 0) {
        return resultBySid.data[0];
      }
    }

    if (asset.id) {
      const resultById = await dataProvider(GET_ONE, type, { id: asset.id });
      if (resultById && resultById.data) {
        return resultById.data;
      }
    }

    throw new Error(`Unable to resolve imported ${type} record.`);
  }

  async approveImportListing(importRecord, asset, tags) {
    const isScene = importRecord.type === "scenes";
    const columnPrefix = isScene ? "scene" : "avatar";
    const approveNew = isScene ? sceneApproveNew : avatarApproveNew;
    const approveExisting = isScene ? sceneApproveExisting : avatarApproveExisting;
    const reviewed = isScene ? sceneReviewed : avatarReviewed;
    const dataProvider = window.APP.dataProvider;
    const objectRecord = await this.resolveImportedObject(dataProvider, importRecord.type, columnPrefix, asset);

    const listingRes = await dataProvider(GET_MANY_REFERENCE, `${columnPrefix}_listings`, {
      sort: { field: "id", order: "desc" },
      target: `_${columnPrefix}_id`,
      id: objectRecord.id
    });

    const isNew = listingRes.data.length === 0;
    const approve = isNew ? approveNew : approveExisting;
    const exec = async f => {
      const d = f();
      await dataProvider(d.meta.fetch, d.meta.resource, d.payload);
    };

    if (!isNew) {
      objectRecord[`${columnPrefix}_listing_id`] = listingRes.data[0].id;
    }

    await exec(() => {
      const d = approve(objectRecord);
      d.payload.data.tags = { tags };
      return d;
    });

    if (isNew) {
      await exec(() => reviewed(objectRecord.id));
    }

    return isNew;
  }

  async onImport(e, options = {}) {
    if (e) e.preventDefault();
    const onlyLocal = !!options.localOnly;
    const { imports } = this.state;

    for (let i = 0; i < imports.length; i++) {
      const importRecord = imports[i];
      const { url, type, importUrl, isEnabled, isImported, isLocal } = importRecord;

      if (isImported || !isEnabled) continue;
      if (onlyLocal && !isLocal) continue;

      this.setImportResult(url, RESULTS.importing);

      try {
        let asset;

        if (isLocal) {
          asset = await this.importLocalAvatar(importRecord);
        } else {
          const res = await fetchReticulumAuthenticated(`/api/v1/${type}`, "POST", { url: importUrl });
          asset = res[type][0];
        }

        const tags = this.tagsForImport(importRecord);
        const isNewListing = await this.approveImportListing(importRecord, asset, tags);

        this.setImportResult(url, isNewListing ? RESULTS.new_listing : RESULTS.existing_listing);
        await this.updateReticulumMeta();
        await this.updateBaseAvatarListingId();
      } catch (error) {
        console.error("onImport:", error);
        this.setImportResult(url, RESULTS.failed);
      }
    }
  }

  renderImportTable() {
    const { imports } = this.state;
    const isImportingAny = imports ? !!imports.find(i => i.result === RESULTS.importing) : false;
    const hasNonImported = imports ? !!imports.find(i => !i.isImported) : false;

    const rowForImportRecord = r => {
      let icon = null;
      let status = null;
      const listingType = r.type === "scenes" ? "scene_listings" : "avatar_listings";

      switch (r.result) {
        case RESULTS.importing:
          icon = <CircularProgress size={18} />;
          break;
        case RESULTS.failed:
          icon = <Warning />;
          break;
        case RESULTS.new_listing:
          icon = <Done />;
          status = (
            <p>
              Import Successful.
              <br />
              Go to <a href={`/admin?#/${listingType}`}>approved {r.type}</a> to manage.
            </p>
          );
          break;
        case RESULTS.existing_listing:
          icon = <Done />;
          status = (
            <p>
              Update Successful.
              <br />
              Go to <a href={`/admin?#/${listingType}`}>approved {r.type}</a> to manage.
            </p>
          );
          break;
      }

      const screenshotSource = r.asset && (r.asset.screenshot_url || (r.asset.files && r.asset.files.thumbnail));
      const screenshotUrl = screenshotSource ? proxiedUrlFor(screenshotSource) : null;
      const metadataText = [];

      if (r.isLocal) {
        metadataText.push("Local GLB upload");
      }

      if (r.previewUnavailable) {
        metadataText.push("Preview unavailable (import is still allowed)");
      }

      if (r.skeletonMetadata) {
        if (r.skeletonMetadata.isFullBody) {
          metadataText.push("Full-body detected");
        }

        if (r.skeletonMetadata.isRpmLike) {
          metadataText.push("RPM-like skeleton detected");
        }
      }

      if (r.autoTags && r.autoTags.length > 0) {
        metadataText.push(`Auto tags: ${r.autoTags.join(", ")}`);
      }

      return (
        <TableRow key={r.url}>
          <TableCell>
            {icon ||
              (!isImportingAny && (
                <Checkbox
                  checked={r.isEnabled}
                  onChange={e => this.setImportIsEnabled(r.url, e.target.checked)}
                  value="enabled"
                />
              ))}
          </TableCell>
          <TableCell>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {metadataText.map(text => (
                <Typography key={`${r.url}-${text}`} variant="caption" gutterBottom>
                  {text}
                </Typography>
              ))}
              <FormControlLabel
                control={
                  <Checkbox
                    disabled={!r.isEnabled || isImportingAny || r.isImported}
                    checked={r.isDefault}
                    onChange={e => this.setImportIsDefault(r.url, e.target.checked)}
                    value="default"
                  />
                }
                label="Set to Default"
              />
              {r.type === "avatars" && (
                <FormControlLabel
                  control={
                    <Checkbox
                      disabled={!r.isEnabled || isImportingAny || r.isImported}
                      checked={r.isBase}
                      onChange={e => this.setImportIsBase(r.url, e.target.checked)}
                      value="base"
                    />
                  }
                  label="Set to Base"
                />
              )}
              <FormControlLabel
                control={
                  <Checkbox
                    disabled={!r.isEnabled || isImportingAny || r.isImported}
                    checked={r.isFeatured}
                    onChange={e => this.setImportIsFeatured(r.url, e.target.checked)}
                    value="featured"
                  />
                }
                label="Featured"
              />
            </div>
          </TableCell>
          <TableCell>
            {screenshotUrl ? (
              <img src={screenshotUrl} style={{ width: "100px" }} />
            ) : (
              <Typography variant="caption">No preview</Typography>
            )}
          </TableCell>
          <TableCell align="right">
            {r.isLocal ? (
              <span>{r.asset.name}</span>
            ) : (
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                {r.asset.name}
              </a>
            )}
            {status}
          </TableCell>
        </TableRow>
      );
    };

    const numSelected = imports ? imports.filter(i => i.isEnabled && !i.isImported).length : 0;
    const rowCount = imports ? imports.length : 0;

    return (
      <CardContent>
        <Paper>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>
                  {hasNonImported && !isImportingAny && (
                    <Checkbox
                      indeterminate={numSelected > 0 && numSelected < rowCount}
                      checked={numSelected === rowCount}
                      onChange={e => {
                        for (const { isImported, url } of imports) {
                          if (!isImported) {
                            this.setImportIsEnabled(url, e.target.checked);
                          }
                        }
                      }}
                    />
                  )}
                </TableCell>
                <TableCell>Info</TableCell>
                <TableCell>Preview</TableCell>
                <TableCell align="right">Name</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{imports.map(rowForImportRecord)}</TableBody>
          </Table>
        </Paper>
      </CardContent>
    );
  }

  render() {
    const needsBaseAvatar = this.state.reticulumMeta.repo && !this.state.reticulumMeta.repo.avatar_listings.base;
    const needsDefaultAvatar = this.state.reticulumMeta.repo && !this.state.reticulumMeta.repo.avatar_listings.default;
    const needsDefaultScene = this.state.reticulumMeta.repo && !this.state.reticulumMeta.repo.scene_listings.default;
    const { urls, imports, loadFailed } = this.state;
    const unimportedCount = imports ? imports.filter(i => !i.isImported).length : 0;
    const readyToImportCount = imports ? imports.filter(i => i.isEnabled && !i.isImported).length : 0;
    const readyToImportLocalCount = imports ? imports.filter(i => i.isEnabled && !i.isImported && i.isLocal).length : 0;
    const importCount = imports ? imports.length : 0;
    const isImportingAny = imports ? imports.find(i => i.result === RESULTS.importing) : false;

    return (
      <Card className={this.props.classes.container}>
        <Title title="Import Content" />
        <CardContent className={this.props.classes.info}>
          <Typography variant="body2" gutterBottom>
            You can import avatars and scenes from any other Hubs Cloud site, such as{" "}
            <a href="https://demo.hubsfoundation.org" target="_blank" rel="noopener noreferrer">
              demo.hubsfoundation.org
            </a>
            .<br />
            Please ensure the content you import has a permissible license (such as{" "}
            <a href="https://creativecommons.org/licenses/by/2.0/" rel="noopener noreferrer" target="_blank">
              CC-BY
            </a>
            ) or is licensed to you for redistribution.
          </Typography>
          <Button
            className={this.props.classes.button}
            variant="outlined"
            href="https://docs.hubsfoundation.org/hubs-cloud-asset-packs.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Find Avatars &amp; Scenes
          </Button>
          <Typography variant="subheading" gutterBottom className={this.props.classes.section}>
            Importing Content
          </Typography>
          <Typography variant="body1" gutterBottom>
            Enter a comma-separted list of URLs avatars or scenes to import them into your Hubs Cloud instance.
            <br />
            Or, specify a .pack file which contains a list of URLs, one per line.
          </Typography>
          {(needsBaseAvatar || needsDefaultAvatar || needsDefaultScene) && (
            <List>
              {needsBaseAvatar && (
                <ListItem>
                  <ListItemIcon className={this.props.classes.warningIcon}>
                    <Warning />
                  </ListItemIcon>
                  <ListItemText
                    inset
                    primary="You need to add a base avatar."
                    secondary="Base avatars will be provided as choices when customizing avatars."
                  />
                </ListItem>
              )}
              {needsDefaultAvatar && (
                <ListItem>
                  <ListItemIcon className={this.props.classes.warningIcon}>
                    <Warning />
                  </ListItemIcon>
                  <ListItemText
                    inset
                    primary="You need to add at least one default avatar."
                    secondary="New users will be assigned one of the default avatars."
                  />
                </ListItem>
              )}
              {needsDefaultScene && (
                <ListItem>
                  <ListItemIcon className={this.props.classes.warningIcon}>
                    <Warning />
                  </ListItemIcon>
                  <ListItemText
                    inset
                    primary="You need to add at least one default scene."
                    secondary="New rooms will be assigned a default scene, which can be changed after room creation."
                  />
                </ListItem>
              )}
            </List>
          )}
          <form className={this.props.classes.info}>
            <FormControl>
              <FormGroup>
                <TextField
                  key="url"
                  id="url"
                  label="Avatar or Scene URLs or .pack file"
                  value={urls}
                  onChange={this.handleUrlChanged.bind(this)}
                  type="text"
                  fullWidth
                  margin="normal"
                />
              </FormGroup>
            </FormControl>
            {!this.state.isLoading && (
              <Button
                onClick={this.onPreviewImport.bind(this)}
                className={this.props.classes.button}
                variant="contained"
                color="primary"
              >
                Preview Import
              </Button>
            )}
          </form>
          <Typography variant="subheading" gutterBottom className={this.props.classes.section}>
            Upload Avatars from Disk
          </Typography>
          <Typography variant="body1" gutterBottom>
            Upload one or more avatar files (`.glb`). Imported avatars are auto-approved and can be marked as
            base/default/featured before import.
          </Typography>
          <input
            id="local-avatar-upload"
            type="file"
            accept=".glb,model/gltf-binary,model/gltf+binary"
            multiple
            style={{ display: "none" }}
            onChange={this.onLocalFilesSelected.bind(this)}
          />
          <label htmlFor="local-avatar-upload">
            <Button className={this.props.classes.button} variant="outlined" color="primary" component="span">
              Select Local Avatar Files
            </Button>
          </label>
          {this.state.isLoading && <CircularProgress />}
          {!this.state.isLoading && unimportedCount > 0 && (
            <div>
              <p />
              <Typography variant="subheading" gutterBottom>
                Next, choose the content you&apos;d like to import, and which content flags to set. Then, click Import.
              </Typography>
            </div>
          )}
          {!this.state.isLoading && importCount > 0 && this.renderImportTable()}
          {!this.state.isLoading && readyToImportCount > 0 && !isImportingAny && (
            <Button
              onClick={this.onImport.bind(this)}
              className={this.props.classes.button}
              variant="contained"
              color="primary"
            >
              Import {readyToImportCount} Item{readyToImportCount > 1 && "s"}
            </Button>
          )}
          {!this.state.isLoading && readyToImportLocalCount > 0 && !isImportingAny && (
            <Button
              onClick={e => this.onImport(e, { localOnly: true })}
              className={this.props.classes.button}
              variant="outlined"
              color="primary"
            >
              Import {readyToImportLocalCount} Local Avatar{readyToImportLocalCount > 1 && "s"}
            </Button>
          )}
          {isImportingAny && <CircularProgress />}
          <Snackbar
            anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
            open={!!loadFailed}
            autoHideDuration={10000}
            onClose={() => this.setState({ loadFailed: false })}
          >
            <SnackbarContent
              className={clsx({
                [this.props.classes.warning]: this.state.importFailed
              })}
              message={
                <span id="import-snackbar" className={this.props.classes.message}>
                  <Icon className={clsx(this.props.classes.icon, this.props.classes.iconVariant)} />
                  Failed to load specified URLs.
                </span>
              }
              action={[
                <IconButton key="close" color="inherit" onClick={() => this.setState({ loadFailed: false })}>
                  <CloseIcon className={this.props.classes.icon} />
                </IconButton>
              ]}
            ></SnackbarContent>
          </Snackbar>
        </CardContent>
      </Card>
    );
  }
}

export const ImportContent = withStyles(styles)(ImportContentComponent);
