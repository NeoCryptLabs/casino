"""
LA CHANTEUSE — habille le squelette animé du jeu avec un modèle riggé du commerce.

À lancer DANS Blender (onglet Scripting, ou via BlenderMCP). Travaille dans une
scène dédiée `TINA`, jamais dans la scène courante.

    entrée   un FBX/glTF déjà riggé et déjà pesé (SOURCE_MODEL)
    sortie   assets/singer.glb, porteur des clips du jeu

POURQUOI UN RETARGET, ET PAS UNE COPIE
Le modèle acheté a son propre squelette Mixamo mais AUCUNE animation ; les clips
(`idle`, `walk`, `run`…) vivent dans `assets/player.glb`. Les deux rigs ont les
mêmes os, aux mêmes endroits — mais pas les mêmes repères d'os :

  - l'import glTF de player.glb fabrique des os qui pointent tous vers le HAUT,
    sans rapport avec le membre qu'ils pilotent (heuristique de longueur du
    chargeur) ;
  - l'import FBX du modèle, lui, aligne chaque os sur son membre.

Copier les rotations — en local comme en monde — plaque donc les repères de l'un
sur l'autre et replie le personnage en deux (essayé, vérifié en rendu : jambes
au-dessus de la tête). On ne copie donc pas des rotations mais des DIRECTIONS :
chaque os du modèle est VISÉ le long de la direction qu'a son homologue à cette
image. C'est exactement la technique déjà employée par `NPC._aim()` côté jeu.

  - os à deux enfants ou plus (bassin, buste, mains) : les deux premiers enfants
    donnent un repère complet, la torsion est donc conservée ;
  - os à un seul enfant : visée simple, la torsion propre de l'os est perdue —
    invisible sur une marche vue de la salle.

Le modèle est en A-pose et les clips en T-pose : c'est sans importance ici, la
visée est ABSOLUE (elle impose la direction de l'image, pas un écart au repos).
"""
import bpy
from mathutils import Matrix, Vector

SOURCE_MODEL = "/private/tmp/claude-501/-Users-neo-projects-casino2/0fcb4003-eea5-4608-8b7b-3aeae7794a13/scratchpad/tina/source/tina turner tpose.fbx"
CLIPS_GLB = "/Users/neo/projects/casino2/assets/player.glb"
OUTPUT = "/Users/neo/projects/casino2/assets/singer.glb"
CLIPS = ["idle", "walk", "run", "agree", "headShake"]
SP, TP = "mixamorig:", "mixamorig_"          # préfixes d'os source / cible
SOLE_MESH = "high_heels"                     # ce qui doit toucher le sol
HEAD_MESH = "tina_head"                      # porteur des cibles de morph
# Le FBX livre ses expressions en MAILLAGES SÉPARÉS (héritage ZBrush/GoZ), pas
# en clés de forme : mêmes sommets, même ordre, une copie par expression. On les
# récupère en clés de forme, seule forme que glTF sache transporter. `mouthOpen`
# est celle qui compte : c'est elle que le jeu pilote au niveau du chant.
MORPHS = {"aaah": "mouthOpen", "smile_open": "smile"}

# Le poil coûte cher : trois calottes de 50 à 65 k sommets pour une chanteuse
# vue à cinq mètres. Décimation par objet (les poids suivent).
DECIMATE = {"hair_2": 0.16, "hair_3": 0.16, "hair_4": 0.16, "tina_turner": 0.5}


# --------------------------------------------------------------------------
def frame_of(a, b):
    """Repère orthonormé bâti sur deux directions ; None si elles sont colinéaires."""
    x = a.normalized()
    z = x.cross(b)
    if z.length < 1e-6:
        return None
    z.normalize()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()     # colonnes = axes


def hierarchy(tina, src):
    """Os communs aux deux rigs, parents avant enfants, avec leurs enfants."""
    common = {b.name[len(TP):] for b in tina.data.bones
              if SP + b.name[len(TP):] in src.data.bones}
    order, seen = [], set()

    def walk(b):
        n = b.name[len(TP):]
        if n in common and n not in seen:
            seen.add(n)
            order.append(n)
        for c in b.children:
            walk(c)
    for b in tina.data.bones:
        if not b.parent:
            walk(b)
    parent, kids = {}, {}
    for n in order:
        tb = tina.data.bones[TP + n]
        p = tb.parent.name[len(TP):] if tb.parent else None
        parent[n] = p if p in common else None
        kids[n] = [c.name[len(TP):] for c in tb.children if c.name[len(TP):] in common]
    return order, parent, kids


