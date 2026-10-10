import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { initCreator } from './creator.js'
import { buildCozyRoom } from './cozy-room.js'
import { furnishGoodiesRoom } from './goodies-room.js'
import { furnishInteriorRoom } from './interior-room.js'
import './style.css'
import './replacement-dialog.css'
import { buildTownScene } from './town-scene.js'

const isCreatorLevel = new URLSearchParams(location.search).get('level') === '2'
document.querySelectorAll('.level-switch a').forEach(link => link.classList.toggle('active', link.getAttribute('href') === (isCreatorLevel ? '/?level=2' : '/')))
if (isCreatorLevel) {
  document.body.classList.add('cozy-theme')
  document.querySelector('#level-eyebrow').textContent = '微缩街道 · 四个不同的家'
  document.querySelector('#level-title').textContent = '小屋造物间'
  document.querySelector('#scene-help').textContent = '先选择一间小屋，再生成物件、从物品栏摆放；拖动空白处可旋转视角'
  document.querySelector('#playbar').hidden = true
  document.querySelector('#creator-panel').hidden = false
  document.querySelector('.counter').hidden = true
}

const COLORS = {
  ink: 0x261b45, wall: 0xb4a2f0, wallLight: 0xd2c6ff, wallSide: 0x7d69c6,
  floor: 0xf5b671, floorAlt: 0xe8a765, trim: 0xffe68b, pink: 0xf7a4c4,
  blue: 0x5e80e7, blueLight: 0x9ddff0, mint: 0x78d1ab, green: 0x4ca977,
  purple: 0x8054a5, cream: 0xfff5db, orange: 0xffab59,
}

const host = document.querySelector('#scene')
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = isCreatorLevel ? 1.02 : 1.18
renderer.setClearColor(isCreatorLevel ? 0xd5d2c9 : 0x8f73dd)
host.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(isCreatorLevel ? 0xd5d2c9 : 0x8f73dd)
const exportRoot = new THREE.Group()
exportRoot.name = 'Cartoon Hidden Object Room'
scene.add(exportRoot)
const camera = isCreatorLevel
  ? new THREE.OrthographicCamera(-8.2 * innerWidth / innerHeight, 8.2 * innerWidth / innerHeight, 8.2, -8.2, 0.1, 100)
  : new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 100)
if (isCreatorLevel) camera.aspect = innerWidth / innerHeight
const initialCamera = isCreatorLevel ? new THREE.Vector3(5.25, 32, 49) : new THREE.Vector3(11.8, 9.8, 15.2)
camera.position.copy(initialCamera)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(isCreatorLevel ? 5.25 : 0, isCreatorLevel ? 1.8 : 2.2, 0)
controls.enableDamping = true
controls.dampingFactor = 0.075
controls.minDistance = 12
controls.maxDistance = 42
if (isCreatorLevel) { controls.minZoom = .7; controls.maxZoom = 1.8 }
controls.minPolarAngle = 0.37
controls.maxPolarAngle = 1.33
controls.minAzimuthAngle = -0.1
controls.maxAzimuthAngle = 1.48
controls.update()
let viewportFit = 1
let creatorSpan = 32
function fitViewport() {
  if (isCreatorLevel) {
    const halfHeight = Math.max(creatorSpan, (creatorSpan > 10 ? 56 : 5.5) / camera.aspect)
    camera.left = -halfHeight * camera.aspect
    camera.right = halfHeight * camera.aspect
    camera.top = halfHeight
    camera.bottom = -halfHeight
    camera.updateProjectionMatrix()
    return
  }
  const nextFit = Math.max(1, .98 / camera.aspect)
  camera.position.sub(controls.target).multiplyScalar(nextFit / viewportFit).add(controls.target)
  viewportFit = nextFit
  controls.update()
}
fitViewport()

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: true, ...extra })
const ink = mat(COLORS.ink)
const mint = mat(COLORS.mint)
const cream = mat(COLORS.cream)
const gold = mat(COLORS.trim)
const targetDefs = [
  { id: 'star', icon: '⭐', name: '星星', hint: '它在书架顶层闪闪发亮。' },
  { id: 'clock', icon: '⏰', name: '时钟', hint: '守在窗边，提醒故事开始的时间。' },
  { id: 'key', icon: '🗝️', name: '钥匙', hint: '翻一翻写故事的小桌面。' },
  { id: 'letter', icon: '✉️', name: '信封', hint: '秘密藏在一封放在桌面的信里。' },
  { id: 'globe', icon: '🌍', name: '地球仪', hint: '在地图和书本之间，找到转动的世界。' },
  { id: 'camera', icon: '📷', name: '相机', hint: '沙发旁的小桌上，留住一瞬间。' },
  { id: 'mushroom', icon: '🍄', name: '蘑菇', hint: '地毯边缘长出了一位小客人。' },
  { id: 'telescope', icon: '🔭', name: '望远镜', hint: '抬头看看书架旁的星空工具。' },
]
const targetRoots = new Map()
const pickables = []
const placementSurfaces = []
const found = new Set()
const targetBar = document.querySelector('#targets')
const toast = document.querySelector('#toast')
let toastTimer

