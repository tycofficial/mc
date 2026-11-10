import { SAVE_VERSION, ITEMS, BLOCKS } from './data.js';
import { WORLD_HEIGHT } from './terrain.js';

const PREFIX='mc.voxel.world.', INDEX='mc.voxel.index', SETTINGS='mc.voxel.settings';
const WORLD_LIMIT=30000000;
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const numberIn=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
const coordinate=n=>Number.isInteger(n)&&Math.abs(n)<WORLD_LIMIT;
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<WORLD_LIMIT);
const validId=id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id);
const fail=message=>{throw new Error(message);};

export const DEFAULT_SETTINGS={volume:.45,sensitivity:1,renderDistance:4,fov:75,bob:true,debug:false};

export function sanitizeSettings(value){
  const input=record(value)?value:{},result={...DEFAULT_SETTINGS};
  for(const [key,min,max]of [['volume',0,1],['sensitivity',.1,3],['renderDistance',2,8],['fov',50,110]]){
    if(Number.isFinite(input[key]))result[key]=Math.max(min,Math.min(max,input[key]));
  }
  result.renderDistance=Math.round(result.renderDistance);
  for(const key of ['bob','debug'])if(typeof input[key]==='boolean')result[key]=input[key];
  return result;
}

export class SaveStore {
  constructor(storage){
    // Some private-browser policies throw when the localStorage property is accessed.
    if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
    this.storage=storage;
  }
  list(){
    try{
      const entries=JSON.parse(this.storage.getItem(INDEX)||'[]');
      if(!Array.isArray(entries))return [];
      return entries.filter(e=>record(e)&&validId(e.id)).map(e=>({
        id:e.id,name:typeof e.name==='string'?e.name:'未命名世界',seed:typeof e.seed==='string'?e.seed:'',
        mode:e.mode==='creative'?'creative':'survival',updated:numberIn(e.updated,0,Number.MAX_SAFE_INTEGER)?e.updated:0,
        created:numberIn(e.created,0,Number.MAX_SAFE_INTEGER)?e.created:0,
      })).sort((a,b)=>b.updated-a.updated);
    }catch{return [];}
  }
  read(id){const text=this.storage?.getItem(PREFIX+id);if(!text)throw new Error('存档不存在');return validateSave(JSON.parse(text));}
  write(save){
    validateSave(save);
    if(!this.storage)throw new Error('浏览器无法访问存档存储');
    const key=PREFIX+save.id,previous=this.storage.getItem(key),serialized=JSON.stringify(save);
    const list=this.list().filter(w=>w.id!==save.id);
    list.push({id:save.id,name:save.name,seed:save.seed,mode:save.mode,updated:save.updated,created:save.created});
    this.storage.setItem(key,serialized);
    try{this.storage.setItem(INDEX,JSON.stringify(list));}
    catch(error){
      if(previous!==null)this.storage.setItem(key,previous);else this.storage.removeItem(key);
      throw error;
    }
    return save;
  }
  delete(id){
    if(!this.storage)throw new Error('浏览器无法访问存档存储');
    const previousIndex=this.storage.getItem(INDEX),list=this.list().filter(w=>w.id!==id);
    this.storage.setItem(INDEX,JSON.stringify(list));
    try{this.storage.removeItem(PREFIX+id);}
    catch(error){if(previousIndex!==null)this.storage.setItem(INDEX,previousIndex);else this.storage.removeItem(INDEX);throw error;}
  }
  getSettings(){try{return sanitizeSettings(JSON.parse(this.storage.getItem(SETTINGS)||'{}'));}catch{return {...DEFAULT_SETTINGS};}}
  setSettings(settings){if(!this.storage)throw new Error('浏览器无法保存设置');this.storage.setItem(SETTINGS,JSON.stringify(sanitizeSettings(settings)));}
}

function stackIsValid(stack){
  if(!record(stack)||!Number.isInteger(stack.id)||stack.id<=0)return false;
  const item=ITEMS[stack.id];
  if(!item||!Number.isInteger(stack.count)||stack.count<1||stack.count>(item.stack||64))return false;
  if(stack.durability!==undefined&&(!item.durability||!Number.isInteger(stack.durability)||stack.durability<1||stack.durability>item.durability))return false;
  return true;
}
function validateSlots(slots,max,message){
  if(!Array.isArray(slots)||slots.length>max||slots.some(s=>s!==null&&!stackIsValid(s)))fail(message);
}
function optionalNumber(object,key,min,max,message,integer=false){
  const value=object[key];
  if(value!==undefined&&(!numberIn(value,min,max)||(integer&&!Number.isInteger(value))))fail(message);
}
function blockPosition(value){return Array.isArray(value)&&value.length>=3&&coordinate(value[0])&&Number.isInteger(value[1])&&value[1]>=0&&value[1]<WORLD_HEIGHT&&coordinate(value[2]);}
function containerPosition(key){
  if(!/^-?\d+,-?\d+,-?\d+$/.test(key))return false;
  return blockPosition(key.split(',').map(Number));
}

