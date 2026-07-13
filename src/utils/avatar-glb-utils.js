export const MAX_AVATAR_GLB_BYTES = 64 * 1024 * 1024;

const GLB_HEADER_BYTES = 12;
const GLB_MAGIC = 0x46546c67;
const SUPPORTED_GLB_VERSION = 2;

export async function validateAvatarGlbFile(file, maxBytes = MAX_AVATAR_GLB_BYTES) {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Selecciona un archivo GLB válido.");
  }

  if (!file.name.toLowerCase().endsWith(".glb")) {
    throw new Error("El avatar debe ser un archivo con extensión .glb.");
  }

  if (file.size > maxBytes) {
    const maxMiB = Math.floor(maxBytes / (1024 * 1024));
    throw new Error(`El archivo supera el límite de ${maxMiB} MiB.`);
  }

  if (file.size < GLB_HEADER_BYTES) {
    throw new Error("El archivo GLB está incompleto.");
  }

  const header = new DataView(await file.slice(0, GLB_HEADER_BYTES).arrayBuffer());
  const magic = header.getUint32(0, true);
  const version = header.getUint32(4, true);
  const declaredLength = header.getUint32(8, true);

  if (magic !== GLB_MAGIC || version !== SUPPORTED_GLB_VERSION || declaredLength !== file.size) {
    throw new Error("El archivo no es un GLB 2.0 válido.");
  }
}
