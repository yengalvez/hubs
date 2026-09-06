"""Build MakeHuman wardrobe templates offline; run with Blender --python-exit-code 1.
Usage: Blender --background --factory-startup --disable-autoexec --offline-mode
       --python scripts/build-business-avatar-assets.py --
       --mpfb-source /path/to/mpfb/src --assets /path/to/extracted/assets
       --output /private/build-output [--female]
Then run normalize-business-avatar.mjs on the resulting raw GLB.
MPFB v2.0.17; Blender 4.4.1. No permanent addon installation or preference save.
"""
import argparse, os, sys, bpy, bmesh, json
from mathutils import Vector
parser=argparse.ArgumentParser()
parser.add_argument('--mpfb-source',required=True)
parser.add_argument('--assets',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--female',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
ROOT=os.path.abspath(args.output)
ASSETS=os.path.abspath(args.assets)
BODY='female' if args.female else 'male'
os.makedirs(ROOT,exist_ok=True)
sys.path.insert(0,os.path.abspath(args.mpfb_source))
original_extension_path_user=bpy.utils.extension_path_user
def local_extension_path(package,path='',create=False):
    if package=='mpfb':
        result=os.path.join(ROOT,'mpfb-build-user',path)
        if create:os.makedirs(result,exist_ok=True)
        return result
    return original_extension_path_user(package,path=path,create=create)
bpy.utils.extension_path_user=local_extension_path
import mpfb
bpy.context.preferences.addons.new().module='mpfb'
mpfb.register()
from mpfb.services.humanservice import HumanService as service
from mpfb.services.targetservice import TargetService
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
macro=TargetService.get_default_macro_info_dict()
macro['gender']=0.0 if args.female else 1.0
macro['age']=.35
human=service.create_human(macro_detail_dict=macro)
service.add_builtin_rig(human,'mixamo')
polo='namuhekam_male_polo_shirt'
service.add_mhclo_asset(os.path.join(ASSETS,'clothes',polo,polo+'.mhclo'),human,subdiv_levels=0)
for obj in bpy.data.objects:
    if 'polo_shirt' in obj.name:
        obj['creator_group']='top_polo'
def load(folder,name,kind='Clothes',group=None):
    obj=service.add_mhclo_asset(os.path.join(ASSETS,folder,name,name+'.mhclo'),human,asset_type=kind,subdiv_levels=0)
    if group: obj['creator_group']=group
    return obj
def split_suit(obj,top,bottom=None):
    # Both source suits have disconnected trouser shells reaching ankle height.
    # Split by connectivity, never by a plane through the jacket hem.
    adj=[set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        a,b=edge.vertices;adj[a].add(b);adj[b].add(a)
    unseen=set(range(len(adj))); lower=set()
    while unseen:
        pending=[unseen.pop()];part=[]
        while pending:
            i=pending.pop();part.append(i)
            fresh=adj[i]&unseen;unseen-=fresh;pending.extend(fresh)
        if min((obj.matrix_world@obj.data.vertices[i].co).z for i in part)<.2:
            lower.update(part)
    assert lower and len(lower)<len(adj), 'Suit has no independently separable trousers'
    original=obj.data.copy()
    for target,keep in [(obj,set(range(len(adj)))-lower)]:
        bm=bmesh.new();bm.from_mesh(target.data);bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in keep],context='VERTS')
        bm.to_mesh(target.data);bm.free()
    obj['creator_group']='top_'+top
    if bottom:
        trousers=obj.copy();trousers.data=original;bpy.context.collection.objects.link(trousers)
        trousers.name='Trousers.'+bottom;trousers['creator_group']='bottom_'+bottom
        bm=bmesh.new();bm.from_mesh(trousers.data);bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index not in lower],context='VERTS')
        bm.to_mesh(trousers.data);bm.free()
    print('SPLIT',top,len(adj)-len(lower),len(lower),flush=True)
split_suit(load('clothes','toigo_male_suit_tie_and_jacket'),'blazer','suit')
split_suit(load('clothes','toigo_male_double-breasted_suit'),'doublebreasted')
sweater=load('clothes','toigo_fisherman_sweater',group='top_sweater')
for vertex in sweater.data.vertices:
    vertex.co += vertex.normal * .004
    # Trouser waistbands vary in thickness. Add clearance only around the lower
    # torso, tapering to zero above it so collar and sleeves retain their fit.
    clearance=max(0.0,min(1.0,(1.10-vertex.co.z)/.20))*.025
    radial=Vector((vertex.co.x,vertex.co.y,0))
    if radial.length>0:vertex.co+=radial.normalized()*clearance
tshirt=load('clothes','toigo_basic_tucked_t-shirt',group='top_tshirt')
hem=min(v.co.z for v in tshirt.data.vertices)
for vertex in tshirt.data.vertices:
    if vertex.co.z<hem+.05:
        vertex.co.z-=.025*(1-(vertex.co.z-hem)/.05)
