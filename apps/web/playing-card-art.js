/** Original vector card artwork. One layout drives HTML SVG and WebGL canvas textures. */
const PATHS = {
 '♥':'M50 90C42 79 5 55 5 28C5 0 40 0 50 23C60 0 95 0 95 28C95 55 58 79 50 90Z',
 '♠':'M50 4C42 17 5 40 5 62C5 86 34 92 45 71L38 96H62L55 71C66 92 95 86 95 62C95 40 58 17 50 4Z',
 '♦':'M50 0L88 50L50 100L12 50Z',
 '♣':'M50 3C24 3 23 32 36 43C9 30-7 62 10 78C21 89 39 86 46 72L38 97H62L54 72C61 86 79 89 90 78C107 62 91 30 64 43C77 32 76 3 50 3Z'
};
const star='M50 3L62 34L96 37L70 59L78 94L50 76L22 94L30 59L4 37L38 34Z';
export function cardDesign(value){
 const suit=value.match(/[♠♥♦♣]/)?.[0]||null,rank=value.replace(/[♠♥♦♣]/g,'');
 const joker=!suit,red=/[♥♦]/.test(value)||value==='BJ';
 const n=Number(rank),pips=[];
 if(n>=2&&n<=10){
  if(n<=3){pips.push([128,92],[128,268]);if(n===3)pips.push([128,180]);}
  else {const ys=n<=5?[100,260]:n<=8?[92,180,268]:[82,147,213,278];for(const x of [86,170])for(const y of ys)pips.push([x,y]);if(n===5||n===9)pips.push([128,180]);if(n===7)pips.push([128,135]);if(n===8||n===10)pips.push([128,125],[128,235]);}
 }
 return {rank,suit,joker,red,color:red?'#ae2942':'#182537',path:PATHS[suit]||star,pips};
}
function ornaments(d){
 if(d.pips.length)return d.pips.map(([x,y])=>({x,y,size:34,flip:y>180}));
 return [{x:128,y:180,size:d.joker?98:80,flip:false}];
}
const suitSVG=(path,x,y,size,flip=false)=>`<path d="${path}" transform="translate(${x} ${y}) rotate(${flip?180:0}) scale(${size/100}) translate(-50 -50)"/>`;
export function playingCardSVG(value){
 const d=cardDesign(value),royal=/^[JQK]$/.test(d.rank),label=d.joker?'J':d.rank;
 const corner=`<text x="19" y="76" font-size="70" font-weight="700" font-family="Georgia,serif">${label}</text>${suitSVG(d.path,39,110,40)}`;
 return `<svg class="card-face" aria-hidden="true" viewBox="0 0 256 360" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="254" height="358" rx="17" fill="#fffaf0" stroke="#cbbb96" stroke-width="2"/><rect x="9" y="9" width="238" height="342" rx="12" fill="none" stroke="#daccad" stroke-width="1"/><g fill="${d.color}"><g class="card-corner">${corner}<g transform="translate(256 360) rotate(180)">${corner}</g></g>${royal?'<path d="M128 75L208 180L128 285L48 180Z" fill="none" stroke="#b39459" stroke-width="2"/><path d="M96 129L91 105L114 117L128 95L142 117L165 105L160 129Z" fill="#b39459"/>':''}${ornaments(d).map(p=>suitSVG(d.path,p.x,p.y,p.size,p.flip)).join('')}${royal?`<text x="128" y="252" text-anchor="middle" font-size="31" font-family="Georgia,serif">${d.rank}</text>`:''}${d.joker?`<text x="128" y="270" text-anchor="middle" font-size="23" font-family="sans-serif">${value==='BJ'?'大王':'小王'}</text>`:''}</g></svg>`;
}
export function drawPlayingCard(c,w,h,value){
 const d=cardDesign(value),royal=/^[JQK]$/.test(d.rank);
 c.save();c.scale(w/256,h/360);c.fillStyle='#fffaf0';c.beginPath();c.roundRect(0,0,256,360,17);c.fill();c.strokeStyle='#cbbb96';c.lineWidth=2;c.beginPath();c.roundRect(2,2,252,356,16);c.stroke();c.strokeStyle='#daccad';c.lineWidth=1;c.beginPath();c.roundRect(9,9,238,342,12);c.stroke();
 function symbol(x,y,size,flip=false){c.save();c.translate(x,y);if(flip)c.rotate(Math.PI);c.scale(size/100,size/100);c.translate(-50,-50);c.fill(new Path2D(d.path));c.restore();}
 c.fillStyle=d.color;
 for(let i=0;i<2;i++){c.save();if(i){c.translate(256,360);c.rotate(Math.PI);}c.font='bold 70px Georgia';c.fillText(d.joker?'J':d.rank,19,76);symbol(39,110,40);c.restore();}
 if(royal){c.strokeStyle='#b39459';c.lineWidth=2;c.beginPath();c.moveTo(128,75);c.lineTo(208,180);c.lineTo(128,285);c.lineTo(48,180);c.closePath();c.stroke();c.fillStyle='#b39459';c.fill(new Path2D('M96 129L91 105L114 117L128 95L142 117L165 105L160 129Z'));c.fillStyle=d.color;}
 for(const p of ornaments(d))symbol(p.x,p.y,p.size,p.flip);
 c.textAlign='center';if(royal){c.font='31px Georgia';c.fillText(d.rank,128,252);}if(d.joker){c.font='23px sans-serif';c.fillText(value==='BJ'?'大王':'小王',128,270);}c.restore();
}
