import { upload } from '@fn/cs/server'

const supportedImages = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxBytes = 15 * 1024 * 1024

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin') ?? ''
  if (/^https:\/\/f\.new\.ndhy\.com$/i.test(origin)) return origin
  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return origin
  return ''
}

function headers(request: Request) {
  const origin = allowedOrigin(request)
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'reference.png'
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: headers(request) })
}

/**
 * 只负责将浏览器选中的参考图保存为 AIHub 可访问的 CS 地址。
 * AIHub token 不会经过浏览器；后续由本机 Python 服务调用图生图工作流。
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ message: '请选择参考图片' }, { status: 400, headers: headers(request) })
  if (!supportedImages.has(file.type)) return Response.json({ message: '仅支持 JPG、PNG 或 WebP 图片' }, { status: 400, headers: headers(request) })
  if (file.size <= 0 || file.size > maxBytes) return Response.json({ message: '图片大小需在 1B 到 15MB 之间' }, { status: 400, headers: headers(request) })

  try {
    const requestId = crypto.randomUUID()
    const asset = await upload(Buffer.from(await file.arrayBuffer()), {
      path: `coloring-game/level-references/guest/${requestId}`,
      name: safeName(file.name),
    })
    return Response.json({ url: asset.url, name: safeName(file.name) }, { status: 201, headers: headers(request) })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : '参考图上传失败'
    return Response.json({ message }, { status: 500, headers: headers(request) })
  }
}
