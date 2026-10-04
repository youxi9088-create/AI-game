const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const FILTERS = { natural: 'none', warm: 'sepia(.25) saturate(1.12)', mono: 'grayscale(1)' };
export const BACKGROUNDS = { midnight: '#142338', plum: '#38203b' };
export function photoArtwork(photo) {
  const filter = FILTERS[photo.filter] || FILTERS.natural;
  const bg = BACKGROUNDS[photo.background] || BACKGROUNDS.midnight;
  return `<div class="my-photo finish-${['classic','foil','prism'].includes(photo.finish) ? photo.finish : 'classic'}" style="background:${bg}"><div class="my-photo-image ${photo.framing === 'close' ? 'close' : ''}" style="filter:${filter}">${Number.isFinite(photo.moment) && photo.layerSnapshot.cardVideo ? `<video muted playsinline preload="metadata" data-photo-moment="${photo.moment}" src="${esc(photo.layerSnapshot.cardVideo)}" poster="${esc(photo.layerSnapshot.cardPoster || photo.layerSnapshot.outfit)}" aria-label="${esc(photo.outfitName)}定格姿态"></video>` : `<img src="${esc(photo.layerSnapshot.outfit)}" alt="${esc(photo.outfitName)}" />`}</div><div class="my-photo-caption"><strong>${esc(photo.name || '我的定格')}</strong><small>${esc(photo.outfitName)} · AI 虚构成年</small></div></div>`;
}
export function studioMarkup({ gameId, draft, cards, name }) {
  const source = cards.find((c) => c.cardId === draft.cardId) || cards[0];
  if (!source) return '';
  const select = (key, label, entries) => `<label>${label}<select data-photo-option="${key}">${entries.map(([id, text]) => `<option value="${esc(id)}"${draft[key] === id ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  return `<section class="photo-studio" role="dialog" aria-modal="true" aria-labelledby="studio-title"><div class="studio-preview">${photoArtwork({ ...source, ...draft })}</div><form id="photo-studio-form" class="studio-controls" data-game="${esc(gameId)}"><p class="eyebrow">我的写真工作室</p><h2 id="studio-title" tabindex="-1">定格你的${esc(name)}写真</h2><p>由你选择演出瞬间、构图与卡面工艺，按下快门。</p>${select('cardId', '已解锁服装', cards.map((c) => [c.cardId, c.outfitName]))}${source.layerSnapshot.cardVideo ? `<fieldset class="pose-picker"><legend>演出姿态</legend><div><button type="button" data-action="pose-preset" data-moment=".08">开场</button><button type="button" data-action="pose-preset" data-moment=".45">舞步</button><button type="button" data-action="pose-preset" data-moment=".8">收尾</button></div><label>定格时机<input aria-label="定格时机" type="range" min="0" max=".95" step=".01" data-photo-option="moment" value="${draft.moment ?? .08}" /></label><small>取自这套服装的真实演出，姿态随视频而定。</small></fieldset>` : ''}${select('finish','卡面工艺',[['classic','经典'],['foil','鎏金'],...(draft.bondPoints >= 30 ? [['prism','棱彩 · 羁绊解锁']] : [])])}${select('background', '背景底色', [['midnight', '午夜蓝'], ['plum', '暮色紫']])}${select('filter', '滤镜', [['natural', '原色'], ['warm', '暖光'], ['mono', '黑白']])}${select('framing', '构图', [['full', '完整画面'], ['close', '近景裁切']])}<label>作品名<input id="photo-name" maxlength="24" value="${esc(draft.name || '')}" placeholder="给这一刻起个名字" /></label><p class="studio-hint">每场胜利保留一份作品，重复保存会更新同一份作品。</p><div class="studio-actions"><button class="primary" type="submit">定格并收藏</button><button class="secondary" type="button" data-action="close-studio">稍后再搭配</button></div></form></section>`;
}
export function collectionMarkup(collection, palName) {
  if (!collection) return '';
  return `<section class="bond-panel" aria-label="收集与羁绊"><h2>下一次相见</h2><p>已记录 ${collection.wins} 场奖励胜利 · 旧版收藏保留，羁绊从本次升级后开始累计。</p><div class="bond-grid">${collection.pals.map((p) => `<article><h3>${esc(palName(p.palId))} · ${esc(p.level.name)}</h3><p>羁绊 ${p.points}${p.nextBond ? ` / ${p.nextBond.points}` : ' · 已达知音'}，每次为你登台 +10</p><p>${esc(p.level.story)}</p><small>${p.nextOutfit ? `下次该牌友登台：可选择解锁「${esc(p.nextOutfit.name)}」` : '服装已集齐，再次登台提升卡面等级'}</small></article>`).join('')}</div><div class="collection-badges">${collection.milestones.map((m) => `<span class="${m.unlocked ? 'earned' : ''}">${m.unlocked ? '已获得' : `${m.count} 款解锁`} · ${esc(m.name)}</span>`).join('')}</div>${collection.pending?.length ? `<h3>待定格 · ${collection.pending.length}</h3><div class="collection-badges">${collection.pending.map((r) => `<button class="secondary compact" data-action="compose-pending" data-game="${esc(r.gameId)}">为${esc(palName(r.palId))}定格</button>`).join('')}</div>` : ''}</section>${collection.creations.length ? `<section class="my-creations"><h2>我的定格 · ${collection.creations.length}</h2><div class="creation-grid">${collection.creations.map((c) => `<article>${photoArtwork(c)}<button class="secondary compact" data-action="export-creation" data-creation="${esc(c.creationId)}">导出分享图</button><button class="secondary compact" data-action="edit-creation" data-game="${esc(c.gameId)}">重新搭配</button></article>`).join('')}</div></section>` : ''}`;
}
export async function exportPhoto(photo) {
  const img = Number.isFinite(photo.moment) && photo.layerSnapshot.cardVideo ? await loadVideoMoment(photo.layerSnapshot.cardVideo,photo.moment) : new Image();
  if (img instanceof HTMLImageElement) await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('写真素材加载失败，请稍后重试。')); img.src = photo.layerSnapshot.outfit; });
  const width=img.videoWidth || img.width, height=img.videoHeight || img.height;
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUNDS[photo.background] || BACKGROUNDS.midnight; ctx.fillRect(0, 0, 600, 800);
  ctx.save(); ctx.beginPath(); ctx.rect(24, 24, 552, 660); ctx.clip();
  ctx.filter = FILTERS[photo.filter] || 'none';
  const scale = (photo.framing === 'close' ? Math.max : Math.min)(552 / width, 660 / height) * (photo.framing === 'close' ? 1.12 : 1);
  const w = width * scale, h = height * scale;
  ctx.drawImage(img, 24 + (552 - w) / 2, 24 + (660 - h) / 2, w, h); ctx.restore();
  if (photo.finish === 'foil' || photo.finish === 'prism') { const gradient=ctx.createLinearGradient(0,0,600,800);gradient.addColorStop(0,photo.finish==='prism'?'#86e7ee':'#a27733');gradient.addColorStop(.5,'#fff0b3');gradient.addColorStop(1,photo.finish==='prism'?'#b18bed':'#a27733');ctx.strokeStyle=gradient;ctx.lineWidth=6;ctx.strokeRect(8,8,584,784); }
  ctx.fillStyle = '#fff8ed'; ctx.font = 'bold 26px sans-serif'; ctx.fillText(photo.name, 24, 728, 552);
  ctx.font = '18px sans-serif'; ctx.fillText(`${photo.outfitName} · AI 虚构成年`, 24, 766, 552);
  const link = document.createElement('a'); link.download = `${photo.creationId}.png`; link.href = canvas.toDataURL('image/png'); link.click();
}