for name,choice in [('mindfront_male_trousers_1','denim'),('mindfront_male_trousers_2','chinos'),('punkduck_male_classic_jeans','jeans'),('toigo_wool_pants','wool')]:
    load('clothes',name,group='bottom_'+choice)
for name in ['short01','short02','bob01','ponytail01','afro01']:
    load('hair',name,'Hair','hair_'+name)
for folder,name,kind in [('clothes','shoes01','Clothes'),('eyes','low-poly','Eyes'),('eyebrows','eyebrow001','Eyebrows')]:
    load(folder,name,kind)
skin='young_caucasian_'+BODY
service.set_character_skin(os.path.join(ASSETS,'skins',skin,skin+'.mhmat'),human,skin_type='MAKESKIN')
top_sources={'polo':'namuhekam_male_polo_shirt','blazer':'toigo_male_suit_tie_and_jacket',
    'doublebreasted':'toigo_male_double-breasted_suit','sweater':'toigo_fisherman_sweater','tshirt':'toigo_basic_tucked_t-shirt'}
bottom_sources={'suit':'toigo_male_suit_tie_and_jacket','denim':'mindfront_male_trousers_1',
    'chinos':'mindfront_male_trousers_2','jeans':'punkduck_male_classic_jeans','wool':'toigo_wool_pants'}
# Bake only the chosen garment's occlusion mask into each body variant. Selecting
# a short sleeve must never retain a jacket's hidden-arm mask. Shared materials
# and rig are retained; the composer will select exactly one body variant.
for top,top_source in top_sources.items():
    for bottom,bottom_source in bottom_sources.items():
        body=human.copy();body.data=human.data.copy();bpy.context.collection.objects.link(body)
        body.name='Body.'+top+'.'+bottom;body['creator_group']='body_'+top+'_'+bottom
        allowed={'Delete.'+top_source,'Delete.'+bottom_source,'Delete.shoes01'}
        # The suit source's mask includes a jacket even when selecting only its
        # trousers. Other trouser masks cannot hide arms and cover the same legs.
        if bottom=='suit' and top not in {'blazer','doublebreasted'}:
            allowed.discard('Delete.'+bottom_source)
            allowed.add('Delete.mindfront_male_trousers_2')
        for mod in list(body.modifiers):
            if mod.type=='MASK' and mod.name.startswith('Delete.') and mod.name not in allowed:
                body.modifiers.remove(mod)
bpy.data.objects.remove(human,do_unlink=True)
for tex in bpy.data.images:
    limit=1024 if 'skin' in tex.filepath.lower() else 512
    if max(tex.size)>limit:
        ratio=limit/max(tex.size);tex.scale(round(tex.size[0]*ratio),round(tex.size[1]*ratio))
    if tex.source=='FILE': tex.pack()
for obj in list(bpy.data.objects):
    if obj.type!='MESH':continue
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    if obj.data.shape_keys:bpy.ops.object.shape_key_remove(all=True,apply_mix=True)
    for mod in list(obj.modifiers):
        if mod.type!='ARMATURE':bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.hide_render=bool(obj.get('creator_group') and obj['creator_group'] not in ['top_polo','bottom_chinos','hair_short02'])
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x=600;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.world.color=(.3,.3,.3)
bpy.ops.object.camera_add(location=(2.2,-6,1.9));cam=bpy.context.object
cam.rotation_euler=(Vector((0,0,.95))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO';cam.data.ortho_scale=2.2;scene.camera=cam
for loc,power in [((2,-4,5),600),((-3,-2,3),400)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object
    light.data.energy=power;light.data.size=5
    light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
groups=sorted({obj.get('creator_group') for obj in bpy.data.objects if obj.get('creator_group')})
assert len(groups)==40,groups
for top in ['polo','blazer','doublebreasted','sweater','tshirt']:
    for obj in bpy.data.objects:
        group=obj.get('creator_group')
        if group:obj.hide_render=group not in ['top_'+top,'bottom_chinos','hair_short02','body_'+top+'_chinos']
    scene.render.filepath=os.path.join(ROOT,'business-'+BODY+'-'+top+'.png');bpy.ops.render.render(write_still=True)
for bottom in bottom_sources:
    for obj in bpy.data.objects:
        group=obj.get('creator_group')
        if group:obj.hide_render=group not in ['top_sweater','bottom_'+bottom,'hair_short02','body_sweater_'+bottom]
    scene.render.filepath=os.path.join(ROOT,'sweater-'+BODY+'-'+bottom+'.png');bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type in {'MESH','ARMATURE'}:obj.hide_render=False;obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'business-template-'+BODY+'.glb'),export_format='GLB',use_selection=True,export_animations=False,export_apply=True,export_extras=True)
print('BUSINESS_TEMPLATE_GROUPS',json.dumps(groups),flush=True)
