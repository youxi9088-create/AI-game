import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { craftedTextures } from './crafted-materials.js'

// An original, open-front miniature street. The four homes share a material
// language but have different silhouettes, rooms and family belongings.
export function buildCozyRoom({ THREE, exportRoot, placementSurfaces }) {
  const movableItems = []
  // Keep each furnishing together, with its origin at the bottom centre.
  function movable(parent, id, name, start, mode = 'surface') {
    const nodes = parent.children.slice(start)
    const group = new THREE.Group()
    parent.add(group)
    for (const node of nodes) group.add(node)
    group.updateWorldMatrix(true, true)
    const bounds = new THREE.Box3().setFromObject(group)
    const origin = parent.worldToLocal(new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2, bounds.min.y, (bounds.min.z + bounds.max.z) / 2))
    group.position.copy(origin)
    for (const node of nodes) node.position.sub(origin)
    group.name = name
    movableItems.push({ id, name, model: group, homeId: id.split(':')[0], mode })
    return parent.children.length
  }
  const C = {
    road: 0xb5ad97, roadLight: 0xc8c1aa, paving: 0xe5d9bb,
    wood: 0xa58061, woodLight: 0xc6ab88, woodDark: 0x705b48,
    cream: 0xeee9df, plaster: 0xe6e1d6, sage: 0x889785,
    leaf: 0x4d7655, leafLight: 0x7b9a67, clay: 0xb9775b,
    blue: 0x8d9fa4, ink: 0x5a5746, linen: 0xece6dc,
    cane: 0xd6b782, yellow: 0xf2d89a,
  }
  const textures = craftedTextures()
  const materialCache = new Map()
  function mat(color, options = {}) {
    const key = `${color}-${options.transparent || false}-${options.opacity ?? 1}`
    if (!materialCache.has(key)) {
      const type = [C.wood, C.woodLight, C.woodDark, C.cane].includes(color) ? 'wood'
        : [C.linen, C.blue, C.sage].includes(color) ? 'linen' : 'plaster'
      materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: type === 'wood' ? .72 : .93,
        map: textures[type], bumpMap: textures[type], bumpScale: type === 'linen' ? .016 : .008,
        metalness: 0, ...options }))
    }
    return materialCache.get(key)
  }
  function add(parent, geometry, color, x, y, z, options = {}) {
    const mesh = new THREE.Mesh(geometry, typeof color === 'number' ? mat(color) : color)
    mesh.position.set(x, y, z)
    if (options.rotation) mesh.rotation.set(...options.rotation)
    if (options.scale) mesh.scale.set(...options.scale)
    mesh.castShadow = options.castShadow !== false
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  function box(parent, w, h, d, color, x, y, z, options = {}) {
    const radius = Math.min(options.round || 0, w / 2, h / 2, d / 2)
    return add(parent, radius ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d), color, x, y, z, options)
  }
  function cylinder(parent, top, bottom, h, color, x, y, z, sides = 20, options = {}) {
    return add(parent, new THREE.CylinderGeometry(top, bottom, h, sides), color, x, y, z, options)
  }
  function ball(parent, radius, color, x, y, z, scale = [1, 1, 1], options = {}) {
    return add(parent, new THREE.SphereGeometry(radius, 16, 12), color, x, y, z, { scale, ...options })
  }
  function rod(parent, a, b, radius, color, sides = 8) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b)
    const mesh = add(parent, new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), sides), color,
      (start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize())
    return mesh
  }
  function plant(parent, x, y, z, size = 1, hue = C.leaf) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g)
    const profile = [[0,0],[.17,0],[.21,.03],[.265,.32],[.275,.35],[.237,.35],[.23,.3],[.18,.04]]
      .map(([r,h]) => new THREE.Vector2(r * size, h * size))
    add(g, new THREE.LatheGeometry(profile, 24), C.clay, 0, 0, 0)
    cylinder(g, .2 * size, .15 * size, .06 * size, C.woodDark, 0, .34 * size, 0, 16)
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.399
      const reach = (.48 + (i % 3) * .12) * size
      const top = (.95 + (i % 3) * .22) * size
      rod(g, [0, .3 * size, 0], [Math.cos(angle) * reach, top, Math.sin(angle) * reach], .018 * size, C.leaf, 6)
      const leaf = new THREE.Shape()
      leaf.moveTo(0, -.3); leaf.bezierCurveTo(-.31, -.07, -.27, .35, 0, .57)
      leaf.bezierCurveTo(.24, .3, .29, -.05, 0, -.3)
      const geometry = new THREE.ShapeGeometry(leaf, 10)
      const positions = geometry.attributes.position
      for (let j = 0; j < positions.count; j++) positions.setZ(j, .16 * Math.sin(positions.getY(j) * 4) + Math.abs(positions.getX(j)) * .18)
      geometry.computeVertexNormals()
      add(g, geometry, new THREE.MeshStandardMaterial({ color: i % 2 ? hue : C.leafLight, side: THREE.DoubleSide, roughness: .7 }),
        Math.cos(angle) * reach, top + .12 * size, Math.sin(angle) * reach,
        { scale: [size, size, size], rotation: [.28, -angle, Math.cos(angle) * -.5] })
    }
    return g
  }
  function picture(parent, x, y, z, color = C.leaf) {
    box(parent, .95, 1.15, .08, C.wood, x, y, z)
    box(parent, .79, .99, .015, C.linen, x, y, z + .05)
    rod(parent, [x, y - .32, z + .07], [x + .03, y + .28, z + .07], .014, C.woodDark, 6)
    for (const [dx, dy, tilt] of [[-.15, -.04, -.48], [.17, .11, .5], [-.13, .25, -.4]]) {
      ball(parent, .16, color, x + dx, y + dy, z + .08, [.55, 1, .08], { rotation: [0, 0, tilt] })
    }
  }
  function table(parent, x, z, topColor = C.woodLight, width = 2.4) {
    const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g)
    box(g, width, .16, 1.35, topColor, 0, 1.33, 0, { round: .06 })
    for (const px of [-width / 2 + .16, width / 2 - .16]) for (const pz of [-.48, .48]) {
      rod(g, [px, .12, pz], [px * .94, 1.28, pz * .94], .055, C.woodDark)
    }
    return { group: g, surface: g.children[0] }
  }
  function shelf(parent, x, y, z, width, homeSurfaces) {
    const top = box(parent, width, .12, .57, C.woodLight, x, y, z, { round: .025 })
    homeSurfaces.push(top); placementSurfaces.push(top)
    for (const dx of [-width / 2 + .15, width / 2 - .15]) {
      rod(parent, [x + dx, y - .08, z + .2], [x + dx, y - .52, z - .2], .028, C.woodDark)
    }
  }
  function wovenPanel(parent, x, y, z, w, h) {
    box(parent, w + .14, h + .14, .075, C.wood, x, y, z, { round: .05 })
    box(parent, w, h, .078, C.cane, x, y, z + .025)
    for (let i = 0; i < 12; i++) {
      const px = x - w / 2 + .04 + i * (w - .08) / 11
      rod(parent, [px, y - h / 2, z + .07], [px, y + h / 2, z + .07], .011, i % 2 ? C.cream : C.woodLight, 5)
    }
    for (let i = 0; i < 7; i++) {
      const py = y - h / 2 + .06 + i * (h - .12) / 6
      rod(parent, [x - w / 2, py, z + .08], [x + w / 2, py, z + .08], .01, C.wood, 5)
    }
  }

  const street = new THREE.Group(); street.name = '四个家的微缩街'; exportRoot.add(street)
  box(street, 45.5, .28, 3.6, C.road, 5.25, -.43, 6.65, { castShadow: false })
  box(street, 45.5, .12, .66, C.paving, 5.25, -.22, 4.55, { castShadow: false })
  for (let i = -17; i <= 27; i++) {
    box(street, .035, .018, 3.2, i % 2 ? C.roadLight : C.paving, i, -.274, 6.65, { castShadow: false })
    if (i % 3 === 0) box(street, 1.05, .012, .035, C.roadLight, i + .4, -.265, 6.65, { castShadow: false })
  }
  for (const x of [-15.6, -5.3, 5.3, 15.6, 26.1]) {
    cylinder(street, .3, .34, .28, C.paving, x, -.15, 4.12, 14)
    plant(street, x, 0, 4.12, .72)
  }

  const definitions = [
    { id: 'forest', label: '林家 · 植物客厅', short: '林家', x: -10.5, wall: 0xe5e3d8, accent: 0x98aa87, roof: 0x8b7560, floor: 0xd6a46a },
    { id: 'kitchen', label: '陈家 · 暖木厨房', short: '陈家', x: 0, wall: 0xeee4d7, accent: 0xb9977f, roof: 0x967b65, floor: 0xe0b47a },
    { id: 'interior', label: '周家 · Interior 复式小楼', short: '周家', x: 10.5 },
    { id: 'goodies', label: '顾家 · 午后客厅', short: '顾家', x: 21, wall: 0xece4d7, accent: 0xa9b69a, roof: 0x8c7660, floor: 0xd7ad76 },
  ]
  const homes = []
  for (const def of definitions) {
    const root = new THREE.Group(); root.position.set(def.x, 0, -1.2); root.name = def.label; street.add(root)
    const surfaces = []
    if (def.id === 'goodies' || def.id === 'interior') {
      // Its complete shell is authored from Goodies modules, not this procedural house.
      homes.push({ ...def, root, surfaces, center: new THREE.Vector3(def.x, def.id === 'interior' ? 3.6 : 1.8, -1.2), quickSpot: new THREE.Vector3(def.x - 2.7, .04, 1.8) })
      continue
    }
    const floor = box(root, 8.8, .36, 7.7, C.woodDark, 0, -.22, 0, { castShadow: false })
    surfaces.push(floor); placementSurfaces.push(floor)
    // Geometric parquet has a human-readable scale and no external texture dependency.
    for (let iz = 0; iz < 15; iz++) for (let ix = 0; ix < 5; ix++) {
      const left = Math.max(-4.2, -4.2 + ix * 2.1 - (iz % 2) * 1.05)
      const right = Math.min(4.2, -4.2 + (ix + 1) * 2.1 - (iz % 2) * 1.05)
      if (right <= left) continue
      const timber = mat(C.woodLight).clone()
      timber.color.multiplyScalar(.89 + ((ix * 7 + iz * 3) % 5) * .025)
      const tile = box(root, right - left - .014, .045, .492, timber, (left + right) / 2, -.01, -3.5 + iz * .5, { castShadow: false })
      surfaces.push(tile); placementSurfaces.push(tile)
    }
    box(root, 8.8, 5.8, .22, def.wall, 0, 2.72, -3.8)
    for (const x of [-4.36, 4.36]) {
      box(root, .2, 5.8, 1.7, def.wall, x, 2.72, -3)
      box(root, .2, 1.8, 6, def.wall, x, .72, .85)
      box(root, .24, .065, 6, C.woodLight, x, 1.65, .85)
    }
    box(root, 8.9, .15, .18, C.wood, 0, .58, -3.66)
    for (const side of [-4.26, 4.26]) box(root, .14, .15, 7.5, C.wood, side, .58, 0)
    // Distinctive cutaway roof and sill make each room read as a separate house on the street.
    box(root, 9.2, .25, .65, def.roof, 0, 5.75, -3.73, { round: .06 })
    for (const side of [-4.32, 4.32]) box(root, .24, 5.7, .26, def.roof, side, 2.8, -3.7)
    box(root, 8.7, .16, .55, def.roof, 0, -.17, 3.91, { castShadow: false })
    const step = box(root, 3.6, .12, .8, C.paving, 0, -.16, 4.26, { castShadow: false })
    placementSurfaces.push(step); surfaces.push(step)
    // Slatted accent wall, house-specific colour and framed family illustration.
    // Quiet lower-wall joinery rather than a full wall of repeated stripes.
    for (let i = 0; i < 7; i++) box(root, .045, 1.45, .055, C.woodLight, .2 + i * .62, 1.36, -3.63)
    box(root, 4.15, .07, .1, C.woodLight, 2.12, 2.1, -3.62)
    const pictureStart = root.children.length
    picture(root, 2.5, 3.65, -3.54, def.accent)
    movable(root, `${def.id}:picture`, '植物装饰画', pictureStart, 'wall')
    // Four-pane wooden window; the mint backdrop suggests a garden beyond it.
    box(root, 2.35, 2.7, .09, C.woodDark, -2.55, 3.28, -3.57)
    box(root, 2.15, 2.5, .012, 0xb7cbb6, -2.55, 3.28, -3.5)
    box(root, .11, 2.6, .16, C.woodLight, -2.55, 3.28, -3.46)
    box(root, 2.27, .1, .16, C.woodLight, -2.55, 3.28, -3.46)
    box(root, 2.62, .16, .39, C.wood, -2.55, 1.87, -3.27)
    for (let i = 0; i < 3; i++) ball(root, .16, C.cream, -3.1 + i * .4, 3.58 + (i % 2) * .28, -3.46, [1.25, .55, .18])
    homes.push({ ...def, root, surfaces, center: new THREE.Vector3(def.x, 2.5, -1.2), quickSpot: new THREE.Vector3(def.x - 2.7, .09, 1.8) })
  }

  // 林家：藤编阅读角、叶片地毯与高低错落的植物。
  {
    const { root, surfaces } = homes[0]
    let start = root.children.length
    cylinder(root, 2.06, 2.06, .06, C.leaf, .2, .08, .52, 48, { scale: [1, 1, .73] })
    const leafVein = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.1, .13, .55), new THREE.Vector3(.1, .13, .5), new THREE.Vector3(1.45, .13, .45)])
    add(root, new THREE.TubeGeometry(leafVein, 14, .026, 6, false), C.cream, 0, 0, 0)
    start = movable(root, 'forest:rug', '叶片地毯', start, 'floor')
    const chair = new THREE.Group(); chair.position.set(-1.6, 0, 1); root.add(chair)
    wovenPanel(chair, 0, 1.52, -.52, 1.38, 1.2)
    for (const x of [-.7, .7]) {
      rod(chair, [x, .1, -.47], [x, 1.18, -.47], .07, C.woodDark)
      rod(chair, [x, .1, .54], [x, 1.07, .54], .07, C.woodDark)
      rod(chair, [x, 1.02, -.5], [x, .93, .54], .055, C.wood)
    }
    box(chair, 1.42, .24, 1.07, C.linen, 0, .91, 0, { round: .11 })
    box(chair, 1.18, .16, .46, C.sage, 0, 1.19, -.32, { round: .07 })
    start = movable(root, 'forest:chair', '藤编阅读椅', start, 'floor')
    plant(root, -3.25, 0, -.72, 1.5)
    start = movable(root, 'forest:plant-large', '落地绿植', start)
    plant(root, 3.21, 0, 1.62, .9, C.leaf)
    start = movable(root, 'forest:plant-small', '陶盆绿植', start)
    const side = table(root, 1.42, -1.55, C.woodLight, 1.45)
    surfaces.push(side.surface); placementSurfaces.push(side.surface)
    let decorStart = side.group.children.length
    cylinder(side.group, .36, .36, .06, C.ink, -.35, 1.47, 0, 30)
    cylinder(side.group, .13, .13, .015, C.cream, -.35, 1.51, 0, 30)
    decorStart = movable(side.group, 'forest:record', '黑胶唱片', decorStart)
    for (let i = 0; i < 3; i++) {
      box(side.group, .43, .045, .31, [C.clay, C.sage, C.blue][i], .34, 1.48 + i * .05, -.1)
      decorStart = movable(side.group, `forest:book-${i}`, '阅读小册', decorStart)
    }
    start = movable(root, 'forest:table', '唱片边桌', start, 'floor')
    shelf(root, 1.3, 3.34, -3.2, 2.5, surfaces)
    start = movable(root, 'forest:shelf', '木搁架', start, 'wall')
    plant(root, 2.05, 3.4, -3.22, .48)
    start = movable(root, 'forest:plant-shelf', '架上盆栽', start)
    wovenPanel(root, -3.74, 2.5, .78, .5, 1.45)
    movable(root, 'forest:woven', '藤编装饰', start, 'wall')
  }

  // 陈家：家用厨房、餐桌、陶罐和柔软的奶油色墙面。
  {
    const { root, surfaces } = homes[1]
    let start = root.children.length
    box(root, 5.5, 1.45, 1.35, C.cream, 1.05, .73, -2.65, { round: .08 })
    const counter = box(root, 5.7, .18, 1.53, C.wood, 1.05, 1.51, -2.65, { round: .04 })
    surfaces.push(counter); placementSurfaces.push(counter)
    for (let i = 0; i < 4; i++) {
      box(root, 1.25, 1.16, .075, i % 2 ? C.woodLight : C.linen, -1.05 + i * 1.38, .78, -1.93, { round: .03 })
      ball(root, .055, C.woodDark, -.59 + i * 1.38, .8, -1.88)
    }
    start = movable(root, 'kitchen:counter', '厨房地柜', start, 'floor')
    const dining = table(root, -1.22, 1.02, C.woodLight, 2.65)
    surfaces.push(dining.surface); placementSurfaces.push(dining.surface)
    start = movable(root, 'kitchen:table', '木餐桌', start, 'floor')
    for (const x of [-2.3, -.12]) {
      box(root, .86, .2, .77, C.cane, x, .72, 2.28, { round: .07 })
      wovenPanel(root, x, 1.24, 2.63, .67, .84)
      for (const dx of [-.31, .31]) rod(root, [x + dx, .09, 2.05], [x + dx, .64, 2.05], .045, C.woodDark)
      start = movable(root, `kitchen:chair-${x}`, '藤编餐椅', start, 'floor')
    }
    for (let i = 0; i < 3; i++) {
      cylinder(root, .2, .16, .42 + i * .12, i % 2 ? C.clay : C.cream, -.65 + i * .52, 1.79 + i * .06, -2.45, 14)
      start = movable(root, `kitchen:jar-${i}`, '陶瓷罐', start)
    }
    cylinder(root, .39, .39, .06, C.clay, -1.52, 1.46, .82, 24)
    ball(root, .22, C.yellow, -1.64, 1.65, .8, [.9, .7, 1])
    ball(root, .18, C.wood, -1.28, 1.63, .8, [1, .7, .9])
    start = movable(root, 'kitchen:plate', '面包餐盘', start)
    shelf(root, 2.2, 3.27, -3.18, 2.9, surfaces)
    start = movable(root, 'kitchen:shelf', '厨房搁架', start, 'wall')
    for (let i = 0; i < 4; i++) {
      cylinder(root, .15, .13, .25, i % 2 ? C.cream : C.clay, 1.35 + i * .49, 3.48, -3.18, 16)
      start = movable(root, `kitchen:cup-${i}`, '陶瓷杯', start)
    }
    plant(root, 3.3, 0, 1.55, .86, C.leafLight)
    movable(root, 'kitchen:plant', '厨房绿植', start)
  }

  // Low-volume street lights and stepping stones give the overview a street identity.
  for (const x of [-5.25, 5.25, 15.75]) {
    cylinder(street, .11, .17, 2.2, C.woodDark, x, .97, 4.67, 12)
    ball(street, .18, C.yellow, x, 2.16, 4.67, [1, 1.15, 1])
    cylinder(street, .3, .27, .13, C.woodDark, x, 2.38, 4.67, 12)
  }
  // Use one coordinate space for all independent props and furniture.
  for (const item of movableItems) {
    const homeRoot = homes.find(home => home.id === item.homeId).root
    homeRoot.attach(item.model)
  }
  return { homes, movableItems, street }
}
