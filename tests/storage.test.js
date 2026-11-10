import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveStore, validateSave, makeWorldMeta, DEFAULT_SETTINGS } from '../src/storage.js';
import { B, SAVE_VERSION } from '../src/data.js';

class MemoryStorage {
  constructor(){this.data=new Map();this.failSet=null;this.failRemove=null;}
  getItem(key){return this.data.get(key)??null;}
  setItem(key,value){if(this.failSet===key){this.failSet=null;throw new Error('quota exceeded');}this.data.set(key,String(value));}
  removeItem(key){if(this.failRemove===key){this.failRemove=null;throw new Error('storage unavailable');}this.data.delete(key);}
}
function fixture(){return {
  version:SAVE_VERSION,id:'test-world',name:'中文存档世界',seed:'测试种子',mode:'survival',created:100,updated:200,
  player:{position:[-16.5,35,20.5],yaw:2.3,pitch:-.25,health:17,hunger:14,xp:9,mode:'survival',flying:false},
  inventory:{selected:2,slots:[{id:B.STONE,count:32},null,{id:140,count:1,durability:121}]},
  edits:[[-17,34,20,B.PLANKS],[-16,35,20,B.AIR],[1,20,0,B.TORCH]],
  pendingItems:[{id:B.LOG,count:3},{id:150,count:1,durability:1200}],
  drops:[{id:110,count:2,position:[2.5,31.2,-4.5],velocity:[.1,-2,.2],age:7.5}],
  chests:{'-17,35,20':{slots:[{id:104,count:5},null]}},
  furnaces:{'-16,35,20':{slots:[{id:102,count:3},{id:101,count:2},null],burnRemaining:22,burnTotal:80,cookTime:3.2,cookingId:102}},
  fuses:[{x:2,y:34,z:7,time:2.1}],environment:{time:.78,day:3,weather:'rain'},
  entities:[{type:'pig',position:[-2.5,35,4.2],health:8,yaw:.75}],
};}

test('complete saves round-trip every world, container and transient item field',()=>{
  const storage=new MemoryStorage(),store=new SaveStore(storage),save=fixture();
  assert.equal(store.write(save),save);assert.deepEqual(store.read(save.id),save);
  assert.equal(store.list()[0].name,'中文存档世界');
  const other={...fixture(),id:'newer',name:'第二个世界',updated:500};store.write(other);
  assert.deepEqual(store.list().map(s=>s.id),['newer','test-world']);
  store.delete('newer');assert.deepEqual(store.list().map(s=>s.id),['test-world']);assert.throws(()=>store.read('newer'),/不存在/);
});

test('dead-player saves and empty optional containers remain loadable',()=>{
  const save=fixture();save.player.health=0;save.pendingItems=[];save.drops=[];save.fuses=[];save.entities=[];save.chests={};save.furnaces={};
  assert.equal(validateSave(save),save);
  delete save.inventory;delete save.environment;delete save.player.yaw;delete save.player.pitch;assert.equal(validateSave(save),save);
});

test('malformed numeric player state is rejected before serialization changes storage',()=>{
  const storage=new MemoryStorage(),store=new SaveStore(storage);store.write(fixture());const before=[...storage.data];
  for(const [key,value]of [['health',NaN],['health',-1],['health',21],['hunger','20'],['xp',Infinity],['yaw',null],['pitch',4],['flying','true']]){
    const save=fixture();save.player[key]=value;assert.throws(()=>store.write(save),undefined,`${key}: ${value}`);
  }
  for(const position of [[0,NaN,0],[0,0],['1',2,3],[30000000,20,0],null]){const save=fixture();save.player.position=position;assert.throws(()=>validateSave(save));}
  assert.deepEqual([...storage.data],before);
});

test('malformed world edits cannot inject unknown blocks or invalid coordinates',()=>{
  for(const edit of [null,[1,2,3],[1,2,3,999],[1,2,3,140],[1,-1,3,B.STONE],[1,96,3,B.STONE],[1.5,2,3,B.STONE],[1,2,Infinity,B.STONE],['1',2,3,B.STONE]]){
    const save=fixture();save.edits=[edit];assert.throws(()=>validateSave(save),/方块数据/);
  }
  const save=fixture();save.edits=[[0,0,0,B.AIR],[-29999999,95,29999999,B.BEDROCK]];assert.equal(validateSave(save),save);
});

test('inventories enforce real stack limits, valid tools and durability',()=>{
  for(const stack of [{id:0,count:1},{id:B.STONE,count:65},{id:140,count:2},{id:140,count:1,durability:0},{id:140,count:1,durability:251},{id:1,count:1,durability:5},{id:1,count:1.5},{id:'1',count:2}]){
    const save=fixture();save.inventory.slots=[stack];assert.throws(()=>validateSave(save),/背包/);
  }
  for(const selected of [-1,9,1.5,'2']){const save=fixture();save.inventory.selected=selected;assert.throws(()=>validateSave(save),/快捷栏/);}
  for(const invalid of [false,null,[],{slots:'wrong'}]){const save=fixture();save.inventory=invalid;assert.throws(()=>validateSave(save),/背包/);}
});

