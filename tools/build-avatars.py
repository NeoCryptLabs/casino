"""
LES AVATARS — un homme et une femme « habillés classe » pour remplacer le Xbot
Mixamo des joueurs distants (`assets/player.glb`).

À lancer DANS Blender (onglet Scripting, ou via BlenderMCP). Deux fabriques :

    build_man()    barman.glb (généré Rodin, déjà riggé/pesé) re-habillé en
                   gilet bleu nuit + clips de player.glb transplantés
                   -> assets/player.glb  (écrase le Xbot ; git garde l'original)
    build_woman()  singer.glb (déjà riggé ET porteur des clips) re-habillé en
                   robe émeraude -> assets/player_f.glb

POURQUOI CES BASES-LÀ : la clé d'essai Rodin est épuisée (API_INSUFFICIENT_FUNDS)
et aucune autre source gratuite ne tient la barre de qualité du croupier — donc
on repart des modèles Rodin/commerce déjà dans le dépôt, re-habillés pour ne pas
cloner le personnel. Le retarget des clips réutilise la VISÉE DE DIRECTION de
`tools/retarget-singer.py` (importé comme module, préfixes d'os surchargés) :
copier des rotations entre deux rigs Mixamo replie le personnage en deux, viser
des directions non (voir l'en-tête de ce script-là).
"""
import bpy
import importlib.util
import numpy as np
import os
from mathutils import Vector

ROOT = "/Users/neo/projects/casino2"
BARMAN = os.path.join(ROOT, "assets/barman.glb")
PLAYER = os.path.join(ROOT, "assets/player.glb")     # source des clips (Xbot)
SINGER = os.path.join(ROOT, "assets/singer.glb")
OUT_M = os.path.join(ROOT, "assets/player.glb")
OUT_F = os.path.join(ROOT, "assets/player_f.glb")
CLIPS = ["idle", "walk", "run", "agree", "headShake"]

# retarget-singer.py fournit toute la mécanique de visée ; seuls ses préfixes
# d'os diffèrent (FBX Tina : `mixamorig_`, glb Rodin : `mixamorig:`).
_spec = importlib.util.spec_from_file_location(
    "retarget_singer", os.path.join(ROOT, "tools/retarget-singer.py"))
RT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RT)
RT.SP = RT.TP = "mixamorig:"


def fresh_scene(name):
    sc = bpy.data.scenes.get(name)
    if sc:
        for o in list(sc.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        sc = bpy.data.scenes.new(name)
    bpy.context.window.scene = sc
    sc.render.fps = 24                    # les clips de player.glb sont à 24 i/s
    return sc


def import_glb(sc, path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in set(bpy.data.objects) - before]


def rename_actions(suffix):
    """Écarte les clips homonymes pour qu'un import à venir garde les noms nus."""
    for n in CLIPS:
        a = bpy.data.actions.get(n)
        if a:
            a.name = n + suffix


def diffuse_image(mesh_ob):
    for m in mesh_ob.data.materials:
        if not m or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and 'diffuse' in n.image.name:
                return n.image
    return None


def recolor_vest(img):
    """Gilet bordeaux -> bleu nuit, par clé de couleur sur l'atlas.

    Le bordeaux est le seul rouge SOMBRE et SATURÉ de l'atlas (peau : r/g ≈ 1,5 ;
    gilet : r/g > 2). On garde la luminance du pixel (l'ombrage cuit) et on ne
    remplace que la teinte.
    """
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    mask = (r > 0.05) & (r > g * 2.0) & (r > b * 1.55) & (g < 0.33)
    v = np.clip(r[mask] * 1.15, 0, 1)            # le rouge porte la luminance
    px[mask, 0] = v * 0.13
    px[mask, 1] = v * 0.20
    px[mask, 2] = v * 0.55
    img.pixels.foreach_set(px.ravel())
    img.update()
    return int(mask.sum())


def _ground_gap(sc, arm, act, sole, f0, f1):
    """Comme RT.ground_gap mais en numpy : la semelle ici, c'est le maillage
    entier (36 k sommets), la boucle Python par sommet serait interminable."""
    arm.animation_data.action = act
    lo = 1e9
    dg = bpy.context.evaluated_depsgraph_get
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        me = sole.evaluated_get(dg()).to_mesh()
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(sole.matrix_world)
        z = co @ M[2, :3] + M[2, 3]
        lo = min(lo, float(z.min()))
        sole.evaluated_get(dg()).to_mesh_clear()
    return lo


def retarget_clips(sc, arm, sole):
    """Transplante les clips de player.glb sur `arm`, sol recalé."""
    src_objs = import_glb(sc, PLAYER)
    src = next(o for o in src_objs if o.type == 'ARMATURE')
    src.name = "SrcRig"
    for o in [o for o in src_objs if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)

    # à l'échelle de la jambe : c'est elle qui commande le contact au sol
    k = ((arm.matrix_world @ arm.data.bones[RT.TP + "Hips"].head_local).z
         / (src.matrix_world @ src.data.bones[RT.SP + "Hips"].head_local).z)
    src.scale = tuple(s * k for s in src.scale)
    print(f"[avatars] source ×{k:.4f}")

    for ob in (src, arm):
        if not ob.animation_data:
            ob.animation_data_create()
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()

    order, parent, kids = RT.hierarchy(arm, src)
    rest = RT.rest_of(arm, order, kids)
    print(f"[avatars] {len(order)} os appariés")

    src.animation_data.action = None
    for pb in src.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    root_rest = (arm.matrix_world.inverted()
                 @ (src.matrix_world @ src.pose.bones[RT.SP + order[0]].head))
    UP = arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))

    mods = [m for o in sc.objects if o.type == 'MESH'
            for m in o.modifiers if m.type == 'ARMATURE']
    for clip in CLIPS:
        if not bpy.data.actions.get(clip):
            print("[avatars] clip absent :", clip)
            continue
        for m in mods:
            m.show_viewport = False
        act, f0, f1 = RT.bake(arm, src, order, parent, kids, rest, clip, root_rest)
        for m in mods:
            m.show_viewport = True
        gap = _ground_gap(sc, arm, act, sole, f0, f1)
        if abs(gap) > 0.002:
            for m in mods:
                m.show_viewport = False
            act, f0, f1 = RT.bake(arm, src, order, parent, kids, rest, clip,
                                  root_rest, lift=UP * -gap)
            for m in mods:
                m.show_viewport = True
        print(f"[avatars] {clip} : {f0}->{f1}, sol {gap * 1000:+.1f} mm")

    # les clips du Xbot ne concernent pas ce squelette ; les cuissons prennent
    # leurs noms (le jeu cherche `idle`, `walk`… dans les groupes d'animation)
    arm.animation_data.action = None
    for n in CLIPS:
        a = bpy.data.actions.get(n)
        if a:
            bpy.data.actions.remove(a)
    for n in CLIPS:
        a = bpy.data.actions.get(n + "_T")
        if a:
            a.name = n
    bpy.data.objects.remove(src, do_unlink=True)
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()