def rest_of(tina, order, kids):
    """Pose de repos de la cible, dans l'espace de SON armature."""
    heads, dirs, frames, rots = {}, {}, {}, {}
    for n in order:
        b = tina.data.bones[TP + n]
        heads[n] = b.matrix_local.to_translation()
        rots[n] = b.matrix_local.to_3x3().to_quaternion().to_matrix()
    for n in order:
        k = kids[n]
        if k:
            d = heads[k[0]] - heads[n]
            dirs[n] = d.normalized() if d.length > 1e-9 else None
        if len(k) >= 2 and dirs.get(n):
            frames[n] = frame_of(dirs[n], heads[k[1]] - heads[n])
    return heads, dirs, frames, rots


def source_pose(src, tina, order, kids):
    """Têtes, directions et repères de la SOURCE à l'image courante, ramenés
    dans l'espace de l'armature cible — c'est là que tout le calcul se fait."""
    A = tina.matrix_world.inverted()
    heads = {n: A @ (src.matrix_world @ src.pose.bones[SP + n].head) for n in order}
    dirs, frames = {}, {}
    for n in order:
        k = kids[n]
        if k:
            d = heads[k[0]] - heads[n]
            dirs[n] = d.normalized() if d.length > 1e-9 else None
        if len(k) >= 2 and dirs.get(n):
            frames[n] = frame_of(dirs[n], heads[k[1]] - heads[n])
    return heads, dirs, frames


def apply_frame(tina, order, parent, rest, spose, root, arm_mats):
    """Pose la cible sur l'image courante de la source."""
    r_heads, r_dirs, r_frames, r_rots = rest
    s_heads, s_dirs, s_frames = spose
    R, head = {}, {}
    for n in order:
        p = parent[n]
        base = R[p] if p else Matrix.Identity(3)
        head[n] = (r_heads[n] + root) if p is None else head[p] + base @ (r_heads[n] - r_heads[p])
        if n in s_frames and r_frames.get(n):
            R[n] = s_frames[n] @ r_frames[n].inverted()     # repère complet : torsion gardée
        elif s_dirs.get(n) and r_dirs.get(n):
            inherited = base @ r_dirs[n]
            R[n] = (inherited.rotation_difference(s_dirs[n]).to_matrix()) @ base
        else:
            R[n] = base                                      # feuille : suit son parent
    # conversion en base locale, sans jamais dépendre du graphe de dépendances
    for n in order:
        pb = tina.pose.bones[TP + n]
        M = Matrix.Translation(head[n]) @ (R[n] @ r_rots[n]).to_4x4()
        arm_mats[n] = M
        pbone = pb.bone
        if pb.parent and pb.parent.name[len(TP):] in arm_mats:
            ref = (arm_mats[pb.parent.name[len(TP):]]
                   @ pb.parent.bone.matrix_local.inverted() @ pbone.matrix_local)
        else:
            ref = pbone.matrix_local
        pb.matrix_basis = ref.inverted() @ M


def bake(tina, src, order, parent, kids, rest, clip, root_rest, lift=None):
    """Cuit un clip source en une action posée sur le squelette du modèle."""
    a = bpy.data.actions[clip]
    src.animation_data.action = a
    f0, f1 = int(a.frame_range[0]), int(round(a.frame_range[1]))
    if bpy.data.actions.get(clip + "_T"):
        bpy.data.actions.remove(bpy.data.actions[clip + "_T"])
    act = bpy.data.actions.new(clip + "_T")
    tina.animation_data.action = act
    sc = bpy.context.scene
    hips = order[0]
    arm_mats = {}
    lift = lift or Vector((0, 0, 0))
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        spose = source_pose(src, tina, order, kids)
        apply_frame(tina, order, parent, rest, spose,
                    spose[0][hips] - root_rest + lift, arm_mats)
        for n in order:
            pb = tina.pose.bones[TP + n]
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if n == hips:
                pb.keyframe_insert("location", frame=f)
    return act, f0, f1


def ground_gap(sc, tina, act, sole, f0, f1):
    """Point le plus bas de la semelle sur tout le clip, en mètres monde.

    Les deux squelettes n'ont pas exactement la même longueur de jambe : sans
    ce recalage la chanteuse marche enfoncée d'un ou deux centimètres dans le
    plateau — visible de face, dès qu'on la regarde marcher.
    """
    tina.animation_data.action = act
    lo = 1e9
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        ev = sole.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        lo = min(lo, min((sole.matrix_world @ v.co).z for v in me.vertices))
        ev.to_mesh_clear()
    return lo


