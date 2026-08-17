"""
LA CHANTEUSE — modelage, skinning et export de `assets/singer.glb`.

REPLI. Dès qu'on dispose d'un modèle du commerce déjà riggé, c'est
`tools/retarget-singer.py` qu'il faut lancer : il produit le même fichier à
partir d'un vrai personnage, et non du mannequin stylisé bâti ici.

À lancer DANS Blender (onglet Scripting, ou via BlenderMCP). Le script travaille
dans une scène dédiée `SINGER` : la scène courante n'est jamais touchée.

Pourquoi ce script existe : la chanteuse du concert glissait jusqu'au micro. Le
modèle féminin par défaut du jeu (Michelle.glb) ne porte AUCUN clip
d'animation ; il n'y avait donc rien à jouer pendant qu'elle se déplaçait. La
seule façon propre de lui donner la marche du jeu est de la poser sur le MÊME
squelette que `assets/player.glb`, qui porte `idle`/`walk`/`run`… : rig, pose de
repos et roulis des os sont alors identiques par construction, il n'y a rien à
retargeter (les essais de transfert entre rigs différents sortaient
anatomiquement faux — cf. le commentaire de `NPC.play` dans src/npc.js).

Le maillage construit ici est un mannequin stylisé. Pour le remplacer par un
modèle de meilleure facture (génération Rodin/Hunyuan, achat, scan) :
  1. importer ce modèle dans la scène `SINGER`, EN T-POSE, orienté -Y devant,
     debout sur z = 0, à l'échelle du squelette (≈ 177 unités de haut) ;
  2. le renommer `SingerMesh` ;
  3. relancer ce script : il saute le modelage et ne fait que peser + exporter.

Tout est en CENTIMÈTRES : le squelette importé de player.glb vit à cette
échelle (objet armature en scale 0.01). L'export remet le tout en mètres.
"""
import math
import bmesh
import bpy
from mathutils import Vector

PLAYER = "/Users/neo/projects/casino2/assets/player.glb"   # source du squelette + des clips
OUTPUT = "/Users/neo/projects/casino2/assets/singer.glb"
K = 0.574          # rayon de surface / `radius` d'un élément metaball (mesuré)


# --------------------------------------------------------------------------
# squelette
# --------------------------------------------------------------------------
def scene_and_armature():
    """Scène `SINGER` + squelette Mixamo de player.glb, clips compris."""
    sc = bpy.data.scenes.get("SINGER") or bpy.data.scenes.new("SINGER")
    bpy.context.window.scene = sc
    arm = next((o for o in sc.objects if o.type == 'ARMATURE'), None)
    if not arm:
        bpy.ops.import_scene.gltf(filepath=PLAYER)
        arm = next(o for o in sc.objects if o.type == 'ARMATURE')
        # le maillage source (Xbot) ne sert à rien : seuls le rig et les actions comptent
        for o in [o for o in sc.objects if o.type == 'MESH' and not o.name.startswith("Singer")]:
            bpy.data.objects.remove(o, do_unlink=True)
    # résultat d'un passage précédent : il serait exporté en double
    old = sc.objects.get("Singer")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    arm.scale = (1, 1, 1)                    # on modèle en cm ; remis à 0.01 à l'export
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    return sc, arm


def fresh(sc, name):
    o = sc.objects.get(name)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


def done(ob, bm, smooth=True):
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.polygons.foreach_set("use_smooth", [smooth] * len(ob.data.polygons))
    ob.data.update()


