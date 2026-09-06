// Curated static GLB templates only: no animations, external buffers or sparse accessors.
// Compact the selected wardrobe without uploading all other meshes and textures.
export function pruneCreatorResources(json, bin) {
  const compact = (key, used) => {
    const map = new Map();
    json[key] = (json[key] || []).filter((_, index) => {
      if (!used.has(index)) return false;
      map.set(index, map.size);
      return true;
    });
    return index => {
      if (!map.has(index)) throw new Error("Referencia incompleta en la plantilla.");
      return map.get(index);
    };
  };
  const meshMap = compact("meshes", new Set(json.nodes.filter(n => n.mesh !== undefined).map(n => n.mesh)));
  for (const node of json.nodes) if (node.mesh !== undefined) node.mesh = meshMap(node.mesh);
  const accessors = new Set();
  const materials = new Set();
  const eachPrimitive = fn => json.meshes.forEach(mesh => mesh.primitives.forEach(fn));
  eachPrimitive(p => {
    Object.values(p.attributes).forEach(i => accessors.add(i));
    if (p.indices !== undefined) accessors.add(p.indices);
    if (p.material !== undefined) materials.add(p.material);
    if (p.targets) throw new Error("La plantilla debe contener geometría final.");
  });
  for (const skin of json.skins || []) {
    if (skin.inverseBindMatrices !== undefined) accessors.add(skin.inverseBindMatrices);
  }
  const accessorMap = compact("accessors", accessors);
  const materialMap = compact("materials", materials);
  eachPrimitive(p => {
    for (const key of Object.keys(p.attributes)) p.attributes[key] = accessorMap(p.attributes[key]);
    if (p.indices !== undefined) p.indices = accessorMap(p.indices);
    if (p.material !== undefined) p.material = materialMap(p.material);
  });
  for (const skin of json.skins || []) {
    if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accessorMap(skin.inverseBindMatrices);
  }
  const textureInfos = [];
  const visit = object => {
    for (const [key, value] of Object.entries(object || {})) {
      if (!value || typeof value !== "object") continue;
      if (key.endsWith("Texture") && Number.isInteger(value.index)) textureInfos.push(value);
      else visit(value);
    }
  };
  json.materials.forEach(visit);
  const textureMap = compact("textures", new Set(textureInfos.map(t => t.index)));
  textureInfos.forEach(info => (info.index = textureMap(info.index)));
  const imageMap = compact("images", new Set(json.textures.map(t => t.source)));
  json.textures.forEach(texture => (texture.source = imageMap(texture.source)));
  const views = new Set();
  for (const accessor of json.accessors) {
    if (accessor.sparse) throw new Error("La plantilla contiene geometría no compatible.");
    if (accessor.bufferView !== undefined) views.add(accessor.bufferView);
  }
  for (const image of json.images) {
    if (image.uri || image.bufferView === undefined) throw new Error("Textura no integrada en la plantilla.");
    views.add(image.bufferView);
  }
  const viewMap = compact("bufferViews", views);
  for (const accessor of json.accessors) {
    if (accessor.bufferView !== undefined) accessor.bufferView = viewMap(accessor.bufferView);
  }
  for (const image of json.images) image.bufferView = viewMap(image.bufferView);
  const chunks = [];
  let length = 0;
  for (const view of json.bufferViews) {
    const start = view.byteOffset || 0;
    if (view.buffer !== 0 || start + view.byteLength > bin.length) throw new Error("Datos de plantilla incompletos.");
    chunks.push({ offset: length, bytes: bin.subarray(start, start + view.byteLength) });
    view.byteOffset = length;
    length += Math.ceil(view.byteLength / 4) * 4;
  }
  const output = new Uint8Array(length);
  for (const chunk of chunks) output.set(chunk.bytes, chunk.offset);
  json.buffers = [{ byteLength: length }];
  return output;
}
