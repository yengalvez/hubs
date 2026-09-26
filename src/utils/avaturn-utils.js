import { MAX_AVATAR_GLB_BYTES, validateAvatarGlbFile } from "./avatar-glb-utils";

const AVATURN_PROJECT_SUFFIX = ".avaturn.dev";
const AVATURN_EXPORT_SUFFIXES = [AVATURN_PROJECT_SUFFIX, ".avaturn.me"];

export function withAvaturnDeadline(operation, { signal, timeoutMs = 60000, timeoutMessage } = {}) {
  const controller = new AbortController();
  let timer;
  let cancel;
  const cancelled = new Promise((_, reject) => {
    cancel = () => {
      const error = new Error("La operación de Avaturn se ha cancelado.");
      error.name = "AbortError";
      reject(error);
      controller.abort();
    };
    if (signal?.aborted) return cancel();
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      const error = new Error(timeoutMessage || "Avaturn ha tardado demasiado. Inténtalo de nuevo.");
      error.name = "TimeoutError";
      reject(error);
      controller.abort();
    }, timeoutMs);
  });
  const work = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new Error("La operación de Avaturn se ha cancelado.");
    return operation(controller.signal);
  });
  return Promise.race([cancelled, work]).finally(() => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", cancel);
    // Also close a response body rejected early (for example, content-length)
    // instead of leaving its network transfer running after the error.
    controller.abort();
  });
}

function hasAllowedHostname(hostname, suffixes) {
  const normalized = hostname.toLowerCase();
  return suffixes.some(suffix => normalized.endsWith(suffix) && normalized.length > suffix.length);
}

export function normalizeAvaturnCreatorUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !hasAllowedHostname(url.hostname, [AVATURN_PROJECT_SUFFIX])
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function avaturnFileName(avatarId) {
  const safeId = typeof avatarId === "string" ? avatarId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) : "";
  return safeId ? `avaturn-${safeId}.glb` : "avatar-avaturn.glb";
}

function decodeDataUrl(dataUrl, maxBytes) {
  const separator = dataUrl.indexOf(",");
  const metadata = separator >= 0 ? dataUrl.slice(5, separator) : "";
  const encoded = separator >= 0 ? dataUrl.slice(separator + 1) : "";
  if (!dataUrl.startsWith("data:") || !metadata.toLowerCase().includes(";base64") || !encoded) {
    throw new Error("Avaturn no devolvió un GLB válido.");
  }

  const estimatedBytes = Math.floor((encoded.length * 3) / 4);
  if (estimatedBytes > maxBytes) throw new Error("El avatar de Avaturn supera el tamaño permitido.");

  let binary;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("Avaturn devolvió un archivo dañado.");
  }
  if (binary.length > maxBytes) throw new Error("El avatar de Avaturn supera el tamaño permitido.");

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validateExportUrl(value, creatorUrl) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Avaturn devolvió una dirección de descarga inválida.");
  }

  const creator = new URL(creatorUrl);
  const isProviderHost = hasAllowedHostname(url.hostname, AVATURN_EXPORT_SUFFIXES);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (!isProviderHost && url.origin !== creator.origin)
  ) {
    throw new Error("Avaturn devolvió una descarga desde un dominio no permitido.");
  }
  return url;
}

async function readResponseWithLimit(response, maxBytes, signal) {
  const declaredLength = Number(response.headers && response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("El avatar de Avaturn supera el tamaño permitido.");
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error("El avatar de Avaturn supera el tamaño permitido.");
    return blob;
  }

  const reader = response.body.getReader();
  const cancel = () => Promise.resolve(reader.cancel()).catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("La descarga de Avaturn se ha cancelado.");
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("El avatar de Avaturn supera el tamaño permitido.");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (reader.releaseLock) reader.releaseLock();
  }
  return new Blob(chunks, { type: "model/gltf-binary" });
}

export async function avaturnExportToFile(
  result,
  creatorUrl,
  { fetchImpl = fetch, maxBytes = MAX_AVATAR_GLB_BYTES, signal, timeoutMs = 60000 } = {}
) {
  const normalizedCreatorUrl = normalizeAvaturnCreatorUrl(creatorUrl);
  if (!normalizedCreatorUrl || !result || typeof result.url !== "string") {
    throw new Error("No se pudo recibir el avatar desde Avaturn.");
  }

  return withAvaturnDeadline(
    async downloadSignal => {
      let contents;
      if (result.urlType === "dataURL") {
        contents = decodeDataUrl(result.url, maxBytes);
      } else if (result.urlType === "httpURL") {
        const url = validateExportUrl(result.url, normalizedCreatorUrl);
        const response = await fetchImpl(url.toString(), {
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal: downloadSignal
        });
        if (downloadSignal.aborted) throw new Error("La descarga de Avaturn se ha cancelado.");
        if (!response || !response.ok) throw new Error("No se pudo descargar el avatar terminado desde Avaturn.");
        if (
          response.redirected ||
          response.type === "opaqueredirect" ||
          (response.url && response.url !== url.toString())
        ) {
          throw new Error("Avaturn devolvió una redirección de descarga no permitida.");
        }
        contents = await readResponseWithLimit(response, maxBytes, downloadSignal);
      } else {
        throw new Error("Avaturn devolvió un formato de exportación no compatible.");
      }

      const file = new File([contents], avaturnFileName(result.avatarId), { type: "model/gltf-binary" });
      await validateAvatarGlbFile(file, maxBytes);
      return file;
    },
    { signal, timeoutMs }
  );
}