# --------------------------------------------------------------------------
# matières
# --------------------------------------------------------------------------
def mat(name, col, metal, rough, double=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    m.use_backface_culling = not double
    m.diffuse_color = (*col, 1)
    return m


def materials():
    return {
        "skin":   mat("SingerSkin",   (0.78, 0.58, 0.47), 0.0, 0.62),
        "dress":  mat("SingerDressM", (0.40, 0.045, 0.10), 0.85, 0.24, True),
        "glove":  mat("SingerGlove",  (0.035, 0.03, 0.04), 0.10, 0.34, True),
        "hair":   mat("SingerHairM",  (0.050, 0.032, 0.030), 0.0, 0.42, True),
        "shoe":   mat("SingerShoe",   (0.70, 0.54, 0.19), 1.0, 0.26),
        "sclera": mat("SingerSclera", (0.88, 0.86, 0.84), 0.0, 0.25),
        "iris":   mat("SingerIris",   (0.06, 0.035, 0.02), 0.0, 0.18),
        "lips":   mat("SingerLips",   (0.45, 0.06, 0.10), 0.0, 0.30),
        "brow":   mat("SingerBrow",   (0.05, 0.033, 0.03), 0.0, 0.50),
    }


# --------------------------------------------------------------------------
# corps : champ de metaballs, donc une seule surface fermée et lisse — les
# primitives qui s'interpénètrent laissent des coutures d'ombrage visibles
# --------------------------------------------------------------------------
def build_body(sc, M):
    mb = bpy.data.metaballs.new("singerBody")
    mb.resolution = mb.render_resolution = 1.0
    old = sc.objects.get("SingerBody")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    body = bpy.data.objects.new("SingerBody", mb)
    sc.collection.objects.link(body)

    def ball(co, r, neg=False):
        e = mb.elements.new(type='BALL')
        e.co, e.radius, e.use_negative = co, r / K, neg

    def ellip(co, half, neg=False):
        e = mb.elements.new(type='ELLIPSOID')
        e.co = co
        R = max(half) / K
        e.radius = R
        e.size_x, e.size_y, e.size_z = [h / (K * R) for h in half]
        e.use_negative = neg

    def chain(p0, p1, r0, r1):
        a, b = Vector(p0), Vector(p1)
        n = max(2, int((b - a).length / (0.40 * min(r0, r1))) + 1)
        for i in range(n + 1):
            t = i / n
            ball(tuple(a.lerp(b, t)), r0 + (r1 - r0) * t)

    ellip((0, -1.0, 100.0), (15.5, 10.5, 11.0))     # bassin
    ellip((0,  4.0,  96.0), (13.0,  7.5,  8.0))     # fessier
    ellip((0, -1.5, 114.0), (11.0,  8.2,  9.0))     # taille
    ellip((0, -0.5, 125.0), (13.0,  9.3,  9.0))     # cage thoracique
    ellip((0,  0.5, 135.0), (14.5,  9.2,  8.0))     # poitrine
    ellip((0,  3.0, 143.0), (16.0,  8.8,  6.0))     # ligne d'épaules
    ball((6.9, -6.6, 132.0), 5.6)
    ball((-6.9, -6.6, 132.0), 5.6)
    ball((15.16, 5.0, 143.8), 6.0)                  # deltoïdes
    ball((-15.16, 5.0, 143.8), 6.0)
    chain((0, 2.8, 146.5), (0, 2.0, 159.5), 4.0, 4.1)
    ellip((0,  1.8, 167.6), (7.6, 9.2, 10.6))       # crâne
    ellip((0, -3.0, 162.8), (5.0, 4.5, 4.8))        # visage
    ellip((0, -1.4, 159.0), (3.9, 3.6, 2.8))        # mâchoire
    for s in (1, -1):
        chain((s * 15.16, 5, 143.8), (s * 43.0, 5, 143.8), 5.2, 3.9)
        chain((s * 43.0, 5, 143.8), (s * 71.33, 5, 143.8), 3.9, 3.0)
        ellip((s * 78.0, 4.2, 143.6), (8.5, 4.6, 2.5))          # main
        chain((s * 8.21, -0.5, 97.2), (s * 8.21, -0.8, 52.9), 8.2, 5.6)
        chain((s * 8.21, -0.8, 52.9), (s * 8.21, 2.2, 10.0), 5.6, 3.4)
        ball((s * 8.21, 1.6, 6.0), 3.8)
        ellip((s * 8.21, -3.5, 4.2), (4.4, 10.5, 4.0))          # pied
    # sans ce creux, les deux cuisses fusionnent en un seul bloc
    ball((0, -1.0, 88.0), 7.0, neg=True)

    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.convert(target='MESH')
    body = bpy.context.view_layer.objects.active
    body.name = "SingerBody"
    bpy.ops.object.shade_smooth()
    d = body.modifiers.new("dec", 'DECIMATE')
    d.decimate_type, d.ratio = 'COLLAPSE', 0.22
    bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.shade_smooth()
    body.data.materials.clear()
    body.data.materials.append(M["skin"])
    return body


# --------------------------------------------------------------------------
# vêtements. Les rayons de la robe sont MESURÉS sur le corps : à la main, elle
# rentrait dans les hanches et la poitrine ressortait au travers.
# --------------------------------------------------------------------------
def build_dress(sc, body, M):
    V = [v.co for v in body.data.vertices]

    def fit(z, band=3.5, clear=1.4, xmax=17.5):
        pts = [p for p in V if abs(p.z - z) < band and abs(p.x) < xmax]
        cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
        return (cy,
                max(abs(p.x) for p in pts) + clear,
                (max(p.y for p in pts) - min(p.y for p in pts)) / 2 + clear)

    dress = fresh(sc, "SingerDress")
    bm = bmesh.new()
    SEG, prev = 32, None
    for z in [135.5, 133, 130, 126, 122, 118, 114, 110, 106, 102, 98, 94, 90, 86, 82, 78, 76]:
        cy, rx, ry = fit(z)
        if z >= 133:
            rx *= 0.97                      # le bustier se resserre sous les aisselles
        if z <= 80:
            rx *= 1.02; ry *= 1.02          # léger évasé à l'ourlet
        row = [bm.verts.new((rx * math.sin(2 * math.pi * i / SEG),
                             cy + ry * math.cos(2 * math.pi * i / SEG), z))
               for i in range(SEG)]
        if prev:
            for i in range(SEG):
                j = (i + 1) % SEG
                bm.faces.new((prev[i], prev[j], row[j], row[i]))
        prev = row
    done(dress, bm)
    dress.data.materials.append(M["dress"])
    return dress


def build_gloves(sc, M):
    for s, nm in ((1, "SingerGloveL"), (-1, "SingerGloveR")):
        ob = fresh(sc, nm)
        bm = bmesh.new()
        Y, Z, SEG, prev = 4.4, 143.7, 20, None
        for (x, ry, rz) in [(88, 4.0, 2.2), (84, 5.0, 2.8), (79, 5.2, 3.2), (74, 4.4, 3.6),
                            (71, 3.8, 3.8), (62, 4.1, 4.1), (52, 4.4, 4.4), (44, 4.7, 4.7),
                            (39, 5.0, 5.0), (36, 5.6, 5.6), (35, 5.7, 5.7)]:
            row = [bm.verts.new((s * x,
                                 Y + ry * math.sin(2 * math.pi * i / SEG),
                                 Z + rz * math.cos(2 * math.pi * i / SEG)))
                   for i in range(SEG)]
            if prev:
                for i in range(SEG):
                    j = (i + 1) % SEG
                    bm.faces.new((prev[i], prev[j], row[j], row[i]))
            prev = row
        done(ob, bm)
        ob.data.materials.append(M["glove"])


def build_shoes(sc, M):
    for s, nm in ((1, "SingerShoeL"), (-1, "SingerShoeR")):
        ob = fresh(sc, nm)
        bm = bmesh.new()
        X, prev = s * 8.21, None
        for (y, rx, rz) in [(7.2, 3.6, 3.4), (4.0, 4.5, 4.6), (0.0, 4.7, 4.8), (-4.0, 4.6, 4.6),
                            (-8.0, 4.2, 3.8), (-11.0, 3.6, 3.0), (-13.5, 2.6, 2.2), (-14.8, 1.4, 1.4)]:
            row = [bm.verts.new((X + rx * math.sin(2 * math.pi * i / 18), y,
                                 max(0.15, 4.6 + rz * math.cos(2 * math.pi * i / 18))))
                   for i in range(18)]
            if prev:
                for i in range(18):
                    j = (i + 1) % 18
                    bm.faces.new((prev[i], prev[j], row[j], row[i]))
            prev = row
        done(ob, bm)
        ob.data.materials.append(M["shoe"])


def build_hair(sc, M):
    """Calotte (ellipsoïde percé d'un ovale pour le visage) + masse longue."""
    hair = fresh(sc, "SingerHair")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=26, radius=1.0)
    CY, CZ, RX, RY, RZ = 2.4, 167.6, 9.0, 10.6, 11.6
    OX, OZ, OC = 7.8, 10.4, 164.0
    for v in bm.verts:
        v.co = Vector((v.co.x * RX, CY + v.co.y * RY, CZ + v.co.z * RZ))
    kill = [f for f in bm.faces
            if (lambda p: p.y < CY and (p.x / OX) ** 2 + ((p.z - OC) / OZ) ** 2 < 1.0)
               (sum((v.co for v in f.verts), Vector()) / len(f.verts))]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    # la découpe sur une grille laisse un bord en escalier : on rabat les
    # sommets du bord sur l'ovale exact, sinon la racine des cheveux crénèle
    for v in bm.verts:
        if not any(len(e.link_faces) == 1 for e in v.link_edges) or v.co.y >= CY:
            continue
        a, b = v.co.x / OX, (v.co.z - OC) / OZ
        s = math.hypot(a, b)
        if s < 1e-6 or s > 1.6:
            continue
        x, z = OX * a / s, OC + OZ * b / s
        q = 1 - (x / RX) ** 2 - ((z - CZ) / RZ) ** 2
        v.co = Vector((x, CY - RY * math.sqrt(max(0.0, q)), z))
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v.co.y < CY], factor=0.3,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)

    RINGS = [(172, 2.4, 9.0, 10.6), (166, 2.6, 9.4, 11.0), (160, 3.4, 9.6, 10.2),
             (154, 5.0, 9.8, 9.0), (148, 7.0, 10.2, 8.0), (142, 8.6, 10.8, 7.2),
             (136, 9.8, 11.2, 6.6), (130, 10.6, 11.2, 6.0), (124, 10.8, 10.6, 5.4),
             (120, 10.6, 9.4, 4.6)]
    TH, A, N = 2.6, math.radians(106), 22
    outer, inner = [], []
    for (z, cy, rx, ry) in RINGS:
        ro, ri = [], []
        for i in range(N + 1):
            a = -A + 2 * A * i / N
            ro.append(bm.verts.new((rx * math.sin(a), cy + ry * math.cos(a), z)))
            ri.append(bm.verts.new(((rx - TH) * math.sin(a),
                                    cy + (ry - TH * ry / rx) * math.cos(a), z)))
        outer.append(ro)
        inner.append(ri)
    for k in range(len(RINGS) - 1):
        for i in range(N):
            bm.faces.new((outer[k][i], outer[k][i + 1], outer[k + 1][i + 1], outer[k + 1][i]))
            bm.faces.new((inner[k][i + 1], inner[k][i], inner[k + 1][i], inner[k + 1][i + 1]))
        for side in (0, N):
            f = (outer[k][side], outer[k + 1][side], inner[k + 1][side], inner[k][side])
            bm.faces.new(f if side == 0 else f[::-1])
    for i in range(N):
        bm.faces.new((outer[-1][i], outer[-1][i + 1], inner[-1][i + 1], inner[-1][i]))
    done(hair, bm)
    hair.data.materials.append(M["hair"])


