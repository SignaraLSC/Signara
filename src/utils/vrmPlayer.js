/**
 * vrmPlayer.js — reproductor de keyframes por cuaterniones (slerp), portado
 * de public/vrm-lab/index.html (playSolverAnim). Recibe el `vrm` cargado y
 * los keyframes que devuelve bakeSolver (ver vrmBaker.js).
 */
import * as THREE from 'three'

function quatOfEuler(e) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x || 0, e.y || 0, e.z || 0, 'XYZ'))
}

/**
 * Reproduce `kfs` (array de { duration, pose }) sobre los huesos del `vrm`.
 * Devuelve una función para cancelar la reproducción a medio camino.
 */
// Canales de expresión facial (boca/ojos) — pesos 0..1, van por
// expressionManager en vez de por hueso, así que se interpolan con lerp
// simple (no tiene sentido un slerp de cuaterniones para un escalar).
const EXPR_NAMES = ['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'surprised', 'angry', 'sad']

export function playSolverAnim(vrm, kfs, onDone) {
  const getBone = (n) => vrm.humanoid.getNormalizedBoneNode(n)
  // 'expr' no es un hueso — se excluye de la pista de cuaterniones y se
  // trata aparte (ver exprTracks más abajo).
  const names = [...new Set(kfs.flatMap((k) => Object.keys(k.pose)))].filter((n) => n !== 'expr')
  const nodes = {}
  names.forEach((n) => { nodes[n] = getBone(n) })
  const exprManager = vrm.expressionManager

  // Pista de cuaterniones por hueso: frame 0 = pose actual (reposo), luego
  // cada keyframe (arrastrando el último valor para huesos ausentes).
  const times = [0]
  const carry = {}
  const tracks = {}
  names.forEach((n) => {
    carry[n] = nodes[n] ? nodes[n].quaternion.clone() : new THREE.Quaternion()
    tracks[n] = [carry[n].clone()]
  })
  // Pista de expresiones: mismo patrón (arrastra el último valor conocido),
  // pero como números sueltos en vez de cuaterniones.
  const exprCarry = {}
  const exprTracks = {}
  EXPR_NAMES.forEach((n) => {
    exprCarry[n] = exprManager ? (exprManager.getValue(n) || 0) : 0
    exprTracks[n] = [exprCarry[n]]
  })
  let acc = 0
  for (const k of kfs) {
    acc += k.duration
    times.push(acc)
    for (const n of names) {
      if (k.pose[n]) carry[n] = quatOfEuler(k.pose[n])
      tracks[n].push(carry[n].clone())
    }
    EXPR_NAMES.forEach((n) => {
      if (k.pose.expr) exprCarry[n] = k.pose.expr[n] ?? 0
      exprTracks[n].push(exprCarry[n])
    })
  }
  const total = acc || 1
  const start = performance.now()
  let raf = null
  let cancelled = false
  function step(now) {
    if (cancelled) return
    const el = now - start
    if (el >= total) {
      for (const n of names) if (nodes[n]) nodes[n].quaternion.copy(tracks[n][tracks[n].length - 1])
      if (exprManager) EXPR_NAMES.forEach((n) => exprManager.setValue(n, exprTracks[n][exprTracks[n].length - 1]))
      onDone && onDone()
      return
    }
    let i = 0
    while (i < times.length - 1 && times[i + 1] <= el) i++
    const seg = Math.max(1, times[i + 1] - times[i])
    // SIEMPRE lineal aquí: la entrada/salida ya traen la aceleración/
    // desaceleración horneada en cómo se repartieron los pasos del IK
    // (transition() dentro de bakeSolver). Frenar/acelerar OTRA VEZ aquí
    // (por-tramo) causaba pausas y saltos de velocidad en cada frontera
    // entre los varios micro-tramos del IK.
    const tt = Math.min(1, Math.max(0, (el - times[i]) / seg))
    for (const n of names) if (nodes[n]) nodes[n].quaternion.slerpQuaternions(tracks[n][i], tracks[n][i + 1], tt)
    if (exprManager) {
      EXPR_NAMES.forEach((n) => {
        const v = exprTracks[n][i] + (exprTracks[n][i + 1] - exprTracks[n][i]) * tt
        exprManager.setValue(n, v)
      })
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => { cancelled = true; if (raf) cancelAnimationFrame(raf) }
}
