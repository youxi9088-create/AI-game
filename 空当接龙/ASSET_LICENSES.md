# 素材来源与发布登记

主题库包含“翡翠牌室”和“冰爽红白餐厅”两套已验收真实资源。资源均无文字、品牌标识、角色或第三方 IP 元素；仅用于项目内牌桌氛围和牌背装饰，不承载点数、花色或合法移动判断。

| 资源 | 用途与生成提示摘要 | 尺寸 / 模式 | 字节 | SHA-256 | 生成与审核 |
| --- | --- | --- | ---: | --- | --- |
| `app/assets/classic-table-bg.png` | 高级翡翠绿绒牌桌，黄铜与叶片纹样只位于外围，中心低干扰；不含牌、文字和 logo | 1672×941 / RGB | 2,523,044 | `d14a929dfbfe44e52222d2afc28b57a9f9f58a5662b095a186a2a89d85210dbb` | `codex-imagegen` / `built-in-imagegen`；阶段二人工视觉复核通过 |
| `app/assets/classic-card-back.png` | 对称翡翠绿与黄铜装饰牌背，无文字、数字与 logo | 1060×1484 / RGB | 2,815,773 | `6db531fc3f43856139f5f769df05db747340570b418886794e6b91d0391e0320` | `codex-imagegen` / `built-in-imagegen`；阶段二人工视觉复核通过 |
| `app/assets/red-diner-table-bg.jpg` | 原创红白汽水与复古餐厅环境，白色波浪、气泡和水珠位于外围，无文字与品牌标识 | 4096×2304 / JPEG | 641,129 | `1c327269b8a3bb3503a7060a5095b2bcec20248f076a3f947bdf6241c98358c7` | `aihub` / `jimeng` / `AAABoICKorzElQ`；阶段三质量门与人工视觉复核通过 |
| `app/assets/red-diner-card-back.jpg` | 对称红白波浪与气泡牌背，无文字、数字、包装与品牌标识 | 2048×2048 / JPEG | 798,912 | `6d6ec254c132cc99974ed1eb5744f69d71a4a3eec9aa98bcca40181e1b100a23` | `aihub` / `jimeng` / `AAABoICKoFXitA`；阶段三质量门与人工视觉复核通过 |

“翡翠牌室”包体为 5,338,817 字节，“冰爽红白餐厅”包体为 1,440,041 字节，均低于 ThemePackage 20MB 门禁。`tests/theme-contract.test.mjs` 会读取两套主题的实际文件并核对字节、SHA-256、审核状态和总包体，避免登记与二进制文件漂移。

运行时 Provider 生成的图片先保存在 `.data/theme-assets`，不会自动成为内置发布素材。只有通过质量门、人工目检并登记 provider、model、contentHash、promptHash、尺寸和审核结论后，才能复制进 `app/assets` 晋升为主题库资源。
