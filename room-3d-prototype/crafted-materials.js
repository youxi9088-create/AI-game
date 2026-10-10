import * as THREE from 'three'

// Small, deterministic surface studies: grain follows the timber, weave the cloth.
// These belong to the material, not a screen-space filter over the whole room.
export function craftedTextures() {
  let seed = 7143
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  function texture(kind) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#e6e2d9'; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 10000; i++) {
      ctx.fillStyle = `rgba(70,58,43,${random() * .075})`
      ctx.fillRect(random() * 256, random() * 256, 1, 1)
    }
    if (kind === 'wood') for (let i = 0; i < 115; i++) {
      const y = random() * 256
      ctx.strokeStyle = `rgba(78,57,36,${.02 + random() * .12})`
      ctx.lineWidth = .3 + random() * .9
      ctx.beginPath(); ctx.moveTo(0, y)
      ctx.bezierCurveTo(75, y + random() * 9, 166, y - random() * 9, 256, y)
      ctx.stroke()
    }
    if (kind === 'linen') for (let i = 0; i < 256; i += 3) {
      ctx.strokeStyle = i % 2 ? '#a9a39744' : '#ffffff66'
      ctx.lineWidth = .6
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke()
    }
    const result = new THREE.CanvasTexture(canvas)
    result.wrapS = result.wrapT = THREE.RepeatWrapping
    result.colorSpace = THREE.SRGBColorSpace
    result.anisotropy = 4
    return result
  }
  return { wood: texture('wood'), linen: texture('linen'), plaster: texture('plaster') }
}
