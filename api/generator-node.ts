import { upload } from '@fn/cs/server'
import { mongodb } from '@fn/mongodb'

type NodeJob = {
  jobId: string
  userId: string
  title: string
  difficulty: '简单' | '普通' | '困难'
  category: '动物' | '风景' | '世界名画'
  sourceUrl: string
  sourceName: string
  state: 'queued' | 'processing' | 'completed' | 'failed'
  nodeId?: string
}

const jobs = mongodb.collection<NodeJob & Record<string, unknown>>('generation_jobs')

function authorized(request: Request) {
  const expected = process.env.GENERATOR_NODE_TOKEN
  return Boolean(expected && request.headers.get('x-generator-node-token') === expected)
}

function pathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ message: '生成节点未授权' }, { status: 401 })
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null
  const action = payload?.action
  const nodeId = typeof payload?.nodeId === 'string' ? payload.nodeId.slice(0, 80) : ''
  if (!nodeId) return Response.json({ message: '缺少节点标识' }, { status: 400 })

  if (action === 'claim') {
    return Response.json({ message: '数字填色任务已迁移至 FN 云端处理，无需本机生成节点。' }, { status: 410 })
  }

  const jobId = typeof payload?.jobId === 'string' ? payload.jobId : ''
  if (!jobId) return Response.json({ message: '缺少任务标识' }, { status: 400 })
  const job = await jobs.findOne({ jobId, state: 'processing', nodeId })
  if (!job) return Response.json({ message: '任务不可回传' }, { status: 409 })

  if (action === 'fail') {
    const error = typeof payload?.error === 'string' ? payload.error.slice(0, 500) : '本机生成节点处理失败'
    await jobs.updateOne({ jobId, state: 'processing', nodeId }, { $set: { state: 'failed', error, updatedAt: new Date().toISOString() } })
    return Response.json({ ok: true })
  }

  if (action !== 'complete') return Response.json({ message: '未知节点操作' }, { status: 400 })
  const previewBase64 = typeof payload?.previewBase64 === 'string' ? payload.previewBase64 : ''
  const verifyBase64 = typeof payload?.verifyBase64 === 'string' ? payload.verifyBase64 : ''
  const level = payload?.level
  if (!previewBase64 || !verifyBase64 || !level || typeof level !== 'object') return Response.json({ message: '生成结果不完整' }, { status: 400 })
  try {
    const prefix = `coloring-game/generated/${pathPart(String(job.userId))}/${pathPart(jobId)}`
    const preview = await upload(Buffer.from(previewBase64, 'base64'), { path: prefix, name: 'preview.png' })
    const verify = await upload(Buffer.from(verifyBase64, 'base64'), { path: prefix, name: 'verify.png' })
    const normalized: Record<string, unknown> = {
      ...(level as Record<string, unknown>),
      source: job.sourceUrl,
      preview: preview.url,
      verify: verify.url,
      custom: true,
    }
    const config = await upload(Buffer.from(JSON.stringify(normalized), 'utf8'), { path: prefix, name: 'level.json' })
    const regions = Array.isArray(normalized.regions) ? normalized.regions.length : 0
    const colors = Array.isArray(normalized.palette) ? normalized.palette.length : 0
    const now = new Date().toISOString()
    await jobs.updateOne({ jobId, state: 'processing', nodeId }, { $set: { state: 'completed', levelUrl: config.url, previewUrl: preview.url, verifyUrl: verify.url, regions, colors, completedAt: now, updatedAt: now } })
    return Response.json({ ok: true, levelUrl: config.url })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : '生成结果上传失败'
    await jobs.updateOne({ jobId, state: 'processing', nodeId }, { $set: { state: 'failed', error: message, updatedAt: new Date().toISOString() } })
    return Response.json({ message }, { status: 500 })
  }
}

function claimJob(job: NodeJob) {
  return { jobId: job.jobId, title: job.title, difficulty: job.difficulty, category: job.category, sourceUrl: job.sourceUrl, sourceName: job.sourceName }
}
