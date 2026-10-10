import { wallAsset } from './wall-assets.js'
export const categories = [
  ['房间', /^Room_\d/i, '房间 室内 room'],
  ['座椅沙发', /chair|sofa|stool|bench|couch/i, '椅子 座椅 扶手椅 沙发 凳子'],
  ['桌子柜架', /table|desk|cabinet|drawer|shelf|shelfs|shelves|stand|dresser/i, '桌子 茶几 书桌 柜子 抽屉 书架 架子'],
  ['植物花器', /flower|plant|vase|branch|cactus/i, '植物 花 花盆 花瓶 盆栽 绿植'],
  ['灯具', /lamp|light|chandelier/i, '灯 台灯 吊灯 灯具'],
  ['床与织物', /bed|pillow|carpet|rug|curtain|blanket/i, '床 枕头 地毯 窗帘 织物'],
  ['建筑部件', /wall|floor|window|door|panel|roof|stair/i, '墙 地板 窗 门 屋顶 楼梯'],
  ['书画装饰', /book|picture|frame|painting|clock|watch|decor/i, '书 画 相框 时钟 装饰'],
  ['厨房卫浴', /kitchen|bath|toilet|sink|plate|cup|bottle|pot|pan|oven|fridge|shower|towel/i, '厨房 卫浴 餐具 杯子 瓶子 锅 浴室'],
  ['其他', /.*/, '其他'],
]
export function enrichAsset(asset, pack, label) {
  const [category, , keywords] = categories.find(([, pattern]) => pattern.test(asset.name))
  const wall=wallAsset(asset)
  return { ...asset, pack, label, category, wall, url: `/content/${pack}/${encodeURIComponent(asset.file)}`, searchText: `${asset.name} ${keywords} ${label} ${wall?.category||''} ${wall?.eligible?'上墙 墙面 挂件':''}`.toLowerCase() }
}
export function filterAssets(assets, pack, category, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return assets.filter(a => (!pack || a.pack === pack) && (!category || a.category === category) && words.every(w => a.searchText.includes(w)))
}
