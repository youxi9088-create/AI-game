import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'path'; d: string }
type Region = { id: string; color: number; shape?: Shape; maskId?: number }
type PixelGrid = { columns: number; rows: number; cells: number[] }
type Category = '推荐' | '动物' | '风景' | '世界名画'
type Painting = { id: string; title: string; caption: string; category: Category; palette: string[]; regions: Region[]; viewBox: string; maskMode?: boolean; pixelGrid?: PixelGrid; lineart?: string; outline?: string; regionMaskWeb?: string; preview?: string; verify?: string; difficulty?: string; imported?: boolean }
type SavedProgress = Record<string, Record<string, number>>
type SubmittedWorks = Record<string, { submittedAt: string }>
type HistoryAction = { changes: { regionId: string; previous?: number }[] }

const STORAGE_KEY = 'colorverse-paint-by-number-v1'
const IMPORTED_STORAGE_KEY = 'colorverse-paint-by-number-imports-v1'
const SUBMITTED_STORAGE_KEY = 'colorverse-paint-by-number-submitted-v1'
const DEFAULT_IMPORTED_LEVELS = ['/levels/number-mona-lisa-1787923006/level.json']
const REMOVED_PRESET_IDS = new Set(['paint-garden-cat', 'paint-balloon-trip'])

const builtInPaintings: Painting[] = [
  {
    id: 'paint-garden-cat', title: '花园里的小猫', caption: '温暖午后 · 动物', category: '动物', viewBox: '0 0 640 480',
    palette: ['#F7CF76', '#ED9171', '#9DD7E8', '#6BB773', '#5A7993', '#F4ECDC', '#30443A'],
    regions: [
      { id: 'sky', color: 2, shape: { kind: 'rect', x: 0, y: 0, width: 640, height: 290 } }, { id: 'grass', color: 3, shape: { kind: 'rect', x: 0, y: 290, width: 640, height: 190 } },
      { id: 'sun', color: 0, shape: { kind: 'circle', cx: 105, cy: 94, r: 46 } }, { id: 'cloud', color: 5, shape: { kind: 'path', d: 'M256 113c0-23 19-42 42-42 15 0 28 8 35 20 7-7 16-11 27-11 23 0 42 19 42 42 0 23-19 41-42 41H298c-23 0-42-19-42-42z' } },
      { id: 'house', color: 1, shape: { kind: 'rect', x: 466, y: 238, width: 122, height: 108, rx: 6 } }, { id: 'roof', color: 4, shape: { kind: 'path', d: 'M442 240 527 169l85 71z' } }, { id: 'door', color: 6, shape: { kind: 'rect', x: 506, y: 281, width: 38, height: 65, rx: 8 } },
      { id: 'cat', color: 1, shape: { kind: 'path', d: 'M242 391c0-72 38-128 91-128 55 0 98 55 98 128H242z M274 248l11-78 46 46m45 0 46-46 10 79' } }, { id: 'chest', color: 5, shape: { kind: 'path', d: 'M300 323c17 13 56 13 69 0l-34 60z' } },
      { id: 'flower-a', color: 1, shape: { kind: 'circle', cx: 124, cy: 363, r: 25 } }, { id: 'flower-b', color: 0, shape: { kind: 'circle', cx: 543, cy: 406, r: 24 } }, { id: 'path', color: 0, shape: { kind: 'path', d: 'M0 438c110-32 195-19 275 13 88 34 197 27 365-7v36H0z' } },
    ],
  },
  {
    id: 'paint-balloon-trip', title: '气球旅行', caption: '轻盈旅行 · 风景', category: '风景', viewBox: '0 0 640 480',
    palette: ['#F7C7D8', '#F5A55E', '#F3E8CF', '#A5DAEA', '#71B77A', '#746093', '#E86F59', '#2C4D59'],
    regions: [
      { id: 'sky', color: 3, shape: { kind: 'rect', x: 0, y: 0, width: 640, height: 480 } }, { id: 'hill-a', color: 4, shape: { kind: 'path', d: 'M0 480V385c102-120 228-86 340 95H0z' } }, { id: 'hill-b', color: 2, shape: { kind: 'path', d: 'M261 480c112-146 267-151 379-48v48H261z' } },
      { id: 'balloon-a', color: 0, shape: { kind: 'circle', cx: 177, cy: 148, r: 82 } }, { id: 'balloon-b', color: 1, shape: { kind: 'circle', cx: 314, cy: 104, r: 66 } }, { id: 'balloon-c', color: 6, shape: { kind: 'circle', cx: 445, cy: 154, r: 83 } },
      { id: 'rope-a', color: 7, shape: { kind: 'path', d: 'M175 230 290 362l8-6-113-128z' } }, { id: 'rope-b', color: 7, shape: { kind: 'path', d: 'M311 168 298 358l8 0 14-190z' } }, { id: 'rope-c', color: 7, shape: { kind: 'path', d: 'm445 235-145 122 5 6 145-123z' } },
      { id: 'home', color: 2, shape: { kind: 'rect', x: 246, y: 336, width: 116, height: 95, rx: 7 } }, { id: 'home-roof', color: 5, shape: { kind: 'path', d: 'm222 338 82-74 82 74z' } }, { id: 'home-door', color: 7, shape: { kind: 'rect', x: 288, y: 378, width: 34, height: 53, rx: 8 } },
    ],
  },
]