def build_face(sc, body, M):
    """Yeux posés SUR la surface, suivant sa normale : un œil planté à l'axe Y
    s'enfonce d'un côté du visage et louche."""
    def sphere(name, center, r, material):
        ob = fresh(sc, name)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0)
        for v in bm.verts:
            v.co = Vector(center) + v.co * r
        done(ob, bm)
        ob.data.materials.append(material)

    def squashed(name, center, scale, material):
        ob = fresh(sc, name)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=9, radius=1.0)
        for v in bm.verts:
            v.co = Vector((center[0] + v.co.x * scale[0],
                           center[1] + v.co.y * scale[1],
                           center[2] + v.co.z * scale[2]))
        done(ob, bm)
        ob.data.materials.append(material)

    for s in (1, -1):
        t = 'L' if s > 0 else 'R'
        hit, loc, nor, _ = body.ray_cast(Vector((s * 3.3, -60, 166.3)), Vector((0, 1, 0)))
        sphere(f"SingerEye{t}", loc - nor * 0.62, 1.05, M["sclera"])
        sphere(f"SingerIris{t}", loc + nor * 0.30, 0.50, M["iris"])
        hit, loc2, _, _ = body.ray_cast(Vector((s * 3.4, -60, 169.0)), Vector((0, 1, 0)))
        squashed(f"SingerBrow{t}", (loc2.x, loc2.y + 0.25, loc2.z), (1.95, 0.55, 0.30), M["brow"])
    squashed("SingerNose", (0, -8.20, 162.9), (1.00, 1.15, 1.55), M["skin"])
    squashed("SingerLips", (0, -7.90, 159.6), (2.25, 0.80, 0.70), M["lips"])


