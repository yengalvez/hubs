import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { AvatarUrlModal } from "./AvatarUrlModal";
import { idForAvatarUrl } from "../../utils/media-url-utils";
import { fetchReticulumAuthenticated } from "../../utils/phoenix-utils";

const hasProtocol = value => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

const normalizeAvatarInput = rawUrl => {
  const trimmedUrl = (rawUrl || "").trim();
  if (!trimmedUrl) return trimmedUrl;

  const normalizedInput = hasProtocol(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;

  try {
    const parsedUrl = new URL(normalizedInput);
    return parsedUrl.href;
  } catch {
    return normalizedInput;
  }
};

const resolveAvatarIdForInput = async urlOrText => {
  const normalizedInput = normalizeAvatarInput(urlOrText);
  if (!normalizedInput) return normalizedInput;

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedInput);
  } catch {
    // Not a URL, just store whatever user entered.
    return normalizedInput;
  }

  const hubsAvatarId = idForAvatarUrl(parsedUrl.href);
  if (!hubsAvatarId) return parsedUrl.href;

  // If the avatar URL is from this server, store the avatar SID directly (skinnable avatar).
  if (parsedUrl.origin === document.location.origin) {
    return hubsAvatarId;
  }

  // Otherwise, import the remote avatar into our reticulum and store the imported SID.
  try {
    const importUrl = `${parsedUrl.origin}/api/v1/avatars/${hubsAvatarId}`;
    const res = await fetchReticulumAuthenticated("/api/v1/avatars", "POST", { url: importUrl });
    const importedId = res?.avatars?.[0]?.avatar_id;
    return importedId || parsedUrl.href;
  } catch (e) {
    console.warn("Failed to import remote avatar URL, falling back to direct URL.", e);
    return parsedUrl.href;
  }
};

export function AvatarUrlModalContainer({ store, scene, onClose }) {
  const onSubmit = useCallback(
    async ({ url }) => {
      const avatarId = await resolveAvatarIdForInput(url);
      store.update({ profile: { ...store.state.profile, ...{ avatarId } } });
      scene.emit("avatar_updated");
      onClose();
    },
    [store, scene, onClose]
  );

  return <AvatarUrlModal onSubmit={onSubmit} onClose={onClose} />;
}

AvatarUrlModalContainer.propTypes = {
  store: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired,
  onClose: PropTypes.func
};
