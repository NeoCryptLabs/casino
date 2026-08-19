/**
 * OVERLAY DE MESURE — `?perf=1`.
 *
 * Répond à la seule question qui compte quand « ça laggue » : la frame est-elle
 * bornée par le CPU (draw calls, évaluation des meshes actifs, JS) ou par le
 * GPU (pixels) ? Sans cette mesure on optimise à l'aveugle — baisser la
 * résolution sur une machine CPU-bound ne change rien, par exemple.
 *
 * Tout vient de l'instrumentation Babylon ; le temps GPU exige l'extension
 * EXT_disjoint_timer_query (souvent absente) et s'affiche « n/d » sans elle.
 */
const B = () => BABYLON;

export function initPerf(scene, engine) {
  if (new URLSearchParams(location.search).get("perf") == null) return;

  const si = new (B()).SceneInstrumentation(scene);
  si.captureFrameTime = true;                 // scene.render(), côté CPU
  si.captureInterFrameTime = true;            // le reste du JS entre deux frames
  si.captureActiveMeshesEvaluationTime = true;
  si.captureRenderTargetsRenderTime = true;   // ombres, sonde, eau
  si.captureParticlesRenderTime = true;

  let ei = null;
  try {
    ei = new (B()).EngineInstrumentation(engine);
    ei.captureGPUFrameTime = true;
  } catch { /* extension timer absente : temps GPU indisponible */ }

  const el = document.createElement("div");
  el.id = "perfHud";
  el.style.cssText = "position:fixed;top:8px;right:8px;z-index:99999;"
    + "background:rgba(6,8,10,.78);color:#9fe8a0;font:11px/1.55 ui-monospace,monospace;"
    + "padding:8px 11px;border-radius:6px;pointer-events:none;white-space:pre;text-align:left;";
  document.body.appendChild(el);

  const ms = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + " ms";
  let acc = 0;
  scene.onAfterRenderObservable.add(() => {
    acc += engine.getDeltaTime();
    if (acc < 500) return;
    acc = 0;
    const fps = engine.getFps();
    const draws = si.drawCallsCounter.current;
    const render = si.frameTimeCounter.lastSecAverage;
    const between = si.interFrameTimeCounter.lastSecAverage;
    const evalT = si.activeMeshesEvaluationTimeCounter.lastSecAverage;
    const rtt = si.renderTargetsRenderTimeCounter.lastSecAverage;
    const parts = si.particlesRenderTimeCounter.lastSecAverage;
    const gpu = ei && ei.gpuFrameTimeCounter.lastSecAverage
      ? ei.gpuFrameTimeCounter.lastSecAverage / 1e6 : null;
    const cpu = render + between;
    // le fautif est celui dont le temps encadre la frame réelle (1000/fps)
    const verdict = gpu === null
      ? (fps >= 55 ? "fluide" : "CPU-bound (probable — temps GPU non mesurable)")
      : gpu > cpu * 1.2 ? "GPU-bound" : "CPU-bound";
    el.textContent =
      `${fps.toFixed(0).padStart(3)} FPS   ${verdict}\n`
      + `draw calls    ${String(draws).padStart(6)}\n`
      + `meshes actifs ${String(scene.getActiveMeshes().length).padStart(6)} / ${scene.meshes.length}\n`
      + `CPU render    ${ms(render).padStart(8)}\n`
      + `CPU JS/autre  ${ms(between).padStart(8)}\n`
      + `  éval actifs ${ms(evalT).padStart(8)}\n`
      + `  ombres/RTT  ${ms(rtt).padStart(8)}\n`
      + `  particules  ${ms(parts).padStart(8)}\n`
      + `GPU frame     ${(gpu === null ? "n/d" : ms(gpu)).padStart(8)}`;
  });
}