function ShapeNode({ region, fill, stroke }: { region: Region; fill: string; stroke: string }) {
  if (!region.shape) return null
  const shared = { fill, stroke, strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' as const }
  if (region.shape.kind === 'rect') return <rect {...region.shape} {...shared} />
  if (region.shape.kind === 'circle') return <circle {...region.shape} {...shared} />
  return <path d={region.shape.d} {...shared} />
}

function Preview({ painting, colors }: { painting: Painting; colors: Record<string, number> }) {
  if (painting.maskMode && (painting.preview || painting.lineart)) return <img className={`pbn-preview ${painting.pixelGrid ? 'pbn-preview--pixel' : 'pbn-preview--lineart'}`} src={painting.preview ?? painting.lineart} alt="" />
  return <svg className="pbn-preview" viewBox={painting.viewBox} aria-hidden="true"><rect width="100%" height="100%" fill="#fffdf8" />{painting.regions.map((region) => <ShapeNode key={region.id} region={region} fill={colors[region.id] === region.color ? painting.palette[region.color] : '#fffdf8'} stroke="#514d48" />)}</svg>
}

type MaskArtwork = { width: number; height: number; ids: Uint16Array; pixelsById: Map<number, number[]> }

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('区域 Mask 加载失败'))
    image.src = source
  })
}