function say(message) {
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3300)
}

for (const item of targetDefs) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'target'
  button.dataset.id = item.id
  button.innerHTML = `<span class="icon" aria-hidden="true">${item.icon}</span><span class="name">${item.name}</span>`
  button.setAttribute('aria-label', `${item.name}，点击获得线索`)
  button.addEventListener('click', () => say(found.has(item.id) ? `已找到：${item.name}` : item.hint))
  targetBar.append(button)
}

function addMesh(parent, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  if (rotation) mesh.rotation.set(...rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function box(parent, w, h, d, color, x, y, z, options = {}) {
  const geometry = options.round
    ? new RoundedBoxGeometry(w, h, d, 3, Math.min(options.round, w / 2, h / 2, d / 2))
    : new THREE.BoxGeometry(w, h, d)
  const mesh = addMesh(parent, geometry, typeof color === 'number' ? mat(color) : color, [x, y, z])
  if (options.rotate) mesh.rotation.set(...options.rotate)
  if (options.edge !== false) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, options.round ? 40 : 16), new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.72 }))
    mesh.add(edges)
  }
  return mesh
}

function cylinder(parent, rt, rb, height, color, x, y, z, segments = 24, rotation) {
  return addMesh(parent, new THREE.CylinderGeometry(rt, rb, height, segments), typeof color === 'number' ? mat(color) : color, [x, y, z], rotation)
}

function ball(parent, radius, color, x, y, z, w = 16, h = 10) {
  return addMesh(parent, new THREE.SphereGeometry(radius, w, h), typeof color === 'number' ? mat(color) : color, [x, y, z])
}

function group(x = 0, y = 0, z = 0) {
  const result = new THREE.Group()
  result.position.set(x, y, z)
  exportRoot.add(result)
  return result
}

function register(id, root) {
  root.userData.targetId = id
  root.traverse(child => {
    if (child.isMesh) {
      child.userData.targetId = id
      pickables.push(child)
    }
  })
  targetRoots.set(id, root)
}

