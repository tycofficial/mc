import * as THREE from 'three';
import { BLOCKS, ITEMS } from './data.js';

const SIZE=16, CELL=32, COLS=8, ATLAS_SIZE=256;
let cached;
const clamp=n=>Math.max(0,Math.min(255,n));
function rgb(hex) {return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
function shade(hex,delta) {return `rgb(${rgb(hex).map(v=>clamp(v+delta)).join(',')})`;}
function randomFor(name) {
  let s=2166136261; for(const c of name){s^=c.charCodeAt(0);s=Math.imul(s,16777619);}
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}

function tile(name, base) {
  const c=document.createElement('canvas');c.width=c.height=SIZE;
  const ctx=c.getContext('2d'), rand=randomFor(name);
  const p=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
  const grain=(color,amount=22)=>{
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)p(x,y,1,1,shade(color,Math.floor((rand()-.5)*amount)));
  };
  const specks=(colors,count=25)=>{for(let i=0;i<count;i++)p(Math.floor(rand()*16),Math.floor(rand()*16),1+(rand()>.7?1:0),1,colors[Math.floor(rand()*colors.length)]);};
  grain(base);
  switch(name) {
    case 'grass_top': grain('#719c42',30);specks(['#94b751','#4e8032','#86ab48'],55);break;
    case 'dirt': grain('#82603e',32);specks(['#5c422c','#ab8056','#947b5e','#736a59'],35);break;
    case 'grass_side': {
      grain('#82603e',32);specks(['#5c422c','#ac8056','#78684f'],35);
      for(let x=0;x<16;x++){const h=3+Math.floor(rand()*3);for(let y=0;y<h;y++)p(x,y,1,1,shade('#65903c',(rand()-.5)*25));p(x,h,1,1,'#526c31');}break;
    }
    case 'stone': grain('#868786',20);for(let i=0;i<12;i++)p(Math.floor(rand()*14),Math.floor(rand()*16),2+Math.floor(rand()*4),1,shade('#858585',(rand()-.5)*29));break;
    case 'cobble': case 'moss': {
      grain('#535854',14);
      for(let row=0;row<4;row++)for(let col=0;col<4;col++){
        const x=col*4-(row%2)*2,y=row*4;const color=shade('#8c9087',(rand()-.5)*26);
        p(x,y,4,3,color);p(x+1,y,3,1,'#a2a69c');p(x+1,y+2,3,1,'#777d74');
      }
      if(name==='moss')specks(['#58753f','#688d46','#718756','#405f35'],65);break;
    }
    case 'sand': grain('#dac990',19);specks(['#e8d9a6','#c4ae74','#d3be80'],25);break;
    case 'log_side': {
      grain('#745332',25);for(let x=0;x<16;x+=3){p(x,0,1,16,'#4f3926');p(x+1,0,1,16,'#957343');}
      for(let i=0;i<11;i++)p(Math.floor(rand()*16),Math.floor(rand()*14),1,2+Math.floor(rand()*5),'#5d432a');break;
    }
    case 'log_top': {
      grain('#bd945b',15);for(let n=1;n<7;n+=2){ctx.strokeStyle=n%4===1?'#846239':'#a47d45';ctx.lineWidth=1;ctx.strokeRect(n+.5,n+.5,15-n*2,15-n*2);}p(7,7,2,2,'#8c663b');break;
    }
    case 'leaves': case 'birch_leaves': {
      grain(name==='leaves'?'#477737':'#719446',32);
      for(let i=0;i<52;i++){const x=Math.floor(rand()*16),y=Math.floor(rand()*16);p(x,y,2,1,rand()>.5?'#68984a':'#38652f');if(rand()>.75)ctx.clearRect(x,y,1,1);}break;
    }
    case 'planks': case 'crafting_side': case 'crafting_top': case 'bookshelf': {
      grain('#b28a51',22);
      for(let y=3;y<16;y+=4){p(0,y,16,1,'#795931');p(0,y-1,16,1,'#c19a61');}
      for(let y=0;y<4;y++)p(y%2?4:11,y*4,1,3,'#806039');
      if(name==='crafting_top'){
        p(0,0,16,2,'#704925');p(0,14,16,2,'#704925');p(0,0,2,16,'#704925');p(14,0,2,16,'#704925');
        p(5,2,1,12,'#65462c');p(10,2,1,12,'#65462c');p(2,6,12,1,'#65462c');p(2,10,12,1,'#65462c');
      }
      if(name==='crafting_side'){
        p(0,0,16,3,'#795028');p(1,3,2,13,'#634523');p(13,3,2,13,'#634523');p(5,5,1,7,'#4b3824');p(4,5,4,2,'#9a9b88');p(10,7,1,5,'#4b3824');p(9,4,3,4,'#817860');
      }
      if(name==='bookshelf'){
        p(1,2,14,5,'#4b3929');p(1,9,14,5,'#4b3929');
        const colors=['#a54435','#527b82','#d6bb6c','#69834c','#a36c8c','#c27c44'];
        for(let r=0;r<2;r++)for(let i=0;i<6;i++){p(2+i*2,2+r*7,1+(i%2),5,colors[(i+r*2)%6]);p(2+i*2,3+r*7,1,1,'#d7ca9b');}
      }break;
    }
    case 'water': {
      grain('#5485bc',12);for(let i=0;i<11;i++)p(Math.floor(rand()*14),Math.floor(rand()*16),2+Math.floor(rand()*4),1,rand()>.5?'#6794c6':'#497bb4');break;
    }
    case 'bedrock':grain('#484a49',68);specks(['#242626','#60615f','#7b7c76'],58);break;
    case 'coal_ore': case 'iron_ore': case 'gold_ore': case 'diamond_ore': {
      grain('#858783',21);
      const colors={coal_ore:['#242625','#414340'],iron_ore:['#c99e85','#96745f'],gold_ore:['#e5bd46','#af8830'],diamond_ore:['#70e4dc','#3aabae']}[name];
      for(const [x,y] of [[3,2],[9,3],[11,9],[4,11],[5,6],[1,8]]){p(x,y,2,2,colors[1]);p(x,y,2,1,colors[0]);p(x+1,y+1,1,1,shade(colors[0],20));}break;
    }
    case 'glass': {
      ctx.clearRect(0,0,16,16);p(0,0,16,1,'#bddbe2');p(0,15,16,1,'#92b7c7');p(0,0,1,16,'#bddbe2');p(15,0,1,16,'#92b7c7');
      p(2,2,3,1,'#def2f4');p(2,3,1,2,'#def2f4');p(10,10,2,1,'#c1dfe5');p(9,11,1,2,'#c1dfe5');break;
    }
    case 'bricks': {
      grain('#a95e4c',24);for(let y=3;y<16;y+=4)p(0,y,16,1,'#c1b4a0');
      for(let row=0;row<4;row++)for(let x=(row%2?3:7);x<16;x+=8)p(x,row*4,1,4,'#c1b4a0');break;
    }
    case 'furnace_side':case 'furnace_front':case 'furnace_top': {
      grain('#858884',28);p(0,0,16,1,'#a7a9a1');p(0,15,16,1,'#4c504c');p(0,0,1,16,'#a7a9a1');p(15,0,1,16,'#4c504c');
      if(name==='furnace_front'){p(3,3,10,4,'#383c39');p(4,4,8,2,'#242725');p(2,9,12,5,'#454a45');p(4,10,8,3,'#222823');p(4,10,8,1,'#121713');}
      else for(let y=4;y<16;y+=4){p(1,y,14,1,'#696e67');p(3+(y%3)*3,y-3,1,3,'#696e67');}break;
    }
    case 'snow':grain('#e6eef0',12);specks(['#d6e1e6','#f6faf8','#ccdce2'],20);break;
    case 'cactus_side': {
      grain('#57943c',18);for(let x=1;x<16;x+=4){p(x,0,1,16,'#356b2b');p(x+1,0,1,16,'#6ca74c');}for(let i=0;i<16;i++)p(Math.floor(rand()*16),Math.floor(rand()*16),1,1,'#d5c68c');break;
    }
    case 'cactus_top':grain('#82a950',20);p(1,1,14,1,'#396e2e');p(1,14,14,1,'#396e2e');p(1,1,1,14,'#396e2e');p(14,1,1,14,'#396e2e');p(6,6,4,4,'#5a843e');break;
    case 'glowstone': {
      grain('#c1964a',45);for(let i=0;i<32;i++)p(Math.floor(rand()*16),Math.floor(rand()*16),2,2,rand()>.5?'#fbe5a0':'#e4bb69');break;
    }
    case 'wool':case 'red_wool':case 'blue_wool':case 'yellow_wool': {
      grain(base,16);for(let y=0;y<16;y+=2)for(let x=y%4;x<16;x+=4){p(x,y,2,1,shade(base,12));p(x+1,y+1,2,1,shade(base,-9));}break;
    }
    case 'gravel':grain('#928c86',60);specks(['#686964','#bbb4a7','#7d7067'],50);break;
    case 'birch_side': {
      grain('#d8d4bf',16);for(let i=0;i<13;i++){const x=Math.floor(rand()*16),y=Math.floor(rand()*16);p(x,y,2+Math.floor(rand()*4),1,'#4a4840');p(x+1,y+1,1,1,'#666151');}break;
    }
    case 'obsidian':grain('#2c263b',22);specks(['#493654','#392849','#1a1825','#514060'],35);break;
    case 'tnt_side': {
      grain('#b94b34',20);for(let x=0;x<16;x+=4){p(x,0,1,16,'#7c3028');p(x+2,0,1,16,'#d76641');}
      p(0,5,16,6,'#ddd3b9');ctx.fillStyle='#292a27';ctx.font='bold 6px monospace';ctx.fillText('TNT',2,10);break;
    }
    case 'tnt_top': {
      grain('#b9563c',18);for(let y=1;y<16;y+=5)for(let x=1;x<16;x+=5){p(x,y,4,4,'#d06d49');p(x+1,y+1,2,2,'#77392b');}p(7,5,2,4,'#45453d');break;
    }
    case 'flower': {
      ctx.clearRect(0,0,16,16);p(7,5,1,11,'#477b32');p(4,10,3,2,'#4e8e36');p(8,8,3,2,'#689f43');p(5,2,5,4,'#c6312d');p(4,3,7,2,'#da4037');p(6,2,3,2,'#eb5543');p(6,5,3,1,'#8a2926');break;
    }
    case 'tall_grass': {
      ctx.clearRect(0,0,16,16);for(let i=0;i<8;i++){const x=2+Math.floor(rand()*12),h=4+Math.floor(rand()*8);p(x,16-h,1,h,rand()>.5?'#659740':'#80a74d');p(x-1,15-h,1,3,'#719f43');}break;
    }
    case 'torch': {
      ctx.clearRect(0,0,16,16);p(7,7,2,9,'#90613a');p(7,7,1,8,'#b18b4b');p(6,5,4,3,'#cc8033');p(6,4,4,2,'#ffd96d');p(7,3,2,3,'#fff0a5');break;
    }
    case 'chest_side':case 'chest_front':case 'chest_top': {
      grain('#b28242',20);p(0,0,16,2,'#64462b');p(0,14,16,2,'#64462b');p(0,0,2,16,'#64462b');p(14,0,2,16,'#64462b');
      if(name!=='chest_top'){p(0,5,16,1,'#5b3d25');p(2,6,12,1,'#c59650');}
      if(name==='chest_front'){p(7,4,3,5,'#4c4b43');p(7,4,2,4,'#d1d0b5');}break;
    }
    case 'melon_side':grain('#7b9c34',22);for(let x=0;x<16;x+=4){p(x,0,1,16,'#49792f');p(x+1,0,1,16,'#5a862e');}break;
    case 'melon_top':grain('#84a13f',18);p(7,7,2,2,'#5d6e32');for(let n=1;n<7;n+=3){ctx.strokeStyle='#639235';ctx.strokeRect(n+.5,n+.5,15-2*n,15-2*n);}break;
    case 'ice':grain('#a6cee4',12);for(let i=0;i<9;i++){const x=Math.floor(rand()*13),y=Math.floor(rand()*13);p(x,y,3,1,'#c4e0ef');p(x+2,y+1,1,2,'#c4e0ef');}break;
    case 'clay':grain('#979fa8',14);specks(['#a9b0b6','#868e99'],20);break;
  }
  return c;
}