function ImportedMaskCanvas({ painting, colors, selectedColor, onPaint }: { painting: Painting; colors: Record<string, number>; selectedColor: number; onPaint: (region: Region) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const artworkRef = useRef<MaskArtwork | null>(null)
  const [revision, setRevision] = useState(0)
  const regionsByMask = useMemo(() => new Map(painting.regions.filter((region) => region.maskId).map((region) => [region.maskId!, region])), [painting.regions])

  function redraw(current = colors) {
    const canvas = canvasRef.current
    const artwork = artworkRef.current
    if (!canvas || !artwork) return
    if (canvas.width !== artwork.width || canvas.height !== artwork.height) { canvas.width = artwork.width; canvas.height = artwork.height }
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(artwork.width, artwork.height)
    for (const [maskId, region] of regionsByMask) {
      const chosen = current[region.id]
      if (chosen === undefined) continue
      const hex = painting.palette[chosen] ?? '#000000'
      const red = Number.parseInt(hex.slice(1, 3), 16)
      const green = Number.parseInt(hex.slice(3, 5), 16)
      const blue = Number.parseInt(hex.slice(5, 7), 16)
      const [edgeRed, edgeGreen, edgeBlue] = chosen === region.color ? [86, 160, 108] : [212, 87, 80]
      for (const pixelIndex of artwork.pixelsById.get(maskId) ?? []) {
        const offset = pixelIndex * 4
        image.data[offset] = red; image.data[offset + 1] = green; image.data[offset + 2] = blue; image.data[offset + 3] = 255
        const x = pixelIndex % artwork.width
        const y = Math.floor(pixelIndex / artwork.width)
        const ids = artwork.ids
        const boundary = (x > 0 && ids[pixelIndex - 1] !== maskId) || (x + 1 < artwork.width && ids[pixelIndex + 1] !== maskId) || (y > 0 && ids[pixelIndex - artwork.width] !== maskId) || (y + 1 < artwork.height && ids[pixelIndex + artwork.width] !== maskId)
        if (boundary) { image.data[offset] = edgeRed; image.data[offset + 1] = edgeGreen; image.data[offset + 2] = edgeBlue }
      }
    }
    context.putImageData(image, 0, 0)
  }

  useEffect(() => {
    let active = true
    if (!painting.regionMaskWeb) return
    void loadImage(painting.regionMaskWeb).then((image) => {
      const work = document.createElement('canvas')
      work.width = image.naturalWidth; work.height = image.naturalHeight
      const context = work.getContext('2d', { willReadFrequently: true })
      if (!context || !active) return
      context.drawImage(image, 0, 0)
      const raw = context.getImageData(0, 0, work.width, work.height).data
      const ids = new Uint16Array(work.width * work.height)
      const pixelsById = new Map<number, number[]>()
      for (let index = 0; index < ids.length; index += 1) {
        const id = raw[index * 4] + raw[index * 4 + 1] * 256
        ids[index] = id
        if (!id) continue
        const pixels = pixelsById.get(id) ?? []
        pixels.push(index)
        pixelsById.set(id, pixels)
      }
      artworkRef.current = { width: work.width, height: work.height, ids, pixelsById }
      if (active) setRevision((value) => value + 1)
    }).catch(() => undefined)
    return () => { active = false }
  }, [painting.regionMaskWeb])

  useEffect(() => { redraw() }, [colors, revision])

  function paintAt(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const artwork = artworkRef.current
    if (!canvas || !artwork) return
    const bounds = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(artwork.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * artwork.width)))
    const y = Math.max(0, Math.min(artwork.height - 1, Math.floor((event.clientY - bounds.top) / bounds.height * artwork.height)))
    const region = regionsByMask.get(artwork.ids[y * artwork.width + x])
    if (region && selectedColor >= 0) onPaint(region)
  }

  return <canvas ref={canvasRef} className="pbn-imported-mask" width={1} height={1} onPointerDown={paintAt} />
}

function PixelNumberCanvas({ painting, colors, selectedColor, onPaint }: { painting: Painting; colors: Record<string, number>; selectedColor: number; onPaint: (region: Region) => void }) {
  const grid = painting.pixelGrid
  if (!grid) return null
  const cells = grid.cells
  return <svg className="pbn-pixel-canvas" style={{ aspectRatio: `${grid.columns} / ${grid.rows}` }} viewBox={`0 0 ${grid.columns} ${grid.rows}`} aria-label={`${painting.title} 数字填色网格`}>
    <rect width={grid.columns} height={grid.rows} fill="#fffdf8" />
    {cells.map((targetColor, index) => {
      const column = index % grid.columns; const row = Math.floor(index / grid.columns)
      const region = painting.regions[index]
      const chosen = colors[region.id]; const painted = chosen !== undefined; const correct = chosen === targetColor; const highlighted = !painted && selectedColor === targetColor
      const source = painting.palette[targetColor].slice(1)
      const [red, green, blue] = [Number.parseInt(source.slice(0, 2), 16), Number.parseInt(source.slice(2, 4), 16), Number.parseInt(source.slice(4, 6), 16)]
      const guideTones = [185, 150, 205, 115, 170, 230, 75, 135, 165, 190, 145, 105, 140, 120, 200, 175]
      const tone = guideTones[targetColor] ?? Math.round(46 + (.2126 * red + .7152 * green + .0722 * blue) * .58)
      const guideFill = highlighted ? '#FFF3B8' : `rgb(${tone}, ${tone}, ${tone})`
      return <g key={region.id} onPointerDown={() => onPaint(region)}>
        <rect x={column} y={row} width="1" height="1" fill={painted ? painting.palette[chosen] : guideFill} stroke={painted ? correct ? '#56a06c' : '#d45750' : highlighted ? '#755CC2' : '#f1f1ee'} strokeWidth={highlighted ? '.1' : '.055'} vectorEffect="non-scaling-stroke" />
        {!painted && <text x={column + .5} y={row + .58} textAnchor="middle" fontSize={highlighted ? '.44' : '.34'} fill={highlighted ? '#5B44A6' : tone < 135 ? '#fff' : '#42403c'} pointerEvents="none">{targetColor + 1}</text>}
      </g>
    })}
  </svg>
}

