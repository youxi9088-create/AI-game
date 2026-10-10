# Unity 资源包 → Three.js 静态资源

## 本次产物

原包保持不变，未安装 Unity，也未执行包内脚本。

| 包 | 转换输出 | 保存目录 |
| --- | --- | --- |
| Interior 1 v1.0 | 1,580 个独立模型 | `.asset-work/converted/interior-1` |
| Low Poly 30 Rooms Interiors 1000 Objects | 30 个房间组合、1,138 个物件/组合，共 1,168 个模型 | `.asset-work/converted/low-poly-rooms` |
| Goodies Cozy Room Pack 1.2 | 292 个源 FBX，含材质/部件变体共 302 个可选模型 | `.asset-work/converted/goodies-cozy` |

Goodies 单独使用 `python tools/prepare-goodies.py` 解析 Unity 材质与 Prefab 材质槽，然后再运行转换器。该包是 Y-up、Unity `useFileScale: 0`，保留源模型的米制尺寸，不使用前两包的旋转和厘米缩放。支持基础颜色、主贴图、UV 平铺/偏移、法线、透明裁剪/混合及启用的发光、金属粗糙度通道；26 张纹理以文件引用随 GLB 交付。它不使用共用 palette.png，必须保留 catalog.textures 中列出的 PNG。

Goodies 的节点按 Prefab 对应的材质槽绑定；同一 FBX 的不同材质/部件组合保留为 variant。未被该组合引用的节点不输出，记录在 repairs；不是完整 Prefab 场景重建，不包含跨 FBX 的装配、Prefab 位置覆盖、脚本、动画行为、烘焙光照和包内嵌套的渲染管线包。Unity 自定义着色器不能保证逐像素一致。

当前预览库总计 3,050 项。Goodies 302 项通过结构检查，其中 8 项进行几何回读；三个包清单计数、文件存在与筛选回归检查通过。尚未完成浏览器目视验收。

每个目录包含 `catalog.json`、`validation.json`、GLB 文件和共用 `palette.png`。
**GLB 引用同目录的 palette.png；移动、加载或交付时必须一起带上贴图。**
目录包含原始英文名称、尺寸（米）、三角形数、来源文件、跳过项及修复记录。
第二包一个空节点不输出；重名模型以 `__2` 后缀保留，避免覆盖。
第二包三个输出原有无效的次级 UV；由于这些材质只使用 UV0 色板，转换时剔除无效且未使用的次级 UV，不改动 UV0。

## 边界

- 只转换静态模型、层级及原色板；不是 Unity Prefab 行为、脚本、碰撞器、光照烘焙、相机和 Unity 场景的完整迁移。
- 两包已检查的 FBX 声明 Z-up，转换为 Three.js Y-up；单位换算为米；各输出模型原点归到水平中心、底部落地。
- Unity 的自定义 Shader 不直接移植，本次色板材质映射为 glTF metallic-roughness；光照效果不保证与 Unity 一模一样。
- 原色板和静态几何适合低多边形美术，并不会自动变成 Hozy 风格。
- 第一个包含第三方转载说明，包内未查到明确许可；用户提供文件不等于已验证商业授权。正式发布前核对购买来源与许可，不对外提供原始模型下载。
- 当前仅本地转换、样例预览；未替换原有小屋家具、未修改玩家存档、未部署公网。

## 预览和验证

开发服务器 `npm run dev -- --port 5175`，打开 `/asset-preview.html`。
预览页提供三个包的全部 3,050 个模型，包括 30 个房间组合；支持资源包筛选、基于名称的分类、中英文关键词搜索、上一件/下一件、旋转和缩放。只加载当前选择的模型，切换释放旧模型。
`public/content` 已同步完整转换资源，构建也包含这些文件；目前仅用于本地预览，未经许可核对不要部署公网。原始包与中间文件仍留在 `.asset-work`。重新转换后执行 `node tools/sync-preview-assets.mjs` 更新预览资源。

结构检查验证 GLB 头、bufferView、有限数值、贴图存在；代表模型通过 Three.js GLTFLoader 回读，检查尺寸与底部原点。
**浏览器访问被工具策略阻止，未完成目视验收；结构通过不等于画面通过。** 接入现有小屋前仍须看实际贴图、正面朝向、尺度和拖动操作。

## 重跑

```powershell
python tools/unpack_unity.py '资源包.unitypackage' '.asset-work/包名'
node tools/convert-unity-fbx.mjs '.asset-work/包名' '.asset-work/converted/包名'
node tools/validate-converted.mjs '.asset-work/converted/包名'
npm run build
```

转换器仅针对本次两个已检查的单色板、Z-up 静态资源包，不是通用 Unity 项目转换器。其他包要重新检查单位、轴向、材质引用及 Prefab 覆盖关系。
