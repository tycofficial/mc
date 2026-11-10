import * as THREE from 'three';
import './style.css';
import './extras.css';
import { B, BLOCKS, ITEMS, SAVE_VERSION } from './data.js';
import { World, SEA_LEVEL, WORLD_HEIGHT } from './world.js';
import { createTextureAtlas, getIcon } from './textures.js';
import { Environment } from './environment.js';
import { Entities } from './entities.js';
import { GameAudio } from './audio.js';
import { Player } from './player.js';
import { Inventory, Furnace, Chest } from './inventory.js';
import { UI } from './ui.js';
import { SaveStore, makeWorldMeta, validateSave } from './storage.js';
import { Visuals } from './visuals.js';
import { TouchControls } from './touch.js';

const canvas=document.querySelector('#game-canvas');
const store=new SaveStore();
const settings=store.getSettings();
const audio=new GameAudio();audio.setVolume(settings.volume);
let renderer,scene,camera,world,environment,entities,player,visuals,inventory,meta;
let active=false,loading=false,locked=false,touchActive=false,saveElapsed=0,uiElapsed=0,hudElapsed=0,frameCount=0,fpsElapsed=0,fps=60;
let mining=null,mouseDown=false,placeDown=false,placeCooldown=0,attackCooldown=0,hit=null,debug=settings.debug,lastTime=performance.now(),suppressUnlock=false;
let fallbackControls=false,lockPending=false,dragPress=null,lockTimer;
const DRAG_THRESHOLD=5, HOLD_TO_MINE_MS=180;
const keys=new Set(),furnaces=new Map(),chests=new Map(),fuses=[];
const direction=new THREE.Vector3();
const touchMovement={x:0,y:0};
const mobile=TouchControls.isSupported();
const ui=new UI({settings,getIcon,touch:mobile,callbacks:{
  onCreate:options=>startWorld(makeWorldMeta(options)),
  onLoad:id=>{try{startWorld(store.read(id));}catch(error){ui.toast(error.message);}},
  onDelete:id=>{store.delete(id);ui.showWorlds(store.list());},
  onResume:()=>resume(), onQuit:()=>quit(), onInventoryClose:()=>closeInventory(),
  onSettings:next=>applySettings(next),onRespawn:()=>respawn(),
  onSelectSlot:index=>{inventory?.select(index);audio.play('click');},
  onModeChange:mode=>setMode(mode),onSaveExport:()=>exportSave(),onSaveImport:file=>importSave(file),
  onFullscreen:()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.();},
}});

function fatal(error){console.error(error);const e=document.createElement('div');e.className='fatal-error';const title=document.createElement('h1');title.textContent='世界暂时无法启动';const message=document.createElement('p');message.textContent=error.message||String(error);const hint=document.createElement('p');hint.textContent='请使用支持 WebGL 2 的现代浏览器并开启硬件加速，然后刷新页面。';e.append(title,message,hint);document.body.append(e);}
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.25:1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.NoToneMapping;renderer.setClearColor(0x8fc4eb);renderer.autoClear=false;
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(settings.fov,innerWidth/innerHeight,.05,700);
  const atlas=createTextureAtlas();
  world=new World(scene,{seed:'方块世界-2026',renderDistance:3});environment=new Environment(scene,{seed:'panorama',time:.28});environment.setViewDistance(80);
  world.ensureAround(8,8,1);camera.position.set(12,world.getHeight(12,12)+12,12);camera.lookAt(-24,SEA_LEVEL+4,-30);
  ui.showTitle(store.list());
  requestAnimationFrame(frame);
}catch(error){fatal(error);}