function normalizeImportedLevel(level: unknown): Painting | null {
  if (!level || typeof level !== 'object') return null
  const candidate = level as Partial<Painting>
  if (!candidate.id || !Array.isArray(candidate.palette) || !Array.isArray(candidate.regions)) return null
  const rawGrid = candidate.pixelGrid
  const pixelGrid = rawGrid && Number.isInteger(rawGrid.columns) && Number.isInteger(rawGrid.rows) && Array.isArray(rawGrid.cells) && rawGrid.cells.length === rawGrid.columns * rawGrid.rows ? rawGrid : undefined
  const asset = (path?: string) => path ? /^https?:\/\//.test(path) ? path : import.meta.env.BASE_URL + path.replace(/^\//, '') : undefined
  return {
    id: candidate.id,
    title: candidate.title || 'AI 填色线稿',
    caption: `AI 创作 · ${typeof candidate.difficulty === 'string' ? candidate.difficulty : '普通'}`,
    category: candidate.category === '动物' || candidate.category === '风景' || candidate.category === '世界名画' ? candidate.category : '推荐',
    palette: candidate.palette,
    regions: pixelGrid ? pixelGrid.cells.map((color, index) => ({ id: `cell-${index}`, color })) : candidate.regions,
    viewBox: candidate.viewBox || '0 0 1 1',
    maskMode: true,
    pixelGrid,
    lineart: asset(candidate.lineart),
    outline: asset(candidate.outline),
    regionMaskWeb: asset(candidate.regionMaskWeb),
    preview: asset(candidate.preview),
    verify: asset(candidate.verify ?? candidate.preview),
    difficulty: typeof candidate.difficulty === 'string' ? candidate.difficulty : '普通',
    imported: true,
  }
}

function resolveLevelUrl(value: string | null) {
  if (!value) return null
  if (/^\/levels\/(?:ai-level-\d+|number-[a-z0-9-]+)\/level\.json$/.test(value)) return `${import.meta.env.BASE_URL}${value.replace(/^\//, '')}`
  try {
    const url = new URL(value)
    // Generated visitor levels live on FN's public object-storage CDN. Do not
    // accept arbitrary remote URLs from a query string.
    if (url.protocol === 'https:' && url.hostname === 'gcdncs.cn.ndhy.com' && /\/level\.json$/.test(url.pathname)) return url.href
  } catch { /* invalid level URL */ }
  return null
}