// Open-front room: generous negative space in the center leaves room for hidden-object play.
let cozyStreet = null
if (!isCreatorLevel) {
const room = group()
box(room, 12.6, .42, 10.4, COLORS.ink, 0, -.31, 0, { edge: false })
for (let i = 0; i < 10; i++) {
  placementSurfaces.push(box(room, 12, .13, 1, i % 2 ? COLORS.floor : COLORS.floorAlt, 0, -.06, -4.5 + i, { edge: true }))
}
box(room, 12.4, 7.5, .38, COLORS.wall, 0, 3.68, -5.28)
box(room, .38, 7.5, 10.3, COLORS.wallSide, -6.2, 3.68, 0)
box(room, 12.3, .22, .5, COLORS.trim, 0, .85, -5.02)
box(room, .5, .22, 10.2, COLORS.trim, -5.95, .85, 0)
box(room, 12.3, .23, .48, COLORS.cream, 0, 6.87, -5.02)
box(room, .49, .23, 10.2, COLORS.cream, -5.95, 6.87, 0)

// A bright, graphic window inspired by the supplied blue-purple sky and green canopy.
const windowGroup = group(-3.4, 4.05, -4.98)
box(windowGroup, 3.25, 3.5, .12, COLORS.ink, 0, 0, 0)
box(windowGroup, 2.91, 3.16, .08, 0x7399e9, 0, 0, .08, { edge: false })
box(windowGroup, 2.91, 1.08, .015, 0xa491ea, 0, -.97, .13, { edge: false })
for (const [x, y, s] of [[-.82,.68,.25],[-.51,.7,.32],[.55,.3,.26],[.83,.31,.19]]) {
  ball(windowGroup, s, 0xffdbe7, x, y, .17)
}
box(windowGroup, .18, 3.4, .23, COLORS.cream, 0, 0, .2)
box(windowGroup, 3.2, .17, .23, COLORS.cream, 0, .03, .2)
box(windowGroup, 3.5, .29, .45, COLORS.trim, 0, -1.82, .32)
const curtain = group(-5.11, 4.05, -4.66)
box(curtain, .6, 3.7, .2, COLORS.pink, 0, 0, 0, { round: .08 })
const curtain2 = group(-1.69, 4.05, -4.66)
box(curtain2, .6, 3.7, .2, COLORS.pink, 0, 0, 0, { round: .08 })

// Checker rug and large round center table.
const rug = group(.4, .025, .6)
const rugMesh = addMesh(rug, new THREE.CylinderGeometry(2.25, 2.25, .06, 40), mat(COLORS.purple), [0, 0, 0])
rugMesh.receiveShadow = true
cylinder(rug, 1.88, 1.88, .07, COLORS.pink, 0, .05, 0, 40)
cylinder(rug, 1.6, 1.6, .08, 0xf7d18c, 0, .09, 0, 40)
const table = group(.45, 0, .45)
for (const [x,z] of [[-.85,-.54],[.85,-.54],[-.85,.54],[.85,.54]]) cylinder(table, .12, .15, 1.14, COLORS.ink, x, .59, z)
box(table, 2.55, .2, 1.75, COLORS.trim, 0, 1.16, 0, { round: .09 })
placementSurfaces.push(box(table, 2.3, .09, 1.5, COLORS.cream, 0, 1.31, 0, { round: .04 }))
box(table, .68, .07, .55, COLORS.pink, -.55, 1.39, -.28, { rotate: [0,.28,0] })
box(table, .55, .07, .62, COLORS.blueLight, .47, 1.39, .31, { rotate: [0,-.25,0] })
cylinder(table, .21, .19, .16, COLORS.orange, .63, 1.45, -.3)

// Writing desk, letter, key and little plant.
const desk = group(-2.95, 0, -2.55)
placementSurfaces.push(box(desk, 3.4, .23, 1.52, COLORS.trim, 0, 1.6, 0, { round: .08 }))
for (const x of [-1.43,1.43]) for (const z of [-.57,.57]) box(desk, .17, 1.48, .17, COLORS.purple, x, .77, z)
box(desk, 3.18, .12, .15, COLORS.ink, 0, 1.03, -.62)
box(desk, 1.25, 1.1, .26, COLORS.blue, -1.58, 2.14, -.68, { rotate: [0,0,.13] })
box(desk, 1.1, .8, .2, COLORS.pink, 1.52, 2.25, -.72)
const letter = group(-3.66, 1.78, -2.36)
box(letter, .78, .035, .52, COLORS.cream, 0, 0, 0, { rotate: [0,.32,0] })
const flap = box(letter, .53, .01, .013, COLORS.orange, 0, .026, 0, { edge: false })
flap.rotation.y = .32
register('letter', letter)
const key = group(-2.18, 1.8, -2.53)
const keyRing = addMesh(key, new THREE.TorusGeometry(.13, .047, 7, 14), gold, [0, .02, 0], [-Math.PI/2, 0, 0])
keyRing.castShadow = true
box(key, .055, .045, .46, COLORS.trim, 0, .02, .29, { edge: false })
box(key, .18, .045, .07, COLORS.trim, -.055, .02, .49, { edge: false })
register('key', key)
const plant = group(-4.19, 1.78, -2.91)
cylinder(plant, .22, .15, .37, COLORS.pink, 0, .11, 0)
cylinder(plant, .025, .025, .55, COLORS.green, 0, .53, 0)
for (const [x,y,z] of [[-.2,.48,0],[.2,.63,.03],[-.15,.77,-.04]]) {
  const leaf = ball(plant, .15, COLORS.green, x, y, z, 9, 7)
  leaf.scale.set(1.4,.5,.7)
}

// Chunky bookshelf with uneven colorful books and a small display top.
const shelf = group(3.7, 0, -4.03)
box(shelf, 3.55, 5.6, .17, COLORS.ink, 0, 2.8, -.68, { edge: false })
box(shelf, 3.25, 5.3, .06, COLORS.orange, 0, 2.8, -.55, { edge: false })
for (const x of [-1.68,1.68]) box(shelf, .19, 5.6, 1.5, COLORS.ink, x, 2.8, 0, { edge: false })
box(shelf, 3.55, .18, 1.5, COLORS.ink, 0, 5.52, 0, { edge: false })
box(shelf, 3.55, .18, 1.5, COLORS.ink, 0, .09, 0, { edge: false })
for (const y of [1.15,2.4,3.65,4.9]) placementSurfaces.push(box(shelf, 3.43, .2, 1.53, COLORS.trim, 0, y, .11))
const books = [COLORS.pink,COLORS.blue,COLORS.mint,COLORS.cream,COLORS.purple,COLORS.blueLight]
for (let row=0; row<3; row++) {
  for (let i=0; i<5; i++) {
    const h = .66 + ((i*2 + row) % 3)*.13
    const b = box(shelf, .32 + (i%2)*.08, h, .62, books[(i + row*2)%books.length], -1.18+i*.55, 1.27+row*1.25+h/2, .24, { round: .04 })
    b.rotation.z = (i === 4 && row === 1) ? -.14 : 0
  }
}
box(shelf, .95, .36, .78, COLORS.purple, -.82, 5.2, .25, { round: .06 })
const star = group(3.62, 6.02, -3.24)
const starShape = new THREE.Shape()
for (let i=0;i<10;i++) {
  const a = -Math.PI/2 + i*Math.PI/5
  const r = i%2 ? .23 : .47
  const x = Math.cos(a)*r, y = Math.sin(a)*r
  if (i===0) starShape.moveTo(x,y); else starShape.lineTo(x,y)
}
starShape.closePath()
const starGeometry = new THREE.ExtrudeGeometry(starShape, {depth:.15, bevelEnabled:true, bevelSize:.045, bevelThickness:.05, bevelSegments:1})
addMesh(star, starGeometry, gold, [0,0,0])
register('star', star)

// Telescope: short body, flared lens, actual tripod contact.
const telescope = group(4.65, 5.15, -3.71)
const scopeBody = cylinder(telescope, .15, .23, 1.04, COLORS.blue, 0, 0, 0, 18, [0,0,Math.PI/2])
scopeBody.rotation.y = .12
cylinder(telescope, .27, .27, .1, COLORS.trim, -.55, 0, 0, 18, [0,0,Math.PI/2])
cylinder(telescope, .18, .18, .1, COLORS.trim, .53, 0, 0, 18, [0,0,Math.PI/2])
cylinder(telescope, .07, .07, .38, COLORS.ink, 0, -.29, 0)
for (const [x,z] of [[-.26,-.19],[.26,-.19],[0,.27]]) {
  const leg = cylinder(telescope, .035, .035, .58, COLORS.ink, x/2, -.64, z/2)
  leg.rotation.z = x ? (x > 0 ? -.4 : .4) : 0
  leg.rotation.x = z > 0 ? .35 : -.2
}
register('telescope', telescope)

// Clock on the left wall, raised enough to stay visible in the room overview.
const clock = group(-5.8, 4.4, -1.32)
cylinder(clock, .5, .5, .18, COLORS.ink, 0, 0, 0, 30, [0,0,Math.PI/2])
cylinder(clock, .41, .41, .22, COLORS.cream, .04, 0, 0, 30, [0,0,Math.PI/2])
box(clock, .04, .29, .035, COLORS.ink, .17, .08, 0, { edge: false, rotate: [0,0,.68] })
box(clock, .04, .19, .035, COLORS.ink, .17, 0, .07, { edge: false, rotate: [0,0,-.8] })
ball(clock, .07, COLORS.pink, .19, 0, 0)
register('clock', clock)

// Comfy chair and camera side table.
const chair = group(-3.36, 0, 1.37)
box(chair, 2.3, .87, 1.6, COLORS.blue, 0, .72, 0, { round: .25 })
box(chair, 2.28, 2.08, .52, COLORS.blue, 0, 1.42, -.73, { round: .22 })
for (const x of [-1.12,1.12]) box(chair, .46, 1.2, 1.65, COLORS.blue, x, .98, 0, { round: .18 })
box(chair, 1.1, .18, .65, COLORS.pink, -.25, 1.26, -.38, { round: .08, rotate: [0,.14,-.16] })
for (const x of [-.83,.83]) for (const z of [-.48,.48]) cylinder(chair, .1, .12, .27, COLORS.ink, x, .18, z)
const sideTable = group(-4.9, 0, 2.6)
cylinder(sideTable, .6, .6, .16, COLORS.trim, 0, 1.18, 0)
cylinder(sideTable, .11, .12, 1.14, COLORS.ink, 0, .55, 0)
cylinder(sideTable, .38, .43, .14, COLORS.ink, 0, .1, 0)
const cameraProp = group(-4.89, 1.37, 2.55)
box(cameraProp, .63, .37, .35, COLORS.ink, 0, .02, 0, { round: .06, edge: false })
box(cameraProp, .48, .24, .05, COLORS.pink, 0, .04, .2, { edge: false })
cylinder(cameraProp, .17, .17, .09, COLORS.cream, 0, .02, .24, 24, [Math.PI/2,0,0])
cylinder(cameraProp, .09, .09, .1, COLORS.blueLight, 0, .02, .3, 24, [Math.PI/2,0,0])
box(cameraProp, .2, .11, .17, COLORS.ink, -.16, .25, -.02, { edge: false })
register('camera', cameraProp)

// Globe on a separate low chest, with latitude meridians suggested by gold bands.
const chest = group(3.6, 0, 2.3)
box(chest, 2.6, 1.22, 1.5, COLORS.pink, 0, .65, 0, { round: .09 })
placementSurfaces.push(box(chest, 2.82, .18, 1.68, COLORS.trim, 0, 1.31, 0, { round: .07 }))
box(chest, .52, .18, .06, COLORS.cream, 0, .76, .78)
const globe = group(3.6, 1.48, 2.3)
cylinder(globe, .45, .52, .11, COLORS.ink, 0, .07, 0)
cylinder(globe, .06, .07, .35, COLORS.trim, 0, .28, 0)
const earth = ball(globe, .58, COLORS.blue, 0, .9, 0, 24, 16)
earth.rotation.z = -.18
for (const [x,y,z,s] of [[-.27,1.15,.48,.26],[.34,.85,.43,.22],[-.29,.63,.29,.21],[.16,1.24,-.36,.22]]) {
  const continent = ball(globe, s, COLORS.green, x, y, z, 9, 7)
  continent.scale.set(1.2,.6,.2)
}
addMesh(globe, new THREE.TorusGeometry(.64, .027, 7, 38), gold, [0,.9,0], [0,0,-.22])
register('globe', globe)

const mushroom = group(1.95, 0, 2.22)
cylinder(mushroom, .13, .17, .5, COLORS.cream, 0, .23, 0)
const cap = ball(mushroom, .4, COLORS.pink, 0, .59, 0, 16, 8)
cap.scale.y = .52
for (const [x,z] of [[-.13,.18],[.17,.08],[0,-.2]]) ball(mushroom, .055, COLORS.cream, x, .76, z, 8, 5)
register('mushroom', mushroom)
if (isCreatorLevel) targetRoots.forEach(root => { root.visible = false })

// Graphic ceiling pennants and paper stars give the supplied thumbnail's bold, cheerful rhythm.
for (let i=0;i<7;i++) {
  const x = -5.4 + i*1.6
  const flag = new THREE.Shape()
  flag.moveTo(-.22,0); flag.lineTo(.22,0); flag.lineTo(0,-.48); flag.closePath()
  addMesh(scene, new THREE.ShapeGeometry(flag), mat([COLORS.pink,COLORS.trim,COLORS.mint,COLORS.blueLight][i%4], {side:THREE.DoubleSide}), [x,6.45,-4.77])
}
box(exportRoot, 11.2, .035, .035, COLORS.ink, -.6, 6.47, -4.77, { edge: false })
} else {
  cozyStreet = buildCozyRoom({ THREE, exportRoot, placementSurfaces })
  cozyStreet.town=buildTownScene(cozyStreet.street)
}

