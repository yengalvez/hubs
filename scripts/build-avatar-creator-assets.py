"""Blender 4.4: curate CC0 Quaternius Standard assets into two creator templates.

blender --background --factory-startup --python scripts/build-avatar-creator-assets.py -- BASE_KIT OUTFIT_KIT OUTPUT
Only the two documented Standard kits are inputs. No network or production effects.
"""
import sys
from pathlib import Path
import bpy
import bmesh

base, outfits, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
hair_dir = base / 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)'
outfit_dir = outfits / 'Exports/glTF (Godot-Unreal)/Outfits'
mapping = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2', 'neck_01': 'Neck'}
for side, prefix in [('l', 'Left'), ('r', 'Right')]:
    mapping.update({f'{src}_{side}': prefix + dst for src, dst in [('clavicle', 'Shoulder'), ('upperarm', 'Arm'), ('lowerarm', 'ForeArm'), ('hand', 'Hand'), ('thigh', 'UpLeg'), ('calf', 'Leg'), ('foot', 'Foot'), ('ball', 'ToeBase')]})

def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return set(bpy.data.objects) - before

for gender in ['Male', 'Female']:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    original = load(base / f'Base Characters/Godot - UE/Superhero_{gender}_FullBody.gltf')
    rig = next(obj for obj in original if obj.type == 'ARMATURE')
    body = next(obj for obj in original if obj.type == 'MESH' and obj.name.lower().startswith('superhero'))
    # The outfits include arms/body, so retain only the base model's head/neck.
    neck = rig.matrix_world @ rig.data.bones['neck_01'].head_local
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (body.matrix_world @ v.co).z < neck.z - 0.025], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    for obj in original:
        if obj.type == 'MESH':
            obj.name = 'base_' + obj.name
    additions = [(outfit_dir / f'{gender}_{style}.gltf', 'outfit_' + style.lower()) for style in ['Peasant', 'Ranger']]
    additions += [(hair_dir / f'Hair_{style}.gltf', 'hair_' + style.lower()) for style in ['SimpleParted', 'Buzzed', 'BuzzedFemale', 'Buns', 'Long']]
    for path, key in additions:
        imported = load(path)
        for obj in imported:
            if obj.type == 'MESH':
                world = obj.matrix_world.copy()
                obj.parent = rig
                obj.matrix_world = world
                obj.name = key + '__' + obj.name
                obj['creator_group'] = key
                for mod in obj.modifiers:
                    if mod.type == 'ARMATURE':
                        mod.object = rig
        for obj in imported:
            if obj.type == 'ARMATURE':
                bpy.data.objects.remove(obj, do_unlink=True)
    for old, new in mapping.items():
        if old in rig.data.bones:
            rig.data.bones[old].name = new
        for obj in bpy.context.scene.objects:
            if obj.type == 'MESH' and old in obj.vertex_groups:
                obj.vertex_groups[old].name = new
    # Remove optional normals with broken vendor paths. Curated textures are <=1K.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                for slot in ['Normal', 'Roughness', 'Metallic']:
                    for link in list(node.inputs[slot].links):
                        mat.node_tree.links.remove(link)
                node.inputs['Roughness'].default_value = 0.85
                node.inputs['Metallic'].default_value = 0
    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, 1024)
    bpy.ops.export_scene.gltf(filepath=str(output / f'{gender.lower()}.glb'), export_format='GLB', export_extras=True, export_animations=False, export_cameras=False, export_lights=False)