def export_glb(sc, arm, path):
    """Export depuis une scène jetable : voir retarget-singer.py (sans
    `use_active_scene` l'exportateur embarque TOUTES les scènes du fichier)."""
    exp = bpy.data.scenes.new("EXPORT_TMP")
    exp.render.fps = sc.render.fps
    exp.collection.objects.link(arm)
    for o in sc.objects:
        if o.type == 'MESH' and (o.parent is arm or
                                 any(m.type == 'ARMATURE' and m.object is arm
                                     for m in o.modifiers)):
            exp.collection.objects.link(o)
    cur = bpy.context.window.scene
    bpy.context.window.scene = exp
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False,
        use_active_scene=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_apply=False, export_yup=True, export_skins=True,
        export_morph=True, export_morph_normal=False,
        export_cameras=False, export_lights=False,
        export_image_format='JPEG', export_jpeg_quality=80)
    bpy.context.window.scene = cur
    bpy.data.scenes.remove(exp)
    print("[avatars] exporté :", path, os.path.getsize(path) // 1024, "ko")


def build_man():
    """barman.glb re-habillé (gilet bleu nuit) + clips -> assets/player.glb."""
    sc = fresh_scene("AVATAR_M")
    # les clips homonymes d'anciennes sessions fausseraient les noms d'import
    for n in CLIPS:
        a = bpy.data.actions.get(n)
        if a:
            bpy.data.actions.remove(a)
    objs = import_glb(sc, BARMAN)
    arm = next(o for o in objs if o.type == 'ARMATURE')
    arm.name = "ManRig"
    body = max((o for o in objs if o.type == 'MESH'),
               key=lambda o: len(o.data.vertices))
    img = diffuse_image(body)
    if img:
        n = recolor_vest(img)
        print(f"[avatars] gilet recoloré : {n} pixels")
    retarget_clips(sc, arm, body)
    export_glb(sc, arm, OUT_M)


def build_woman():
    """singer.glb re-habillé (robe émeraude) -> assets/player_f.glb.
    Ses clips sont déjà à bord : aucun retarget à refaire."""
    rename_actions("#m")                   # l'import doit garder les noms nus
    sc = fresh_scene("AVATAR_F")
    objs = import_glb(sc, SINGER)
    arm = next(o for o in objs if o.type == 'ARMATURE')
    arm.name = "WomanRig"
    # robe : matériau `top` (noir uni, sans texture) -> satin émeraude profond ;
    # les ongles suivent, la chanteuse garde son rouge à elle
    for o in objs:
        if o.type != 'MESH':
            continue
        for m in o.data.materials:
            if not m or not m.node_tree:
                continue
            bsdf = next((x for x in m.node_tree.nodes
                         if x.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf:
                continue
            base = m.name.split(".")[0]
            if base == "top":
                bsdf.inputs['Base Color'].default_value = (0.012, 0.10, 0.055, 1)
                bsdf.inputs['Roughness'].default_value = 0.35
            elif base == "nails":
                bsdf.inputs['Base Color'].default_value = (0.02, 0.12, 0.07, 1)
    export_glb(sc, arm, OUT_F)


if __name__ == "__main__":
    build_man()
    build_woman()