function clearDrag(){
  const id=dragPress?.id;
  dragPress=null;
  if(id!==undefined&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
}
function releasePointer(){
  keys.clear();mouseDown=placeDown=false;mining=null;clearDrag();
  if(player)player.jumpRequested=false;
  clearTimeout(lockTimer);lockPending=false;
  if(document.pointerLockElement){suppressUnlock=true;document.exitPointerLock();}
  locked=false;touchActive=false;touchControls.setActive(false);
}
function enableFallback(){
  if(!active||mobile||player.health<=0)return;
  clearTimeout(lockTimer);lockPending=false;locked=false;
  const first=!fallbackControls;fallbackControls=true;
  if(first)ui.toast('直接按住左键拖动视角。长按不动挖掘，右键放置。');
}
async function lockPointer(){
  if(!active||player.health<=0)return;audio.unlock();
  if(mobile){touchActive=true;touchControls.setActive(true);return;}
  if(fallbackControls||locked||lockPending)return;
  lockPending=true;
  // Embedded browsers may reject, throw, or silently ignore Pointer Lock. None should trap the player in a menu.
  lockTimer=setTimeout(()=>{if(!document.pointerLockElement&&active&&!ui.isOpen)enableFallback();},700);
  try{await canvas.requestPointerLock();}catch{if(active&&!ui.isOpen)enableFallback();}
}
function resume(){if(!active)return;if(ui.menu==='inventory'||['crafting','furnace','chest','creative'].includes(ui.menu))return closeInventory();ui.hideMenus();lockPointer();}
function pause(){if(!active||ui.isOpen)return;releasePointer();ui.showPause();saveGame();}
function openInventory(kind='inventory',extra){if(!active||ui.isOpen)return;releasePointer();ui.showInventory(inventory,kind,extra);audio.play('click');}
function closeInventory(){
  const overflow=ui.closeInventory()||[];for(const stack of overflow)visuals.drop(stack.id,stack.count,player.position,stack.durability);
  ui.hideMenus();saveGame();lockPointer();
}
function applySettings(next){
  Object.assign(settings,next);settings.renderDistance=Math.max(2,Math.min(8,Number(settings.renderDistance)||4));settings.fov=Math.max(50,Math.min(110,Number(settings.fov)||75));
  settings.sensitivity=Math.max(.1,Math.min(3,Number(settings.sensitivity)||1));audio.setVolume(settings.volume);debug=!!settings.debug;
  if(player)player.settings=settings;if(world)world.renderDistance=settings.renderDistance;environment?.setViewDistance(settings.renderDistance*16);try{store.setSettings(settings);}catch{ui.toast('浏览器无法保存设置');}
}
function findSpawn(){
  let x=8,z=8;let found=false;
  for(let r=0;r<64&&!found;r+=4)for(let dx=-r;dx<=r&&!found;dx+=4)for(let dz=-r;dz<=r;dz+=4){const sx=8+dx,sz=8+dz,h=world.getHeight(sx,sz);if(h>SEA_LEVEL+1&&h<65&&world.getBlock(sx,h,sz)!==B.CACTUS){x=sx;z=sz;found=true;break;}}
  let y=world.getHeight(x,z)+1.05;while(y<WORLD_HEIGHT-3&&(BLOCKS[world.getBlock(x,Math.floor(y),z)]?.solid||BLOCKS[world.getBlock(x,Math.floor(y)+1,z)]?.solid))y++;
  return [x+.5,y,z+.5];
}
async function startWorld(save){
  if(loading)return;loading=true;releasePointer();ui.showLoading('正在生成地形…');await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,30)));
  try{
    if(active)saveGame();active=false;entities?.dispose();visuals?.dispose();world?.dispose();environment?.dispose();
    meta={...save};world=new World(scene,{seed:meta.seed,renderDistance:settings.renderDistance,edits:save.edits||[]});
    environment=new Environment(scene,{seed:meta.seed,...save.environment});environment.setViewDistance(settings.renderDistance*16);
    furnaces.clear();chests.clear();fuses.length=0;for(const fuse of save.fuses||[])fuses.push({...fuse});
    for(const [key,value]of Object.entries(save.furnaces||{}))furnaces.set(key,new Furnace(value));
    for(const [key,value]of Object.entries(save.chests||{}))chests.set(key,new Chest(value));
    const spawn=save.player?.position||findSpawn();world.ensureAround(spawn[0],spawn[2],1);
    inventory=new Inventory(meta.mode,save.inventory||null);
    player=new Player(camera,world,{...save.player,position:spawn,mode:meta.mode});player.settings=settings;
    if(save.player?.flying&&meta.mode==='creative')player.flying=true;
    visuals=new Visuals(scene,camera,createTextureAtlas());
    visuals.restoreDrops(save.drops);
    for(const stack of save.pendingItems||[]){const left=inventory.add(stack.id,stack.count,stack.durability);if(left)visuals.drop(stack.id,left,player.position,stack.durability);}
    entities=new Entities(scene,world,{seed:meta.seed,data:save.entities,onDamage:(amount,reason)=>player.damage(amount,reason),onDrop:(id,count,pos)=>visuals.drop(id,count,pos)});
    player.onStep=(type,id)=>audio.play(type,id);
    player.onDamage=(amount,reason)=>{audio.play('hit');visuals.flash();if(player.health<=0){for(const s of inventory.slots)if(s)visuals.drop(s.id,s.count,player.position,s.durability);inventory.slots.fill(null);player.xp=0;releasePointer();ui.showDeath(reason);saveGame();}};
    active=true;saveElapsed=0;hit=null;mining=null;ui.hideMenus();
    ui.toast(`${meta.name} · ${meta.mode==='creative'?'创造模式':'生存模式'}  |  E 打开背包 · Esc 菜单`);
    audio.unlock();saveGame();if(player.health<=0)ui.showDeath();else await lockPointer();
  }catch(error){fatal(error);}finally{loading=false;}
}
function snapshot(){const pendingItems=['inventory','crafting','furnace','chest'].includes(ui.menu)?[ui.cursor,...ui.craftGrid].filter(Boolean).map(s=>({...s})):[];return {...meta,version:SAVE_VERSION,mode:player.mode,updated:Date.now(),player:player.serialize(),inventory:inventory.serialize(),pendingItems,drops:visuals.serializeDrops(),fuses:fuses.map(({x,y,z,time})=>({x,y,z,time})),environment:environment.serialize(),edits:world.getEdits(),entities:entities.serialize(),furnaces:Object.fromEntries([...furnaces].map(([k,v])=>[k,v.serialize()])),chests:Object.fromEntries([...chests].map(([k,v])=>[k,v.serialize()]))};}
function saveGame(notify=false){if(!active||!player)return;try{const save=snapshot();store.write(save);meta.updated=save.updated;if(notify)ui.toast('世界已保存');}catch(error){ui.toast('保存失败：存储空间不足或浏览器禁用存储，请导出存档。');console.error(error);}}
function quit(){if(!active){ui.showTitle(store.list());return;}releasePointer();if(ui.menu==='inventory'||['crafting','furnace','chest','creative'].includes(ui.menu)){const extras=ui.closeInventory()||[];for(const s of extras)inventory.add(s.id,s.count,s.durability);}saveGame();active=false;entities?.dispose();entities=null;visuals?.dispose();visuals=null;ui.showTitle(store.list());}
function respawn(){player.position.set(...findSpawn());world.ensureAround(player.position.x,player.position.z,1);player.velocity.set(0,0,0);player.health=20;player.hunger=20;player.oxygen=20;player.fallStart=player.position.y;player.syncCamera();ui.hideMenus();lockPointer();saveGame();}
function setMode(mode){if(!player)return;mode=mode==='creative'?'creative':'survival';player.mode=mode;inventory.mode=mode;meta.mode=mode;ui.lastState.mode=mode;if(mode==='creative'){player.health=20;player.hunger=20;}else player.flying=false;ui.toast(`游戏模式已切换为${mode==='creative'?'创造':'生存'}`);saveGame();}
function exportSave(){if(!active){ui.toast('请先进入要导出的世界');return;}saveGame();const blob=new Blob([JSON.stringify(snapshot())],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${meta.name.replace(/[<>:"/\\|?*]/g,'_')}.mc-world.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importSave(file){try{if(!file)return;if(file.size>30*1024*1024)throw new Error('存档不能超过 30 MB');const imported=validateSave(JSON.parse(await file.text()));imported.id=crypto.randomUUID();imported.updated=Date.now();store.write(imported);ui.showWorlds(store.list());ui.toast('世界导入成功');}catch(error){ui.toast(`导入失败：${error.message}`);}}

function select(index){if(!inventory)return;inventory.select((index+9)%9);mining=null;audio.play('click');}
function pickBlock(){if(!hit||player.mode!=='creative')return;const existing=inventory.slots.slice(0,9).findIndex(s=>s?.id===hit.id);if(existing>=0)select(existing);else inventory.slots[inventory.selected]={id:hit.id,count:64};}
function interact(){
  if(placeCooldown>0)return;
  const selected=inventory.selectedItem,item=ITEMS[selected?.id];
  if(item?.food&&player.mode==='survival'){placeCooldown=.8;if(player.eat(item.food)){inventory.takeSelected(1);audio.play('eat');visuals.swingHand();}return;}
  if(!hit)return;placeCooldown=.22;visuals.swingHand();
  if(!player.crouching){const key=`${hit.x},${hit.y},${hit.z}`;
    if(hit.id===B.CRAFTING){openInventory('crafting');return;}
    if(hit.id===B.FURNACE){if(!furnaces.has(key))furnaces.set(key,new Furnace());openInventory('furnace',{furnace:furnaces.get(key)});return;}
    if(hit.id===B.CHEST){if(!chests.has(key))chests.set(key,new Chest());openInventory('chest',{chest:chests.get(key)});return;}
    if(hit.id===B.TNT){ignite(hit);return;}
  }
  if(!selected||!BLOCKS[selected.id])return;
  const p=hit.previous||{x:hit.x+hit.normal.x,y:hit.y+hit.normal.y,z:hit.z+hit.normal.z};
  if(p.y<1||p.y>=WORLD_HEIGHT)return;
  if(BLOCKS[selected.id].solid&&player.intersectsBlock(p.x,p.y,p.z))return;
  const current=world.getBlock(p.x,p.y,p.z);if(current&&!BLOCKS[current]?.liquid&&!BLOCKS[current]?.cross)return;
  if(world.setBlock(p.x,p.y,p.z,selected.id)!==false){if(player.mode==='survival')inventory.takeSelected(1);audio.play('place',selected.id);settle(p.x,p.y,p.z);}
}
function settle(x,y,z){
  // Falling columns settle synchronously; updates are bounded by world height.
  for(let by=Math.max(1,y);by<Math.min(WORLD_HEIGHT,y+32);by++) {
    const id=world.getBlock(x,by,z);if(!BLOCKS[id]?.gravity)continue;
    let down=by;while(down>1&&!BLOCKS[world.getBlock(x,down-1,z)]?.solid)down--;
    if(down!==by){world.setBlock(x,by,z,0);world.setBlock(x,down,z,id);}
  }
}
function breakBlock(target){
  const {x,y,z,id}=target,b=BLOCKS[id];if(!b)return;
  world.setBlock(x,y,z,0);visuals.spawnBreak(target,id);audio.play('break',id);
  const item=ITEMS[inventory.selectedItem?.id];
  if(player.mode==='survival'){
    if(!b.tier||(item?.tool==='pickaxe'&&item.tier>=b.tier)){
      let drop=b.drop??id;if(id===B.LEAVES||id===B.BIRCH_LEAVES)drop=Math.random()<.15?110:0;if(id===B.GLASS||id===B.ICE)drop=0;
      if(drop)visuals.drop(drop,id===B.MELON?3:1,new THREE.Vector3(x+.5,y+.4,z+.5));
      if([11,12,13,14].includes(id))player.xp+=id===14?7:1;
    }
    if(item?.tool)inventory.damageSelected(1);player.exhaustion+=.025;
  }
  const key=`${x},${y},${z}`;
  const container=furnaces.get(key)||chests.get(key);if(container){for(const s of container.slots)if(s)visuals.drop(s.id,s.count,new THREE.Vector3(x+.5,y+.4,z+.5),s.durability);furnaces.delete(key);chests.delete(key);}
  settle(x,y+1,z);mining=null;
}
function tryAttack(selected=ITEMS[inventory.selectedItem?.id]){
  if(attackCooldown>0||!entities.hit(camera.position,direction,Math.min(hit?.distance??4,4),selected?.attack||1))return false;
  visuals.swingHand();audio.play('hit');attackCooldown=.45;mining=null;
  if(player.mode==='survival'&&selected?.tool)inventory.damageSelected(1);
  return true;
}
function updateMining(dt,now){
  const holdingStill=dragPress&&!dragPress.moved&&now-dragPress.started>=HOLD_TO_MINE_MS;
  if(!mouseDown&&!holdingStill){mining=null;return;}
  const selected=ITEMS[inventory.selectedItem?.id];
  if(tryAttack(selected))return;
  if(!hit||attackCooldown>0)return;
  if(fuses.some(f=>f.x===hit.x&&f.y===hit.y&&f.z===hit.z))return;
  const b=BLOCKS[hit.id];if(!b||b.liquid||(!Number.isFinite(b.hardness)&&!(player.mode==='creative'&&hit.id===B.BEDROCK)))return;
  const key=`${hit.x},${hit.y},${hit.z}`;if(!mining||mining.key!==key){mining={key,progress:0};visuals.swingHand();}
  let duration=player.mode==='creative'?.12:b.hardness*1.55;
  if(player.mode!=='creative'){
    if((selected?.tool&&selected.tool===b.tool)||(selected?.tool==='shovel'&&[1,2,5,19,23,39].includes(hit.id)))duration/=selected.speed;
    if(b.tier&&!(selected?.tool==='pickaxe'&&selected.tier>=b.tier))duration*=3;
    if(player.underwater)duration*=3;
  }
  mining.progress+=dt/Math.max(.08,duration);
  if(visuals.swing===0)visuals.swingHand();
  if(mining.progress>=1){breakBlock(hit);attackCooldown=player.mode==='creative'?.12:.08;}
}
function ignite(target){if(fuses.some(f=>f.x===target.x&&f.y===target.y&&f.z===target.z))return;fuses.push({...target,time:3});ui.toast('TNT 已点燃！');audio.play('click');}
function explode(fuse){
  const p=new THREE.Vector3(fuse.x+.5,fuse.y+.5,fuse.z+.5);visuals.spawnBreak(fuse,B.TNT,60);audio.play('break',B.STONE);
  for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++)for(let dz=-3;dz<=3;dz++)if(dx*dx+dy*dy+dz*dz<11){const x=fuse.x+dx,y=fuse.y+dy,z=fuse.z+dz,id=world.getBlock(x,y,z);if(id&&id!==B.BEDROCK&&id!==B.OBSIDIAN&&id!==B.WATER){if(id===B.TNT&&(dx||dy||dz)){const existing=fuses.find(f=>f.x===x&&f.y===y&&f.z===z);if(existing)existing.time=Math.min(existing.time,.35);else fuses.push({x,y,z,time:.35});}world.setBlock(x,y,z,0);const key=`${x},${y},${z}`;const c=furnaces.get(key)||chests.get(key);if(c)for(const s of c.slots)if(s)visuals.drop(s.id,s.count,new THREE.Vector3(x+.5,y+.5,z+.5));furnaces.delete(key);chests.delete(key);}}
  const dist=player.position.distanceTo(p);if(dist<7){player.damage(Math.ceil((7-dist)*3),'爆炸');player.velocity.add(player.position.clone().sub(p).normalize().multiplyScalar(9));}
}
function frame(now){
  requestAnimationFrame(frame);const dt=Math.min(.05,(now-lastTime)/1000);lastTime=now;
  if(!renderer||!world||loading)return;
  frameCount++;fpsElapsed+=dt;if(fpsElapsed>=.5){fps=Math.round(frameCount/fpsElapsed);frameCount=0;fpsElapsed=0;}
  const playing=active&&!ui.isOpen&&!chat.open&&(locked||touchActive||fallbackControls)&&player.health>0;
  fallbackHint.hidden=!(active&&fallbackControls&&!ui.isOpen&&!chat.open);
  canvas.classList.toggle('drag-look',playing&&fallbackControls);
  canvas.classList.toggle('dragging-look',!!dragPress?.moved);
  if(active){
    if(playing){
      world.ensureAround(player.position.x,player.position.z,0);player.update(dt,keys,mobile?touchMovement:undefined);if(player.position.y<-10&&player.mode==='creative')respawn();camera.getWorldDirection(direction);hit=world.raycast(camera.position,direction,player.mode==='creative'?7:4.5);
      if(touchActive)touchControls.setFlying(player.flying);
      placeCooldown=Math.max(0,placeCooldown-dt);attackCooldown=Math.max(0,attackCooldown-dt);updateMining(dt,now);if(placeDown)interact();
      environment.update(dt,player.position,{underwater:player.underwater});entities.update(dt,player.position,{mode:player.mode,daylight:environment.daylight});
      visuals.setHeld(inventory.selectedItem?.id||0);visuals.update(dt,player,world,inventory,audio);visuals.target(hit,mining?.progress||0);
      for(let i=fuses.length-1;i>=0;i--){fuses[i].time-=dt;if(fuses[i].time<=0){const fuse=fuses.splice(i,1)[0];explode(fuse);}}
    }else{visuals.target(null);environment.update(0,player.position,{underwater:player.underwater,paused:true});}
    // Furnaces run while their container is open, but pause in the game menu.
    const processing=playing||['inventory','furnace','crafting','chest','creative'].includes(ui.menu);
    if(processing){for(const f of furnaces.values())f.tick(dt);uiElapsed+=dt;if(uiElapsed>.2){if(ui.menu==='furnace')ui.renderInventory();uiElapsed=0;}}
    world.update(player.position.x,player.position.z,1);
    waterOverlay.style.display=player.underwater?'block':'none';
    hudElapsed+=dt;if(hudElapsed>.08){ui.updateHUD({inventory,mode:player.mode,health:player.health,hunger:player.hunger,xp:player.xp,oxygen:player.oxygen,target:hit?BLOCKS[hit.id].name:'',mining:mining?.progress||0,position:player.position,biome:world.getBiome(player.position.x,player.position.z),fps,flying:player.flying,debug,time:environment.time,day:environment.day});hudElapsed=0;}
    saveElapsed+=dt;if(saveElapsed>20){saveGame();saveElapsed=0;}
  }else{
    camera.rotation.order='YXZ';camera.rotation.y+=dt*.035;world.update(camera.position.x,camera.position.z,1);environment.update(dt,camera.position,{paused:true});waterOverlay.style.display='none';
  }
  renderer.clear();renderer.render(scene,camera);if(active)visuals.renderHand(renderer,playing);
}

document.addEventListener('pointerlockchange',()=>{
  locked=document.pointerLockElement===canvas;
  if(locked){lockPending=false;fallbackControls=false;clearDrag();clearTimeout(lockTimer);suppressUnlock=false;}
  else{keys.clear();mouseDown=placeDown=false;mining=null;if(suppressUnlock){suppressUnlock=false;return;}if(lockPending){if(active&&!ui.isOpen)enableFallback();return;}if(active&&!ui.isOpen&&!chat.open&&!fallbackControls){ui.showPause();saveGame();}}
});
document.addEventListener('pointerlockerror',()=>{if(lockPending&&active&&!ui.isOpen)enableFallback();});
canvas.addEventListener('click',()=>{if(active&&!ui.isOpen&&!locked&&!mobile&&!chat.open)lockPointer();});
document.addEventListener('mousemove',e=>{if(active&&locked&&!ui.isOpen)player.look(e.movementX,e.movementY);});
document.addEventListener('mousedown',e=>{
  if(mobile||e.target.closest?.('[data-hotbar]')||!active||ui.isOpen||chat.open||(!locked&&!fallbackControls))return;
  if(e.button===0&&locked){mouseDown=true;audio.unlock();if(!tryAttack())visuals.swingHand();}
  if(e.button===2){placeDown=true;interact();}
  if(e.button===1){e.preventDefault();pickBlock();}
});
document.addEventListener('mouseup',e=>{if(e.button===0&&!mobile)mouseDown=false;if(e.button===2)placeDown=false;});
canvas.addEventListener('pointerdown',e=>{
  if(mobile||!fallbackControls||!active||ui.isOpen||chat.open||e.button!==0)return;
  e.preventDefault();audio.unlock();
  dragPress={id:e.pointerId,x:e.clientX,y:e.clientY,started:performance.now(),moved:false};
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',e=>{
  if(dragPress?.id!==e.pointerId)return;
  const dx=e.clientX-dragPress.x,dy=e.clientY-dragPress.y;
  if(!dragPress.moved&&Math.hypot(dx,dy)<DRAG_THRESHOLD)return;
  dragPress.moved=true;mining=null;
  player.look(dx*1.95,dy*1.95);
  dragPress.x=e.clientX;dragPress.y=e.clientY;
});
canvas.addEventListener('pointerup',e=>{
  if(dragPress?.id!==e.pointerId)return;
  const click=!dragPress.moved&&performance.now()-dragPress.started<HOLD_TO_MINE_MS;
  clearDrag();
  if(click&&!tryAttack())visuals.swingHand();
});
for(const type of ['pointercancel','lostpointercapture'])canvas.addEventListener(type,e=>{if(dragPress?.id===e.pointerId)clearDrag();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('wheel',e=>{if(active&&!ui.isOpen&&!chat.open){e.preventDefault();select(inventory.selected+Math.sign(e.deltaY));}},{passive:false});
document.addEventListener('keydown',e=>{
  if(chat.open)return;
  if(active&&e.code==='Escape'){
    e.preventDefault();
    if(['inventory','creative','crafting','furnace','chest'].includes(ui.menu))closeInventory();
    else if(ui.menu==='settings'||ui.menu==='help')ui.showPause();
    else if(!ui.isOpen)pause();
    return;
  }
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  if(!active)return;
  if(e.code==='KeyE'&&!e.repeat){e.preventDefault();if(['inventory','creative','crafting','furnace','chest'].includes(ui.menu))closeInventory();else if(!ui.isOpen)openInventory();return;}
  if(ui.isOpen)return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','F3','F4'].includes(e.code))e.preventDefault();
  if(e.code==='F3'&&!e.repeat){debug=!debug;settings.debug=debug;return;}
  if(e.code==='F4'&&!e.repeat){setMode(player.mode==='creative'?'survival':'creative');return;}
  if((e.code==='KeyT'||e.code==='Slash')&&!e.repeat){e.preventDefault();chat.show(e.code==='Slash'?'/':'');return;}
  if(e.code==='KeyQ'&&!e.repeat){const stack=inventory.takeSelected(e.ctrlKey?64:1);if(stack)visuals.drop(stack.id,stack.count,player.position.clone().addScaledVector(direction,1),stack.durability);return;}
  if(e.code==='KeyF'&&!e.repeat&&inventory.selectedItem&&ITEMS[inventory.selectedItem.id]?.food){if(player.eat(ITEMS[inventory.selectedItem.id].food)){inventory.takeSelected(1);audio.play('eat');}return;}
  if(e.code.startsWith('Digit')&&Number(e.code.slice(5))>=1){select(Number(e.code.slice(5))-1);return;}
  if(e.code==='Space'&&!e.repeat)player.jumpPress(performance.now()/1000);
  keys.add(e.code);
});
document.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();mouseDown=placeDown=false;if(active&&!ui.isOpen&&!chat.open)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){saveGame();if(active&&!ui.isOpen)pause();}});
window.addEventListener('beforeunload',()=>saveGame());
window.addEventListener('resize',()=>{if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});

const waterOverlay=document.createElement('div');waterOverlay.id='water-overlay';document.body.append(waterOverlay);
const fallbackHint=document.createElement('div');fallbackHint.id='fallback-controls';fallbackHint.hidden=true;fallbackHint.textContent='左键拖动视角 · 长按不动挖掘 · 右键放置 · WASD 移动';document.body.append(fallbackHint);
const touchControls=new TouchControls(canvas,{
  look:(dx,dy)=>player?.look(dx*2.25,dy*2.25),
  move:(x,y)=>{touchMovement.x=x;touchMovement.y=y;},
  key:(code,pressed)=>pressed?keys.add(code):keys.delete(code),
  jump:()=>player?.jumpPress(performance.now()/1000),
  mine:pressed=>{mouseDown=pressed;if(pressed&&!tryAttack())visuals.swingHand();},
  place:pressed=>{placeDown=pressed;if(pressed)interact();},
  inventory:()=>openInventory(),
  pause,
});

const chat={open:false,lines:[],element:document.createElement('div'),show(initial=''){
  releasePointer();this.open=true;this.element.style.display='block';this.input.value=initial;this.input.focus();this.render();
},close(){this.open=false;this.element.style.display='none';this.input.blur();lockPointer();},render(){this.history.textContent=this.lines.slice(-10).join('\n');},say(message){this.lines.push(message);this.render();}};
chat.element.id='chat-box';chat.element.style.display='none';chat.history=document.createElement('div');chat.history.className='chat-history';chat.input=document.createElement('input');chat.input.placeholder='输入 /help 查看命令，Enter 发送，Esc 关闭';chat.input.maxLength=200;chat.element.append(chat.history,chat.input);document.body.append(chat.element);
chat.input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();chat.close();}if(e.key==='Enter'){const text=chat.input.value.trim();if(text)executeCommand(text);chat.input.value='';} });
function executeCommand(text){
  if(!text.startsWith('/')){chat.say(`<玩家> ${text}`);return;}
  const [command,...args]=text.slice(1).trim().split(/\s+/);
  try{
    if(command==='help')chat.say('/gamemode creative|survival  /give 物品ID [数量]\n/time day|night|sunset  /weather clear|rain\n/tp x y z  /seed  /save  /clear');
    else if(command==='gamemode'){if(!['creative','survival','0','1'].includes(args[0]))throw new Error('用法：/gamemode creative|survival');setMode(['creative','1'].includes(args[0])?'creative':'survival');chat.say('游戏模式已更新');}
    else if(command==='time'){const times={day:.28,night:.78,sunset:.49,sunrise:.02};const value=args[0]==='set'?args[1]:args[0];if(!(value in times)&&!Number.isFinite(Number(value)))throw new Error('时间：day / night / sunset 或 0–24000');environment.time=value in times?times[value]:((Number(value)/24000)%1+1)%1;chat.say('时间已更新');}
    else if(command==='weather'){if(!['clear','rain'].includes(args[0]))throw new Error('天气：clear / rain');environment.setWeather(args[0]);chat.say('天气已更新');}
    else if(command==='give'){const query=args[0];const def=ITEMS[Number(query)]||Object.values(ITEMS).find(i=>i.name===query);if(!def||def.id===0)throw new Error('未知物品 ID 或中文名称');const count=Math.max(1,Math.min(2304,parseInt(args[1]||'64',10)));if(!Number.isFinite(count))throw new Error('无效数量');const left=inventory.add(def.id,count);chat.say(`给予 ${def.name} × ${count-left}${left?'（背包已满）':''}`);}
    else if(command==='tp'){const coords=args.map((v,i)=>v.startsWith('~')?player.position.getComponent(i)+Number(v.slice(1)||0):Number(v));if(coords.length!==3||coords.some(n=>!Number.isFinite(n)||Math.abs(n)>1000000)||coords[1]<1||coords[1]>512)throw new Error('用法：/tp x y z，y 在 1–512 之间');world.ensureAround(coords[0],coords[2],1);player.position.set(...coords);player.velocity.set(0,0,0);player.fallStart=coords[1];player.syncCamera();chat.say('已传送');}
    else if(command==='seed')chat.say(`世界种子：${meta.seed}`);
    else if(command==='save'){saveGame();chat.say('世界已保存');}
    else if(command==='clear'){inventory.slots.fill(null);chat.say('背包已清空');}
    else chat.say('未知命令，输入 /help 查看帮助。');
  }catch(error){chat.say(error.message);}
}

// Development-only diagnostics for deterministic integration checks; excluded from production builds.
if(import.meta.env.DEV)Object.defineProperty(window,'__MC__',{get:()=>({world,player,inventory,ui,environment,entities,visuals,store,startWorld,saveGame,breakBlock,interact,executeCommand,get hit(){return hit;},get active(){return active;},renderer})});
