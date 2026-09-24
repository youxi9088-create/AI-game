# 牌局输赢、角色演出与卡牌掉落流程

## 当前真实流程

```text
进入牌局
  -> 服务端创建牌局并扣 1 Token
  -> 叫分、抢地主、轮流出牌
  -> 服务端检测终局，只允许结算一次
  -> 计算地主/农民阵营、底分、炸弹/王炸、春天/反春天倍率
  -> 结算 Token
  -> 若玩家胜利：选择败方牌友（优先选择该牌友收藏数最少者）
  -> 若玩家胜利：从该牌友 outfitLibrary 选择尚未解锁的套装；若已全部解锁则升级已有卡
  -> 若玩家胜利：立即写入写真馆，并把该套装的 cardVideo 作为演出视频
  -> RESULT ->（玩家胜利：PERFORMANCE -> PHOTO_REVEAL）-> DESTINATION
  -> 玩家输局：RESULT -> DESTINATION，不掉新卡、不播放舞蹈
```

流程图：[`game-result-dance-card-drop.html`](./game-result-dance-card-drop.html)

机器可校验源：[`game-result-dance-card-drop.workflow.json`](./game-result-dance-card-drop.workflow.json)

## 输赢与 Token

- 牌局创建处扣除入场 Token，当前默认是 1 Token。
- `apps/api/game-engine.mjs` 的 `settle()` 只在牌局不是 `SETTLED` 时执行，因此同一局不会重复结算。
- `packages/performance-core/index.mjs` 的 `planSettlement()` 计算 `tokenDelta`：玩家赢为正，玩家输为负；玩家是地主时按两家结算，下注额乘 2。
- `recordLedger()` 将实际变动写入账本；余额不足时，输局最多扣到 0，不会出现负余额。
- 胜负结算发生在演出之前；演出播放失败、跳过演出都不应再次修改 Token。

## 斗地主四种组合

| 玩家阵营 | 胜者 | 败方 AI | 结算后演出 | 卡牌 |
| --- | --- | --- | --- | --- |
| 玩家地主 | 玩家地主 | 两名农民 AI | 从两名农民中选一名 | 掉该牌友的一张套装卡 |
| 玩家农民 | 玩家农民 | 一名地主 AI | 该地主 AI | 掉该牌友的一张套装卡 |
| 玩家地主 | 农民 AI | 玩家地主 | 无 | 不掉新卡 |
| 玩家农民 | 地主 AI | 玩家所在农民阵营 | 无 | 不掉新卡 |

“玩家赢”是唯一的演出资格条件；败方牌友列表只是用于玩家获胜时挑选演出者，不代表 AI 赢时也要登台。

## 角色跳舞选择逻辑

### 有写真卡的结算

写真卡对应一个稳定的 `palId + outfitId`。前端 `danceFilmOf()` 按以下优先级取视频：

1. 本张卡的 `layerSnapshot.cardVideo`；
2. 同一 `outfitId` 的 `outfitLibrary[].layerSnapshot.cardVideo`；
3. 只有首套默认服装才允许回退到牌友的 `appearance.danceVideoRef`；
4. 视频仍不可用时，回退五态动作包中的 A05/A04/A01；
5. 最后使用 L2 分层静态立绘。

因此，同一角色不同服装卡不能共用默认舞蹈视频；视频必须跟着套装记录走。

### 玩家输赢分支

- 玩家赢且生成了写真卡：进入独立全屏舞台，播放该败方牌友对应套装的视频。
- 玩家输：不进入 `PERFORMANCE`，不播放胜方或败方舞蹈，也不生成新的写真卡，结算结果后直接散场。

## 卡牌掉落与写真馆

- 卡牌不是等视频播放成功后才生成；但只有玩家赢时，服务端才在 `settle()` 中根据被选中的败方牌友和 `outfitLibrary` 生成并持久化 `settlement.card`。
- 首次套装生成 `rarity: first`、`upgradeLevel: 1`；重复套装不新建卡，而是提升等级，最高为 5 级。
- 卡牌绑定 `cardId`、`palId`、`outfitId`、`layerSnapshot`、`gameStats` 和审计记录；卡面、回放视频、服装必须来自同一套装版本。
- 前端推进到 `PHOTO_REVEAL` 时刷新 `/api/gallery`，再在 `DESTINATION` 提供重开或进入写真馆。
- “跳过演出”只跳过展示阶段，仍会刷新写真馆；不能撤销已经完成的结算或掉落。

## 当前需要特别注意的实现边界

1. **掉落时点与演出时点不同**：当前是“结算立即写卡，随后按阶段展示演出”。如果产品要改成“演出成功后才掉落”，需要同时修改 `settle()`、跳过逻辑和幂等键，不能只改前端文案。
2. **视频绑定必须是套装级**：新增卡牌时必须把 `cardVideo/cardPoster` 写进对应 outfit 的 `layerSnapshot`，否则会回退到角色默认舞片，造成不同卡播放同一视频。
3. **牌桌五态与写真演出是两套资源**：A01-A05 服务牌桌状态；`cardVideo` 服务结算/写真回放，不能用动作 Sprite 图替代套装视频。
4. **服务端是唯一胜负来源**：前端只调用 `/api/game/play`、`/api/game/pass` 和 `/api/game/settlement/advance` 并展示快照，不能在浏览器自行判定输赢、扣 Token 或生成卡牌。

## 代码定位

- 牌局状态、终局、Token 账本、写真馆写入：`apps/api/game-engine.mjs`
- 胜负结算、败方牌友选择、套装选择、卡牌结构：`packages/performance-core/index.mjs`
- 结算阶段常量：`packages/contracts/index.mjs` 的 `SETTLEMENT_STAGES`
- 舞蹈视频与回退动作包选择：`apps/web/app.js` 的 `danceFilmOf()`、`settlementPerformanceBody()`、`danceStagePage()`
- 官方牌友的 outfit/video 映射：`apps/api/server.mjs`
- 资源槽位契约：`apps/web/asset-slots.js`