/** Validate external saves before they reach physics, meshes, inventories or browser storage. */
export function validateSave(save){
  if(!record(save)||save.version!==SAVE_VERSION)fail('不支持的存档版本');
  if(!validId(save.id))fail('无效的世界 ID');
  if(typeof save.name!=='string'||!save.name.length||save.name.length>100||typeof save.seed!=='string'||save.seed.length>200)fail('无效的世界信息');
  if(!['survival','creative'].includes(save.mode))fail('无效的游戏模式');
  optionalNumber(save,'created',0,Number.MAX_SAFE_INTEGER,'无效的存档时间');
  optionalNumber(save,'updated',0,Number.MAX_SAFE_INTEGER,'无效的存档时间');

  const p=save.player;
  if(!record(p)||!vector(p.position))fail('无效的玩家位置');
  optionalNumber(p,'yaw',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'无效的玩家视角');
  optionalNumber(p,'pitch',-Math.PI/2,Math.PI/2,'无效的玩家视角');
  for(const key of ['health','hunger'])optionalNumber(p,key,0,20,'无效的玩家状态');
  optionalNumber(p,'xp',0,Number.MAX_SAFE_INTEGER,'无效的经验值');
  if(p.flying!==undefined&&typeof p.flying!=='boolean')fail('无效的飞行状态');
  if(p.mode!==undefined&&!['survival','creative'].includes(p.mode))fail('无效的玩家模式');

  if(!Array.isArray(save.edits)||save.edits.length>500000)fail('无效的方块数据');
  for(const edit of save.edits)if(!Array.isArray(edit)||edit.length!==4||!blockPosition(edit)||!Number.isInteger(edit[3])||!BLOCKS[edit[3]])fail('无效的方块数据');
  if(save.inventory!==undefined){
    if(!record(save.inventory))fail('无效的背包');
    validateSlots(save.inventory.slots,36,'无效的背包');
    optionalNumber(save.inventory,'selected',0,8,'无效的快捷栏',true);
  }
  if(save.pendingItems!==undefined){
    if(!Array.isArray(save.pendingItems)||save.pendingItems.length>64||save.pendingItems.some(s=>!stackIsValid(s)))fail('无效的暂存物品');
  }
  if(save.drops!==undefined){
    if(!Array.isArray(save.drops)||save.drops.length>10000)fail('无效的掉落物');
    for(const drop of save.drops){
      if(!stackIsValid(drop)||!vector(drop.position))fail('无效的掉落物');
      optionalNumber(drop,'age',0,86400,'无效的掉落物时间');
      if(drop.velocity!==undefined&&(!vector(drop.velocity)||drop.velocity.some(v=>Math.abs(v)>10000)))fail('无效的掉落物速度');
    }
  }
  for(const type of ['chests','furnaces'])if(save[type]!==undefined){
    if(!record(save[type])||Object.keys(save[type]).length>10000)fail('无效的容器数据');
    for(const [key,container]of Object.entries(save[type])){
      if(!containerPosition(key)||!record(container))fail('无效的容器位置');
      validateSlots(container.slots,type==='chests'?27:3,'无效的容器物品');
      if(type==='furnaces'){
        for(const field of ['burnRemaining','burnTotal'])optionalNumber(container,field,0,86400,'无效的熔炉燃烧时间');
        optionalNumber(container,'cookTime',0,10,'无效的熔炼进度');
        if(container.cookingId!==undefined&&container.cookingId!==null&&(!Number.isInteger(container.cookingId)||container.cookingId<=0||!ITEMS[container.cookingId]))fail('无效的熔炼物品');
      }
    }
  }
  if(save.fuses!==undefined){
    if(!Array.isArray(save.fuses)||save.fuses.length>2000)fail('无效的 TNT 数据');
    for(const fuse of save.fuses)if(!record(fuse)||!blockPosition([fuse.x,fuse.y,fuse.z])||!numberIn(fuse.time,0,4))fail('无效的 TNT 数据');
  }
  if(save.environment!==undefined){
    const e=save.environment;if(!record(e))fail('无效的环境数据');
    optionalNumber(e,'time',0,1,'无效的世界时间');optionalNumber(e,'day',1,Number.MAX_SAFE_INTEGER,'无效的世界天数',true);
    if(e.weather!==undefined&&!['clear','rain'].includes(e.weather))fail('无效的天气');
  }
  if(save.entities!==undefined){
    if(!Array.isArray(save.entities)||save.entities.length>32)fail('无效的生物数据');
    for(const entity of save.entities){
      if(!record(entity)||!['sheep','pig','cow','zombie'].includes(entity.type)||!vector(entity.position))fail('无效的生物数据');
      optionalNumber(entity,'health',0,20,'无效的生物生命值');optionalNumber(entity,'yaw',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'无效的生物方向');
    }
  }
  return save;
}

export function makeWorldMeta({name='新的世界',seed,mode='survival'}){
  const now=Date.now();
  return {version:SAVE_VERSION,id:globalThis.crypto?.randomUUID?.()||`world-${now}`,name:String(name).trim().slice(0,100)||'新的世界',seed:String(seed||Math.floor(Math.random()*2147483647)).slice(0,200),mode,created:now,updated:now};
}
