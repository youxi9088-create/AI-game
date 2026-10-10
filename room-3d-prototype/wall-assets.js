// Catalog semantics plus dimensional checks; not a claim of visual approval.
export function wallAsset(asset) {
  const n=asset.file||asset.name||'', [w,h,d]=asset.size||[0,0,0]
  const yes=(category,reason)=>({eligible:true,category,reason})
  const review=reason=>({eligible:false,category:'待核验',reason})
  if(/Window_Cutout/i.test(n))return {eligible:false,category:'结构窗墙',reason:'包含墙体开口，不能当独立挂件替换'}
  if(/standing|bookshelf|wardrobe|washbasin|shelfing|roomframe/i.test(n))return /frame|shelf|mirror/i.test(n)?{eligible:false,category:'落地或桌面',reason:'桌面支架、落地柜架或组合结构'}:null
  if(/curtain.*rod/i.test(n))return yes('窗帘杆','明确命名的墙面配件')
  if(/curtain|blind/i.test(n))return yes(/blind/i.test(n)?'百叶帘':'窗帘','窗饰命名；需按预览确认单片或整套')
  if(/window/i.test(n))return yes('窗户','独立窗模型；不包含 cutout 墙体')
  if(/picture_|painting|poster|decorativepanno/i.test(n) && d<.15)return yes('挂画海报','图画命名且模型厚度小于15厘米')
  if(/sconce/i.test(n))return yes('壁灯','明确的壁灯命名')
  if(/mirror/i.test(n))return d<.25 && h>.2?yes('壁镜','独立薄镜模型'):review('镜子可能包含柜体或支架')
  if(/shelf/i.test(n))return h<.3 && d<.6 && w>.3?yes('壁架','短薄横板，可作为壁架；未逐件目检'):review('架体较高，不能仅凭 shelf 名称认定悬挂')
  if(/heatedtowelrail/i.test(n))return yes('毛巾架','明确的墙式毛巾散热架命名')
  if(/frame|clock|wall.?lamp/i.test(n))return review('需核对支架或安装结构')
  return null
}
export const wallCategories=['窗户','窗帘','窗帘杆','百叶帘','挂画海报','壁灯','壁镜','壁架','毛巾架']