def add_shapekeys(sc):
    """Transforme les maillages d'expression du FBX en clés de forme sur la tête.

    Sans elles, la chanteuse chante bouche fermée : glTF ne transporte que des
    morph targets, et le modèle n'en avait aucun — juste des copies du maillage
    de tête, une par expression, mises de côté à l'import.
    """
    head = sc.objects.get(HEAD_MESH)
    if not head:
        print("[retarget] tête introuvable :", HEAD_MESH)
        return

    if head.data.shape_keys and len(head.data.shape_keys.key_blocks) > 1:
        # L'import FBX les a déjà posées — mais TOUTES À 1,0 : le visage sortait
        # avec ses six expressions empilées, bouche ouverte et yeux fermés en
        # permanence. Le repos, c'est zéro partout ; le jeu remonte `aaah` au
        # rythme du chant.
        for kb in head.data.shape_keys.key_blocks:
            kb.value = 0.0
        print("[retarget] clés de forme remises au repos :",
              [k.name for k in head.data.shape_keys.key_blocks[1:]])
        return

    before = set(bpy.data.objects)
    tmp = bpy.data.scenes.new("MORPH_TMP")
    cur = bpy.context.window.scene
    bpy.context.window.scene = tmp
    bpy.ops.import_scene.fbx(filepath=SOURCE_MODEL)
    bpy.context.window.scene = cur
    fresh = {o.name.split(".")[0]: o for o in set(bpy.data.objects) - before}

    if not head.data.shape_keys:
        head.shape_key_add(name="Basis", from_mix=False)
    n = len(head.data.vertices)
    for src_name, key in MORPHS.items():
        o = fresh.get(src_name)
        if not o or len(o.data.vertices) != n:
            print(f"[retarget] morph {src_name} inutilisable "
                  f"({len(o.data.vertices) if o else 'absent'} sommets pour {n})")
            continue
        # les copies d'expression vivent à une autre échelle que la tête : on
        # les ramène dans SON espace local avant d'en faire une clé
        M = head.matrix_world.inverted() @ o.matrix_world
        kb = head.shape_key_add(name=key, from_mix=False)
        moved = 0
        for i, v in enumerate(o.data.vertices):
            co = M @ v.co
            if (co - head.data.vertices[i].co).length > 1e-4:
                moved += 1
            kb.data[i].co = co
        print(f"[retarget] clé de forme {key} ({moved}/{n} sommets déplacés)")

    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.scenes.remove(tmp)