export default function PaintByNumberApp() {
  const [screen, setScreen] = useState<'gallery' | 'canvas' | 'collection'>('gallery')
  const [category, setCategory] = useState<Category>('推荐')
  const [importedPaintings, setImportedPaintings] = useState<Painting[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(IMPORTED_STORAGE_KEY) ?? '[]') as unknown
      return Array.isArray(saved) ? saved.filter((item): item is Painting => Boolean(item && typeof item === 'object' && 'id' in item && ('regionMaskWeb' in item || 'pixelGrid' in item))) : []
    } catch { return [] }
  })
  const [progress, setProgress] = useState<SavedProgress>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedProgress } catch { return {} }
  })
  const [submitted, setSubmitted] = useState<SubmittedWorks>(() => {
    try { return JSON.parse(localStorage.getItem(SUBMITTED_STORAGE_KEY) ?? '{}') as SubmittedWorks } catch { return {} }
  })
  const [showReference, setShowReference] = useState(false)
  const [importError, setImportError] = useState('')
  const paintings = useMemo(() => [...importedPaintings, ...builtInPaintings], [importedPaintings])
  const visiblePaintings = useMemo(() => paintings.filter((item) => !REMOVED_PRESET_IDS.has(item.id)), [paintings])
  const [activeId, setActiveId] = useState(builtInPaintings[0].id)
  const [selectedColor, setSelectedColor] = useState(0)
  const [history, setHistory] = useState<HistoryAction[]>([])
  const [notice, setNotice] = useState('选择底部颜色，再点击画面中的区域。')
  const [zoom, setZoom] = useState(1)

  const painting = paintings.find((item) => item.id === activeId) ?? paintings[0]
  const colors = progress[painting.id] ?? {}
  const completeIds = useMemo(() => painting.regions.filter((region) => colors[region.id] === region.color).map((region) => region.id), [colors, painting])
  const completion = Math.round(completeIds.length / painting.regions.length * 100)
  const isFinished = completeIds.length === painting.regions.length
  const isSubmitted = Boolean(submitted[painting.id])
  const gallery = visiblePaintings.filter((item) => category === '推荐' || item.category === category)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)) }, [progress])
  useEffect(() => { localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(importedPaintings)) }, [importedPaintings])
  useEffect(() => { localStorage.setItem(SUBMITTED_STORAGE_KEY, JSON.stringify(submitted)) }, [submitted])
  useEffect(() => {
    void Promise.all(DEFAULT_IMPORTED_LEVELS.map(async (levelPath) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${levelPath.replace(/^\//, '')}`)
      if (!response.ok) throw new Error('默认关卡文件读取失败')
      return normalizeImportedLevel(await response.json())
    })).then((defaults) => {
      const valid = defaults.filter((item): item is Painting => item !== null)
      if (!valid.length) return
      setImportedPaintings((current) => [...valid.filter((item) => !current.some((saved) => saved.id === item.id)), ...current])
    }).catch(() => undefined)
  }, [])
  useEffect(() => {
    const levelUrl = resolveLevelUrl(new URLSearchParams(window.location.search).get('level'))
    if (!levelUrl) return
    setImportError('')
    void fetch(levelUrl).then(async (response) => {
      if (!response.ok) throw new Error('关卡文件读取失败')
      return normalizeImportedLevel(await response.json())
    }).then((imported) => {
      if (!imported) throw new Error('关卡文件格式不正确')
      setImportedPaintings((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
      setActiveId(imported.id); setScreen('canvas'); setHistory([]); setNotice(imported.pixelGrid ? '数字填色关卡已导入。选择底部编号颜色，再点击画面中相同数字的方格。' : 'AI 关卡已导入。选择底部颜色，再点击线稿中的区域。')
      window.history.replaceState({}, '', './paint.html')
    }).catch((reason: unknown) => {
      const message = reason instanceof Error ? `关卡导入失败：${reason.message}` : '关卡导入失败。'
      setNotice(message); setImportError(message)
    })
  }, [])

  function openPainting(next: Painting) {
    setActiveId(next.id); setSelectedColor(0); setHistory([]); setZoom(1); setNotice('选择底部颜色，再点击画面中的区域。'); setScreen('canvas')
  }
  function paint(region: Region) {
    const before = colors[region.id]
    setHistory((current) => [...current.slice(-99), { changes: [{ regionId: region.id, previous: before }] }])
    setProgress((current) => ({ ...current, [painting.id]: { ...(current[painting.id] ?? {}), [region.id]: selectedColor } }))
    setNotice(selectedColor === region.color ? '颜色正确，继续完成这幅画。' : '颜色已填入，边缘变红；可选择其他颜色再次填色。')
  }
  function autoPaint() {
    if (!painting.pixelGrid) return
    const changes = painting.regions.filter((region) => region.color === selectedColor && colors[region.id] !== selectedColor).map((region) => ({ regionId: region.id, previous: colors[region.id] }))
    if (!changes.length) { setNotice(`${selectedColor + 1} 号颜色已经全部完成。`); return }
    setHistory((current) => [...current.slice(-99), { changes }])
    setProgress((current) => ({ ...current, [painting.id]: { ...(current[painting.id] ?? {}), ...Object.fromEntries(changes.map(({ regionId }) => [regionId, selectedColor])) } }))
    setNotice(`自动涂抹已完成 ${selectedColor + 1} 号颜色的 ${changes.length} 个方格。`)
  }
  function undo() {
    const latest = history.at(-1)
    if (!latest) { setNotice('还没有可撤销的填色。'); return }
    setHistory((current) => current.slice(0, -1))
    setProgress((current) => { const next = { ...(current[painting.id] ?? {}) }; latest.changes.forEach(({ regionId, previous }) => { if (previous === undefined) delete next[regionId]; else next[regionId] = previous }); return { ...current, [painting.id]: next } })
    setNotice(latest.changes.length > 1 ? '已撤销自动涂抹。' : '已撤销上一步。')
  }
  function reset() { setProgress((current) => ({ ...current, [painting.id]: {} })); setHistory([]); setNotice('本幅画已重置。') }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); setNotice('进度已保存到本机。') }
  function submit() {
    if (!isFinished) { setNotice('完成所有区域后才能提交作品。'); return }
    setSubmitted((current) => ({ ...current, [painting.id]: { submittedAt: new Date().toLocaleString() } }))
    setNotice('作品已提交到本机作品集。')
  }

  if (screen === 'collection') return <div className="pbn-app"><header className="pbn-header"><a href="./index.html">← 真人线稿工坊</a><strong>我的作品</strong><button onClick={() => setScreen('gallery')}>返回画册</button></header><main className="pbn-page"><section className="pbn-intro"><p>MY COLLECTION</p><h1>已点亮的画作</h1></section><div className="pbn-gallery">{visiblePaintings.map((item) => <article className="pbn-card" key={item.id}><div className="pbn-card-image"><Preview painting={item} colors={progress[item.id] ?? {}} /></div><h2>{item.title}</h2><small>{(progress[item.id] ? Object.keys(progress[item.id]).length : 0)} / {item.regions.length} 已填色</small></article>)}</div></main></div>

  if (screen === 'gallery') return <div className="pbn-app"><header className="pbn-header"><a href="./index.html">← 真人线稿工坊</a><strong>ColorVerse · 数字涂色</strong><a href="./number-workshop.html">＋ 数字填色工作坊</a></header><main className="pbn-page"><section className="pbn-intro"><p>PAINT BY NUMBER</p><h1>今天想涂哪一幅？</h1><span>选择颜色，按方格内的数字点击填色；每一格都是独立的可填区域。</span></section><div className="pbn-tabs">{(['推荐', '世界名画'] as const).map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><section className="pbn-gallery">{gallery.map((item) => { const previous = paintings[paintings.indexOf(item) - 1]; const locked = !item.imported && Boolean(previous && Object.keys(progress[previous.id] ?? {}).filter((id) => (progress[previous.id] ?? {})[id] === previous.regions.find((region) => region.id === id)?.color).length < previous.regions.length); const itemProgress = Object.keys(progress[item.id] ?? {}).filter((id) => (progress[item.id] ?? {})[id] === item.regions.find((region) => region.id === id)?.color).length; return <article className={`pbn-card ${locked ? 'locked' : ''}`} key={item.id}><div className="pbn-card-image"><Preview painting={item} colors={progress[item.id] ?? {}} />{locked && <b>🔒</b>}</div><div className="pbn-card-title"><div><h2>{item.title}</h2><p>{item.difficulty ?? item.caption} · {Math.round(itemProgress / item.regions.length * 100)}% 完成</p></div></div><button className="pbn-primary" disabled={locked} onClick={() => openPainting(item)}>{locked ? '完成上一幅解锁' : itemProgress ? '继续填色' : '开始填色'}</button></article> })}</section></main></div>

  return <div className="pbn-app pbn-canvas-app">
    <header className="pbn-header"><button onClick={() => setScreen('gallery')}>← 返回画册</button><strong>{painting.title}</strong><div>{painting.pixelGrid && <><button onClick={() => setZoom((value) => Math.max(.6, Number((value - .2).toFixed(1))))}>－ 缩小</button><button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom((value) => Math.min(3, Number((value + .2).toFixed(1))))}>＋ 放大</button></>}<button onClick={undo}>撤销</button><button onClick={reset}>重置</button><button onClick={save}>保存</button><button onClick={submit}>{isSubmitted ? '已提交' : '提交作品'}</button></div></header>
    <main className="pbn-canvas-layout"><aside className="pbn-side"><p>本幅进度</p><strong>{completion}%</strong><div className="pbn-progress"><span style={{ width: `${completion}%` }} /></div><small>{completeIds.length} / {painting.regions.length} 个区域正确</small>{painting.pixelGrid && <section className="pbn-tools"><p>道具栏</p><button onClick={autoPaint}>✦ 自动涂抹 {selectedColor + 1} 号</button><small>填满当前选中编号的全部方格，可一次撤销。</small></section>}{painting.verify && <button className="pbn-reference-button" onClick={() => setShowReference(true)}>查看完成效果</button>}<hr /><p>{notice}</p></aside><section className="pbn-stage">{painting.pixelGrid ? <div className="pbn-zoom-scroll"><div className="pbn-zoom-content" style={{ width: `${zoom * 80}%` }}><PixelNumberCanvas painting={painting} colors={colors} selectedColor={selectedColor} onPaint={paint} /></div></div> : painting.maskMode ? <div className="pbn-imported-stage" style={{ aspectRatio: painting.viewBox.replace(/^0 0 /, '').replace(' ', ' / ') }}><img className="pbn-imported-outline" src={painting.outline ?? painting.lineart} alt={`${painting.title} 线稿`} /><ImportedMaskCanvas painting={painting} colors={colors} selectedColor={selectedColor} onPaint={paint} /></div> : <svg className="pbn-canvas" viewBox={painting.viewBox} aria-label={`${painting.title} 数字涂色画布`}><rect width="100%" height="100%" fill="#fffdf8" />{painting.regions.map((region) => { const chosen = colors[region.id]; const painted = chosen !== undefined; const correct = chosen === region.color; return <g key={region.id} onPointerDown={() => paint(region)}><ShapeNode region={region} fill={painted ? painting.palette[chosen] : '#fffdf8'} stroke={painted ? correct ? '#56a06c' : '#d45750' : '#4f4b47'} /></g> })}</svg>}</section></main>
    <footer className="pbn-palette">{painting.palette.map((color, index) => { const remaining = painting.regions.filter((region) => region.color === index && colors[region.id] !== index).length; return <button key={color} className={selectedColor === index ? 'active' : ''} onClick={() => { setSelectedColor(index); setNotice(remaining ? `已选择 ${index + 1} 号颜色，请点击画面中相同数字的方格。` : `${index + 1} 号颜色已经全部完成。`) }}><i style={{ background: color }} />{remaining ? <em>{index + 1}</em> : <b>✓</b>}</button> })}</footer>
    {showReference && painting.verify && <div className="pbn-reference-modal" onPointerDown={() => setShowReference(false)}><section onPointerDown={(event) => event.stopPropagation()}><button onClick={() => setShowReference(false)}>×</button><p>完成效果参考</p><img src={painting.verify} alt={`${painting.title} 的完成效果`} /></section></div>}
    {isFinished && <div className="pbn-finish"><section><span>✦</span><p>完成作品</p><h1>这幅画被你点亮了！</h1><button className="pbn-primary" onClick={submit}>{isSubmitted ? '已提交到作品集' : '提交作品'}</button></section></div>}
  </div>
}