function makeItemIcon(item) {
  const c=document.createElement('canvas');c.width=c.height=16;const ctx=c.getContext('2d');
  const p=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
  if(item.tool){
    for(let i=0;i<9;i++){p(3+i,12-i,2,2,'#493623');p(3+i,12-i,1,1,'#a17a44');}
    if(item.tool==='pickaxe'){p(3,1,9,2,'#393c37');p(5,2,8,2,item.color);p(11,3,3,5,item.color);p(5,2,7,1,shade(item.color,28));p(12,7,1,2,item.color);}
    if(item.tool==='axe'){p(5,1,7,5,'#373b34');p(5,2,7,3,item.color);p(6,1,5,1,shade(item.color,25));p(5,5,4,2,item.color);}
    if(item.tool==='shovel'){p(9,1,5,5,'#3c4038');p(9,2,4,3,item.color);p(8,3,4,3,item.color);p(10,1,3,1,shade(item.color,25));}
    if(item.tool==='sword'){ctx.clearRect(0,0,16,16);p(2,12,2,2,'#63472b');p(3,11,2,2,'#a27a43');p(2,8,6,2,'#54584d');p(6,9,2,3,'#54584d');for(let i=0;i<8;i++){p(5+i,8-i,3,3,'#364d48');p(6+i,8-i,2,2,item.color);p(6+i,8-i,1,1,shade(item.color,30));}p(13,0,2,2,item.color);}
  } else if(item.id===100){for(let i=0;i<10;i++){p(2+i,12-i,2,2,'#5e4128');p(2+i,12-i,1,1,'#b0884d');}}
  else if(item.id===104){for(let y=2;y<13;y++){const w=y<6?y-1:13-y;p(8-w,y,w*2,1,y<6?'#a2f4e7':item.color);}p(5,4,5,2,'#d3fff0');p(9,6,3,4,'#30a6af');}
  else if(item.id===105||item.id===106||item.id===109){p(2,8,12,5,shade(item.color,-35));p(3,5,10,5,item.color);p(4,4,8,2,shade(item.color,30));p(3,5,1,4,shade(item.color,25));}
  else if(item.id===107){p(2,8,12,4,'#568636');p(3,6,10,5,'#acc766');p(4,5,8,5,'#e36662');p(5,7,1,1,'#493a2d');p(8,8,1,1,'#493a2d');p(10,6,1,1,'#493a2d');}
  else if(item.id===110){p(7,1,2,3,'#765b2e');p(9,2,3,2,'#6b9638');p(3,5,10,7,'#992d29');p(4,4,8,9,item.color);p(5,5,2,3,'#ed7160');p(6,12,4,2,'#ac302b');}
  else if(item.id===113){for(let i=0;i<9;i++)p(4+i,13-i,1,1,'#907b39');for(let i=0;i<5;i++){p(6+i,8-i,2,2,'#d6bd64');p(8+i,10-i,2,2,'#bda450');}}
  else {p(3,5,9,7,shade(item.color,-25));p(4,3,7,9,item.color);p(2,6,11,4,item.color);p(5,4,4,2,shade(item.color,30));p(10,7,2,3,shade(item.color,-15));}
  const big=document.createElement('canvas');big.width=big.height=64;const b=big.getContext('2d');b.imageSmoothingEnabled=false;b.drawImage(c,0,0,64,64);return big.toDataURL();
}

