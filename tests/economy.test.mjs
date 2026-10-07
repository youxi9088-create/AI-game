import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameService } from '../apps/api/game-engine.mjs';
const palOutfits = { 'pal-linxing': Array.from({ length: 7 }, (_, i) => ({ outfitId: `look-${i}`, name: `服装${i}`, dance: '舞步', layerSnapshot: { base: '/assets/base.png', outfit: '/assets/outfit.png' } })) };
const create = options => new GameService({ palOutfits, ...options });
function win(svc, winner = 'player') { const g = svc.get(svc.newGame({ seed: 2 }).id); g.landlordId = 'pal-linxing'; svc.settle(g, winner); return g; }
let seq = 0;
function input(svc, index) { const q = svc.getEconomy().catalog[index]; return { commandId: `purchase-${++seq}`, cardId: q.cardId, expectedLevel: q.level, expectedCost: q.cost }; }

test('first win gift, milestone and repeated wins form a deterministic earning loop', () => {
  const svc = create();
  assert.throws(() => svc.purchaseCard(input(svc, 0)), /累计 1 胜/);
  const first = win(svc);
  assert.equal(first.settlement.freeCardReward, true);
  assert.equal(svc.walletBalance, 32); assert.equal(svc.getGallery().length, 1);
  svc.selectReward(first.id, 'pal-linxing:look-1');
  assert.equal(svc.walletBalance, 32);
  svc.settle(first, 'player'); assert.equal(svc.walletBalance, 32);
  const second = win(svc);
  assert.equal(second.settlement.freeCardReward, false);
  assert.equal(svc.walletBalance, 40); assert.equal(svc.getGallery().length, 1);
  assert.equal(svc.getGallery()[0].upgradeLevel, 1);
  assert.equal(svc.getCollection().pals[0].points, 20);
  const result = svc.purchaseCard(input(svc, 0));
  assert.equal(result.spent, 24); assert.equal(result.account.balance, 16);
  assert.equal(svc.getGallery().length, 2);
  svc.purchaseCard(input(svc, 0)); assert.equal(svc.walletBalance, 4);
  assert.throws(() => svc.purchaseCard(input(svc, 0)), /还差/);
});
test('server enforces tier gates, stale quotes, max level and paid upgrades preserve provenance', () => {
  const svc = create({ initialTokenBalance: 1000 });
  const first = win(svc);
  assert.throws(() => svc.purchaseCard(input(svc, 2)), /累计 3 胜/);
  const original = structuredClone(svc.getGallery()[0]);
  const stale = input(svc, 0);
  assert.throws(() => svc.purchaseCard({ ...stale, expectedCost: 0 }), /价格已变化/);
  for (const cost of [12, 24, 40, 60]) {
    const request = input(svc, 0); assert.equal(request.expectedCost, cost);
    svc.purchaseCard(request);
  }
  assert.equal(svc.getGallery()[0].upgradeLevel, 5);
  assert.equal(svc.getGallery()[0].unlockedAt, original.unlockedAt);
  assert.throws(() => svc.purchaseCard(input(svc, 0)), /典藏/);
  assert.throws(() => svc.purchaseCard(stale), /等级或价格/);
  assert.throws(() => svc.selectReward(first.id, 'pal-linxing:look-1'), /首胜/);
  win(svc); win(svc); assert.equal(svc.getEconomy().catalog[2].cost, 40);
  svc.purchaseCard(input(svc, 2));
  assert.throws(() => svc.purchaseCard(input(svc, 5)), /累计 6 胜/);
  win(svc); win(svc); win(svc); assert.equal(svc.getEconomy().catalog[5].cost, 64);
  svc.purchaseCard(input(svc, 5));
  assert.throws(() => svc.purchaseCard({ ...input(svc, 0), cardId: 'forged:card' }), /目录/);
});
test('purchase retry and all collection milestone rewards survive restart without duplicate spending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dress-economy-')); const walletPath = join(dir, 'account.json');
  try {
    let svc = create({ walletPath, initialTokenBalance: 1000 });
    for (let i = 0; i < 6; i++) win(svc);
    const request = input(svc, 1), result = svc.purchaseCard(request), balance = svc.walletBalance;
    svc = create({ walletPath });
    const retry = svc.purchaseCard(request);
    assert.equal(retry.balanceAfter, result.balanceAfter); assert.equal(svc.walletBalance, balance);
    assert.throws(() => svc.purchaseCard({ ...request, expectedLevel: 1 }), /另一笔/);
    for (let i = 2; i < 6; i++) svc.purchaseCard(input(svc, i));
    assert.equal(svc.walletBalance, 1000 + 6 * 8 - (24 + 3 * 40 + 64) + 4 + 8 + 12);
    svc = create({ walletPath });
    assert.deepEqual(svc.claimedMilestones, [1, 3, 6]);
    assert.equal(svc.getLedger().filter(r => r.type.startsWith('COLLECTION_')).length, 3);
    const b = svc.walletBalance; svc.purchaseCard(input(svc, 0)); assert.equal(svc.walletBalance, b - 12);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('legacy wallet and gallery migrate together without resetting balance or cards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dress-migration-'));
  try {
    const walletPath = join(dir, 'wallet.json'), galleryPath = join(dir, 'gallery.json');
    const old = create(); win(old);
    writeFileSync(walletPath, JSON.stringify({ version: 1, balance: 73, ledger: [] }));
    writeFileSync(galleryPath, JSON.stringify({ version: 2, player: old.getGallery(), collection: old.collection }));
    const svc = create({ walletPath, galleryPath });
    assert.equal(svc.walletBalance, 73); assert.deepEqual(svc.getGallery(), old.getGallery());
    svc.purchaseCard(input(svc, 1));
    writeFileSync(galleryPath, '{legacy-backup-broken');
    const restored = create({ walletPath, galleryPath });
    assert.equal(restored.getGallery().length, 2); assert.equal(restored.walletBalance, 53);
    const payload = JSON.parse(readFileSync(walletPath)); payload.collection = null;
    writeFileSync(walletPath, JSON.stringify(payload));
    assert.throws(() => create({ walletPath, galleryPath }), /存档格式无效/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('disk failure rolls back card, balance, receipts, milestones and settlement for a safe retry', () => {
  const svc = create(); const original = svc.persistWallet.bind(svc);
  const g = svc.get(svc.newGame({ seed: 2 }).id); g.landlordId = 'pal-linxing';
  svc.persistWallet = function () { if (this.transactionActive) { this.transactionDirty = true; return; } throw new Error('disk full'); };
  assert.throws(() => svc.settle(g, 'player'), /disk full/);
  assert.equal(svc.walletBalance, 20); assert.equal(svc.getGallery().length, 0); assert.equal(svc.getLedger().length, 0);
  assert.equal(g.settlement, null); assert.equal(svc.collection.wins, 0);
  svc.persistWallet = original; svc.settle(g, 'player');
  const before = structuredClone({ cards: svc.getGallery(), balance: svc.walletBalance, ledger: svc.ledger });
  const request = input(svc, 1);
  svc.persistWallet = function () { if (this.transactionActive) { this.transactionDirty = true; return; } throw new Error('disk full'); };
  assert.throws(() => svc.purchaseCard(request), /disk full/);
  assert.deepEqual({ cards: svc.getGallery(), balance: svc.walletBalance, ledger: svc.ledger }, before);
  assert.equal(Object.hasOwn(svc.economyCommands, request.commandId), false);
  svc.persistWallet = original; svc.purchaseCard(request); assert.equal(svc.walletBalance, 8);
});
