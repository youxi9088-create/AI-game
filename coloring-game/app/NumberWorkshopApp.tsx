import { useEffect, useMemo, useRef, useState } from 'react'

type Difficulty = '简单' | '普通' | '困难'
type Category = '动物' | '风景' | '世界名画'
type Step = { id: string; title: string; description: string; status: 'queued' | 'running' | 'completed' | 'failed'; message?: string }
type JobResult = { id: string; url: string; title: string; regions: number; colors: number; preview: string; verify: string; source: string; columns?: number; rows?: number }
type LocalJob = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; steps: Step[]; result?: JobResult; error?: string }
type CloudJob = { jobId: string; accessKey?: string; title: string; state: 'queued' | 'processing' | 'completed' | 'failed'; sourceUrl: string; levelUrl?: string; previewUrl?: string; verifyUrl?: string; regions?: number; colors?: number; error?: string }
type JobView = { status: 'queued' | 'running' | 'completed' | 'failed'; steps: Step[]; result?: JobResult; error?: string }

const SERVICE = `http://${window.location.hostname}:5399`
const localNetworkHost = /^(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/
const difficultyInfo: Record<Difficulty, string> = {
  '简单': '18 色 · 28 × 38 格',
  '普通': '32 色 · 38 × 51 格',
  '困难': '48 色 · 48 × 64 格',
}

function asset(path: string) {
  return /^https?:\/\//.test(path) ? path : `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

function apiPath(path: string) {
  return new URL(`api/${path.replace(/^\//, '')}`, document.baseURI).pathname
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

async function readLocalJob(jobId: string) {
  const response = await fetch(`${SERVICE}/api/jobs/${jobId}`)
  const body = await response.json()
  if (!response.ok) throw new Error(body?.detail ?? '无法读取生成进度')
  return body as LocalJob
}

async function readCloudJob(job: CloudJob) {
  if (!job.accessKey) throw new Error('本次访客任务已失效，请重新生成。')
  const params = new URLSearchParams({ jobId: job.jobId, accessKey: job.accessKey })
  const response = await fetch(`${apiPath('generation-jobs')}?${params}`)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.message ?? '无法读取云端任务状态')
  return body.job as CloudJob
}

function cloudView(job: CloudJob): JobView {
  const completed = job.state === 'completed'
  const processing = job.state === 'processing'
  const failed = job.state === 'failed'
  const step = (id: string, title: string, description: string, status: Step['status']): Step => ({ id, title, description, status })
  return {
    status: failed ? 'failed' : completed ? 'completed' : processing ? 'running' : 'queued',
    steps: [
      step('upload', '安全上传原图', '图片已保存到 FN 对象存储，仅用于本次云端生成', 'completed'),
      step('queue', '进入云端生成队列', 'FN 已接收本次任务，正在启动后台图像处理', processing || completed ? 'completed' : failed ? 'failed' : 'running'),
      step('generate', '云端生成数字关卡', 'FN 正在裁白边、提取调色板并生成数字色块', processing ? 'running' : completed ? 'completed' : 'queued'),
      step('package', '保存关卡文件', '关卡、完成效果与预览图已写入对象存储', completed ? 'completed' : 'queued'),
      step('verify', '校验完成效果', '数字、调色板与完成效果已经就绪', completed ? 'completed' : 'queued'),
    ],
    result: completed && job.levelUrl && job.previewUrl && job.verifyUrl ? {
      id: job.jobId, url: job.levelUrl, title: job.title, regions: job.regions ?? 0, colors: job.colors ?? 0,
      preview: job.previewUrl, verify: job.verifyUrl, source: job.sourceUrl,
    } : undefined,
    error: job.error,
  }
}

export default function NumberWorkshopApp() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('困难')
  const [category, setCategory] = useState<Category>('世界名画')
  const [localJob, setLocalJob] = useState<LocalJob | null>(null)
  const [remoteJob, setRemoteJob] = useState<CloudJob | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const cloudMode = typeof window !== 'undefined' && !localNetworkHost.test(window.location.hostname)
  const job = useMemo<JobView | null>(() => remoteJob ? cloudView(remoteJob) : localJob, [localJob, remoteJob])
  const generating = submitting || job?.status === 'queued' || job?.status === 'running'
  const complete = job?.steps.filter((step) => step.status === 'completed').length ?? 0

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  useEffect(() => {
    if (!localJob || !generating || remoteJob) return
    const timer = window.setInterval(() => {
      void readLocalJob(localJob.id).then(setLocalJob).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '无法读取生成进度'))
    }, 450)
    return () => window.clearInterval(timer)
  }, [generating, localJob, remoteJob])

  useEffect(() => {
    if (!remoteJob || !['queued', 'processing'].includes(remoteJob.state)) return
    const timer = window.setInterval(() => {
      void readCloudJob(remoteJob).then((next) => setRemoteJob({ ...next, accessKey: remoteJob.accessKey })).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '无法读取云端任务状态'))
    }, 1200)
    return () => window.clearInterval(timer)
  }, [remoteJob])

  function chooseFile(next: File | null) {
    if (!next) return
    if (!next.type.startsWith('image/')) { setError('请选择 JPG、PNG 或 WebP 图片。'); return }
    if (next.size > 15 * 1024 * 1024) { setError('图片不能超过 15MB。'); return }
    setError('')
    setFile(next)
    setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 48))
    setLocalJob(null); setRemoteJob(null)
    setPreview((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(next) })
  }

  async function generateLocal() {
    if (!file) return
    const query = new URLSearchParams({ title: title.trim() || '数字填色作品', difficulty, category })
    const response = await fetch(`${SERVICE}/api/generate-number-level?${query}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.detail ?? '数字填色关卡生成失败')
    setLocalJob(await readLocalJob(body.jobId))
  }

  async function generateCloud() {
    if (!file) return
    const requestId = crypto.randomUUID()
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const form = new FormData()
      form.set('file', file)
      form.set('title', title.trim() || '数字填色作品')
      form.set('difficulty', difficulty)
      form.set('category', category)
      form.set('requestId', requestId)
      try {
        const response = await fetch(apiPath('generation-jobs'), { method: 'POST', body: form })
        const body = await response.json().catch(() => null)
        if (response.ok) {
          setRemoteJob(body.job)
          return
        }
        if (![502, 503, 504].includes(response.status)) throw new Error(body?.message ?? '数字填色关卡生成失败')
        lastError = new Error(body?.message ?? `上游暂时不可用（${response.status}）`)
      } catch (reason) {
        lastError = reason
      }
      if (attempt < 2) await wait(700 * (attempt + 1))
    }
    throw new Error(lastError instanceof Error ? `云端暂时繁忙，已自动重试 3 次：${lastError.message}` : '云端暂时繁忙，请稍后重试。')
  }

  async function generate() {
    if (!file || generating) return
    setError('')
    setSubmitting(true)
    try {
      if (cloudMode) await generateCloud()
      else await generateLocal()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '数字填色关卡生成失败。')
    } finally {
      setSubmitting(false)
    }
  }

  const actionLabel = generating ? '正在生成数字关卡…' : '生成数字填色关卡'
  const blocked = !file || generating

  return <div className="number-workshop-app">
    <header className="nw-header"><a href="./paint.html">← 数字涂色画册</a><strong>ColorVerse · 数字填色工作坊</strong><a href="./index.html">真人线稿模式</a></header>
    <main className="nw-layout">
      <section className="nw-intro"><p>PAINT BY NUMBER PIPELINE</p><h1>把一张图片，做成可玩的数字填色关卡。</h1><span>{cloudMode ? '登录用户的图片会上传至 FN；云端自动裁白边、提取颜色、像素化并生成可直接游玩的数字关卡。' : '系统会自动裁掉留白、提取颜色、像素化并在每个格子写入对应编号；完成后直接放进数字涂色画册。'}</span></section>
      <section className="nw-workspace">
        <article className="nw-card nw-form">
          <div className="nw-card-head"><div><p>1 · 选择图片</p><h2>上传一幅作品</h2></div><i>{cloudMode ? '访客云端生成' : '本地处理'}</i></div>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} hidden />
          <button className={`nw-dropzone ${preview ? 'nw-dropzone--ready' : ''}`} disabled={generating} onClick={() => inputRef.current?.click()}>{preview ? <img src={preview} alt="待生成的数字填色图片" /> : <span><b>＋</b><strong>选择 JPG / PNG / WebP 图片</strong><small>最大 15MB，人物、名画和插画效果都很好</small></span>}</button>
          {file && <div className="nw-file"><span>✓</span><div><strong>{file.name}</strong><small>{Math.round(file.size / 1024)} KB</small></div><button onClick={() => { setFile(null); setPreview(''); setLocalJob(null); setRemoteJob(null) }} disabled={generating}>移除</button></div>}
          <label className="nw-title"><span>关卡名称</span><input value={title} maxLength={48} disabled={generating} onChange={(event) => setTitle(event.target.value)} placeholder="例如：蒙娜丽莎 · 重制" /></label>
          <div className="nw-controls"><label><span>画册分类</span><select value={category} disabled={generating} onChange={(event) => setCategory(event.target.value as Category)}><option>世界名画</option><option>动物</option><option>风景</option></select></label><label><span>关卡难度</span><select value={difficulty} disabled={generating} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>{(Object.keys(difficultyInfo) as Difficulty[]).map((item) => <option key={item}>{item}</option>)}</select></label></div>
          <p className="nw-hint">{difficultyInfo[difficulty]}</p>
          <button className="nw-primary" disabled={blocked} onClick={generate}>{actionLabel}</button>
          {error && <p className="nw-error">{error}</p>}
        </article>
        <article className="nw-card nw-result">
          <div className="nw-card-head"><div><p>2 · 发布流水线</p><h2>{job?.status === 'completed' ? '关卡已经准备好' : job?.status === 'failed' ? '本次生成失败' : generating ? '正在制作数字填色' : '等待生成'}</h2></div>{job && <strong>{complete}/{job.steps.length}</strong>}</div>
          {job ? <ol className="nw-pipeline">{job.steps.map((step, index) => <li key={step.id} className={`nw-step nw-step--${step.status}`}><b>{step.status === 'completed' ? '✓' : step.status === 'running' ? '…' : index + 1}</b><div><strong>{step.title}</strong><span>{step.message ?? step.description}</span></div></li>)}</ol> : <div className="nw-empty"><span>▦</span><p>上传一张图片后，会在这里逐步显示数字关卡的制作过程。</p></div>}
          {job?.result && <section className="nw-ready"><div className="nw-images"><img src={asset(job.result.preview)} alt="数字填色完成效果" /><img src={asset(job.result.source)} alt="上传的原图" /></div><div><p>3 · 导入画册</p><strong>{job.result.columns && job.result.rows ? `${job.result.columns} × ${job.result.rows} 格 · ` : ''}{job.result.colors} 种颜色 · {job.result.regions} 个色块</strong><span>数字已经写入每个色块。未填时以灰阶展示整幅画，完成后还原目标颜色。</span><a className="nw-primary" href={`./paint.html?level=${encodeURIComponent(job.result.url)}`}>打开并开始填色</a><a className="nw-text-link" href="./paint.html">返回数字涂色画册</a></div></section>}
          {job?.status === 'failed' && <p className="nw-error">{job.error}</p>}
        </article>
      </section>
    </main>
  </div>
}