test('nested chest and furnace state is validated, including cooking identity',()=>{
  const changes=[
    save=>save.chests={'wrong-key':{slots:[]}},
    save=>save.chests={'0,96,0':{slots:[]}},
    save=>save.chests={'0,3,0':{slots:Array(28).fill(null)}},
    save=>save.furnaces={'0,3,0':{slots:[{id:999,count:1}]}},
    save=>save.furnaces['-16,35,20'].burnRemaining='Infinity',
    save=>save.furnaces['-16,35,20'].cookTime=NaN,
    save=>save.furnaces['-16,35,20'].cookingId=999,
    save=>save.furnaces=[]
  ];
  for(const change of changes){const save=fixture();change(save);assert.throws(()=>validateSave(save));}
  const save=fixture();save.furnaces['-16,35,20'].cookingId=null;assert.equal(validateSave(save),save);
});

test('cursor items, dropped stacks and primed TNT reject corrupted import state',()=>{
  const changes=[
    save=>save.pendingItems=[null],save=>save.pendingItems=[{id:140,count:3}],
    save=>save.drops[0].position=[0,null,2],save=>save.drops[0].velocity=[NaN,0,0],
    save=>save.drops[0].age=-1,save=>save.drops[0].count=0,
    save=>save.fuses[0].time=-.1,save=>save.fuses[0].time=8,
    save=>save.fuses[0].x=.3,save=>save.fuses[0].y=96,
  ];
  for(const change of changes){const save=fixture();change(save);assert.throws(()=>validateSave(save));}
});

test('invalid environment and entity numbers cannot enter the live scene',()=>{
  for(const change of [s=>s.environment.time=NaN,s=>s.environment.day=-1,s=>s.environment.weather='acid',s=>s.entities[0].position=[0,Infinity,0],s=>s.entities[0].type='unknown',s=>s.entities[0].health='20']){
    const save=fixture();change(save);assert.throws(()=>validateSave(save));
  }
});

test('failed index update restores an existing save byte-for-byte',()=>{
  const storage=new MemoryStorage(),store=new SaveStore(storage),save=fixture();store.write(save);const before=[...storage.data];
  const changed=fixture();changed.player.position=[30,35,40];changed.updated=600;
  storage.failSet='mc.voxel.index';assert.throws(()=>store.write(changed),/quota/);assert.deepEqual([...storage.data],before);assert.deepEqual(store.read(save.id),save);
});

test('a failed new-world index update leaves no orphan save and a failed body write leaves no index',()=>{
  const storage=new MemoryStorage(),store=new SaveStore(storage);storage.failSet='mc.voxel.index';
  assert.throws(()=>store.write(fixture()),/quota/);assert.equal(storage.data.size,0);
  storage.failSet='mc.voxel.world.test-world';assert.throws(()=>store.write(fixture()),/quota/);assert.equal(storage.data.size,0);
});

test('failed deletion restores the world index so the intact save stays discoverable',()=>{
  const storage=new MemoryStorage(),store=new SaveStore(storage);store.write(fixture());const before=[...storage.data];
  storage.failRemove='mc.voxel.world.test-world';assert.throws(()=>store.delete('test-world'),/unavailable/);assert.deepEqual([...storage.data],before);assert.equal(store.list().length,1);
});

test('corrupt settings cannot break camera, controls or renderer configuration',()=>{
  const storage=new MemoryStorage(),store=new SaveStore(storage);
  storage.setItem('mc.voxel.settings',JSON.stringify({volume:9,sensitivity:-2,renderDistance:999,fov:null,bob:'false',debug:true,unknown:'ignored'}));
  assert.deepEqual(store.getSettings(),{volume:1,sensitivity:.1,renderDistance:8,fov:75,bob:true,debug:true});
  for(const invalid of ['not json','null','[]','"text"']){storage.setItem('mc.voxel.settings',invalid);assert.deepEqual(store.getSettings(),DEFAULT_SETTINGS);}
  assert.deepEqual(new SaveStore(null).getSettings(),DEFAULT_SETTINGS);assert.deepEqual(new SaveStore(null).list(),[]);
});

test('fresh world metadata produces separate IDs and trims empty names',()=>{
  const a=makeWorldMeta({name:'   ',seed:'中文种子',mode:'creative'}),b=makeWorldMeta({name:'新世界'});
  assert.notEqual(a.id,b.id);assert.equal(a.name,'新的世界');assert.equal(a.seed,'中文种子');assert.equal(a.mode,'creative');assert.ok(a.updated>=a.created);
});
