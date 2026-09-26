import { normalizeAvaturnCreatorUrl } from "./avaturn-utils";

// @avaturn/sdk is pinned to 1.1.4. Its constructor binds this method before
// init registers the listener. Gate *all* messages (including the handshake)
// before the upstream dispatcher; never trust the payload's `source` alone.
// The installed-SDK contract test must pass before changing that dependency.
export function createGuardedAvaturnSdk(AvaturnSDK, creatorUrl) {
  const origin = normalizeAvaturnCreatorUrl(creatorUrl);
  if (!origin || typeof AvaturnSDK.prototype.messageHandler !== "function") {
    throw new Error("La versión del SDK de Avaturn no es compatible.");
  }
  return new (class extends AvaturnSDK {
    messageHandler(event) {
      if (
        !this.sceneRef ||
        !this.sceneRef.contentWindow ||
        event.origin !== origin ||
        event.source !== this.sceneRef.contentWindow ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }
      super.messageHandler(event);
    }
  })();
}

export async function loadAvaturnSdk(creatorUrl) {
  const { AvaturnSDK } = await import(/* webpackChunkName: "avaturn-sdk" */ "@avaturn/sdk");
  return createGuardedAvaturnSdk(AvaturnSDK, creatorUrl);
}
