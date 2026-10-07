import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { VRMHumanoid } from '@pixiv/three-vrm'
import { createBaker } from '../src/utils/vrmBaker.js'
import { setIdlePose } from '../src/utils/vrmIdlePose.js'
import { bakePreservingPose, playSolverAnim } from '../src/utils/vrmPlayer.js'

const avatarBytes = readFileSync(new URL('../public/avatar/signara-avatar.vrm', import.meta.url))
const jsonLength = avatarBytes.readUInt32LE(12)
const gltf = JSON.parse(avatarBytes.subarray(20, 20 + jsonLength).toString())
const nodes = gltf.nodes.map(({ name, translation, rotation, scale }) => {
  const node = new THREE.Bone()
  node.name = name || ''
  if (translation) node.position.fromArray(translation)
  if (rotation) node.quaternion.fromArray(rotation)
  if (scale) node.scale.fromArray(scale)
  return node
})
gltf.nodes.forEach(({ children }, i) => {
  children?.forEach((child) => nodes[i].add(nodes[child]))
})
const scene = new THREE.Scene()
nodes.filter((node) => !node.parent).forEach((node) => scene.add(node))
const humanBones = Object.fromEntries(
  Object.entries(gltf.extensions.VRMC_vrm.humanoid.humanBones)
    .map(([name, { node }]) => [name, { node: nodes[node] }]),
)
const humanoid = new VRMHumanoid(humanBones)
scene.add(humanoid.normalizedHumanBonesRoot)
const weights = new Map()
const expressionManager = {
  getValue: (name) => weights.get(name) ?? 0,
  setValue: (name, value) => weights.set(name, value),
}
const vrm = { scene, humanoid, expressionManager }
setIdlePose(vrm)
const baker = createBaker(vrm)

const grab = (name) => JSON.parse(readFileSync(new URL(`../sign_ai/animations/${name}.json`, import.meta.url)))
const firstSign = grab('GRACIAS')
const secondSign = grab('TENGO_SED')
const upperArm = humanoid.getNormalizedBoneNode('rightUpperArm')
upperArm.rotation.x = 0.31
expressionManager.setValue('aa', 0.42)
const before = upperArm.quaternion.clone()

const bake = (dataset, chain) => bakePreservingPose(vrm, () => baker.bakeSolver(dataset, { chain }))
const start = bake(firstSign, 'phrase-start')
assert.ok(start.length > 1)
assert.ok(upperArm.quaternion.angleTo(before) < 1e-8, 'hornear no cambia el brazo visible')
assert.equal(expressionManager.getValue('aa'), 0.42, 'hornear no cambia la expresión visible')

const follow = bake(secondSign, 'phrase-follow')
const release = bake(secondSign, 'phrase-release')
assert.ok(follow.length > 1)
assert.ok(release.length > 1)
assert.ok(follow[0].duration >= 200, 'la segunda seña empieza con un empalme suave')
assert.ok(release.length < follow.length, 'la salida solo contiene el retorno a reposo')
assert.ok(start.at(-1).pose.rightUpperArm, 'la primera seña termina con una pose de mano')
assert.ok(release.at(-1).pose.rightUpperArm, 'la salida termina con una pose de reposo')
assert.equal(release.at(-1).pose.expr.aa, 0, 'la cara vuelve a reposo al final')

let nextFrame = null
globalThis.requestAnimationFrame = (callback) => {
  nextFrame = callback
  return 1
}
globalThis.cancelAnimationFrame = () => {}
const finishClip = (keyframes) => {
  const duration = keyframes.reduce((sum, frame) => sum + frame.duration, 0)
  nextFrame(performance.now() + duration + 10)
}
let completed = 0
playSolverAnim(vrm, start, () => { completed++ })
finishClip(start)
const firstEnd = upperArm.quaternion.clone()
assert.equal(completed, 1)
playSolverAnim(vrm, follow, () => { completed++ })
assert.ok(upperArm.quaternion.angleTo(firstEnd) < 1e-5, 'la segunda seña arranca en la pose final anterior')
finishClip(follow)
assert.equal(completed, 2)
playSolverAnim(vrm, release, () => { completed++ })
finishClip(release)
assert.equal(completed, 3)
assert.ok(upperArm.quaternion.angleTo(firstEnd) > 0.01, 'la salida ocurre después de ambas señas')
const neck = humanoid.getNormalizedBoneNode('neck')
neck.rotation.x = 0.35
setIdlePose(vrm)
assert.ok(Math.abs(neck.rotation.x) < 1e-8, 'limpiar la reproducción también endereza el cuello')

console.log('OK avatar: entrada, empalme, salida y horneado sin alterar pose/cara')
