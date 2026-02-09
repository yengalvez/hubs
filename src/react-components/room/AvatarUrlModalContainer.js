import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { AvatarUrlModal } from "./AvatarUrlModal";
import { idForAvatarUrl } from "../../utils/media-url-utils";

const hasProtocol = value => /^[a-z][a-z0-9+.-]*:\/\//i.test(value);

const normalizeAvatarUrl = rawUrl => {
  const trimmedUrl = (rawUrl || "").trim();
  if (!trimmedUrl) return trimmedUrl;

  const normalizedInput = hasProtocol(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;

  try {
    const parsedUrl = new URL(normalizedInput);
    const hubsAvatarId = idForAvatarUrl(parsedUrl.href);

    if (hubsAvatarId) {
      parsedUrl.pathname = `/api/v1/avatars/${hubsAvatarId}/avatar.gltf`;
      parsedUrl.search = "";
      parsedUrl.hash = "";
    }

    return parsedUrl.href;
  } catch {
    return normalizedInput;
  }
};

export function AvatarUrlModalContainer({ store, scene, onClose }) {
  const onSubmit = useCallback(
    ({ url }) => {
      const normalizedUrl = normalizeAvatarUrl(url);
      store.update({ profile: { ...store.state.profile, ...{ avatarId: normalizedUrl } } });
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