def push_out(sc, body, name, clear, it=2):
    """Chasse hors du corps tout sommet de vêtement qui s'y enfonce, puis lisse.

    Un vêtement dessiné « à vue » troue toujours le corps quelque part ; plutôt
    que de retoucher les cotes à l'aveugle, on projette sur la surface réelle.
    """
    ob = sc.objects[name]
    moved = []
    for v in ob.data.vertices:
        hit, loc, nor, _ = body.closest_point_on_mesh(v.co)
        if hit and (v.co - loc).dot(nor) < clear:
            v.co = loc + nor * clear
            moved.append(v.index)
    if moved and it:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table()
        for _ in range(it):
            new = {}
            for i in moved:
                v = bm.verts[i]
                nb = [e.other_vert(v).co for e in v.link_edges]
                if nb:
                    new[i] = v.co.lerp(sum(nb, Vector()) / len(nb), 0.4)
            for i, co in new.items():
                bm.verts[i].co = co
        bm.to_mesh(ob.data)
        bm.free()
    ob.data.update()
    return len(moved)


# --------------------------------------------------------------------------
# poids. Enveloppes par os : w = (rayon / distance au segment) ^ 4, quatre os
# au plus par sommet. Le « bone heat » de Blender échoue régulièrement sur un
# corps issu de metaballs, et ici on garde la main sur les cas qui comptent :
# la robe doit suivre les cuisses (sinon les jambes la traversent à la foulée)
# et la chevelure la tête, jamais les jambes.
# --------------------------------------------------------------------------
SEGMENTS = {
    "Hips":   ((0, -2.08, 104.0), (0, -2.20, 114.2), 12.0),
    "Spine":  ((0, -2.20, 114.2), (0, -1.20, 124.3), 10.5),
    "Spine1": ((0, -1.20, 124.3), (0, 0.17, 133.4), 10.5),
    "Spine2": ((0, 0.17, 133.4), (0, 2.68, 150.0), 11.0),
    "Neck":   ((0, 2.68, 150.0), (0, 1.00, 159.7), 5.0),
    "Head":   ((0, 1.00, 159.7), (0, -1.59, 177.5), 9.5),
}
for _s, _side in ((1, "Left"), (-1, "Right")):
    SEGMENTS[_side + "Shoulder"] = ((_s * 4.57, 2.79, 144.3), (_s * 15.16, 5.03, 143.8), 5.5)
    SEGMENTS[_side + "Arm"]      = ((_s * 15.16, 5.03, 143.8), (_s * 43.0, 5.03, 143.8), 5.2)
    SEGMENTS[_side + "ForeArm"]  = ((_s * 43.0, 5.03, 143.8), (_s * 71.33, 5.03, 143.8), 4.2)
    SEGMENTS[_side + "Hand"]     = ((_s * 71.33, 5.03, 143.8), (_s * 88.0, 4.50, 143.7), 4.5)
    SEGMENTS[_side + "UpLeg"]    = ((_s * 8.21, -0.48, 97.2), (_s * 8.21, -0.76, 52.9), 8.5)
    SEGMENTS[_side + "Leg"]      = ((_s * 8.21, -0.76, 52.9), (_s * 8.21, 2.22, 8.4), 6.2)
    SEGMENTS[_side + "Foot"]     = ((_s * 8.21, 2.22, 8.4), (_s * 8.21, -8.49, -0.3), 5.0)
    SEGMENTS[_side + "ToeBase"]  = ((_s * 8.21, -8.49, -0.3), (_s * 8.21, -17.8, -0.3), 4.0)
