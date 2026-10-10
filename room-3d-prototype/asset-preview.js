import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { categories, enrichAsset, filterAssets } from './asset-catalog.js'
import './asset-preview.css'
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.append(renderer.domElement)
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ddd9ce')
scene.add(new THREE.HemisphereLight(0xfff9ef, 0x737b80, 2.4))
const key = new THREE.DirectionalLight(0xfff4df, 2.5); key.position.set(5, 8, 6); scene.add(key)
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .01, 1000)
const controls = new OrbitControls(camera, renderer.domElement)
const select = document.querySelector('#asset'), status = document.querySelector('#status')
const packSelect = document.querySelector('#pack'), categorySelect = document.querySelector('#category'), search = document.querySelector('#search')
const previous = document.querySelector('#previous'), next = document.querySelector('#next')
let assets = [], filtered = [], loading = false, pending = null
let current, version = 0, reset = () => {}
function dispose(model) {
  const resources = new Set()
  model.traverse(node => { if (node.isMesh) { resources.add(node.geometry); for (const material of [].concat(node.material)) { resources.add(material); for (const value of Object.values(material)) if (value?.isTexture) resources.add(value) } } })
  resources.forEach(resource => { if (resource.isTexture) resource.source?.data?.close?.(); resource.dispose() })
}
function updateNavigation() {
  previous.disabled = select.selectedIndex <= 0
  next.disabled = select.selectedIndex < 0 || select.selectedIndex >= select.options.length - 1
}
async function show() {
  const token = ++version
  updateNavigation()
  pending = select.value ? { token, url: select.value, label: select.selectedOptions[0].textContent } : null
  if (current) { scene.remove(current); dispose(current); current = null }
  reset = () => {}
  if (!pending) { status.textContent = '没有匹配的物件，请修改或清空筛选。'; return }
  status.textContent = '正在载入模型…'
  // Only one request in flight; rapid selection replaces the pending request.
  if (loading) return
  loading = true
  while (pending) {
    const request = pending; pending = null
    try {
    const gltf = await new GLTFLoader().loadAsync(request.url)
    if (request.token !== version) { dispose(gltf.scene); continue }
    current = gltf.scene; scene.add(current)
    const bounds = new THREE.Box3().setFromObject(current), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z)
    reset = () => { controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(radius * 1.45, radius * .95, radius * 1.7)); controls.update() }
    reset()
    status.textContent = `已载入 ${request.label} · 尺寸 ${size.toArray().map(n => n.toFixed(2)).join(' × ')} m`
    } catch (error) { if (request.token === version) status.textContent = `载入失败：${error.message}` }
  }
  loading = false
}
function applyFilters() {
  const old = select.value
  filtered = filterAssets(assets, packSelect.value, categorySelect.value, search.value)
  select.replaceChildren()
  for (const a of filtered) {
    const option = document.createElement('option'); option.value = a.url
    option.textContent = `${a.label} / ${a.name}`; select.append(option)
  }
  select.disabled = !filtered.length
  if (filtered.some(a => a.url === old)) select.value = old
  document.querySelector('#count').textContent = `当前 ${filtered.length.toLocaleString()} / 全部 ${assets.length.toLocaleString()} 个资源（包含 30 个房间组合）`
  updateNavigation()
  if (old !== select.value || !select.value) show()
}
async function init() {
  for (const [name] of categories) { const option = document.createElement('option'); option.value = name; option.textContent = name; categorySelect.append(option) }
  for (const [pack, label] of [['interior-1', 'Interior 1'], ['low-poly-rooms', '30 Rooms'], ['goodies-cozy', 'Goodies Cozy']]) {
    const response = await fetch(`/content/${pack}/catalog.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`${label} 清单读取失败 (${response.status})`)
    const catalog = await response.json()
    assets.push(...catalog.assets.map(a => enrichAsset(a, pack, label)))
  }
  applyFilters()
}
packSelect.addEventListener('change', applyFilters); categorySelect.addEventListener('change', applyFilters)
search.addEventListener('input', applyFilters)
document.querySelector('#clear').addEventListener('click', () => { packSelect.value = ''; categorySelect.value = ''; search.value = ''; applyFilters() })
previous.addEventListener('click', () => { if (select.selectedIndex > 0) { select.selectedIndex--; show() } })
next.addEventListener('click', () => { if (select.selectedIndex < select.options.length - 1) { select.selectedIndex++; show() } })
select.addEventListener('change', show); document.querySelector('#reset').addEventListener('click', () => reset())
function resize() { const width = innerWidth, height = Math.max(1, innerHeight - document.querySelector('header').getBoundingClientRect().bottom - 12); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height) }
addEventListener('resize', resize)
new ResizeObserver(resize).observe(document.querySelector('header'))
resize()
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
init().catch(error => { status.textContent = error.message })
