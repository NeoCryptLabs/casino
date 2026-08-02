const B = BABYLON;

export const V3 = (x, y, z) => new B.Vector3(x, y, z);
export const C3 = (r, g, b) => new B.Color3(r, g, b);
export const rnd = (a, b) => a + Math.random() * (b - a);
export const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** PBR material factory with sane defaults. */
export function pbr(name, scene, opt = {}) {
  const m = new B.PBRMetallicRoughnessMaterial(name, scene);
  m.baseColor = opt.color || C3(0.5, 0.5, 0.5);
  m.metallic = opt.metallic ?? 0;
  m.roughness = opt.roughness ?? 0.6;
  if (opt.emissive) m.emissiveColor = opt.emissive;
  if (opt.alpha !== undefined) { m.alpha = opt.alpha; m.transparencyMode = 2; }
  if (opt.backFaceCulling === false) m.backFaceCulling = false;
  return m;
}

/** Polished gold / brass (mis en cache par teinte). */
const goldCache = new Map();
export const gold = (scene, tint = 1) => {
  if (!goldCache.has(tint)) {
    goldCache.set(tint, pbr("gold" + tint, scene, {
      color: C3(0.86 * tint, 0.66 * tint, 0.28 * tint), metallic: 1, roughness: 0.19,
    }));
  }
  return goldCache.get(tint);
};

/** Draw on a canvas, return a Babylon texture. */
export function canvasTex(name, scene, w, h, draw, opt = {}) {
  const dt = new B.DynamicTexture(name, { width: w, height: h }, scene, true);
  const ctx = dt.getContext();
  // Une face vue de face rend l'image inversée horizontalement (u croît vers
  // la gauche de l'écran) : on pré-inverse le canvas pour que les textes se lisent.
  // `mirror`  : face vue de face (ex. face +Z d'une box) -> inversion horizontale
  // `flip180` : face vue de dos (ex. plan mural, backFaceCulling off) -> rotation 180°
  if (opt.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  if (opt.flip180) { ctx.translate(w, h); ctx.scale(-1, -1); }
  draw(ctx, w, h);
  if (opt.mirror || opt.flip180) ctx.setTransform(1, 0, 0, 1, 0, 0);
  dt.update(false);
  dt.hasAlpha = !!opt.alpha;
  if (opt.uScale) dt.uScale = opt.uScale;
  if (opt.vScale) dt.vScale = opt.vScale;
  dt.anisotropicFilteringLevel = 8;
  return dt;
}

/** Génère une normal map à partir d'un champ de hauteur procédural (bruit lissé). */
export function normalMap(name, scene, size = 256, freq = 26, strength = 2.2) {
  const h = new Float32Array(size * size);
  const g = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = Math.random();
  // lissage box 2 passes -> bruit organique
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            s += h[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        g[y * size + x] = s / 9;
      }
    }
    h.set(g);
  }
  return canvasTex(name, scene, size, size, (c, w) => {
    const img = c.createImageData(size, size), d = img.data;
    const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        d[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        d[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
        d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  }, { uScale: freq, vScale: freq });
}

/**
 * Ramène `from` sur la branche angulaire la plus proche de `to` (même angle à
 * 2π près). Sans ça, une interpolation linéaire entre deux angles éloignés de
 * plus d'un demi-tour part « à l'envers » et fait un 360°.
 */
export const nearestAngle = (from, to) =>
  from - Math.PI * 2 * Math.round((from - to) / (Math.PI * 2));

/** Idem, composante par composante, sur un Vector3 d'angles d'Euler. */
export const nearestEuler = (from, to) =>
  V3(nearestAngle(from.x, to.x), nearestAngle(from.y, to.y), nearestAngle(from.z, to.z));

/** Smooth float animation helper. */
export function animFloat(scene, obj, prop, from, to, frames, ease = true, onEnd) {
  const a = new B.Animation(
    "a" + Math.random(), prop, 60,
    B.Animation.ANIMATIONTYPE_FLOAT, B.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  a.setKeys([{ frame: 0, value: from }, { frame: frames, value: to }]);
  if (ease) { const e = new B.CubicEase(); e.setEasingMode(B.EasingFunction.EASINGMODE_EASEINOUT); a.setEasingFunction(e); }
  return scene.beginDirectAnimation(obj, [a], 0, frames, false, 1, onEnd);
}

export function animVec(scene, obj, prop, from, to, frames, mode = B.EasingFunction.EASINGMODE_EASEINOUT, onEnd) {
  const a = new B.Animation(
    "v" + Math.random(), prop, 60,
    B.Animation.ANIMATIONTYPE_VECTOR3, B.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  a.setKeys([{ frame: 0, value: from.clone() }, { frame: frames, value: to.clone() }]);
  const e = new B.CubicEase(); e.setEasingMode(mode); a.setEasingFunction(e);
  return scene.beginDirectAnimation(obj, [a], 0, frames, false, 1, onEnd);
}

/** Merge a list of meshes into one (for perf), keeping the first material. */
export function merge(list, name) {
  const m = B.Mesh.MergeMeshes(list, true, true, undefined, false, false);
  if (m) m.name = name;
  return m;
}