# --------------------------------------------------------------------------
def main():
    sc = bpy.data.scenes.get("TINA") or bpy.data.scenes.new("TINA")
    bpy.context.window.scene = sc
    sc.render.fps = 24                     # les clips de player.glb sont à 24 i/s

    # ---- modèle ----
    tina = sc.objects.get("TinaRig")
    if not tina:
        bpy.ops.import_scene.fbx(filepath=SOURCE_MODEL)
        tina = next(o for o in sc.objects if o.type == 'ARMATURE')
        tina.name = "TinaRig"
        # cibles de morph du visage : mêmes sommets que la tête, sans matériau
        for o in list(sc.objects):
            if o.type in ('EMPTY',) or (o.type == 'MESH' and not o.data.materials):
                bpy.data.objects.remove(o, do_unlink=True)

    # Table rase des actions AVANT l'import : sans ça, à la deuxième exécution,
    # les clips importés arrivent en `walk.001` (le nom `walk` étant déjà pris
    # par la cuisson précédente) et on ne sait plus qui est qui.
    if tina.animation_data:
        tina.animation_data.action = None
    for a in list(bpy.data.actions):
        if a.name.split(".")[0].removesuffix("_T") in CLIPS or a.name.endswith("_T"):
            bpy.data.actions.remove(a)

    # ---- squelette porteur des clips ----
    src = sc.objects.get("SrcRig")
    if not src:
        bpy.ops.import_scene.gltf(filepath=CLIPS_GLB)
        src = next(o for o in sc.objects if o.type == 'ARMATURE' and o.name != "TinaRig")
        src.name = "SrcRig"
        for o in [o for o in sc.objects if o.type == 'MESH' and o.parent is src]:
            bpy.data.objects.remove(o, do_unlink=True)
        for a in [a for a in bpy.data.actions if a.name.endswith(".001")]:
            bpy.data.actions.remove(a)
        # à l'échelle de la JAMBE du modèle : c'est elle qui commande le contact
        # au sol, pas la taille totale
        k = ((tina.matrix_world @ tina.data.bones[TP + "Hips"].head_local).z
             / (src.matrix_world @ src.data.bones[SP + "Hips"].head_local).z)
        src.scale = tuple(s * k for s in src.scale)
        print(f"[retarget] squelette source mis à l'échelle ×{k:.4f}")

    if not src.animation_data:
        src.animation_data_create()
    if not tina.animation_data:
        tina.animation_data_create()
    for pb in tina.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()

    order, parent, kids = hierarchy(tina, src)
    rest = rest_of(tina, order, kids)
    print(f"[retarget] {len(order)} os appariés")

    # position de repos des hanches de la SOURCE : origine des déplacements
    src.animation_data.action = None
    for pb in src.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    root_rest = (tina.matrix_world.inverted()
                 @ (src.matrix_world @ src.pose.bones[SP + order[0]].head))

    # la déformation des maillages n'a aucun intérêt pendant la cuisson
    hidden = []
    for o in sc.objects:
        if o.type == 'MESH':
            for m in o.modifiers:
                if m.type == 'ARMATURE' and m.show_viewport:
                    m.show_viewport = False
                    hidden.append(m)

    # axe vertical du monde, exprimé dans l'espace de l'armature
    UP = tina.matrix_world.inverted().to_3x3() @ Vector((0, 0, 1))
    sole = sc.objects.get(SOLE_MESH)

    for clip in CLIPS:
        if not bpy.data.actions.get(clip):
            print("[retarget] clip absent :", clip)
            continue
        act, f0, f1 = bake(tina, src, order, parent, kids, rest, clip, root_rest)
        gap = 0.0
        if sole:
            for m in hidden:
                m.show_viewport = True
            gap = ground_gap(sc, tina, act, sole, f0, f1)
            if abs(gap) > 0.002:                 # au-delà de 2 mm, on recale
                act, f0, f1 = bake(tina, src, order, parent, kids, rest, clip,
                                   root_rest, lift=UP * -gap)
            for m in hidden:
                m.show_viewport = False
        print(f"[retarget] {clip} : images {f0}->{f1}, sol recalé de {gap * 1000:+.1f} mm")

    for m in hidden:
        m.show_viewport = True

    # ---- allègement : le poil pèse plus lourd que le personnage ----
    for name, ratio in DECIMATE.items():
        o = sc.objects.get(name)
        if not o or o.get("decimated"):
            continue
        d = o.modifiers.new("dec", 'DECIMATE')
        d.decimate_type, d.ratio, d.use_collapse_triangulate = 'COLLAPSE', ratio, True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
        o["decimated"] = True
        print(f"[retarget] {name} décimé à {ratio:.0%} -> {len(o.data.vertices)} sommets")

    # ---- expressions du visage ----
    add_shapekeys(sc)

    # ---- budget de textures ----
    # Le glb est chargé par CHAQUE joueur au démarrage. Les cartes de cuir
    # chevelu arrivaient en 2048² : 8,6 Mo à elles deux, pour une chevelure vue
    # à cinq mètres. Les masques (opacité, rugosité) descendent plus bas encore,
    # ils ne portent aucun détail.
    for im in bpy.data.images:
        if not im.has_data or im.size[0] == 0:
            continue
        mask = any(k in im.name.lower() for k in ("opacity", "roughness", "_a_", "_r_"))
        cap = 512 if mask else 1024
        if max(im.size) > cap:
            w, h = im.size
            r = cap / max(w, h)
            im.scale(max(4, int(w * r)), max(4, int(h * r)))
            print(f"[retarget] texture {im.name[:38]} {w}x{h} -> {im.size[0]}x{im.size[1]}")

    # ---- export ----
    # les actions de la source ne concernent pas ce squelette : exportées, elles
    # produiraient des animations vides
    src_actions = [a for a in bpy.data.actions if not a.name.endswith("_T")]
    keep = {}
    for a in src_actions:
        bpy.data.actions.remove(a)
    for a in list(bpy.data.actions):
        if a.name.endswith("_T"):
            a.name = a.name[:-2]
            keep[a.name] = a
    bpy.data.objects.remove(src, do_unlink=True)

    tina.animation_data.action = None
    for pb in tina.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()

    # Export depuis une scène JETABLE ne contenant qu'elle. `use_selection` ne
    # suffit pas : le premier essai a embarqué le squelette de player.glb resté
    # dans une autre scène, et le glb est sorti avec deux armatures et chaque
    # clip en double.
    exp = bpy.data.scenes.new("SINGER_EXPORT")
    exp.render.fps = sc.render.fps
    for o in [tina] + [m for m in sc.objects if m.type == 'MESH' and m.parent is tina]:
        exp.collection.objects.link(o)
    bpy.context.window.scene = exp
    # `use_active_scene=True` est INDISPENSABLE : par défaut l'exportateur
    # embarque TOUTES les scènes du fichier — le décor du cabaret et le
    # mannequin s'étaient invités dans le glb.
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT, export_format='GLB', use_selection=False,
        use_active_scene=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_apply=False, export_yup=True, export_skins=True,
        export_morph=True, export_morph_normal=False,
        export_cameras=False, export_lights=False,
        export_image_format='JPEG', export_jpeg_quality=80)
    bpy.context.window.scene = sc
    bpy.data.scenes.remove(exp)
    print("[retarget] exporté :", OUTPUT, "| clips :", sorted(keep))


if __name__ == "__main__":
    main()
