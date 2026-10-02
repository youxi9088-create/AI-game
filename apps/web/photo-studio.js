const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const FILTERS = { natural: 'none', warm: 'sepia(.25) saturate(1.12)', mono: 'grayscale(1)' };
export const BACKGROUNDS = { midnight: '#142338', plum: '#38203b' };
export function photoArtwork(photo) {
  const filter = FILTERS[photo.filter] || FILTERS.natural;
  const bg = BACKGROUNDS[photo.background] || BACKGROUNDS.midnight;
  return `<div class="my-photo" style="background:${bg}"><div class="my-photo-image ${photo.framing === 'close' ? 'close' : ''}" style="filter:${filter}"><img src="${esc(photo.layerSnapshot.outfit)}" alt="${esc(photo.outfitName)}" /></div><div class="my-photo-caption"><strong>${esc(photo.name || '我的定格')}</strong><small>${esc(photo.outfitName)} · AI 虚构成年</small></div></div>`;
}
export function studioMarkup({ gameId, draft, cards, name }) {
  const source = cards.find((c) => c.cardId === draft.cardId) || cards[0];
  if (!source) return '';
  const select = (key, label, entries) => `<label>${label}<select data-photo-option="${key}">${entries.map(([id, text]) => `<option value="${esc(id)}"${draft[key] === id ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  return `<section class="photo-studio" role="dialog" aria-modal="true" aria-labelledby="studio-title"><div class="studio-preview">${photoArtwork({ ...source, ...draft })}</div><form id="photo-studio-form" class="studio-controls" data-game="${esc(gameId)}"><p class="eyebrow">我的写真工作室</p><h2 id="studio-title" tabindex="-1">定格你的${esc(name)}写真</h2><p>本次胜利已解锁服装。选好搭配，保存这一局的专属作品。</p>${select('cardId', '已解锁服装', cards.map((c) => [c.cardId, c.outfitName]))}${select('background', '背景底色', [['midnight', '午夜蓝'], ['plum', '暮色紫']])}${select('filter', '滤镜', [['natural', '原色'], ['warm', '暖光'], ['mono', '黑白']])}${select('framing', '构图', [['full', '完整画面'], ['close', '近景裁切']])}<label>作品名<input id="photo-name" maxlength="24" value="${esc(draft.name || '')}" placeholder="给这一刻起个名字" /></label><p class="studio-hint">每场胜利保留一份作品，重复保存会更新同一份作品。</p><div class="studio-actions"><button class="primary" type="submit">定格并收藏</button><button class="secondary" type="button" data-action="close-studio">稍后再搭配</button></div></form></section>`;
}
export function collectionMarkup(collection, palName) {
  if (!collection) return '';
  return `<section class="bond-panel" aria-label="收集与羁绊"><h2>下一次相见</h2><p>已记录 ${collection.wins} 场奖励胜利 · 旧版收藏保留，羁绊从本次升级后开始累计。</p><div class="bond-grid">${collection.pals.map((p) => `<article><h3>${esc(palName(p.palId))} · ${esc(p.level.name)}</h3><p>羁绊 ${p.points}${p.nextBond ? ` / ${p.nextBond.points}` : ' · 已达知音'}，每次为你登台 +10</p><p>${esc(p.level.story)}</p><small>${p.nextOutfit ? `下次该牌友登台：解锁「${esc(p.nextOutfit.name)}」` : '服装已集齐，再次登台提升卡面等级'}</small></article>`).join('')}</div><div class="collection-badges">${collection.milestones.map((m) => `<span class="${m.unlocked ? 'earned' : ''}">${m.unlocked ? '已获得' : `${m.count} 款解锁`} · ${esc(m.name)}</span>`).join('')}</div>${collection.pending?.length ? `<h3>待定格 · ${collection.pending.length}</h3><div class="collection-badges">${collection.pending.map((r) => `<button class="secondary compact" data-action="compose-pending" data-game="${esc(r.gameId)}">为${esc(palName(r.palId))}定格</button>`).join('')}</div>` : ''}</section>${collection.creations.length ? `<section class="my-creations"><h2>我的定格 · ${collection.creations.length}</h2><div class="creation-grid">${collection.creations.map((c) => `<article>${photoArtwork(c)}<button class="secondary compact" data-action="export-creation" data-creation="${esc(c.creationId)}">导出分享图</button><button class="secondary compact" data-action="edit-creation" data-game="${esc(c.gameId)}">重新搭配</button></article>`).join('')}</div></section>` : ''}`;
}
export async function exportPhoto(photo) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('写真素材加载失败，请稍后重试。')); img.src = photo.layerSnapshot.outfit; });
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUNDS[photo.background] || BACKGROUNDS.midnight; ctx.fillRect(0, 0, 600, 800);
  ctx.save(); ctx.beginPath(); ctx.rect(24, 24, 552, 660); ctx.clip();
  ctx.filter = FILTERS[photo.filter] || 'none';
  const scale = (photo.framing === 'close' ? Math.max : Math.min)(552 / img.width, 660 / img.height) * (photo.framing === 'close' ? 1.12 : 1);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, 24 + (552 - w) / 2, 24 + (660 - h) / 2, w, h); ctx.restore();
  ctx.fillStyle = '#fff8ed'; ctx.font = 'bold 26px sans-serif'; ctx.fillText(photo.name, 24, 728, 552);
  ctx.font = '18px sans-serif'; ctx.fillText(`${photo.outfitName} · AI 虚构成年`, 24, 766, 552);
  const link = document.createElement('a'); link.download = `${photo.creationId}.png`; link.href = canvas.toDataURL('image/png'); link.click();
}