LIMBS = tuple(k for k in SEGMENTS if k.startswith(("Left", "Right")))


def _dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared == 0 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def bone_weights(co, allow, p=4.0):
    out = []
    for name in allow:
        a, b, r = SEGMENTS[name]
        d = _dist(co, Vector(a), Vector(b))
        # sans cette pénalité, l'intérieur d'une cuisse est happé par l'autre jambe
        if name in LIMBS and abs(co.x) > 3.0 and (a[0] + b[0]) * co.x < 0:
            d *= 1.8
        out.append((name, (r / max(d, 0.35)) ** p))
    out.sort(key=lambda kv: -kv[1])
    out = out[:4]
    tot = sum(w for _, w in out)
    return [(n, w / tot) for n, w in out if w / tot > 0.008]


def paint(sc, plan):
    for name, (allow, mode) in plan.items():
        ob = sc.objects.get(name)
        if not ob:
            continue
        ob.vertex_groups.clear()
        groups = {}
        for v in ob.data.vertices:
            if mode == "head" or (mode == "hair" and v.co.z > 157.0):
                ws = [("Head", 1.0)]
            else:
                ws = bone_weights(v.co, allow)
            for bn, w in ws:
                g = groups.get(bn) or groups.setdefault(bn, ob.vertex_groups.new(name="mixamorig:" + bn))
                g.add([v.index], w, 'REPLACE')