async function loadVideoMoment(src,moment) {
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
 const wait=(event,start)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('演出视频定格超时')),12000);video[event]=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('演出视频加载失败'));};start();});
 await wait('onloadedmetadata',()=>{video.src=src;});
 await wait('onseeked',()=>{video.currentTime=Math.max(.001,Math.min(video.duration-.05,video.duration*moment));});
 return video;
}
export function hydratePhotos(){
 for(const video of document.querySelectorAll('video[data-photo-moment]')){
  if(video.dataset.hydrated)continue;video.dataset.hydrated='1';
  const seek=()=>{video.pause();if(Number.isFinite(video.duration))video.currentTime=Math.max(.001,Math.min(video.duration-.05,video.duration*Number(video.dataset.photoMoment)));};
  video.addEventListener('loadedmetadata',seek,{once:true});if(video.readyState>=1)seek();
 }
}
export function updatePhotoMoment(moment){
 const video=document.querySelector('.studio-preview video[data-photo-moment]');
 if(video){video.dataset.photoMoment=String(moment);if(Number.isFinite(video.duration)){video.pause();video.currentTime=Math.max(.001,Math.min(video.duration-.05,video.duration*moment));}}
 const input=document.querySelector('[data-photo-option="moment"]');if(input)input.value=String(moment);
}
