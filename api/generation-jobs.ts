import { upload } from '@fn/cs/server'
import { mongodb } from '@fn/mongodb'
import { waitUntil } from '@fn/functions'
import { generateNumberPainting } from '../lib/number-painting-generator'

type Difficulty = '简单' | '普通' | '困难'
type Category = '动物' | '风景' | '世界名画'
type GenerationJob = {
  jobId: string
  accessKey: string
  userId: string
  title: string
  difficulty: Difficulty
  category: Category
  sourceUrl: string
  sourceName: string
  state: 'queued' | 'processing' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  completedAt?: string
  levelUrl?: string
  previewUrl?: string
  verifyUrl?: string
  regions?: number
  colors?: number
  error?: string
}

const jobs = mongodb.collection<GenerationJob>('generation_jobs')
const difficulties = new Set<Difficulty>(['简单', '普通', '困难'])
const categories = new Set<Category>(['动物', '风景', '世界名画'])
const supportedImages = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxBytes = 15 * 1024 * 1024

function text(value: unknown, fallback: string, max = 80) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'upload.png'
}

function keyFrom(request: Request) {
  return request.headers.get('x-generation-access-key') ?? new URL(request.url).searchParams.get('accessKey') ?? ''
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return Response.json({ message: '请选择要生成的图片' }, { status: 400 })
  if (!supportedImages.has(file.type)) return Response.json({ message: '仅支持 JPG、PNG 或 WebP 图片' }, { status: 400 })
  if (file.size <= 0 || file.size > maxBytes) return Response.json({ message: '图片大小需在 1B 到 15MB 之间' }, { status: 400 })

  const requestedJobId = form?.get('requestId')
  const jobId = typeof requestedJobId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedJobId)
    ? requestedJobId
    : crypto.randomUUID()
  // The browser retries a request when the gateway times out before dispatch.
  // Returning the existing job makes those retries safe and prevents duplicates.
  const existing = await jobs.findOne({ jobId })
  if (existing) return Response.json({ job: publicJob(existing, true) }, { status: 202 })
  const accessKey = crypto.randomUUID()
  const difficulty = difficulties.has(form?.get('difficulty') as Difficulty) ? form?.get('difficulty') as Difficulty : '困难'
  const category = categories.has(form?.get('category') as Category) ? form?.get('category') as Category : '世界名画'
  const sourceName = safeName(text(file.name, 'upload.png', 100))

  try {
    const source = await upload(Buffer.from(await file.arrayBuffer()), {
      path: `coloring-game/uploads/guest/${jobId}`,
      name: sourceName,
      contentType: file.type,
    })
    const now = new Date().toISOString()
    const job: GenerationJob = {
      jobId,
      accessKey,
      // Guest output stays in an isolated prefix without requiring UC identity.
      userId: `guest-${jobId}`,
      title: text(form?.get('title'), '数字填色作品'),
      difficulty,
      category,
      sourceUrl: source.url,
      sourceName,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    }
    await jobs.insertOne(job)
    waitUntil(runGeneration(job))
    return Response.json({ job: publicJob(job, true) }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : '图片上传失败'
    return Response.json({ message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const jobId = url.searchParams.get('jobId')
  if (!jobId) return Response.json({ message: '缺少 jobId' }, { status: 400 })
  const accessKey = keyFrom(request)
  if (!accessKey) return Response.json({ message: '缺少任务访问凭证' }, { status: 401 })
  const job = await jobs.findOne({ jobId, accessKey })
  if (!job) return Response.json({ message: '任务不存在或访问凭证无效' }, { status: 404 })
  return Response.json({ job: publicJob(job, false) })
}

async function runGeneration(job: GenerationJob) {
  const startedAt = new Date().toISOString()
  await jobs.updateOne({ jobId: job.jobId, accessKey: job.accessKey, state: 'queued' }, { $set: { state: 'processing', updatedAt: startedAt } })
  try {
    const result = await generateNumberPainting(job)
    const completedAt = new Date().toISOString()
    await jobs.updateOne(
      { jobId: job.jobId, accessKey: job.accessKey },
      { $set: { state: 'completed', ...result, completedAt, updatedAt: completedAt } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'FN 云端图片处理失败'
    await jobs.updateOne({ jobId: job.jobId, accessKey: job.accessKey }, { $set: { state: 'failed', error: message, updatedAt: new Date().toISOString() } })
  }
}

function publicJob(job: GenerationJob, includeAccessKey: boolean) {
  return {
    jobId: job.jobId,
    ...(includeAccessKey ? { accessKey: job.accessKey } : {}),
    title: job.title,
    difficulty: job.difficulty,
    category: job.category,
    sourceUrl: job.sourceUrl,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    levelUrl: job.levelUrl,
    previewUrl: job.previewUrl,
    verifyUrl: job.verifyUrl,
    regions: job.regions,
    colors: job.colors,
    error: job.error,
  }
}