# --------------------------------------------------------------------------
def main():
    sc, arm = scene_and_armature()
    M = materials()
    ready = sc.objects.get("SingerMesh")          # maillage fourni de l'extérieur

    if ready:
        parts = ["SingerMesh"]
        plan = {"SingerMesh": (list(SEGMENTS), None)}
    else:
        body = build_body(sc, M)
        build_dress(sc, body, M)
        build_gloves(sc, M)
        build_shoes(sc, M)
        build_hair(sc, M)
        build_face(sc, body, M)
        for n, c in (("SingerDress", 0.7), ("SingerGloveL", 0.35), ("SingerGloveR", 0.35),
                     ("SingerHair", 0.45), ("SingerShoeL", 0.3), ("SingerShoeR", 0.3)):
            push_out(sc, body, n, c)
        ALL = list(SEGMENTS)
        ARMS = [k for k in SEGMENTS if k.endswith(("Shoulder", "Arm", "ForeArm", "Hand"))]
        FEET = [k for k in SEGMENTS if k.endswith(("Leg", "Foot", "ToeBase"))]
        plan = {
            "SingerBody": (ALL, None), "SingerDress": (ALL, None),
            "SingerGloveL": (ARMS, None), "SingerGloveR": (ARMS, None),
            "SingerShoeL": (FEET, None), "SingerShoeR": (FEET, None),
            "SingerHair": (["Head", "Neck", "Spine2"], "hair"),
        }
        for n in ("SingerEyeL", "SingerEyeR", "SingerIrisL", "SingerIrisR",
                  "SingerBrowL", "SingerBrowR", "SingerNose", "SingerLips"):
            plan[n] = (["Head"], "head")
        parts = list(plan)

    paint(sc, plan)

    bpy.ops.object.select_all(action='DESELECT')
    for n in parts:
        sc.objects[n].select_set(True)
    bpy.context.view_layer.objects.active = sc.objects[parts[0]]
    if len(parts) > 1:
        bpy.ops.object.join()
    singer = bpy.context.view_layer.objects.active
    singer.name = singer.data.name = "Singer"

    for m in list(singer.modifiers):
        singer.modifiers.remove(m)
    singer.parent = arm
    singer.matrix_parent_inverse = arm.matrix_world.inverted()
    singer.modifiers.new("Armature", 'ARMATURE').object = arm

    arm.scale = (0.01, 0.01, 0.01)        # cm -> m
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    singer.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_apply=False, export_yup=True, export_skins=True,
        export_morph=False, export_cameras=False, export_lights=False)
    print("singer.glb :", len(singer.data.vertices), "sommets,",
          len(singer.data.polygons), "faces,", len(bpy.data.actions), "clips")


if __name__ == "__main__":
    main()
