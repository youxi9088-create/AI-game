import { copyFile, mkdir, rm } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const [sourcePath, outputDir, levelId = 'forest-001'] = process.argv.slice(2)
const generatorDir = process.env.PBN_GENERATOR_DIR

if (!sourcePath || !outputDir) {
  throw new Error('Usage: PBN_GENERATOR_DIR=<generator-dir> node scripts/generate_pbn_level.mjs <source-image> <output-dir> [level-id]')
}

if (!generatorDir) {
  throw new Error('Set PBN_GENERATOR_DIR to an isolated paint-by-numbers-generator checkout before generating assets.')
}

const generator = resolve(generatorDir)
const destination = resolve(outputDir)
const source = resolve(sourcePath)
const runId = `colorverse-${levelId}-${Date.now()}`
const stagedInput = join(generator, `${runId}${extname(source) || '.png'}`)
const outputBase = `${runId}.svg`
const settings = resolve('scripts/pbn-settings-simple.json')

const run = (command, args, cwd) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`Generator exited with code ${code}`)))
})

await mkdir(destination, { recursive: true })
await copyFile(source, stagedInput)

try {
  await run(process.execPath, ['dist/cli.js', '-i', basename(stagedInput), '-o', outputBase, '-c', settings], generator)
  await Promise.all([
    copyFile(join(generator, `${runId}-preview.svg`), join(destination, 'preview.svg')),
    copyFile(join(generator, `${runId}-outline.svg`), join(destination, 'outline.svg'))
  ])
  console.log(`Generated preview.svg and outline.svg in ${destination}`)
} finally {
  await rm(stagedInput, { force: true })
  await Promise.all([
    rm(join(generator, `${runId}-preview.svg`), { force: true }),
    rm(join(generator, `${runId}-outline.svg`), { force: true })
  ])
}