function cubeIcon(top,side,front,flat=false) {
  const c=document.createElement('canvas');c.width=c.height=64;
  const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
  if(flat){ctx.drawImage(side,8,4,48,56);return c.toDataURL();}
  // Three affine faces: a compact isometric block, matching the world textures.
  const face=(img,a,b,c,d,e,f,tint)=>{ctx.save();ctx.setTransform(a,b,c,d,e,f);ctx.drawImage(img,0,0);if(tint){ctx.globalCompositeOperation='source-atop';ctx.fillStyle=`rgba(0,0,0,${tint})`;ctx.fillRect(0,0,16,16);}ctx.restore();};
  face(top,1.75,-.875,1.75,.875,4,18,0);
  face(side,1.75,.875,0,1.75,4,18,.12);
  face(front,1.75,-.875,0,1.75,32,32,.28);
  return c.toDataURL();
}

/** Pixel artwork is generated locally. No Mojang assets or external texture requests. */
export function createTextureAtlas() {
  if(cached)return cached;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=ATLAS_SIZE;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  const tiles={},locations={},icons={};
  const names=new Map();
  for(const b of BLOCKS)for(const name of [b.texture,b.top,b.bottom,b.front].filter(Boolean))if(!names.has(name))names.set(name,b.color);
  let index=0;
  for(const [name,color] of names){
    const t=tile(name,color),x=(index%COLS)*CELL+8,y=Math.floor(index/COLS)*CELL+8;
    tiles[name]=t;locations[name]=[x,y];
    // Eight-pixel gutters prevent distant mip levels from borrowing adjacent block colors.
    ctx.drawImage(t,x,y);ctx.drawImage(t,0,0,16,1,x,y-8,16,8);ctx.drawImage(t,0,15,16,1,x,y+16,16,8);
    ctx.drawImage(t,0,0,1,16,x-8,y,8,16);ctx.drawImage(t,15,0,1,16,x+16,y,8,16);
    for(const [sx,sy,dx,dy] of [[0,0,-8,-8],[15,0,16,-8],[0,15,-8,16],[15,15,16,16]])ctx.drawImage(t,sx,sy,1,1,x+dx,y+dy,8,8);
    index++;
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestMipmapNearestFilter;texture.generateMipmaps=true;
  const textureName=(id,face)=>{const b=BLOCKS[id]||BLOCKS[0];return face===2?(b.top||b.texture):face===3?(b.bottom||b.texture):face===4?(b.front||b.texture):b.texture;};
  const uvFor=(id,face=0)=>{
    const [x,y]=locations[textureName(id,face)];
    return [(x+.02)/ATLAS_SIZE,1-(y+16-.02)/ATLAS_SIZE,(x+16-.02)/ATLAS_SIZE,1-(y+.02)/ATLAS_SIZE];
  };
  for(const b of BLOCKS)if(b.id)icons[b.id]=cubeIcon(tiles[b.top||b.texture],tiles[b.texture],tiles[b.front||b.texture],b.cross);
  for(const item of Object.values(ITEMS))if(item.id>=100)icons[item.id]=makeItemIcon(item);
  cached={texture,canvas,icons,uvFor,tiles};return cached;
}
export function getIcon(id){return typeof document==='undefined'?'':createTextureAtlas().icons[id]||'';}
