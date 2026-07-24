/**
 * vrmBaker.js — bakeSolver, portado de public/vrm-lab/index.html (bakeSolver +
 * sus funciones auxiliares: IK de 2 huesos, evitar-torso, waypoint de
 * entrada/salida, orientación de mano). En el lab estas funciones leían `vrm`
 * de una variable de módulo global del HTML; aquí se instancian por avatar vía
 * createBaker(vrm), sin estado global compartido entre componentes.
 */
import * as THREE from 'three'
import {
  CONFIG,
  frameToArmDirs,
  frameFingers,
  frameWristBasis,
  frameHandBasis,
  despikeWristSeq,
  lockWristHemisphereSeq,
  despikeVec3Seq,
  frameHeadRotation,
  smoothHeadSeq,
  activeArms,
  smoothPoseSeq,
  smoothVecSeq,
  trimLeadIn,
  trimTrailOut,
} from './vrmSolver.js'
import { setIdlePose } from './vrmIdlePose.js'
import { smoothFaceSeq, lerpExpr, NEUTRAL_EXPR } from './vrmFaceSolver.js'

export function createBaker(vrm) {
  const getBone = (n) => vrm.humanoid.getNormalizedBoneNode(n)

  const LEAD_IN_MS = 280 // entrada reposo → seña (antes 400 ms se sentía lenta)
  const SIGN_SLOWDOWN = 1.0 // ritmo del grabado (antes 1.15 se sentía “arrastrado”)

  // Apunta `bone` para que su "hacia el hijo" mire a targetWorld (Vector3).
  function aimBone(bone, childBone, targetWorld) {
    if (!bone || !childBone) return
    const fBone = childBone.position.clone().normalize() // forward local en reposo
    const pq = new THREE.Quaternion()
    bone.parent.getWorldQuaternion(pq) // rotación mundo del padre
    const tLocal = targetWorld.clone().applyQuaternion(pq.clone().invert()).normalize()
    bone.quaternion.setFromUnitVectors(fBone, tLocal)
  }

  function eulerOf(b) {
    return { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }
  }
  function eulerToQuat(e) {
    e = e || { x: 0, y: 0, z: 0 }
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z, 'XYZ'))
  }
  // Giro real (slerp de cuaterniones), no ángulos sueltos: interpolar Euler
  // componente a componente puede tomar "el camino largo" cuando las dos
  // orientaciones son muy distintas — la muñeca daba un giro brusco de golpe
  // en la entrada/salida. Slerp siempre toma el camino corto y suave.
  function slerpEuler(a, b, t) {
    const q = new THREE.Quaternion().slerpQuaternions(eulerToQuat(a), eulerToQuat(b), t)
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
    return { x: e.x, y: e.y, z: e.z }
  }
  function lerpEuler(a, b, t) {
    // para dedos: ángulos pequeños, lerp simple está bien
    a = a || { x: 0, y: 0, z: 0 }
    b = b || { x: 0, y: 0, z: 0 }
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
  }

  // Orienta la mano con giro completo (dirección + normal de palma). Toma el
  // "reposo" del rig (hacia el dedo medio, y palma vía índice×meñique) y lo
  // rota para que calce con fwd/normal objetivo del 3D real.
  function basisMat(fwd, nrm) {
    const f = fwd.clone().normalize()
    const n = nrm.clone().sub(f.clone().multiplyScalar(nrm.dot(f))).normalize()
    const t = new THREE.Vector3().crossVectors(f, n)
    return new THREE.Matrix4().makeBasis(f, n, t)
  }
  function aimHandFull(B, targetFwd, targetNormal, sideSign, rollRad = CONFIG.wristRoll) {
    if (!B.hd || !B.mid || !B.idx || !B.lit) return
    B.hd.quaternion.identity()
    vrm.scene.updateMatrixWorld(true)
    const hp = B.hd.getWorldPosition(new THREE.Vector3())
    const restFwd = B.mid.getWorldPosition(new THREE.Vector3()).sub(hp)
    const iP = B.idx.getWorldPosition(new THREE.Vector3()).sub(hp)
    const lP = B.lit.getWorldPosition(new THREE.Vector3()).sub(hp)
    const restNrm = new THREE.Vector3().crossVectors(iP, lP)
    const Rrest = basisMat(restFwd, restNrm)
    const Rtgt = basisMat(new THREE.Vector3(...targetFwd), new THREE.Vector3(...targetNormal))
    const qDelta = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().multiplyMatrices(Rtgt, Rrest.clone().invert()),
    )
    const pq = new THREE.Quaternion()
    B.hd.parent.getWorldQuaternion(pq)
    B.hd.quaternion.copy(pq.clone().invert().multiply(qDelta).multiply(pq))
    // Ajuste de giro de palma calibrable, alrededor del eje del antebrazo
    // (hacia el nudillo medio). Signo espejado por lado.
    if (rollRad) {
      const rollAxis = B.mid.position.clone().normalize()
      B.hd.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(rollAxis, rollRad * sideSign))
    }
  }

  // EMA sobre una secuencia de escalares (p.ej. fracción de extensión del
  // brazo). Null reinicia el filtro (brazo inactivo en ese frame).
  function smoothScalarSeqLocal(vals, alpha) {
    let acc = null
    return vals.map((v) => {
      if (v == null) {
        acc = null
        return null
      }
      acc = acc == null ? v : acc + alpha * (v - acc)
      return acc
    })
  }

  // EMA sobre vectores SIN renormalizar (conserva la magnitud, p.ej. wristOffset
  // en metros — a diferencia de smoothVecSeq que los deja unitarios).
  function smoothVecRaw(vecs, alpha = CONFIG.dirSmooth) {
    let acc = null
    return vecs.map((v) => {
      if (!v) {
        acc = null
        return null
      }
      acc = acc == null
        ? [v[0], v[1], v[2]]
        : [acc[0] + alpha * (v[0] - acc[0]), acc[1] + alpha * (v[1] - acc[1]), acc[2] + alpha * (v[2] - acc[2])]
      return [acc[0], acc[1], acc[2]]
    })
  }

  function smoothstep01(t) {
    t = Math.max(0, Math.min(1, t))
    return t * t * (3 - 2 * t)
  }

  // Cinemática inversa de 2 huesos: dado el hombro S y el objetivo de muñeca
  // T (y las longitudes L1=brazo, L2=antebrazo), devuelve la posición del codo
  // E. `poleDir` desambigua hacia dónde apunta el codo. Así la muñeca LLEGA a T.
  // hScale amortigua el componente de flexión (h) cerca de la extensión
  // completa: ahí h ya es pequeño geométricamente, pero su DIRECCIÓN (dada
  // por poleDir) sigue siendo sensible a errores de tracking — un pequeño
  // ruido en el pole se traduce en un salto visible del codo aunque el
  // objetivo T se mueva perfectamente suave. hScale=0 fuerza el codo sobre
  // la línea recta hombro→muñeca (sin ambigüedad posible).
  function solveIK(S, T, L1, L2, poleDir, hScale = 1) {
    const n = T.clone().sub(S)
    let d = n.length()
    if (d < 1e-6) {
      n.set(0, -1, 0)
      d = 1e-6
    }
    n.normalize()
    d = Math.max(Math.abs(L1 - L2) + 1e-4, Math.min(L1 + L2 - 1e-4, d))
    const a = (d * d + L1 * L1 - L2 * L2) / (2 * d)
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a)) * hScale
    let perp = poleDir.clone().addScaledVector(n, -poleDir.dot(n))
    if (perp.lengthSq() < 1e-8) {
      perp = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y)
      if (perp.lengthSq() < 1e-8) perp.set(1, 0, 0)
    }
    perp.normalize()
    return S.clone().addScaledVector(n, a).addScaledVector(perp, h)
  }

  function bakeSolver(rawDataset, { direction = 'neutral' } = {}) {
    // Recorta preparación al inicio Y bajada de vuelta al reposo al final,
    // si quedaron grabadas por error (ambas se sintetizan solas más abajo).
    // IMPORTANTE: trim* a veces devuelve el MISMO objeto (si no recorta).
    // Nunca mutar frames in-place — sharedDatasetCache reusa este JSON y un
    // AYUDAME (reverse) dejaba AYUDA/derivados permanentemente al revés.
    const trimmed = trimTrailOut(trimLeadIn(rawDataset))
    // 'self' (AYUDAME): la seña grabada ("AYUDA") YA es un empujón desde
    // cerca del cuerpo hacia afuera — reproducirla AL REVÉS es literalmente
    // "jalar hacia el pecho" (confirmado por el usuario 2026-07-21). Esto
    // reemplaza el redirect geométrico sintético que se probó antes: usa la
    // profundidad REAL grabada (arranca donde la toma terminaba, termina
    // donde empezaba) en vez de un punto inventado que no se percibía bien
    // en pantalla. Se invierte ANTES de todo el pipeline (frames crudos) —
    // así dedos/cabeza/cara quedan consistentes con el movimiento invertido,
    // no solo la muñeca. Solo AYUDAME usa 'self'; AYUDA y el resto NO.
    const dataset = (direction === 'self' && Array.isArray(trimmed.frames))
      ? { ...trimmed, frames: [...trimmed.frames].reverse() }
      : trimmed
    const arms = activeArms(dataset)
    // Overrides mínimos de giro de palma (solo donde el +45° global no basta).
    // MAL: pulgar abajo → hace falta ~−100° (menos de −90°).
    const token = (dataset.token || '').toUpperCase()
    const WRIST_OVERRIDES = { MAL: (-100 * Math.PI) / 180 }
    // Overrides calibrados contra la fuente 'pose' — no aplican si se está
    // probando 'hand' (esa fuente tiene su propio giro base, wristRollHand).
    const bakeWristRoll = CONFIG.wristSource === 'hand'
      ? CONFIG.wristRollHand
      : (token in WRIST_OVERRIDES ? WRIST_OVERRIDES[token] : CONFIG.wristRoll)
    const R = {
      up: getBone('rightUpperArm'), lo: getBone('rightLowerArm'),
      hd: getBone('rightHand'), mid: getBone('rightMiddleProximal'),
      idx: getBone('rightIndexProximal'), lit: getBone('rightLittleProximal'),
    }
    const L = {
      up: getBone('leftUpperArm'), lo: getBone('leftLowerArm'),
      hd: getBone('leftHand'), mid: getBone('leftMiddleProximal'),
      idx: getBone('leftIndexProximal'), lit: getBone('leftLittleProximal'),
    }
    // Longitudes de hueso (brazo/antebrazo) y centro de hombros en reposo —
    // constantes, para el IK. C_avatar es la referencia común de posición.
    setIdlePose(vrm)
    vrm.scene.updateMatrixWorld(true)
    for (const B of [R, L]) {
      const up = B.up.getWorldPosition(new THREE.Vector3())
      const lo = B.lo.getWorldPosition(new THREE.Vector3())
      const hd = B.hd.getWorldPosition(new THREE.Vector3())
      B.L1 = lo.distanceTo(up)
      B.L2 = hd.distanceTo(lo)
    }
    const C_avatar = new THREE.Vector3()
      .addVectors(R.up.getWorldPosition(new THREE.Vector3()), L.up.getWorldPosition(new THREE.Vector3()))
      .multiplyScalar(0.5)

    // ── Evitar que la muñeca atraviese el torso ─────────────────────────────
    // El IK no "sabe" que hay un cuerpo — solo apunta hacia el objetivo, así
    // que en señas de dos manos que se juntan cerca del pecho (GRACIAS) el
    // objetivo puede caer DETRÁS de donde está el torso y la mano lo
    // atraviesa. Se define una caja simple alrededor del torso (ancho a
    // partir de los hombros, medido en ESTE avatar) y si el objetivo cae
    // dentro en X/Y pero muy atrás en Z, se empuja hacia adelante justo lo
    // necesario para quedar por delante del pecho. General: aplica a
    // cualquier seña, no solo GRACIAS.
    const shoulderHalfW = C_avatar.distanceTo(R.up.getWorldPosition(new THREE.Vector3()))
    const TORSO_HALF_WIDTH = shoulderHalfW * 0.75 // ancho del torso (X)
    const TORSO_UP = shoulderHalfW * 0.35 // cuánto sube sobre los hombros (Y)
    const TORSO_DOWN = shoulderHalfW * 2.0 // cuánto baja hacia la cadera (Y)
    const TORSO_MIN_FWD = shoulderHalfW * 0.4 // grosor del pecho — clearance mínimo (Z)
    function avoidTorso(T) {
      const off = T.clone().sub(C_avatar)
      const insideWidth = Math.abs(off.x) < TORSO_HALF_WIDTH
      const insideHeight = off.y < TORSO_UP && off.y > -TORSO_DOWN
      if (insideWidth && insideHeight && off.z < TORSO_MIN_FWD) {
        off.z = TORSO_MIN_FWD
        return C_avatar.clone().add(off)
      }
      return T
    }
    // Igual que avoidTorso pero solo pregunta (no corrige) — se usa en la
    // transición de ENTRADA/SALIDA para decidir si el camino recto
    // reposo↔seña pasaría por dentro del torso y hace falta un punto
    // intermedio que lo rodee (ver waypointFor más abajo).
    function insideTorso(T) {
      const off = T.clone().sub(C_avatar)
      return Math.abs(off.x) < TORSO_HALF_WIDTH && off.y < TORSO_UP && off.y > -TORSO_DOWN && off.z < TORSO_MIN_FWD
    }
    // Ramp 0→1 entre a y b (suave; evita cortes duros 0/1).
    function soft01(v, a, b) {
      if (b === a) return v >= b ? 1 : 0
      return Math.max(0, Math.min(1, (v - a) / (b - a)))
    }
    // Zona cara/cuello con bordes SUAVES. Antes un umbral duro (p.ej. x>0.18
    // → weight=0) soltaba de golpe la atracción al cuello y la mano “caía”
    // en un frame — tirón que rompe SED y similares.
    function neckZoneFromOffset(wo) {
      if (!wo || wo.length < 3) return 0
      const x = Math.abs(wo[0]), y = wo[1], z = wo[2]
      const wx = 1 - soft01(x, 0.11, 0.24)
      const wy = soft01(y, -0.01, 0.02) * (1 - soft01(y, 0.26, 0.40))
      const wz = soft01(z, 0.08, 0.14) * (1 - soft01(z, 0.40, 0.56))
      return Math.max(0, Math.min(1, wx * wy * wz))
    }
    function neckZoneWeight(T, wo) {
      const fromOff = neckZoneFromOffset(wo)
      if (fromOff > 0.001) return fromOff
      const off = T.clone().sub(C_avatar)
      const nx = Math.abs(off.x) / (shoulderHalfW * 1.25)
      const wx = 1 - soft01(nx, 0.55, 1.05)
      const wy = soft01(off.y, -shoulderHalfW * 0.05, shoulderHalfW * 0.08)
        * (1 - soft01(off.y, shoulderHalfW * 1.6, shoulderHalfW * 2.4))
      const wz = soft01(off.z, shoulderHalfW * 0.08, shoulderHalfW * 0.18)
        * (1 - soft01(off.z, shoulderHalfW * 2.6, shoulderHalfW * 3.6))
      return Math.max(0, Math.min(1, wx * wy * wz))
    }
    // Atrae la muñeca hacia la garganta. weight debe venir YA suavizado en el
    // tiempo (ver smoothNeckWeightSeq) para no soltar de golpe.
    function pullWristToNeck(T, weight) {
      if (weight < 0.02) return T
      const pull = (CONFIG.wristNeckPull ?? 0.42) * weight
      const throat = new THREE.Vector3(0, shoulderHalfW * 0.32, shoulderHalfW * 0.55)
      const off = T.clone().sub(C_avatar)
      off.lerp(throat, pull)
      return C_avatar.clone().add(off)
    }
    // ── Verbos direccionales (Fase 2 — ver src/utils/directionalVerbs.js) ──
    // Misma idea que pullWristToNeck (acercar el objetivo de la muñeca hacia
    // un punto fijo en el espacio 3D relativo al cuerpo), pero con un peso
    // CONSTANTE durante TODA la seña — a diferencia del asistente de cuello,
    // que solo se activa cuando la mano ya pasa cerca de la zona, acá se
    // redirige la seña completa, sea cual sea su trayectoria grabada.
    // Los puntos son honestos sobre lo que hoy se puede saber con certeza:
    // 'self' (hacia el propio pecho) y 'listener' (hacia adelante, como
    // alcanzando al interlocutor) son direcciones sin ambigüedad. 'third'
    // (hacia una tercera persona, ej. "ayúdalo") es un genérico FIJO a la
    // izquierda de pantalla (mundo -X — ver "Marco del avatar" al inicio de
    // vrmSolver.js) — sin la Fase 3 (memoria de a quién ubicó el señante en
    // el espacio) no hay forma de saber el lado REAL, así que esto es
    // deliberadamente aproximado, no la dirección gramaticalmente correcta.
    // 'group_self' (AYUDANOS) es distinto de los demás: no es un punto fijo,
    // es un BARRIDO — el objetivo se desplaza de un lado de pantalla al otro
    // a lo largo del cuadro actual (i) sobre el total (n), imitando "de un
    // lado hacia el otro frente al pecho" (semicírculo corto) en vez de
    // acercar/alejar a un solo punto. Por eso los targets reciben (i, n) —
    // los demás simplemente lo ignoran (son estáticos).
    // 'self' NO está acá — se resuelve invirtiendo los frames grabados (ver
    // arriba, antes de `arms`), no con un punto geométrico sintético.
    // 'listener': el Z puro (adelante/atrás) casi no se percibe con la
    // cámara de frente — empujar más profundo solo hace la mano un poco más
    // chica en pantalla, no da sensación de alcance (reportado 2026-07-21,
    // con AYUDA real la profundidad "no se veía"). Confirmado con el
    // usuario: sumarle un componente hacia ARRIBA además de adelante da la
    // "ilusión de cercanía" — un movimiento diagonal (arriba+adelante) SÍ es
    // legible en pantalla, a diferencia del Z puro. Y sube de 0.05 (casi
    // nula) a 0.5.
    const DIRECTION_TARGETS = {
      listener: () => new THREE.Vector3(0, shoulderHalfW * 0.5, shoulderHalfW * 1.0),
      // 'third' (AYUDALO) NO va aquí: bake = neutral; solo pose.spine/chest.
      group_self: (i, n) => {
        const t = n > 1 ? i / (n - 1) : 0.5 // 0..1 a lo largo de la seña
        // Smoothstep: velocidad más pareja en el centro (sin “traba” percibida
        // cuando el barrido lineal se sumaba a un empujón natural que frena).
        const ts = t * t * (3 - 2 * t)
        const sweepX = (0.5 - ts) * 2 * shoulderHalfW * 0.85 // de +0.85 a -0.85
        // Z más adelante: el brazo no “entra” al pecho a mitad del barrido.
        return new THREE.Vector3(sweepX, shoulderHalfW * 0.08, shoulderHalfW * 0.58)
      },
    }
    // Asimétrico: entra rápido a la zona, SALE lento — evita el tirón al
    // alejar un poco la mano de la cabeza.
    function smoothNeckWeightSeq(ws, attack = 0.55, release = 0.14) {
      let acc = 0
      return ws.map((w) => {
        const t = w == null ? 0 : w
        const a = t > acc ? attack : release
        acc += a * (t - acc)
        return acc < 0.015 ? 0 : acc
      })
    }
    // Cuando las dos manos se apilan (p.ej. GRACIAS: una en barbilla, otra
    // debajo), la de ABAJO no debe meterse en el pecho. Se corrige: misma X
    // aprox., Y separada, y la baja un poco más al frente (+Z).
    // NO aplicar a manos LADO A LADO (FAMILIA, etc.): ahí hay mucho ΔX y poco
    // ΔY — forzar pila las dejaba una sobre otra aunque la grabación no.
    function stackHands(tg) {
      if (!tg.right || !tg.left) return
      const lo = tg.right.T.y <= tg.left.T.y ? 'right' : 'left'
      const hi = lo === 'right' ? 'left' : 'right'
      const hiT = tg[hi].T
      const loT = tg[lo].T
      if (hiT.distanceTo(loT) > shoulderHalfW * 1.35) return
      const dx = Math.abs(hiT.x - loT.x)
      const dy = Math.abs(hiT.y - loT.y)
      // Más separación horizontal que vertical → lado a lado, no pila.
      if (dx >= dy && dx > shoulderHalfW * 0.18) return
      const sepY = shoulderHalfW * 0.16
      const minFwdLo = shoulderHalfW * 0.58 // clearance pecho para la mano baja
      const stackZ = shoulderHalfW * 0.08 // baja un poco más hacia cámara
      // Alinear bajo la mano alta y mantener separación vertical.
      loT.x += (hiT.x - loT.x) * 0.55
      if (hiT.y - loT.y < sepY) loT.y = hiT.y - sepY
      // Mano baja delante del tronco (aunque esté bajo el pecho / fuera de TORSO_UP).
      const off = loT.clone().sub(C_avatar)
      if (Math.abs(off.x) < shoulderHalfW * 0.95 && off.y > -TORSO_DOWN && off.z < minFwdLo) {
        off.z = minFwdLo
        loT.copy(C_avatar.clone().add(off))
      }
      // Que no quede detrás de la mano alta (atraviesa hacia el pecho).
      if (loT.z < hiT.z + stackZ) loT.z = hiT.z + stackZ
    }
    // FAMILIA y similares: manos lado a lado a la misma altura. MediaPipe
    // suele dejar ~3–5 cm de sesgo vertical entre muñecas; en el avatar se
    // nota como “una más baja”. Nivelamos Y al promedio (solo configuración
    // lateral — no toca GRACIAS / apiladas).
    function levelSideBySideHands(tg) {
      if (!tg.right || !tg.left) return
      const a = tg.right.T
      const b = tg.left.T
      if (a.distanceTo(b) > shoulderHalfW * 1.35) return
      const dx = Math.abs(a.x - b.x)
      const dy = Math.abs(a.y - b.y)
      if (dx < dy || dx <= shoulderHalfW * 0.18) return
      const midY = (a.y + b.y) * 0.5
      a.y = midY
      b.y = midY
    }
    const frames = dataset.frames || []
    // 1) Datos crudos por frame: IK (wristDir, reachFrac, pole) + muñeca + dedos.
    const rawDirs = frames.map((f) => frameToArmDirs(f, arms))
    // Base de la muñeca: 'hand' (frameHandBasis, 21 landmarks) es la fuente por
    // defecto para todas las señas (ver CONFIG.wristSource en vrmSolver.js).
    // NEAR_FACE_SIGNS fuerza frameHandBasis en señas puntuales aunque la fuente
    // global fuera 'pose' — hoy es redundante con wristSource='hand' pero se
    // deja por si algún día se vuelve a 'pose' como default.
    const NEAR_FACE_SIGNS = new Set(['HOLA'])
    const useHandBasis = CONFIG.wristSource === 'hand' || NEAR_FACE_SIGNS.has((dataset.token || '').toUpperCase())
    const rawWri = frames.map((f) => {
      const pb = frameWristBasis(f, arms)
      const hb = frameHandBasis(f, arms)
      const primary = useHandBasis ? hb : pb
      const fallback = useHandBasis ? pb : hb
      const out = {}
      if (primary.right || fallback.right) out.right = primary.right || fallback.right
      if (primary.left || fallback.left) out.left = primary.left || fallback.left
      return out
    })
    // Repara pérdidas momentáneas de tracking de mano (1-2 frames sueltos
    // donde el giro se "invierte" de golpe y vuelve) — ver despikeWristSeq.
    // Luego lock de hemisferio: evita flip sostenido de la palma a mitad
    // (AYUDA/AYUDANOS se trababan en el barrido cuando la normal se invertía).
    for (const side of ['right', 'left']) {
      const seq = rawWri.map((r) => r[side] || null)
      const cleaned = lockWristHemisphereSeq(despikeWristSeq(seq))
      cleaned.forEach((v, i) => { if (v) rawWri[i][side] = v })
    }
    const rawFing = frames.map((f) => frameFingers(f, arms))
    // Cabeza (Fase 3): nariz/orejas de pose_world → yaw/pitch. Huecos (mano
    // tapando la cara, detección floja) heredan el último valor válido, igual
    // que el blindaje de bordes de los brazos — nunca deja el canal "vacío".
    let lastHeadRaw = null
    const rawHead = frames.map((f) => {
      const r = frameHeadRotation(f)
      if (r) lastHeadRaw = r
      return r || lastHeadRaw
    })
    const headSmooth = smoothHeadSeq(rawHead)
    const headEuler = (h) => (!h ? { x: 0, y: 0, z: 0 } : {
      [CONFIG.headYawAxis]: h.yaw,
      [CONFIG.headPitchAxis]: h.pitch,
    })

    // Cara (boca/ojos/cejas): landmarks → pesos de expresión VRM
    // (aa/ih/ou/ee/oh, blink, surprised, angry). Ver vrmFaceSolver.js.
    const exprSmooth = smoothFaceSeq(frames)

    // 2) Suavizar antes de orientar (mata tembleque/saltos).
    const pick = (arr, side, key) => arr.map((r) => (r[side] ? r[side][key] : null))
    const put = (arr, side, key, seq) => arr.forEach((r, i) => { if (r[side]) r[side][key] = seq[i] })
    const median = (nums) => {
      const s = nums.filter((v) => v != null).slice().sort((a, b) => a - b)
      if (!s.length) return null
      const m = s.length >> 1
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    // recArmLen (brazo+antebrazo medido en el video) es una constante
    // ANATÓMICA de la persona — no cambia durante la toma. Suavizarlo
    // cuadro-a-cuadro deja pasar caídas de profundidad (oclusión al cruzar
    // las manos frente al pecho, típico en señas de 2 manos como GRACIAS):
    // una caída de ~20% en recArmLen dispara la escala del objetivo de
    // muñeca y el codo se abre hacia afuera y regresa — el "tirón". Usamos
    // en cambio la MEDIANA de toda la toma como referencia fija por brazo
    // (robusta a esos frames sueltos con profundidad mal estimada).
    const armLenRef = {}
    for (const side of ['right', 'left']) {
      armLenRef[side] = median(pick(rawDirs, side, 'recArmLen'))
      const armLen = armLenRef[side] || 0.5
      // Despike ANTES de suavizar (posición y codo, no solo orientación de
      // muñeca — ver despikeVec3Seq): en señas de dos manos muy juntas
      // (ej. AYUDA) MediaPipe puede perder/confundir una mano por 1-2 frames
      // por oclusión; sin esto, smoothVecSeq/smoothVecRaw solo promedian el
      // salto en vez de rechazarlo, y se ve como un brinco. Umbral de
      // wristOffset relativo al brazo de la persona (0.35×): un salto de más
      // de un tercio del largo del brazo en 1 frame a 30fps no es un
      // movimiento real. Umbral de pole (unitario) en distancia euclidiana
      // ≈ mismo corte de 55° que despikeWristSeq (cuerda de 55° ≈ 0.92).
      put(rawDirs, side, 'pole', despikeVec3Seq(pick(rawDirs, side, 'pole'), 0.92))
      put(rawDirs, side, 'wristOffset', despikeVec3Seq(pick(rawDirs, side, 'wristOffset'), armLen * 0.35))
      // poleSlow: versión MUY suavizada del pole (codo), usada solo cuando el
      // brazo está cerca de la extensión completa (ver PASO C) — ahí el pole
      // "normal" (wristSmooth) es ambiguo/ruidoso porque casi cualquier
      // dirección de codo satisface la muñeca por igual, y un pequeño error
      // de tracking se traduce en un salto grande del codo (bug original de
      // singularidad IK, aquí DENTRO de la seña, no solo en la transición).
      put(rawDirs, side, 'poleSlow', smoothVecSeq(pick(rawDirs, side, 'pole'), CONFIG.wristSmooth * 0.35))
      put(rawDirs, side, 'pole', smoothVecSeq(pick(rawDirs, side, 'pole'), CONFIG.wristSmooth))
      put(rawDirs, side, 'wristOffset', smoothVecRaw(pick(rawDirs, side, 'wristOffset'), CONFIG.posSmooth))
      put(rawWri, side, 'fwd', smoothVecSeq(pick(rawWri, side, 'fwd'), CONFIG.wristSmooth))
      put(rawWri, side, 'normal', smoothVecSeq(pick(rawWri, side, 'normal'), CONFIG.wristSmooth))
    }
    const fingSmooth = smoothPoseSeq(rawFing, CONFIG.dirSmooth)

    // 3a) Pre-pasada: calcular el objetivo de muñeca (con atracción) de TODOS
    // los frames primero, y con eso la fracción de extensión del brazo. La
    // extensión puede cambiar rápido de un frame a otro incluso con datos
    // limpios (movimiento real y rápido); si el amortiguado de h/pole (ver
    // solveIK) reacciona al valor INSTANTÁNEO, puede pasar de "sin
    // amortiguar" a "amortiguado del todo" en un solo frame — eso es en sí
    // mismo un salto. Por eso suavizamos la SECUENCIA de extensión en el
    // tiempo antes de decidir cuánto amortiguar, y así la transición hacia
    // el modo "brazo recto" es siempre gradual.
    // 3a) Objetivos de muñeca SIN atracción a cuello todavía — guardamos el
    // weight crudo. Luego suavizamos el weight en el tiempo (sale lento) y
    // recién ahí jalamos; si jaláramos con el weight crudo, al rozar el borde
    // de la zona la mano caía de golpe.
    const allTg = []
    for (let i = 0; i < frames.length; i++) {
      const dirs = rawDirs[i]
      const tg = {}
      for (const [B, d, name] of [[R, dirs.right, 'right'], [L, dirs.left, 'left']]) {
        if (!d) continue
        const S = B.up.getWorldPosition(new THREE.Vector3()) // hombro (fijo, no depende de la pose)
        const scale = (B.L1 + B.L2) / (armLenRef[name] || d.recArmLen)
        let T = C_avatar.clone().addScaledVector(new THREE.Vector3(...d.wristOffset), scale)
        T = avoidTorso(T)
        const neckW = neckZoneWeight(T, d.wristOffset)
        tg[name] = { B, d, S, T, neckW }
      }
      if (tg.right && tg.left) {
        const gap = tg.right.T.distanceTo(tg.left.T)
        const near = 1.0 * (R.L1 + R.L2)
        if (gap < near) {
          const mid = tg.right.T.clone().add(tg.left.T).multiplyScalar(0.5)
          const pull = CONFIG.handAttract * (1 - gap / near)
          tg.right.T.lerp(mid, pull)
          tg.left.T.lerp(mid, pull)
          tg.right.T.copy(avoidTorso(tg.right.T))
          tg.left.T.copy(avoidTorso(tg.left.T))
        }
        stackHands(tg)
        levelSideBySideHands(tg)
        for (const name of ['right', 'left']) {
          if (!tg[name]) continue
          tg[name].neckW = Math.max(
            tg[name].neckW || 0,
            neckZoneWeight(tg[name].T, tg[name].d?.wristOffset),
          )
        }
      }
      allTg.push(tg)
    }
    // Suavizar weight / atracción a cuello solo en whitelist (TENGO_SED).
    // En HOLA la mano en la sien no debe jalarse al cuello ni alzar cabeza.
    const neckAssistList = CONFIG.headNeckAssistTokens
    const neckTok = (dataset.token || '').toUpperCase()
    const useNeckAssist = Array.isArray(neckAssistList) && neckAssistList.length > 0
      && neckAssistList.some((t) => neckTok === String(t).toUpperCase() || neckTok.includes(String(t).toUpperCase()))
    for (const name of ['right', 'left']) {
      const rawW = allTg.map((tg) => (tg[name] ? tg[name].neckW : null))
      const smoothW = useNeckAssist ? smoothNeckWeightSeq(rawW) : rawW.map(() => 0)
      for (let i = 0; i < allTg.length; i++) {
        const t = allTg[i][name]
        if (!t) continue
        t.neckW = smoothW[i] || 0
        if (useNeckAssist && t.neckW > 0.02) t.T = pullWristToNeck(t.T, t.neckW)
      }
    }
    // Verbo direccional: re-dirige TODA la seña hacia el destino pedido
    // (ver DIRECTION_TARGETS arriba). Peso constante — no depende de zona
    // ni de proximidad, a diferencia del asistente de cuello.
    //
    // El pole (dirección del codo, ver frameToArmDirs en vrmSolver.js) viene
    // de la trayectoria ORIGINAL grabada — al redirigir T lejos de su
    // posición original (p.ej. 'self' tira la muñeca hacia el pecho, casi
    // opuesto a como se grabó "AYUDA" empujando hacia afuera), el pole viejo
    // puede quedar casi paralelo a la nueva dirección muñeca-hombro. solveIK
    // proyecta el pole sobre el plano perpendicular a esa dirección (variable
    // `perp`); si el pole es casi paralelo, esa proyección casi se anula y
    // cualquier ruido de un frame a otro decide de qué lado cae — eso se vio
    // como un salto violento del antebrazo entre frames (~180°) al probar con
    // AYUDA real (2026-07-21). Fix: blindar el pole hacia una dirección de
    // codo genérica y estable (codo hacia abajo y levemente hacia afuera del
    // cuerpo) con el mismo peso `pull`, en vez de dejar el original intacto.
    const CANONICAL_POLE = {
      right: new THREE.Vector3(-0.4, -1, 0.1).normalize(),
      left: new THREE.Vector3(0.4, -1, 0.1).normalize(),
    }
    function blendPole(vec3arr, canon, weight) {
      if (!vec3arr) return vec3arr
      const cur = new THREE.Vector3(...vec3arr)
      if (cur.lengthSq() < 1e-8) return vec3arr
      cur.normalize().lerp(canon, weight).normalize()
      return [cur.x, cur.y, cur.z]
    }
    const rotArrYaw = (arr, q) => {
      if (!arr || !q) return arr
      const v = new THREE.Vector3(...arr).applyQuaternion(q)
      return [v.x, v.y, v.z]
    }

    // AYUDALO ('third'): NO tocar targets/muñecas aquí. El bake de manos
    // debe ser idéntico a AYUDA (neutral); solo se añade yaw de tronco en
    // pose.spine/chest al final. Al reproducir, los brazos son hijos del
    // tronco y giran con él sin rehacer IK ni rotar T a mano.

    const directionTargetFn = DIRECTION_TARGETS[direction]
    if (directionTargetFn) {
      const pullByDir = {
        listener: CONFIG.directionalPull ?? 0.6,
        group_self: 0.55,
      }
      const pull = pullByDir[direction] ?? (CONFIG.directionalPull ?? 0.4)
      const poleW = pull
      // Centroide PROMEDIO de TODA la seña (una sola vez, no por frame): si
      // el delta se recalculara cuadro a cuadro contra la posición natural
      // de ESE frame (como antes), cada frame se "atrae" de forma distinta
      // hacia el mismo punto fijo — eso AMORTIGUA/comprime el arco natural
      // de la seña (el empujón alejándose del pecho) en vez de preservarlo,
      // y reportado 2026-07-21: "cuando llega [al destino] la seña ya
      // terminó, no se ve la transición alejándose del pecho". Con un solo
      // delta BASE (rígido) para toda la toma, la seña se reubica completa
      // sin deformar su propio arco — literalmente "la seña ya empieza
      // estando en el destino", como pidió el usuario.
      let baseCx = 0, baseCy = 0, baseCz = 0, baseN = 0
      for (let i = 0; i < allTg.length; i++) {
        for (const n of ['right', 'left']) {
          const t = allTg[i][n]
          if (!t) continue
          const off = t.T.clone().sub(C_avatar)
          baseCx += off.x; baseCy += off.y; baseCz += off.z; baseN++
        }
      }
      const baseCentroid = baseN > 0
        ? new THREE.Vector3(baseCx / baseN, baseCy / baseN, baseCz / baseN)
        : new THREE.Vector3()
      // Yaw del centroide en el plano XZ (desde el pecho hacia adelante).
      // Al mover la seña de lado hay que girar también fwd/normal de palma;
      // si no, la orientación queda “centrada” y las manos se ven raras.
      const centroidYaw = (off) => Math.atan2(off.x, Math.max(0.08, off.z))
      const yawQuatForDelta = (delta) => {
        const yaw = (centroidYaw(baseCentroid.clone().add(delta)) - centroidYaw(baseCentroid)) * 0.85
        if (Math.abs(yaw) < 1e-4) return null
        return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      }
      for (let i = 0; i < allTg.length; i++) {
        const tg = allTg[i]
        const active = ['right', 'left'].filter((n) => tg[n])
        if (!active.length) continue
        // (i, allTg.length) solo importa para direcciones tipo barrido
        // (group_self) — las estáticas lo ignoran y devuelven el mismo
        // punto siempre. Para direcciones estáticas esto da un delta
        // CONSTANTE en todos los frames (traslación rígida real); para el
        // barrido, el delta varía suave con i pero la toma sigue sin
        // deformarse frame a frame.
        const target = directionTargetFn(i, allTg.length)
        const delta = target.clone().sub(baseCentroid).multiplyScalar(pull)
        const qYaw = yawQuatForDelta(delta)
        for (const n of active) {
          tg[n].T.add(delta)
          // Tras redirigir (sobre todo barrido group_self) la muñeca puede
          // meterse otra vez en el pecho — re-aplicar clearance frontal.
          tg[n].T.copy(avoidTorso(tg[n].T))
          const canon = CANONICAL_POLE[n]
          if (poleW > 0 && tg[n].d) {
            tg[n].d.pole = blendPole(tg[n].d.pole, canon, poleW)
            tg[n].d.poleSlow = blendPole(tg[n].d.poleSlow, canon, poleW)
          }
          const wri = rawWri[i]?.[n]
          if (wri && qYaw) {
            wri.fwd = rotArrYaw(wri.fwd, qYaw)
            wri.normal = rotArrYaw(wri.normal, qYaw)
          }
        }
        stackHands(tg)
        levelSideBySideHands(tg)
        for (const n of active) tg[n].T.copy(avoidTorso(tg[n].T))
      }
    }
    const extRaw = { right: [], left: [] }
    for (let i = 0; i < allTg.length; i++) {
      const tg = allTg[i]
      for (const name of ['right', 'left']) {
        extRaw[name].push(tg[name] ? tg[name].S.distanceTo(tg[name].T) / (tg[name].B.L1 + tg[name].B.L2) : null)
      }
    }
    const extSmooth = {
      right: smoothScalarSeqLocal(extRaw.right, 0.25),
      left: smoothScalarSeqLocal(extRaw.left, 0.25),
    }

    // 3b) Hornear con IK: la muñeca llega a su posición real → las manos se juntan.
    const poses = []
    for (let i = 0; i < frames.length; i++) {
      const dirs = rawDirs[i]
      const wrists = rawWri[i]
      setIdlePose(vrm) // brazos inactivos quedan en reposo
      vrm.scene.updateMatrixWorld(true)
      const pose = {}
      const tg = allTg[i]
      // PASO C: IK + orientar huesos hacia el objetivo (ya con atracción).
      for (const name of ['right', 'left']) {
        const t = tg[name]
        if (!t) continue
        const { B, d, T } = t
        const S = t.S
        // Cerca de la extensión completa (brazo casi recto) el pole normal
        // es inestable — mezclamos hacia la versión muy suavizada (poleSlow)
        // Y además amortiguamos h (ver solveIK) para eliminar por completo
        // la sensibilidad al pole justo donde es más ambigua. Usa la
        // extensión SUAVIZADA en el tiempo (extSmooth), no la instantánea.
        const extFrac = extSmooth[name][i]
        const poleBlend = smoothstep01((extFrac - 0.85) / (0.99 - 0.85))
        const poleUse = poleBlend > 0
          ? new THREE.Vector3(...d.pole).normalize().lerp(new THREE.Vector3(...d.poleSlow).normalize(), poleBlend).normalize()
          : new THREE.Vector3(...d.pole).normalize()
        const hScale = 1 - smoothstep01((extFrac - 0.92) / (0.985 - 0.92))
        const E = solveIK(S, T, B.L1, B.L2, poleUse, hScale)
        aimBone(B.up, B.lo, E.clone().sub(S).normalize())
        vrm.scene.updateMatrixWorld(true) // el antebrazo usa el brazo ya girado
        aimBone(B.lo, B.hd, T.clone().sub(E).normalize())
        pose[name + 'UpperArm'] = eulerOf(B.up)
        pose[name + 'LowerArm'] = eulerOf(B.lo)
        const wrist = name === 'right' ? wrists.right : wrists.left
        if (wrist) {
          vrm.scene.updateMatrixWorld(true)
          aimHandFull(B, wrist.fwd, wrist.normal, name === 'right' ? 1 : -1, bakeWristRoll)
          pose[name + 'Hand'] = eulerOf(B.hd)
        }
      }
      Object.assign(pose, fingSmooth[i]) // dedos ya suavizados
      pose.head = headEuler(headSmooth[i]) // cabeza (asentir/girar), independiente de brazos
      // Asistencia de cuello SOLO en tokens whitelist (p.ej. TENGO_SED).
      // En HOLA la mano toca la sien → un assist genérico movía la cabeza mal.
      {
        const allowList = CONFIG.headNeckAssistTokens
        const tok = (dataset.token || '').toUpperCase()
        const allowAssist = !allowList || allowList.length === 0
          ? false
          : allowList.some((t) => tok === String(t).toUpperCase() || tok.includes(String(t).toUpperCase()))
        if (allowAssist) {
          const axis = CONFIG.headPitchAxis || 'x'
          const maxAssist = CONFIG.headNeckAssist ?? 0.75
          let w = 0
          for (const side of ['right', 'left']) {
            const t = tg[side]
            if (!t) continue
            w = Math.max(w, t.neckW || neckZoneWeight(t.T, t.d?.wristOffset))
          }
          if (w > 0.05) {
            const sign = CONFIG.headPitchSign ?? -1
            // Piso bajo (0.25): con 0.55 el assist arrancaba fuerte aunque w
            // fuera pequeño → tirón brusco de cabeza. Neck solo 0.25× para
            // no sumar otro alza encima del pitch de la cabeza.
            const assist = maxAssist * (0.25 + 0.75 * w)
            const cur = pose.head[axis] || 0
            const target = assist * sign
            pose.head[axis] = sign >= 0 ? Math.max(cur, target) : Math.min(cur, target)
            pose.neck = {
              x: axis === 'x' ? assist * 0.25 * sign : 0,
              y: axis === 'y' ? assist * 0.25 * sign : 0,
              z: 0,
            }
          } else {
            pose.neck = { x: 0, y: 0, z: 0 }
          }
        } else {
          pose.neck = { x: 0, y: 0, z: 0 }
        }
      }
      // AYUDALO: solo yaw de tronco en el pose (manos = bake neutral).
      // El player aplica spine/chest; los brazos siguen al esqueleto.
      if (direction === 'third') {
        const yawY = CONFIG.thirdTorsoYawY ?? 0.22
        pose.spine = { x: 0, y: yawY, z: 0 }
        pose.chest = { x: 0, y: yawY * 0.75, z: 0 }
      }
      // Forzar angry=0 siempre (caché vieja / heurística mala lo dejaba enojado).
      const expr = { ...(exprSmooth[i] || NEUTRAL_EXPR), angry: 0 }
      // PERDON = disculpa triste, no enojo. Este VRM tiene morph/preset `sad`.
      if (token === 'PERDON') {
        expr.sad = Math.max(expr.sad || 0, 0.55)
        expr.surprised = Math.min(expr.surprised || 0, 0.12)
        expr.angry = 0
      }
      pose.expr = expr
      poses.push(pose)
    }
    // Blindaje de bordes: si un brazo activo en la seña no se detectó en el
    // primer o el último frame (oclusión momentánea justo al empezar/acabar
    // de grabar — típico si la mano entra/sale del encuadre), se sostiene el
    // valor del frame válido más cercano. Sin esto, poses[0]/poses[N-1] no
    // tendrían esa clave: la transición de entrada/salida (que lee first/last
    // más abajo) se saltaría ese brazo entero, o el brazo aparecería de
    // golpe a mitad de la seña sin transición — el mismo tipo de "pop" que
    // ya resolvimos para el codo, pero por datos faltantes en el borde en
    // vez de por singularidad IK. General: protege cualquier grabación
    // futura, no solo GRACIAS/BIEN.
    for (const side of ['right', 'left']) {
      const key = side + 'UpperArm'
      const firstIdx = poses.findIndex((p) => p[key] !== undefined)
      if (firstIdx === -1) continue // este brazo nunca aparece: nada que rellenar
      let lastIdx = poses.length - 1
      while (lastIdx > firstIdx && poses[lastIdx][key] === undefined) lastIdx--
      for (let i = 0; i < firstIdx; i++) {
        poses[i][key] = poses[firstIdx][key]
        poses[i][side + 'LowerArm'] = poses[firstIdx][side + 'LowerArm']
        poses[i][side + 'Hand'] = poses[firstIdx][side + 'Hand']
      }
      for (let i = lastIdx + 1; i < poses.length; i++) {
        poses[i][key] = poses[lastIdx][key]
        poses[i][side + 'LowerArm'] = poses[lastIdx][side + 'LowerArm']
        poses[i][side + 'Hand'] = poses[lastIdx][side + 'Hand']
      }
    }

    const fps = dataset.fps > 0 && dataset.fps < 240 ? dataset.fps : 30 // valor sano
    const dur = Math.round((1000 / fps) * SIGN_SLOWDOWN) // más lento = natural
    if (!poses.length) return []
    // NOTA: se intentó comprimir automáticamente señas "quietas" (ej. BIEN)
    // para que no demoren sosteniendo una pose fija — primero por rango total
    // (rompió SI: su asentir real quedaba por debajo del umbral de posición),
    // después por salto frame-a-frame (tampoco: medido, BIEN y SI tienen la
    // MISMA magnitud de cambio entre frames vecinos — ambas ~0.02-0.05 rad,
    // indistinguibles con los datos actuales). Cualquier heurística automática
    // aquí arriesga romper señas reales para "arreglar" una demora cosmética.
    // Se descartó — sin compresión, todos los frames grabados se respetan tal
    // cual.

    // ── Reposo natural: muñeca neutra + dedos ligeramente relajados ──────────
    const NEUTRAL = { x: 0, y: 0, z: 0 }
    const fingersOf = (p) => {
      const o = {}
      for (const k in p) if (/(Proximal|Intermediate|Distal|Thumb)/.test(k)) o[k] = p[k]
      return o
    }
    // Brazo activo = aparece en la animación horneada (más fiable que solo
    // activeArms, que puede marcar ruido de la mano opuesta).
    const signUsesArm = (side) => poses.some((p) => p[side + 'UpperArm'] !== undefined)

    setIdlePose(vrm)
    vrm.scene.updateMatrixWorld(true)
    const sideRest = {}
    for (const side of ['right', 'left']) {
      const B = side === 'right' ? R : L
      sideRest[side] = {
        upper: eulerOf(B.up),
        lower: eulerOf(B.lo),
        hand: NEUTRAL,
      }
    }
    // Curva natural de dedos en reposo — MISMA convención que restFingers
    // (más abajo). Antes frozenFingerRest dejaba los dedos en NEUTRAL
    // (totalmente rectos): la mano INACTIVA de una seña de una sola mano
    // (ej. TENGO_SED) quedaba "estirada" mientras la mano activa sí tenía
    // esta curva relajada — se notaba la asimetría. Ver fix gemelo en
    // vrmIdlePose.js (mismo problema en el reposo inicial/tras clear()).
    const REST_CURL = 0.35
    const frozenFingerRest = (side) => {
      const g = side === 'right' ? 1 : -1
      const o = {
        [side + 'UpperArm']: sideRest[side].upper,
        [side + 'LowerArm']: sideRest[side].lower,
        [side + 'Hand']: NEUTRAL,
      }
      for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
        o[`${side}${f}Proximal`] = { x: 0, y: 0, z: g * REST_CURL }
        o[`${side}${f}Intermediate`] = { x: 0, y: 0, z: g * REST_CURL }
        o[`${side}${f}Distal`] = { x: 0, y: 0, z: g * REST_CURL * 0.6 }
      }
      o[side + 'ThumbProximal'] = NEUTRAL
      o[side + 'ThumbDistal'] = NEUTRAL
      return o
    }

    const restFingers = {}
    for (const side of ['right', 'left']) {
      if (!signUsesArm(side)) continue
      const g = side === 'right' ? 1 : -1
      for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
        restFingers[`${side}${f}Proximal`] = { x: 0, y: 0, z: g * REST_CURL }
        restFingers[`${side}${f}Intermediate`] = { x: 0, y: 0, z: g * REST_CURL }
        restFingers[`${side}${f}Distal`] = { x: 0, y: 0, z: g * REST_CURL * 0.6 }
      }
    }

    // ── Transición SIN IK (entrada y salida) ───────────────────────────────
    // Por qué NO usar IK aquí: el reposo (brazo colgando) está casi tan
    // extendido como la seña misma (fracción de extensión ≈0.98, medida con
    // el IK real — ver diagnóstico). Es decir, la transición completa ocurre
    // DENTRO de la zona de singularidad del codo, no solo cerca del final ni
    // solo al bajar — también al SUBIR desde reposo al empezar la seña. Ya
    // conocemos las dos poses exactas en los extremos (reposo, y el primer/
    // último frame de la seña, ambos ya resueltos por IK durante el
    // horneado). No hace falta re-resolver IK para interpolar ENTRE dos
    // rotaciones de hueso conocidas: un SLERP directo de cuaterniones
    // (hombro + codo, cada uno por separado) es geométricamente imposible de
    // "voltear" — no hay solver, no hay singularidad. El único riesgo de
    // este método (que el camino cartesiano de la muñeca no sea "recto") es
    // aceptable e imperceptible en una transición de reposo↔seña.
    //
    // Los pasos usan t = s/(N+1) (nunca llega a 1); el keyframe final es una
    // copia EXACTA del empalme (frame 0 de la seña o reposo). Así smoothstep
    // frena/acelera en reposo sin anular la velocidad justo en el empalme.
    const TRANS_STEPS = 8
    const smoothstep = (t) => t * t * (3 - 2 * t)
    const transition = (sideData, fingerA, fingerB, steps, stepMs, headA, headB, exprA, exprB, neckA, neckB, spineA, spineB, chestA, chestB) => {
      const activeSides = Object.keys(sideData)
      const out = []
      for (let s = 1; s <= steps; s++) {
        const a = smoothstep(s / (steps + 1))
        const pose = {}
        for (const side of ['right', 'left']) {
          if (activeSides.includes(side)) continue
          Object.assign(pose, frozenFingerRest(side))
        }
        for (const side of activeSides) {
          const P = sideData[side]
          // Si hay punto intermedio (waypoint, ver más abajo — la mano
          // ENTRA/SALE del reposo rodeando el torso en vez de en línea
          // recta), el mismo tramo de tiempo compartido `a` se reparte en
          // dos: reposo→waypoint (primera mitad) y waypoint→seña (segunda).
          if (P.wpUpper) {
            if (a <= 0.5) {
              const t2 = a / 0.5
              pose[side + 'UpperArm'] = slerpEuler(P.upperA, P.wpUpper, t2)
              pose[side + 'LowerArm'] = slerpEuler(P.lowerA, P.wpLower, t2)
            } else {
              const t2 = (a - 0.5) / 0.5
              pose[side + 'UpperArm'] = slerpEuler(P.wpUpper, P.upperB, t2)
              pose[side + 'LowerArm'] = slerpEuler(P.wpLower, P.lowerB, t2)
            }
          } else {
            pose[side + 'UpperArm'] = slerpEuler(P.upperA, P.upperB, a)
            pose[side + 'LowerArm'] = slerpEuler(P.lowerA, P.lowerB, a)
          }
          pose[side + 'Hand'] = slerpEuler(P.handA, P.handB, a)
        }
        const bones = new Set([...Object.keys(fingerA), ...Object.keys(fingerB)])
        bones.forEach((k) => { pose[k] = lerpEuler(fingerA[k], fingerB[k], a) })
        if (headA || headB) pose.head = slerpEuler(headA, headB, a)
        if (neckA || neckB) pose.neck = slerpEuler(neckA || NEUTRAL, neckB || NEUTRAL, a)
        if (spineA || spineB) pose.spine = slerpEuler(spineA || NEUTRAL, spineB || NEUTRAL, a)
        if (chestA || chestB) pose.chest = slerpEuler(chestA || NEUTRAL, chestB || NEUTRAL, a)
        if (exprA || exprB) pose.expr = lerpExpr(exprA, exprB, a)
        out.push({ duration: stepMs, pose })
      }
      return out
    }

    const buildExactRestPose = (activeSides) => {
      const pose = { ...restFingers }
      for (const side of ['right', 'left']) {
        if (activeSides.includes(side)) {
          pose[side + 'UpperArm'] = sideRest[side].upper
          pose[side + 'LowerArm'] = sideRest[side].lower
          pose[side + 'Hand'] = NEUTRAL
        } else {
          Object.assign(pose, frozenFingerRest(side))
        }
      }
      pose.head = NEUTRAL
      pose.neck = NEUTRAL
      pose.spine = NEUTRAL
      pose.chest = NEUTRAL
      pose.expr = NEUTRAL_EXPR
      return pose
    }

    // SI / NO: cabeza sintetizada (3 ciclos fluidos). No depende del tracking
    // de cara — SI = pitch (X), NO = yaw (Y); ejes vía CONFIG por si el VRM cambia.
    if (token === 'SI' || token === 'SÍ' || token === 'NO') {
      const n = poses.length
      const cycles = 3
      const amp = token === 'NO' ? 0.42 : 0.38
      const axis = token === 'NO' ? CONFIG.headYawAxis : CONFIG.headPitchAxis
      const sign = token === 'NO' ? CONFIG.headYawSign : CONFIG.headPitchSign
      for (let i = 0; i < n; i++) {
        const t = n <= 1 ? 0 : i / (n - 1)
        const a = amp * sign * Math.sin(cycles * Math.PI * 2 * t)
        poses[i].head = { x: 0, y: 0, z: 0, [axis]: a }
      }
    }

    // ── Rodear el torso en la ENTRADA/SALIDA ────────────────────────────
    // El slerp reposo↔seña de arriba interpola hombro/codo directo, sin
    // saber que hay un cuerpo — en señas donde la mano de reposo (colgando
    // al lado) y la mano de la seña (cerca del pecho, ej. GRACIAS) quedan
    // en lados opuestos del torso, el camino directo lo atraviesa. Si el
    // PUNTO MEDIO de ese camino cae dentro de la caja del torso (mismo
    // chequeo que avoidTorso), se inserta un punto intermedio empujado
    // hacia AFUERA (lado anatómico correcto) y por delante del pecho, y la
    // transición pasa a ser reposo→waypoint→seña. Si el camino directo ya
    // iba por fuera del torso, no se toca nada (waypoint = null). General:
    // se decide por geometría en cada toma, no por lista de señas.
    function tgWristAt(side, fromEnd) {
      const arr = fromEnd ? [...allTg].reverse() : allTg
      for (const tg of arr) if (tg[side]) return tg[side].T
      return null
    }
    function waypointFor(side, targetT) {
      const B = side === 'right' ? R : L
      setIdlePose(vrm)
      vrm.scene.updateMatrixWorld(true)
      const restWrist = B.hd.getWorldPosition(new THREE.Vector3())
      const midPt = restWrist.clone().add(targetT).multiplyScalar(0.5)
      if (!insideTorso(midPt)) return null // camino directo ya libre
      const off = midPt.clone().sub(C_avatar)
      const tgt = targetT.clone().sub(C_avatar)
      // Si la seña está DELANTE del pecho (AYUDA, AYUDANOS, GRACIAS…), rodear
      // por delante (+Z) en entrada Y salida. El desvío lateral hacía que el
      // brazo (sobre todo el derecho al bajar) pareciera atravesar el cuerpo.
      const frontTarget = tgt.z > Math.max(Math.abs(tgt.x) * 0.5, shoulderHalfW * 0.35)
      if (frontTarget) {
        off.x = tgt.x * 0.55 + off.x * 0.2
        off.y = Math.max(off.y, tgt.y * 0.5)
        off.z = Math.max(TORSO_MIN_FWD * 1.85, tgt.z * 0.75, off.z)
      } else {
        const outSign = side === 'right' ? -1 : 1 // lado derecho avatar = -X
        off.x = outSign * Math.max(Math.abs(off.x), TORSO_HALF_WIDTH * 1.3)
      }
      return avoidTorso(C_avatar.clone().add(off))
    }
    function solveArmEuler(side, T) {
      const B = side === 'right' ? R : L
      setIdlePose(vrm)
      vrm.scene.updateMatrixWorld(true)
      const S = B.up.getWorldPosition(new THREE.Vector3())
      const poleDir = new THREE.Vector3(0, -1, 0.3).normalize() // codo relajado hacia abajo/frente
      const E = solveIK(S, T, B.L1, B.L2, poleDir, 1)
      aimBone(B.up, B.lo, E.clone().sub(S).normalize())
      vrm.scene.updateMatrixWorld(true)
      aimBone(B.lo, B.hd, T.clone().sub(E).normalize())
      return { upper: eulerOf(B.up), lower: eulerOf(B.lo) }
    }

    const first = poses[0]
    const last = poses[poses.length - 1]
    const entrySides = {}
    const exitSides = {}
    for (const side of ['right', 'left']) {
      if (!signUsesArm(side) || !first[side + 'UpperArm'] || !last[side + 'UpperArm']) continue
      const rest = sideRest[side]
      const entrySide = {
        upperA: rest.upper, upperB: first[side + 'UpperArm'],
        lowerA: rest.lower, lowerB: first[side + 'LowerArm'],
        handA: NEUTRAL, handB: first[side + 'Hand'] || NEUTRAL,
      }
      const firstTarget = tgWristAt(side, false)
      const entryWp = firstTarget ? waypointFor(side, firstTarget) : null
      if (entryWp) {
        const e = solveArmEuler(side, entryWp)
        entrySide.wpUpper = e.upper
        entrySide.wpLower = e.lower
      }
      entrySides[side] = entrySide

      const exitSide = {
        upperA: last[side + 'UpperArm'], upperB: rest.upper,
        lowerA: last[side + 'LowerArm'], lowerB: rest.lower,
        handA: last[side + 'Hand'] || NEUTRAL, handB: NEUTRAL,
      }
      const lastTarget = tgWristAt(side, true)
      const exitWp = lastTarget ? waypointFor(side, lastTarget) : null
      if (exitWp) {
        const e = solveArmEuler(side, exitWp)
        exitSide.wpUpper = e.upper
        exitSide.wpLower = e.lower
      }
      exitSides[side] = exitSide
    }
    const activeSides = Object.keys(entrySides)
    const transSteps = TRANS_STEPS - 1
    const entryStepMs = LEAD_IN_MS / TRANS_STEPS
    const exitStepMs = 480 / TRANS_STEPS
    const entryKfs = transition(
      entrySides, restFingers, fingersOf(first), transSteps, entryStepMs,
      NEUTRAL, first.head, NEUTRAL_EXPR, first.expr, NEUTRAL, first.neck,
      NEUTRAL, first.spine || NEUTRAL, NEUTRAL, first.chest || NEUTRAL,
    )
    // Empalme exacto con frame 0: mismo pose y duración del primer frame de la
    // seña, sin duplicar keyframe (evita micro-pausa por tramo de delta cero).
    entryKfs.push({ duration: dur, pose: { ...first } })
    const signKfsBody = poses.length > 1 ? poses.slice(1).map((p) => ({ duration: dur, pose: p })) : []
    const exitKfs = transition(
      exitSides, fingersOf(last), restFingers, transSteps, exitStepMs,
      last.head, NEUTRAL, last.expr, NEUTRAL_EXPR, last.neck, NEUTRAL,
      last.spine || NEUTRAL, NEUTRAL, last.chest || NEUTRAL, NEUTRAL,
    )
    exitKfs.push({ duration: exitStepMs, pose: buildExactRestPose(activeSides) })
    const all = [...entryKfs, ...signKfsBody, ...exitKfs]

    // Blindaje: brazos que NO participan en la seña quedan congelados en reposo
    // en todos los keyframes (incluye transiciones).
    for (const side of ['right', 'left']) {
      if (signUsesArm(side)) continue
      const rest = frozenFingerRest(side)
      all.forEach((k) => Object.assign(k.pose, rest))
    }
    return all
  }

  return { bakeSolver }
}
