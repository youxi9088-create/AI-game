# 墙面资产盘点

依据：本地 catalog 的来源命名、尺寸和已知结构。属于目录/几何初筛，不等于逐件视觉验收；待核验项不进入墙面选择器。保持同资源包，不跨包替换。

| 资源包 | 可上墙候选 | 待核验 | 桌面/落地/结构件 |
| --- | ---: | ---: | ---: |
| interior-1 | 142 | 64 | 0 |
| low-poly-rooms | 79 | 28 | 23 |
| goodies-cozy | 18 | 0 | 11 |

## 使用边界

墙面/结构窗面板的“添加墙面物件”只显示同包可上墙候选；窗帘叠加而非删除原窗。挂件可沿墙移动，支持 -180°～180° 中心倾斜；家具调绕竖直轴的朝向。墙、地板、带墙体的结构窗不开启旋转。所有新增物件、位置和角度保存到本地。

壁灯目前只是静态模型，不自动新增灯光；多片窗帘/窗帘杆需按预览自行组合。较高的架子、模糊命名和带柜体的镜子留在待核验/非挂件集合。30 Rooms 参与盘点，但当前两间资产房不会跨包引入它。

## 明细

| 包 | 文件 | 分类 | 可选 | 尺寸 XYZ（米） | 判断依据 |
| --- | --- | --- | --- | --- | --- |
| goodies-cozy | Sconce.glb | 壁灯 | 是 | 0.326 × 0.555 × 0.343 | 明确的壁灯命名 |
| goodies-cozy | Shelf.glb | 壁架 | 是 | 0.850 × 0.267 × 0.278 | 短薄横板，可作为壁架；未逐件目检 |
| goodies-cozy | Shelf2.glb | 壁架 | 是 | 1.371 × 0.267 × 0.278 | 短薄横板，可作为壁架；未逐件目检 |
| goodies-cozy | Window_Cover.glb | 窗户 | 是 | 1.756 × 1.036 × 0.144 | 独立窗模型；不包含 cutout 墙体 |
| goodies-cozy | WindowOpaque.glb | 窗户 | 是 | 5.786 × 1.000 × 0.232 | 独立窗模型；不包含 cutout 墙体 |
| goodies-cozy | Curtain_Rod_2.glb | 窗帘杆 | 是 | 1.987 × 0.158 × 0.168 | 明确命名的墙面配件 |
| goodies-cozy | Curtain_Rod.glb | 窗帘杆 | 是 | 3.168 × 0.158 × 0.168 | 明确命名的墙面配件 |
| goodies-cozy | Curtains.glb | 窗帘 | 是 | 0.845 × 2.175 × 0.156 | 窗饰命名；需按预览确认单片或整套 |
| goodies-cozy | Painting.glb | 挂画海报 | 是 | 0.852 × 1.117 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting12.glb | 挂画海报 | 是 | 0.334 × 0.509 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting4.glb | 挂画海报 | 是 | 1.528 × 1.117 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting5.glb | 挂画海报 | 是 | 0.595 × 0.813 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting6.glb | 挂画海报 | 是 | 0.595 × 0.586 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting7.glb | 挂画海报 | 是 | 0.439 × 0.560 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting8.glb | 挂画海报 | 是 | 1.425 × 1.066 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Painting9.glb | 挂画海报 | 是 | 0.745 × 1.063 × 0.060 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Poster.glb | 挂画海报 | 是 | 0.761 × 1.031 × 0.042 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Poster2.glb | 挂画海报 | 是 | 0.735 × 1.054 × 0.016 | 图画命名且模型厚度小于15厘米 |
| goodies-cozy | Window_Cutout__variant2.glb | 结构窗墙 | 否 | 2.000 × 2.504 × 0.185 | 包含墙体开口，不能当独立挂件替换 |
| goodies-cozy | Window_Cutout_Centered.glb | 结构窗墙 | 否 | 3.000 × 2.504 × 0.131 | 包含墙体开口，不能当独立挂件替换 |
| goodies-cozy | Window_Cutout.glb | 结构窗墙 | 否 | 1.905 × 2.504 × 0.185 | 包含墙体开口，不能当独立挂件替换 |
| goodies-cozy | Bookshelf_Narrow_Short.glb | 落地或桌面 | 否 | 0.666 × 1.170 × 0.450 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Bookshelf_Narrow.glb | 落地或桌面 | 否 | 0.666 × 2.123 × 0.450 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Bookshelf_Wide_Short.glb | 落地或桌面 | 否 | 1.069 × 1.161 × 0.450 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Bookshelf_Wide.glb | 落地或桌面 | 否 | 1.069 × 2.123 × 0.450 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Frame_Standing_1.glb | 落地或桌面 | 否 | 0.311 × 0.359 × 0.232 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Frame_Standing_2.glb | 落地或桌面 | 否 | 0.311 × 0.241 × 0.166 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Frame_Standing_3.glb | 落地或桌面 | 否 | 0.230 × 0.221 × 0.150 | 桌面支架、落地柜架或组合结构 |
| goodies-cozy | Frame_Standing_4.glb | 落地或桌面 | 否 | 0.174 × 0.172 × 0.116 | 桌面支架、落地柜架或组合结构 |
| interior-1 | shelf_003.glb | 壁架 | 是 | 0.739 × 0.035 × 0.316 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_004.glb | 壁架 | 是 | 0.717 × 0.035 × 0.316 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_005.glb | 壁架 | 是 | 0.733 × 0.035 × 0.316 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_015.glb | 壁架 | 是 | 1.450 × 0.086 × 0.251 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_023.glb | 壁架 | 是 | 0.750 × 0.095 × 0.200 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_024.glb | 壁架 | 是 | 0.750 × 0.095 × 0.200 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_025.glb | 壁架 | 是 | 0.750 × 0.031 × 0.200 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_041.glb | 壁架 | 是 | 0.888 × 0.218 × 0.281 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_045.glb | 壁架 | 是 | 0.750 × 0.095 × 0.200 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | shelf_056.glb | 壁架 | 是 | 1.145 × 0.028 × 0.251 | 短薄横板，可作为壁架；未逐件目检 |
| interior-1 | window_001.glb | 窗户 | 是 | 3.624 × 2.647 × 0.186 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_002.glb | 窗户 | 是 | 3.624 × 2.647 × 0.186 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_003.glb | 窗户 | 是 | 1.608 × 1.989 × 0.370 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_004.glb | 窗户 | 是 | 1.916 × 2.755 × 0.225 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_005.glb | 窗户 | 是 | 1.703 × 3.264 × 0.233 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_006.glb | 窗户 | 是 | 3.053 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_007.glb | 窗户 | 是 | 2.253 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_008.glb | 窗户 | 是 | 2.253 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_009.glb | 窗户 | 是 | 1.703 × 3.264 × 0.233 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_010.glb | 窗户 | 是 | 2.253 × 1.672 × 0.325 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_011.glb | 窗户 | 是 | 3.739 × 2.968 × 0.219 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_012.glb | 窗户 | 是 | 3.426 × 2.460 × 0.475 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_013.glb | 窗户 | 是 | 3.624 × 2.647 × 0.186 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_014.glb | 窗户 | 是 | 1.608 × 1.989 × 0.370 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_015.glb | 窗户 | 是 | 3.053 × 1.672 × 0.325 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_016.glb | 窗户 | 是 | 3.426 × 2.460 × 0.475 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_017.glb | 窗户 | 是 | 3.053 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_018.glb | 窗户 | 是 | 3.053 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_019.glb | 窗户 | 是 | 2.253 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_020.glb | 窗户 | 是 | 2.253 × 1.672 × 0.283 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_021.glb | 窗户 | 是 | 3.160 × 2.125 × 0.232 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_022.glb | 窗户 | 是 | 1.608 × 1.989 × 0.370 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_023.glb | 窗户 | 是 | 1.916 × 2.755 × 0.225 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_024.glb | 窗户 | 是 | 3.426 × 2.460 × 0.475 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_025.glb | 窗户 | 是 | 3.426 × 2.460 × 0.475 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_026.glb | 窗户 | 是 | 3.426 × 2.460 × 0.475 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_027.glb | 窗户 | 是 | 3.084 × 2.304 × 0.134 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_028.glb | 窗户 | 是 | 3.084 × 2.304 × 0.134 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_029.glb | 窗户 | 是 | 1.764 × 1.884 × 0.259 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_030.glb | 窗户 | 是 | 0.998 × 2.279 × 0.114 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_031.glb | 窗户 | 是 | 1.916 × 3.251 × 0.124 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_032.glb | 窗户 | 是 | 1.916 × 2.755 × 0.140 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_033.glb | 窗户 | 是 | 2.404 × 2.363 × 0.122 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_034.glb | 窗户 | 是 | 1.209 × 2.760 × 0.083 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_039.glb | 窗户 | 是 | 1.209 × 2.760 × 0.083 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_040.glb | 窗户 | 是 | 1.916 × 3.251 × 0.124 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | window_041.glb | 窗户 | 是 | 1.916 × 2.755 × 0.140 | 独立窗模型；不包含 cutout 墙体 |
| interior-1 | Curtains_001.glb | 窗帘 | 是 | 1.026 × 2.699 × 0.264 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_002.glb | 窗帘 | 是 | 1.112 × 2.699 × 0.268 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_003.glb | 窗帘 | 是 | 1.137 × 2.700 × 0.256 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_004.glb | 窗帘 | 是 | 3.000 × 0.789 × 0.097 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_005.glb | 窗帘 | 是 | 1.112 × 2.699 × 0.268 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_006.glb | 窗帘 | 是 | 0.690 × 2.699 × 0.267 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_007.glb | 窗帘 | 是 | 0.693 × 2.699 × 0.261 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_008.glb | 窗帘 | 是 | 1.112 × 2.699 × 0.268 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_009.glb | 窗帘 | 是 | 1.112 × 2.699 × 0.268 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_010.glb | 窗帘 | 是 | 1.112 × 2.699 × 0.268 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_011.glb | 窗帘 | 是 | 1.124 × 2.700 × 0.256 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_012.glb | 窗帘 | 是 | 1.134 × 2.700 × 0.256 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_013.glb | 窗帘 | 是 | 1.126 × 2.700 × 0.256 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_014.glb | 窗帘 | 是 | 3.000 × 0.790 × 0.097 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_015.glb | 窗帘 | 是 | 3.000 × 0.793 × 0.097 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_016.glb | 窗帘 | 是 | 3.000 × 0.800 × 0.097 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_017.glb | 窗帘 | 是 | 1.131 × 2.700 × 0.256 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_018.glb | 窗帘 | 是 | 3.000 × 0.780 × 0.097 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_019.glb | 窗帘 | 是 | 0.690 × 2.699 × 0.267 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_020.glb | 窗帘 | 是 | 0.690 × 2.699 × 0.267 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_021.glb | 窗帘 | 是 | 0.690 × 2.699 × 0.267 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_022.glb | 窗帘 | 是 | 0.690 × 2.699 × 0.267 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_023.glb | 窗帘 | 是 | 1.486 × 1.888 × 0.113 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_024.glb | 窗帘 | 是 | 2.665 × 0.078 × 0.167 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_025.glb | 窗帘 | 是 | 3.278 × 0.078 × 0.167 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_026.glb | 窗帘 | 是 | 1.532 × 0.933 × 0.075 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_027.glb | 窗帘 | 是 | 1.532 × 0.933 × 0.075 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_028.glb | 窗帘 | 是 | 1.532 × 0.933 × 0.075 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | Curtains_029.glb | 窗帘 | 是 | 1.532 × 0.933 × 0.075 | 窗饰命名；需按预览确认单片或整套 |
| interior-1 | frame.glb | 待核验 | 否 | 59.040 × 0.000 × 83.187 | 需核对支架或安装结构 |
| interior-1 | shelf_001.glb | 待核验 | 否 | 1.225 × 0.729 × 0.602 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_006.glb | 待核验 | 否 | 1.713 × 0.912 × 0.174 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_007.glb | 待核验 | 否 | 0.923 × 1.599 × 0.154 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_008.glb | 待核验 | 否 | 0.548 × 0.647 × 0.519 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_009.glb | 待核验 | 否 | 1.319 × 1.174 × 0.235 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_010.glb | 待核验 | 否 | 1.173 × 0.705 × 0.371 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_011.glb | 待核验 | 否 | 1.094 × 0.657 × 0.346 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_012.glb | 待核验 | 否 | 0.671 × 0.419 × 0.474 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_013.glb | 待核验 | 否 | 1.076 × 1.679 × 0.328 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_014.glb | 待核验 | 否 | 1.498 × 0.912 × 0.177 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_016.glb | 待核验 | 否 | 1.713 × 0.912 × 0.154 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_017.glb | 待核验 | 否 | 0.929 × 0.995 × 0.411 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_018.glb | 待核验 | 否 | 0.548 × 0.647 × 0.543 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_019.glb | 待核验 | 否 | 0.548 × 0.328 × 0.222 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_020.glb | 待核验 | 否 | 0.943 × 1.592 × 0.303 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_021.glb | 待核验 | 否 | 1.328 × 0.463 × 0.689 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_022.glb | 待核验 | 否 | 1.713 × 0.682 × 0.154 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_026.glb | 待核验 | 否 | 0.503 × 1.986 × 0.329 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_027.glb | 待核验 | 否 | 0.444 × 0.500 × 0.466 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_028.glb | 待核验 | 否 | 0.935 × 1.986 × 0.579 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_029.glb | 待核验 | 否 | 0.922 × 0.683 × 0.154 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_030.glb | 待核验 | 否 | 0.724 × 1.221 × 0.300 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_031.glb | 待核验 | 否 | 1.357 × 0.926 × 0.421 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_032.glb | 待核验 | 否 | 0.628 × 0.865 × 0.311 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_033.glb | 待核验 | 否 | 1.189 × 1.020 × 0.645 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_034.glb | 待核验 | 否 | 1.134 × 0.760 × 0.414 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_035.glb | 待核验 | 否 | 0.373 × 2.059 × 0.373 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_036.glb | 待核验 | 否 | 1.102 × 0.704 × 0.382 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_037.glb | 待核验 | 否 | 0.498 × 0.659 × 0.611 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_038.glb | 待核验 | 否 | 1.037 × 0.665 × 0.525 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_039.glb | 待核验 | 否 | 0.379 × 1.401 × 0.376 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_040.glb | 待核验 | 否 | 0.818 × 2.043 × 0.467 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_042.glb | 待核验 | 否 | 0.577 × 0.539 × 0.577 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_043.glb | 待核验 | 否 | 1.099 × 0.422 × 0.298 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_044.glb | 待核验 | 否 | 1.283 × 0.609 × 0.222 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_046.glb | 待核验 | 否 | 1.559 × 0.698 × 0.414 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_047.glb | 待核验 | 否 | 0.548 × 0.979 × 0.547 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_048.glb | 待核验 | 否 | 0.921 × 1.986 × 0.321 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_049.glb | 待核验 | 否 | 1.026 × 1.275 × 0.403 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_050.glb | 待核验 | 否 | 1.697 × 0.685 × 0.440 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_051.glb | 待核验 | 否 | 0.444 × 0.480 × 0.455 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_052.glb | 待核验 | 否 | 0.910 × 0.659 × 0.611 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_053.glb | 待核验 | 否 | 0.881 × 1.966 × 0.305 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_054.glb | 待核验 | 否 | 0.905 × 1.670 × 0.435 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_055.glb | 待核验 | 否 | 1.561 × 2.094 × 0.425 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_057.glb | 待核验 | 否 | 0.548 × 0.328 × 0.222 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_058.glb | 待核验 | 否 | 0.637 × 2.460 × 0.529 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_059.glb | 待核验 | 否 | 0.829 × 2.948 × 0.250 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_060.glb | 待核验 | 否 | 0.664 × 1.555 × 0.511 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_061.glb | 待核验 | 否 | 0.613 × 1.457 × 0.576 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_062.glb | 待核验 | 否 | 2.165 × 2.880 × 0.569 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_063.glb | 待核验 | 否 | 2.212 × 0.405 × 0.368 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_064.glb | 待核验 | 否 | 0.671 × 0.419 × 0.474 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_065.glb | 待核验 | 否 | 1.213 × 0.923 × 0.187 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_066.glb | 待核验 | 否 | 1.792 × 1.091 × 0.212 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_067.glb | 待核验 | 否 | 0.671 × 0.419 × 0.474 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_068.glb | 待核验 | 否 | 0.924 × 0.496 × 0.300 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_069.glb | 待核验 | 否 | 0.671 × 0.419 × 0.474 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_070.glb | 待核验 | 否 | 2.365 × 0.628 × 0.596 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_071.glb | 待核验 | 否 | 1.037 × 1.752 × 0.334 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_072.glb | 待核验 | 否 | 2.678 × 0.422 × 0.278 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_073.glb | 待核验 | 否 | 0.538 × 0.582 × 0.552 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | shelf_074.glb | 待核验 | 否 | 0.922 × 0.683 × 0.154 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| interior-1 | picture_001.glb | 挂画海报 | 是 | 0.793 × 1.000 × 0.030 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_002.glb | 挂画海报 | 是 | 1.387 × 1.749 × 0.046 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_003.glb | 挂画海报 | 是 | 0.724 × 1.038 × 0.001 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_004.glb | 挂画海报 | 是 | 0.479 × 0.743 × 0.007 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_005.glb | 挂画海报 | 是 | 1.258 × 1.258 × 0.078 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_006.glb | 挂画海报 | 是 | 1.002 × 1.554 × 0.037 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_007.glb | 挂画海报 | 是 | 0.772 × 1.068 × 0.036 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_008.glb | 挂画海报 | 是 | 1.002 × 1.554 × 0.038 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_009.glb | 挂画海报 | 是 | 0.848 × 1.005 × 0.124 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_010.glb | 挂画海报 | 是 | 0.543 × 0.375 × 0.020 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_011.glb | 挂画海报 | 是 | 0.543 × 0.375 × 0.020 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_012.glb | 挂画海报 | 是 | 0.454 × 0.543 × 0.020 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_013.glb | 挂画海报 | 是 | 0.557 × 0.806 × 0.029 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_014.glb | 挂画海报 | 是 | 0.763 × 0.793 × 0.029 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_015.glb | 挂画海报 | 是 | 0.984 × 0.305 × 0.029 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_016.glb | 挂画海报 | 是 | 0.836 × 0.939 × 0.043 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_017.glb | 挂画海报 | 是 | 0.554 × 0.622 × 0.029 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_018.glb | 挂画海报 | 是 | 0.347 × 0.390 × 0.018 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_019.glb | 挂画海报 | 是 | 0.717 × 0.859 × 0.031 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_020.glb | 挂画海报 | 是 | 1.220 × 1.461 × 0.053 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_021.glb | 挂画海报 | 是 | 0.567 × 0.577 × 0.026 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_022.glb | 挂画海报 | 是 | 0.779 × 0.577 × 0.026 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_023.glb | 挂画海报 | 是 | 0.560 × 1.745 × 0.035 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_024.glb | 挂画海报 | 是 | 0.629 × 0.646 × 0.053 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_025.glb | 挂画海报 | 是 | 0.660 × 0.660 × 0.024 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_026.glb | 挂画海报 | 是 | 0.390 × 0.477 × 0.022 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_027.glb | 挂画海报 | 是 | 0.554 × 0.622 × 0.039 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_028.glb | 挂画海报 | 是 | 1.056 × 1.283 × 0.022 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_029.glb | 挂画海报 | 是 | 0.378 × 0.453 × 0.027 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_030.glb | 挂画海报 | 是 | 0.873 × 0.836 × 0.046 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_031.glb | 挂画海报 | 是 | 0.571 × 0.424 × 0.026 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_032.glb | 挂画海报 | 是 | 0.416 × 0.424 × 0.026 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_033.glb | 挂画海报 | 是 | 0.390 × 0.477 × 0.042 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_034.glb | 挂画海报 | 是 | 1.471 × 0.883 × 0.035 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_035.glb | 挂画海报 | 是 | 0.499 × 0.629 × 0.027 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_036.glb | 挂画海报 | 是 | 1.387 × 1.749 × 0.046 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_037.glb | 挂画海报 | 是 | 0.724 × 1.038 × 0.023 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_038.glb | 挂画海报 | 是 | 0.479 × 0.743 × 0.022 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_039.glb | 挂画海报 | 是 | 1.156 × 1.157 × 0.056 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_040.glb | 挂画海报 | 是 | 1.002 × 1.554 × 0.038 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_041.glb | 挂画海报 | 是 | 0.597 × 0.909 × 0.028 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_042.glb | 挂画海报 | 是 | 1.197 × 1.096 × 0.001 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_043.glb | 挂画海报 | 是 | 1.387 × 1.749 × 0.046 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_044.glb | 挂画海报 | 是 | 0.717 × 0.859 × 0.051 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_045.glb | 挂画海报 | 是 | 0.749 × 1.033 × 0.039 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_046.glb | 挂画海报 | 是 | 1.633 × 1.053 × 0.043 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_047.glb | 挂画海报 | 是 | 0.347 × 0.390 × 0.029 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_048.glb | 挂画海报 | 是 | 0.554 × 0.622 × 0.039 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_049.glb | 挂画海报 | 是 | 4.634 × 1.986 × 0.067 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_050.glb | 挂画海报 | 是 | 0.557 × 0.806 × 0.040 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_051.glb | 挂画海报 | 是 | 0.557 × 0.806 × 0.040 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_052.glb | 挂画海报 | 是 | 0.763 × 0.793 × 0.039 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_053.glb | 挂画海报 | 是 | 0.984 × 0.305 × 0.039 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_054.glb | 挂画海报 | 是 | 0.560 × 1.745 × 0.055 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_055.glb | 挂画海报 | 是 | 0.629 × 0.646 × 0.053 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_056.glb | 挂画海报 | 是 | 0.566 × 0.678 × 0.035 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_057.glb | 挂画海报 | 是 | 1.469 × 0.817 × 0.056 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_058.glb | 挂画海报 | 是 | 1.564 × 0.869 × 0.059 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_059.glb | 挂画海报 | 是 | 0.546 × 0.790 × 0.034 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_060.glb | 挂画海报 | 是 | 1.864 × 1.010 × 0.103 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_061.glb | 挂画海报 | 是 | 0.353 × 0.217 × 0.000 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_062.glb | 挂画海报 | 是 | 0.790 × 4.000 × 0.000 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_063.glb | 挂画海报 | 是 | 0.557 × 2.286 × 0.000 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_064.glb | 挂画海报 | 是 | 1.528 × 0.978 × 0.005 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_065.glb | 挂画海报 | 是 | 0.546 × 0.790 × 0.034 | 图画命名且模型厚度小于15厘米 |
| interior-1 | picture_066.glb | 挂画海报 | 是 | 0.780 × 4.000 × 0.000 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_BlindsBathPink_01.glb | 百叶帘 | 是 | 1.003 × 1.132 × 0.074 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_BlindsKitchenYellow_01.glb | 百叶帘 | 是 | 1.255 × 0.463 × 0.086 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_BlindsWhiteBlack_01.glb | 百叶帘 | 是 | 2.527 × 0.544 × 0.247 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_BlindsWhiteOffice_01.glb | 百叶帘 | 是 | 2.101 × 0.546 × 0.421 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_GlassShelfAqua_01.glb | 壁架 | 是 | 1.613 × 0.007 × 0.184 | 短薄横板，可作为壁架；未逐件目检 |
| low-poly-rooms | SM_ShelfBeige_01.glb | 壁架 | 是 | 0.990 × 0.186 × 0.223 | 短薄横板，可作为壁架；未逐件目检 |
| low-poly-rooms | SM_ShelfGreyBlue_01.glb | 壁架 | 是 | 1.500 × 0.050 × 0.400 | 短薄横板，可作为壁架；未逐件目检 |
| low-poly-rooms | SM_ShelfGreyBlueSmall_01.glb | 壁架 | 是 | 0.842 × 0.050 × 0.256 | 短薄横板，可作为壁架；未逐件目检 |
| low-poly-rooms | SM_ShelfSmallOrange_01.glb | 壁架 | 是 | 0.990 × 0.186 × 0.223 | 短薄横板，可作为壁架；未逐件目检 |
| low-poly-rooms | SM_BathMirrorRectPurpleBlue_01.glb | 壁镜 | 是 | 2.023 × 0.772 × 0.026 | 独立薄镜模型 |
| low-poly-rooms | SM_MirrorBath_01.glb | 壁镜 | 是 | 0.700 × 0.900 × 0.020 | 独立薄镜模型 |
| low-poly-rooms | SM_MirrorBathroomBrown_01.glb | 壁镜 | 是 | 1.048 × 0.694 × 0.031 | 独立薄镜模型 |
| low-poly-rooms | SM_MirrorCircle_01.glb | 壁镜 | 是 | 0.897 × 0.897 × 0.027 | 独立薄镜模型 |
| low-poly-rooms | SM_MirrorOfficeBrown_01.glb | 壁镜 | 是 | 0.561 × 0.863 × 0.070 | 独立薄镜模型 |
| low-poly-rooms | SM_DoorWindowWhite_01.glb | 窗户 | 是 | 1.438 × 0.518 × 0.231 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_PartitionWallWindowGrey_01.glb | 窗户 | 是 | 2.009 × 2.556 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WallWindowBackWhite_01.glb | 窗户 | 是 | 3.950 × 4.000 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WallWindowBrownRight_01.glb | 窗户 | 是 | 0.050 × 4.000 × 4.000 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WallWindowLightBeige_01.glb | 窗户 | 是 | 0.050 × 4.000 × 4.000 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WallWindowLightBrown_01.glb | 窗户 | 是 | 3.950 × 4.000 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WallWindowRight_01.glb | 窗户 | 是 | 0.050 × 4.000 × 4.000 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WallWindowSlopingGrey_01.glb | 窗户 | 是 | 3.950 × 4.000 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowBathBigBrown_01.glb | 窗户 | 是 | 1.948 × 1.680 × 0.108 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowBathJamb_01.glb | 窗户 | 是 | 1.003 × 1.132 × 0.081 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowBlack_01.glb | 窗户 | 是 | 1.423 × 2.376 × 0.058 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowBrown_01.glb | 窗户 | 是 | 0.829 × 2.083 × 0.041 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowBrownItalia_01.glb | 窗户 | 是 | 1.165 × 1.633 × 0.208 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEarlSet_01.glb | 窗户 | 是 | 3.466 × 3.516 × 0.218 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishLeftBrownBig_01.glb | 窗户 | 是 | 0.868 × 2.090 × 0.123 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishLeftBrownBig_05.glb | 窗户 | 是 | 2.616 × 2.090 × 0.123 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishRightBrownBig_01.glb | 窗户 | 是 | 0.868 × 2.090 × 0.123 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishSmallWhite_01.glb | 窗户 | 是 | 0.868 × 0.499 × 0.129 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishWhiteLeft_01.glb | 窗户 | 是 | 0.868 × 2.090 × 0.123 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishWhiteRight_01.glb | 窗户 | 是 | 0.868 × 2.090 × 0.123 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowEnglishWhiteRight_05.glb | 窗户 | 是 | 2.634 × 2.603 × 0.129 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJamb_01.glb | 窗户 | 是 | 2.673 × 2.238 × 0.140 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJambBlack_01.glb | 窗户 | 是 | 3.032 × 2.551 × 0.140 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJambBlack_02.glb | 窗户 | 是 | 3.032 × 2.551 × 0.140 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJambLightBrown_01.glb | 窗户 | 是 | 2.063 × 2.910 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJambSlopingBigGrey_01.glb | 窗户 | 是 | 3.236 × 2.438 × 0.348 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJambWhiteBig_01.glb | 窗户 | 是 | 2.988 × 2.508 × 0.425 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowJambWhiteBig_03.glb | 窗户 | 是 | 2.988 × 2.508 × 0.425 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowKitchenGrey_01.glb | 窗户 | 是 | 1.197 × 1.859 × 0.145 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowLeftBlack_01.glb | 窗户 | 是 | 1.081 × 3.445 × 0.132 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowLightBlack_01.glb | 窗户 | 是 | 2.344 × 1.859 × 0.145 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowLightBrown_01.glb | 窗户 | 是 | 0.902 × 2.795 × 0.024 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowLightBrown_02.glb | 窗户 | 是 | 0.959 × 2.795 × 0.024 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowLightBrown_05.glb | 窗户 | 是 | 2.063 × 2.910 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowMiddleBlack_01.glb | 窗户 | 是 | 1.081 × 3.445 × 0.132 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowMiddleBlack_02.glb | 窗户 | 是 | 3.434 × 3.639 × 1.033 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowOfficeBlack_01.glb | 窗户 | 是 | 2.116 × 2.124 × 0.250 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowRightBlack_01.glb | 窗户 | 是 | 1.081 × 3.445 × 0.132 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowSillWhite_01.glb | 窗户 | 是 | 1.114 × 0.044 × 0.573 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowSlopingBlackA_01.glb | 窗户 | 是 | 0.626 × 1.809 × 0.026 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowSlopingBlackB_01.glb | 窗户 | 是 | 0.596 × 1.489 × 0.026 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowSlopingBlackC_01.glb | 窗户 | 是 | 0.495 × 1.181 × 0.026 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowSlopingBlackD_01.glb | 窗户 | 是 | 0.485 × 0.919 × 0.026 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowThreeWhite_01.glb | 窗户 | 是 | 2.852 × 3.432 × 0.174 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWallBackWhite_01.glb | 窗户 | 是 | 3.950 × 4.000 × 0.050 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWhite_02.glb | 窗户 | 是 | 1.114 × 1.533 × 0.107 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWhite_04.glb | 窗户 | 是 | 2.418 × 2.819 × 0.449 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWhiteLeft_01.glb | 窗户 | 是 | 1.073 × 2.843 × 0.128 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWhiteRight_01.glb | 窗户 | 是 | 1.073 × 2.843 × 0.128 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWhiteRight_03.glb | 窗户 | 是 | 2.147 × 2.843 × 0.128 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_WindowWhiteTeen_01.glb | 窗户 | 是 | 2.116 × 1.659 × 0.848 | 独立窗模型；不包含 cutout 墙体 |
| low-poly-rooms | SM_BathCurtainsGardineBlueGrey_01.glb | 窗帘 | 是 | 3.953 × 3.174 × 0.254 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_CurtainGardineBrownBlack_01.glb | 窗帘 | 是 | 2.623 × 3.009 × 0.292 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_CurtainsGardineBlackLightBrown_01.glb | 窗帘 | 是 | 3.567 × 3.601 × 0.292 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_CurtainsGardineBrown_01.glb | 窗帘 | 是 | 3.871 × 3.826 × 0.292 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_CurtainsGardineDlackGrey_01.glb | 窗帘 | 是 | 3.236 × 3.183 × 0.259 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_CurtainsGardineSalmonYellowGreen_01.glb | 窗帘 | 是 | 1.417 × 1.925 × 0.266 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_CurtainsWhiteGrey_01.glb | 窗帘 | 是 | 2.467 × 2.951 × 0.208 | 窗饰命名；需按预览确认单片或整套 |
| low-poly-rooms | SM_DrawersShelfBlackPink_01.glb | 待核验 | 否 | 0.919 × 2.791 × 0.647 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_DrawersShelfBlackPinkSet_01.glb | 待核验 | 否 | 3.722 × 2.791 × 0.647 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_HangerShelfBlack_01.glb | 待核验 | 否 | 1.080 × 2.904 × 0.511 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_HangerShelfMediumBlack_01.glb | 待核验 | 否 | 1.000 × 2.061 × 0.500 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_KitchenShelfMedium_GreyBeige_01.glb | 待核验 | 否 | 1.277 × 0.716 × 0.250 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_KitchenShelfSmall_GreyBeige_01.glb | 待核验 | 否 | 0.763 × 0.716 × 0.250 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_KitchenShelfThreeMedium_GreyBeige_01.glb | 待核验 | 否 | 1.062 × 1.184 × 0.250 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_KitchenShelfTwoBigGreyBeige_01.glb | 待核验 | 否 | 1.280 × 1.192 × 0.250 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_PhotoFrameCouple_01.glb | 待核验 | 否 | 0.440 × 0.280 × 0.297 | 需核对支架或安装结构 |
| low-poly-rooms | SM_PhotoFrameLandscape_01.glb | 待核验 | 否 | 0.440 × 0.281 × 0.275 | 需核对支架或安装结构 |
| low-poly-rooms | SM_PhotoFrameRose_01.glb | 待核验 | 否 | 0.247 × 0.352 × 0.306 | 需核对支架或安装结构 |
| low-poly-rooms | SM_PhotoFrameSurfer_01.glb | 待核验 | 否 | 0.238 × 0.259 × 0.258 | 需核对支架或安装结构 |
| low-poly-rooms | SM_PhotoFrameWoman_01.glb | 待核验 | 否 | 0.238 × 0.259 × 0.258 | 需核对支架或安装结构 |
| low-poly-rooms | SM_ShelfBathOvalWhite_01.glb | 待核验 | 否 | 1.970 × 0.457 × 0.457 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfBlack_01.glb | 待核验 | 否 | 2.939 × 2.822 × 0.214 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfBlackPink_01.glb | 待核验 | 否 | 1.878 × 2.791 × 0.626 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfBrown_01.glb | 待核验 | 否 | 0.833 × 1.489 × 0.429 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfBrownGrey_01.glb | 待核验 | 否 | 0.509 × 1.800 × 0.320 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfCrossBrown_01.glb | 待核验 | 否 | 1.671 × 1.355 × 0.404 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfKidsBeigePink_01.glb | 待核验 | 否 | 0.350 × 0.969 × 0.316 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfKidsYellowOrange_01.glb | 待核验 | 否 | 0.350 × 0.969 × 0.316 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfOfficeBeigeBlack_01.glb | 待核验 | 否 | 0.990 × 4.000 × 0.275 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfStairsBeigePink_01.glb | 待核验 | 否 | 0.346 × 1.224 × 0.992 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfTowelBlack_01.glb | 待核验 | 否 | 0.833 × 0.766 × 0.429 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfTowelGrey_01.glb | 待核验 | 否 | 0.833 × 1.185 × 0.429 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShelfWaveWhiteBlack_01.glb | 待核验 | 否 | 0.808 × 2.259 × 0.454 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_ShoeShelfBlackGrey_01.glb | 待核验 | 否 | 0.833 × 0.766 × 0.429 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_SpeakerWitShelfComputeBlackBlue_01.glb | 待核验 | 否 | 0.453 × 1.451 × 0.461 | 架体较高，不能仅凭 shelf 名称认定悬挂 |
| low-poly-rooms | SM_DecorativePannoFrame_01.glb | 挂画海报 | 是 | 1.323 × 0.889 × 0.074 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_DecorativePannoHorizontalGold_01.glb | 挂画海报 | 是 | 1.391 × 0.887 × 0.056 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_DecorativePannoMulticolor_01.glb | 挂画海报 | 是 | 1.391 × 0.887 × 0.056 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_DecorativePannoVerticalGold_01.glb | 挂画海报 | 是 | 1.638 × 2.354 × 0.056 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_PaintingAbstractOrangeYellow_01.glb | 挂画海报 | 是 | 0.726 × 1.271 × 0.070 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_PosterFire_01.glb | 挂画海报 | 是 | 0.627 × 1.102 × 0.002 | 图画命名且模型厚度小于15厘米 |
| low-poly-rooms | SM_BatroomShelfWashbasinMirrorSetWhite_01.glb | 落地或桌面 | 否 | 2.036 × 1.512 × 0.481 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfBilliardBrown_01.glb | 落地或桌面 | 否 | 0.994 × 2.298 × 0.444 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfBilliardBrownSet_01.glb | 落地或桌面 | 否 | 2.991 × 2.298 × 0.444 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfBlackWhite_01.glb | 落地或桌面 | 否 | 1.787 × 2.531 × 0.433 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfFiveBrown_01.glb | 落地或桌面 | 否 | 0.655 × 1.993 × 0.359 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfMetallicBlack_01.glb | 落地或桌面 | 否 | 1.940 × 2.561 × 0.454 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfMetallicCrossBlack_01.glb | 落地或桌面 | 否 | 1.182 × 2.364 × 0.378 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookShelfSalmon_01.glb | 落地或桌面 | 否 | 1.000 × 1.800 × 0.320 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfSciFiBlue_01.glb | 落地或桌面 | 否 | 1.645 × 0.832 × 0.302 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfSciFiBlueSet_01.glb | 落地或桌面 | 否 | 1.645 × 0.832 × 0.302 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfSciFiRed_01.glb | 落地或桌面 | 否 | 1.645 × 0.832 × 0.302 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfSciFiRedSet_01.glb | 落地或桌面 | 否 | 1.645 × 0.832 × 0.302 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookshelfSevenBrown_01.glb | 落地或桌面 | 否 | 0.756 × 2.720 × 0.359 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_BookShelfStripesBrown_02.glb | 落地或桌面 | 否 | 1.251 × 2.554 × 0.300 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_JapaneseRoomFrame_01.glb | 落地或桌面 | 否 | 1.311 × 3.745 × 0.058 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_JapaneseRoomFrameBrown_01.glb | 落地或桌面 | 否 | 1.311 × 3.097 × 0.058 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_JapaneseRoomFrameLightBrown_01.glb | 落地或桌面 | 否 | 1.311 × 3.097 × 0.058 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_JapaneseRoomFrameLightBrown_05.glb | 落地或桌面 | 否 | 3.933 × 3.097 × 0.075 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_SetFireplaceBookshelfBrown_01.glb | 落地或桌面 | 否 | 3.894 × 2.554 × 0.749 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_ShelfingLightBrownMirror_01.glb | 落地或桌面 | 否 | 2.877 × 2.418 × 0.595 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_ShelfingRLightBrown_01.glb | 落地或桌面 | 否 | 0.801 × 3.146 × 0.464 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_WardrobeHangingShelfBlackPinkSet_01.glb | 落地或桌面 | 否 | 3.162 × 2.924 × 0.511 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_WardrobeMirror_01.glb | 落地或桌面 | 否 | 0.450 × 2.098 × 0.404 | 桌面支架、落地柜架或组合结构 |
| low-poly-rooms | SM_HeatedTowelRailGrey_01.glb | 毛巾架 | 是 | 0.631 × 1.529 × 0.157 | 明确的墙式毛巾散热架命名 |
