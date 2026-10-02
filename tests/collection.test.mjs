import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameService } from '../apps/api/game-engine.mjs';
import { emptyCollection, recordWin, composePhoto, collectionSummary } from '../packages/collection-core/index.mjs';
const source = { cardId: 'pal-mia:mint', palId: 'pal-mia', outfitId: 'mint', outfitName: '薄荷', layerSnapshot: { outfit: '/assets/mint.jpg' } };
const library = { 'pal-mia': [{ outfitId: 'mint', name: '薄荷' }, { outfitId: 'rose', name: '蔷薇' }] };
test('win reward is deterministic, idempotent, and advances bond at three wins', () => {
  let p = recordWin(emptyCollection(), { gameId: 'g1', palId: 'pal-mia' });
  assert.equal(recordWin(p, { gameId: 'g1', palId: 'pal-mia' }), p);
  for (const gameId of ['g2', 'g3']) p = recordWin(p, { gameId, palId: 'pal-mia' });
  const s = collectionSummary(p, [source], library);
  assert.equal(s.pals[0].points, 30); assert.equal(s.pals[0].level.name, '熟悉');
  assert.equal(s.pals[0].nextOutfit.name, '蔷薇'); assert.equal(s.milestones[0].unlocked, true);
});
test('composition rejects forged wins, locked outfits and invalid options; retries update one photo', () => {
  let p = recordWin(emptyCollection(), { gameId: 'g1', palId: 'pal-mia' });
  const input = { gameId: 'g1', cardId: source.cardId, name: '月夜', background: 'plum', filter: 'warm' };
  for (const patch of [{ gameId: 'fake' }, { gameId: '__proto__' }, { cardId: 'pal-mia:rose' }, { filter: 'url(javascript:x)' }, { name: '长'.repeat(25) }]) assert.throws(() => composePhoto(p, [source], { ...input, ...patch }));
  p = composePhoto(p, [source], input); const time = p.creations[0].createdAt;
  p = composePhoto(p, [source], { ...input, name: '<月光>' });
  assert.equal(p.creations.length, 1); assert.equal(p.creations[0].name, '<月光>'); assert.equal(p.creations[0].createdAt, time);
});
test('v1 gallery migrates without altering old cards; creations and rewards survive restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dress-collection-')); const galleryPath = join(dir, 'gallery.json');
  try {
    writeFileSync(galleryPath, JSON.stringify({ version: 1, player: [source] }));
    const svc = new GameService({ galleryPath, palOutfits: library });
    assert.deepEqual(svc.getGallery(), [source]); assert.equal(svc.getCollection().wins, 0);
    svc.collection = recordWin(svc.collection, { gameId: 'g1', palId: source.palId });
    svc.savePhoto({ gameId: 'g1', cardId: source.cardId, name: '夜色' });
    const restored = new GameService({ galleryPath, palOutfits: library });
    assert.equal(restored.getCollection().creations[0].name, '夜色'); assert.equal(restored.getCollection().wins, 1);
    assert.deepEqual(restored.getGallery(), [source]);
    writeFileSync(galleryPath, '{broken'); assert.throws(() => new GameService({ galleryPath }));
    assert.equal(readFileSync(galleryPath, 'utf8'), '{broken');
  } finally { rmSync(dir, { recursive: true }); }
});
test('a farmer teammate finishing grants the player a win, photo and one bond reward', () => {
  const svc = new GameService(); const created = svc.newGame({ seed: 2 }); const game = svc.get(created.id);
  game.landlordId = 'pal-linxing'; game.baseBid = 1;
  const before = svc.walletBalance;
  svc.settle(game, 'pal-mia');
  assert.equal(game.settlement.winnerId, 'player'); assert.equal(game.settlement.finisherId, 'pal-mia');
  assert.ok(svc.walletBalance > before); assert.ok(game.settlement.card);
  svc.settle(game, 'pal-mia'); assert.equal(svc.getCollection().wins, 1);
});
