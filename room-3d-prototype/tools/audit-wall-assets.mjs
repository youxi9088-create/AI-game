import fs from 'node:fs/promises'
import {wallAsset} from '../wall-assets.js'
const rows=[]
for(const pack of ['interior-1','low-poly-rooms','goodies-cozy']){
  const catalog=JSON.parse(await fs.readFile(`public/content/${pack}/catalog.json`,'utf8'))
  for(const asset of catalog.assets){const wall=wallAsset(asset);if(wall)rows.push({pack,...asset,...wall})}
}
const lines=['# 墙面资产盘点','', '依据：本地 catalog 的来源命名、尺寸和已知结构。属于目录/几何初筛，不等于逐件视觉验收；待核验项不进入墙面选择器。保持同资源包，不跨包替换。','', '| 资源包 | 可上墙候选 | 待核验 | 桌面/落地/结构件 |','| --- | ---: | ---: | ---: |']
for(const pack of ['interior-1','low-poly-rooms','goodies-cozy']){
  const a=rows.filter(r=>r.pack===pack)
  lines.push(`| ${pack} | ${a.filter(r=>r.eligible).length} | ${a.filter(r=>r.category==='待核验').length} | ${a.filter(r=>!r.eligible&&r.category!=='待核验').length} |`)
  console.log(pack,JSON.stringify(Object.fromEntries([...new Set(a.filter(r=>r.eligible).map(r=>r.category))].map(c=>[c,a.filter(r=>r.eligible&&r.category===c).length]))))
}
lines.push('','## 使用边界','','墙面/结构窗面板的“添加墙面物件”只显示同包可上墙候选；窗帘叠加而非删除原窗。挂件可沿墙移动，支持 -180°～180° 中心倾斜；家具调绕竖直轴的朝向。墙、地板、带墙体的结构窗不开启旋转。所有新增物件、位置和角度保存到本地。','', '壁灯目前只是静态模型，不自动新增灯光；多片窗帘/窗帘杆需按预览自行组合。较高的架子、模糊命名和带柜体的镜子留在待核验/非挂件集合。30 Rooms 参与盘点，但当前两间资产房不会跨包引入它。','', '## 明细','','| 包 | 文件 | 分类 | 可选 | 尺寸 XYZ（米） | 判断依据 |','| --- | --- | --- | --- | --- | --- |')
for(const r of rows.sort((a,b)=>(a.pack+a.category+a.file).localeCompare(b.pack+b.category+b.file)))lines.push(`| ${r.pack} | ${r.file} | ${r.category} | ${r.eligible?'是':'否'} | ${r.size.map(n=>n.toFixed(3)).join(' × ')} | ${r.reason} |`)
await fs.writeFile('tools/WALL-ASSET-AUDIT.md',lines.join('\n')+'\n','utf8')
