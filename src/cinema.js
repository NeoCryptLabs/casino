/**
 * CINÉMA — les moments où le jeu s'empare du temps.
 *
 * Deux outils, un principe : la dramaturgie ne s'ajoute pas par-dessus l'image,
 * elle passe par le TEMPS lui-même.
 *
 *  - `flipMoment()`  la révélation de la carte cachée : le monde ralentit à
 *    26 %, la mise au point glisse de ma main vers la carte du croupier, le
 *    son s'étouffe comme sous l'eau. ~1,6 s réelles, puis tout revient.
 *  - `hitStop()`     l'arrêt sur image des jeux de combat : l'écran gèle
 *    ~90 ms à l'impact (la carte de trop). Le gel est un SAUT DE RENDU —
 *    la boucle tourne, on ne présente juste pas d'image.
 *
 * Le ralenti agit sur trois horloges à la fois — animations Babylon
 * (`animationTimeScale`), physique Havok (`setTimeStep`) et un passe-bas sur
 * tout le bus audio — parce qu'un ralenti qui n'affecte qu'une horloge se lit
 * comme un bug, pas comme un effet.
 */
import { lerp } from "./util.js";

export function createCinema({ scene, pipe, audio }) {
  const engine = scene.getEngine();
  let freezeUntil = 0;
  let moment = false;
  let punching = false;

  return {
    /** Interrogé par la boucle de rendu : true = ne pas présenter cette frame. */
    frozen() { return performance.now() < freezeUntil; },

    /** Arrêt sur image. À réserver aux impacts — pas plus d'un par événement. */
    hitStop(ms = 90) {
      freezeUntil = performance.now() + ms;
    },

    /**
     * Coup de zoom de victoire : la focale pince d'un coup (~90 ms) puis
     * relâche — le « punch-in » des jeux d'arcade. Relatif à la focale
     * courante, donc juste quel que soit le cadrage de la table.
     */
    winPunch(power = 1) {
      if (punching) return;
      punching = true;
      const cam = scene.activeCamera;
      const f0 = cam.fov;
      const dip = 0.065 * power;
      const IN = 0.09, OUT = 0.34;
      let e = 0;
      const obs = scene.onBeforeRenderObservable.add(() => {
        e += engine.getDeltaTime() / 1000;
        if (e < IN) cam.fov = f0 - dip * (e / IN);
        else if (e < IN + OUT) {
          const k = (e - IN) / OUT;
          cam.fov = f0 - dip * (1 - k) * (1 - k);
        } else {
          cam.fov = f0;
          scene.onBeforeRenderObservable.remove(obs);
          punching = false;
        }
      });
    },

    /** La révélation. Ne fait rien si un moment est déjà en cours. */
    flipMoment() {
      if (moment) return;
      moment = true;
      const phys = scene.getPhysicsEngine();
      const dof = pipe.depthOfFieldEnabled ? pipe.depthOfField : null;
      const f0 = dof ? dof.focusDistance : 0;
      const v0 = pipe.imageProcessing.vignetteWeight;

      scene.animationTimeScale = 0.26;
      try { phys?.setTimeStep((1 / 60) * 0.26); } catch { }
      audio.slowmo?.(true);

      let e = 0;
      const DUR = 1.15;                       // montée, en secondes RÉELLES
      const obs = scene.onBeforeRenderObservable.add(() => {
        // le delta de l'engine n'est PAS dilaté : le moment dure un temps
        // humain constant, quel que soit le facteur de ralenti
        e += engine.getDeltaTime() / 1000;
        const k = Math.min(1, e / DUR);
        const s = k * k * (3 - 2 * k);        // smoothstep
        if (dof) dof.focusDistance = lerp(f0, 2400, s);   // …vers le croupier
        pipe.imageProcessing.vignetteWeight = v0 + 2.2 * Math.sin(k * Math.PI);
        if (k < 1) return;

        scene.onBeforeRenderObservable.remove(obs);
        scene.animationTimeScale = 1;
        try { phys?.setTimeStep(1 / 60); } catch { }
        audio.slowmo?.(false);

        // la mise au point revient tranquillement sur ma main
        let e2 = 0;
        const back = scene.onBeforeRenderObservable.add(() => {
          e2 += engine.getDeltaTime() / 1000;
          const k2 = Math.min(1, e2 / 0.5);
          if (dof) dof.focusDistance = lerp(2400, f0, k2);
          if (k2 >= 1) { scene.onBeforeRenderObservable.remove(back); moment = false; }
        });
      });
    },
  };
}