scene.add(new THREE.HemisphereLight(isCreatorLevel ? 0xf5f3ed : 0xdff5ff, isCreatorLevel ? 0x9a958c : 0xb88983, isCreatorLevel ? 2.0 : 1.45))
const sun = new THREE.DirectionalLight(isCreatorLevel ? 0xfff2df : 0xfff7dc, isCreatorLevel ? 1.8 : 2.15)
sun.position.set(6, 13, 8)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12
sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12
sun.shadow.camera.near = .5; sun.shadow.camera.far = 35
sun.shadow.bias = -.00045
scene.add(sun)
scene.add(sun.target)
const windowFill = new THREE.PointLight(isCreatorLevel ? 0xf3e9cb : 0x9bd9f9, isCreatorLevel ? 5 : 12, 10)
windowFill.position.set(-3.5, 4.2, -3.4)
scene.add(windowFill)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const pointerStart = { x: 0, y: 0 }
renderer.domElement.addEventListener('pointerdown', event => { pointerStart.x = event.clientX; pointerStart.y = event.clientY })
renderer.domElement.addEventListener('pointerup', event => {
  if (isCreatorLevel) return
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) return
  pointer.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight * 2 - 1))
  raycaster.setFromCamera(pointer, camera)
  const activePickables = pickables.filter(mesh => !found.has(mesh.userData.targetId))
  const hit = raycaster.intersectObjects(activePickables, false)[0]
  if (!hit) return
  const id = hit.object.userData.targetId
  const item = targetDefs.find(entry => entry.id === id)
  if (!item) return
  if (found.has(id)) return say(`已找到：${item.name}`)
  found.add(id)
  targetRoots.get(id).visible = false
  document.querySelector(`[data-id="${id}"]`).classList.add('done')
  document.querySelector('#found-count').textContent = found.size
  say(found.size === targetDefs.length ? '全部找到啦！这个 3D 房间样例完成了。' : `找到 ${item.name}！还剩 ${targetDefs.length - found.size} 件。`)
})
let activeHome = null
let syncCreatorVisibility = null
function chooseHome(id) {
  activeHome = cozyStreet?.homes.find(home => home.id === id) || null
  if(cozyStreet?.town)cozyStreet.town.visible=!activeHome
  cozyStreet?.homes.forEach(home => { home.root.visible = !activeHome || home.id === activeHome.id })
  syncCreatorVisibility?.()
  document.querySelectorAll('#home-switch button').forEach(button => {
    const selected = button.dataset.home === (activeHome?.id || 'street')
    button.classList.toggle('active', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  creatorSpan = activeHome ? (activeHome.id === 'interior' ? 8.3 : 6.7) : 32
  // Follow the selected house with the existing light direction, not a new tint.
  const lightX = activeHome?.x ?? 5.25
  sun.position.set(lightX + 6, 13, 8); sun.target.position.set(lightX, 0, 0)
  const shadowSpan = activeHome ? 12 : 28
  sun.shadow.camera.left = -shadowSpan; sun.shadow.camera.right = shadowSpan
  sun.shadow.camera.top = shadowSpan; sun.shadow.camera.bottom = -shadowSpan
  sun.shadow.camera.far = 65; sun.shadow.camera.updateProjectionMatrix()
  fitViewport()
  camera.zoom = 1
  camera.updateProjectionMatrix()
  if (activeHome) {
    controls.target.copy(activeHome.center)
    camera.position.set(activeHome.x + 2.4, activeHome.id === 'interior' ? 12 : 10.6, activeHome.center.z + 13.2)
    document.querySelector('#scene-help').textContent = `当前在${activeHome.short}。${['interior','goodies'].includes(activeHome.id)?'点击物件可替换/调角度，点击墙或窗可添加窗帘等挂件；':''}拖动物件挪位置，拖动空处旋转视角。`
    say(`进入${activeHome.label}，现在可以摆放生成物件。`)
  } else {
    controls.target.set(5.25, 1.8, 0)
    camera.position.copy(initialCamera)
    document.querySelector('#scene-help').textContent = '这条街有四个不同的家。最右侧是 Goodies 午后客厅；选择小屋后可摆放和挪动物件。'
  }
  controls.update()
}
if (isCreatorLevel) {
  const homeSwitch = document.querySelector('#home-switch')
  homeSwitch.hidden = false
  for (const home of [{ id: 'street', label: '整条街' }, ...cozyStreet.homes]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.home = home.id
    button.textContent = home.label
    button.addEventListener('click', () => chooseHome(home.id))
    homeSwitch.append(button)
  }
  const homeParam = new URLSearchParams(location.search).get('home')
  const requestedHome = homeParam === 'atelier' ? 'interior' : homeParam
  chooseHome(cozyStreet.homes.some(home => home.id === requestedHome) ? requestedHome : 'street')
}
document.querySelector('#reset-view').addEventListener('click', () => {
  if (isCreatorLevel) { chooseHome(activeHome?.id || 'street'); return }
  controls.target.set(0, 2.2, 0)
  camera.position.copy(controls.target).add(initialCamera.clone().sub(controls.target).multiplyScalar(viewportFit))
  controls.update()
})
document.querySelector('#export-glb').addEventListener('click', () => {
  const button = document.querySelector('#export-glb')
  button.disabled = true
  button.textContent = '导出中…'
  new GLTFExporter().parse(exportRoot, result => {
    const url = URL.createObjectURL(new Blob([result], { type: 'model/gltf-binary' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'cartoon-hidden-object-room.glb'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    button.disabled = false
    button.textContent = '导出 GLB'
    say('3D 房间模型已导出为 GLB。')
  }, error => {
    button.disabled = false
    button.textContent = '导出 GLB'
    say(`导出失败：${error.message}`)
  }, { binary: true, onlyVisible: false })
})
if (isCreatorLevel) syncCreatorVisibility = initCreator({ renderer, camera, controls, exportRoot, movableItems: cozyStreet.movableItems, defaultHome: cozyStreet.homes[0], getPlacementContext: () => ({ home: activeHome, surfaces: activeHome?.surfaces || [] }), say })
if (isCreatorLevel) {
  const home = cozyStreet.homes.find(home => home.id === 'interior')
  const button = document.querySelector('[data-home="interior"]')
  button.textContent = '周家 · 加载 Interior…'
  furnishInteriorRoom(home, placementSurfaces).then(items => {
    items=[...items,...home.editableArchitecture]
    cozyStreet.movableItems.push(...items)
    syncCreatorVisibility.registerItems(items)
    button.textContent = home.label
    if(activeHome?.id === 'interior') say('Interior 复式小楼已就绪，一层客厅、二层卧室与阅读区，家具可挪动。')
  }).catch(error => { button.textContent = '周家 · 加载失败'; say(error.message) })
}
if (isCreatorLevel) {
  const home = cozyStreet.homes.find(home => home.id === 'goodies')
  const button = document.querySelector('[data-home="goodies"]')
  button.textContent = '顾家 · 加载家具…'
  furnishGoodiesRoom(home, placementSurfaces).then(items => {
    items=[...items,...home.editableArchitecture]
    cozyStreet.movableItems.push(...items)
    syncCreatorVisibility.registerItems(items)
    button.textContent = home.label
    if (activeHome?.id === 'goodies') say('Goodies 午后客厅已就绪，家具和桌面摆件都可拖动。')
  }).catch(error => {
    button.textContent = '顾家 · 加载失败'
    say(error.message)
  })
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  fitViewport()
  renderer.setSize(innerWidth, innerHeight)
})
function render() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(render) }
render()
