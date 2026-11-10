// IDs are part of the save format. Never renumber existing blocks/items.
export const B = Object.freeze({ AIR:0, GRASS:1, DIRT:2, STONE:3, COBBLE:4, SAND:5, LOG:6, LEAVES:7, PLANKS:8, WATER:9, BEDROCK:10, COAL_ORE:11, IRON_ORE:12, GOLD_ORE:13, DIAMOND_ORE:14, GLASS:15, BRICKS:16, CRAFTING:17, FURNACE:18, SNOW:19, CACTUS:20, GLOWSTONE:21, WOOL:22, GRAVEL:23, BIRCH_LOG:24, BIRCH_LEAVES:25, OBSIDIAN:26, TNT:27, BOOKSHELF:28, MOSS:29, FLOWER:30, TALL_GRASS:31, TORCH:32, CHEST:33, RED_WOOL:34, BLUE_WOOL:35, YELLOW_WOOL:36, MELON:37, ICE:38, CLAY:39 });
const block = (id,name,color,texture,extra={}) => ({id,name,color,texture,solid:true,hardness:1,stack:64,category:'自然方块',...extra});
export const BLOCKS = [
 block(0,'空气','#ffffff','air',{solid:false,transparent:true,hardness:0}),
 block(1,'草方块','#6c9e45','grass_side',{top:'grass_top',bottom:'dirt',hardness:.7,drop:2}),
 block(2,'泥土','#865d40','dirt',{hardness:.5}),
 block(3,'石头','#88888a','stone',{hardness:1.5,tool:'pickaxe',tier:1,drop:4}),
 block(4,'圆石','#77797a','cobble',{hardness:2,tool:'pickaxe',tier:1}),
 block(5,'沙子','#dccb93','sand',{hardness:.5,gravity:true}),
 block(6,'橡木原木','#79603c','log_side',{top:'log_top',bottom:'log_top',hardness:2,tool:'axe'}),
 block(7,'橡树树叶','#487c35','leaves',{hardness:.25,transparent:true}),
 block(8,'橡木木板','#b78b51','planks',{hardness:2,tool:'axe',category:'建筑方块'}),
 block(9,'水','#426fb3','water',{solid:false,transparent:true,liquid:true,hardness:Infinity}),
 block(10,'基岩','#434344','bedrock',{hardness:Infinity}),
 block(11,'煤矿石','#777775','coal_ore',{hardness:3,tool:'pickaxe',tier:1,drop:101}),
 block(12,'铁矿石','#a68b7b','iron_ore',{hardness:3,tool:'pickaxe',tier:2,drop:102}),
 block(13,'金矿石','#c9ac48','gold_ore',{hardness:3,tool:'pickaxe',tier:3,drop:103}),
 block(14,'钻石矿石','#67ccd1','diamond_ore',{hardness:3,tool:'pickaxe',tier:3,drop:104}),
 block(15,'玻璃','#b6dce0','glass',{hardness:.3,transparent:true,category:'建筑方块'}),
 block(16,'红砖','#a35e4a','bricks',{hardness:2,tool:'pickaxe',tier:1,category:'建筑方块'}),
 block(17,'工作台','#a67d46','crafting_side',{top:'crafting_top',bottom:'planks',hardness:2.5,tool:'axe',category:'功能方块'}),
 block(18,'熔炉','#777777','furnace_side',{front:'furnace_front',top:'furnace_top',hardness:3.5,tool:'pickaxe',tier:1,category:'功能方块'}),
 block(19,'雪块','#eff2f6','snow',{hardness:.3}),
 block(20,'仙人掌','#548d3e','cactus_side',{top:'cactus_top',bottom:'cactus_top',hardness:.4}),
 block(21,'荧石','#edca79','glowstone',{hardness:.3,emissive:true,category:'建筑方块'}),
 block(22,'白色羊毛','#e4e2d8','wool',{hardness:.8,category:'建筑方块'}),
 block(23,'沙砾','#98918b','gravel',{hardness:.6,gravity:true}),
 block(24,'白桦原木','#d5d2c5','birch_side',{top:'log_top',bottom:'log_top',hardness:2,tool:'axe'}),
 block(25,'白桦树叶','#6c963d','birch_leaves',{hardness:.25,transparent:true}),
 block(26,'黑曜石','#30273f','obsidian',{hardness:15,tool:'pickaxe',tier:4}),
 block(27,'TNT','#c25238','tnt_side',{top:'tnt_top',bottom:'tnt_top',hardness:.1,category:'功能方块'}),
 block(28,'书架','#a67d46','bookshelf',{top:'planks',bottom:'planks',hardness:1.5,tool:'axe',category:'建筑方块'}),
 block(29,'苔石','#68745a','moss',{hardness:2,tool:'pickaxe',tier:1}),
 block(30,'虞美人','#df3938','flower',{solid:false,transparent:true,cross:true,hardness:.05}),
 block(31,'草','#739d46','tall_grass',{solid:false,transparent:true,cross:true,hardness:.05,drop:0}),
 block(32,'火把','#fbd270','torch',{solid:false,transparent:true,cross:true,emissive:true,hardness:.05,category:'功能方块'}),
 block(33,'箱子','#b78443','chest_side',{top:'chest_top',front:'chest_front',hardness:2.5,tool:'axe',category:'功能方块'}),
 block(34,'红色羊毛','#ac3636','red_wool',{hardness:.8,category:'建筑方块'}),
 block(35,'蓝色羊毛','#3949a2','blue_wool',{hardness:.8,category:'建筑方块'}),
 block(36,'黄色羊毛','#e4bf3d','yellow_wool',{hardness:.8,category:'建筑方块'}),
 block(37,'西瓜','#71a138','melon_side',{top:'melon_top',bottom:'melon_top',hardness:1,drop:107}),
 block(38,'冰','#9ac8e9','ice',{hardness:.5,transparent:true}),
 block(39,'黏土块','#949da7','clay',{hardness:.6,drop:108}),
];
export const ITEMS = Object.fromEntries(BLOCKS.map(b=>[b.id,b]));
const item=(id,name,color,extra={})=>ITEMS[id]={id,name,color,stack:64,category:'材料',...extra};
item(100,'木棍','#92683f'); item(101,'煤炭','#303033'); item(102,'粗铁','#ba9072'); item(103,'粗金','#d4af43'); item(104,'钻石','#68e4df'); item(105,'铁锭','#c7c9c9'); item(106,'金锭','#f2d04d'); item(107,'西瓜片','#e56b65',{food:4}); item(108,'黏土球','#a8abb4'); item(109,'红砖','#aa5845'); item(110,'苹果','#cc3c34',{food:4}); item(111,'生猪肉','#dd9d9f',{food:3}); item(112,'熟猪排','#bd805a',{food:8}); item(113,'小麦','#d1bb61'); item(114,'面包','#c99d5f',{food:5}); item(115,'火药','#59585b');
item(116,'生牛肉','#b74d43',{food:3});item(117,'牛排','#895439',{food:8});item(118,'生羊肉','#c47269',{food:2});item(119,'熟羊肉','#a46c4a',{food:6});
item(160,'腐肉','#807544',{food:4});
for (const [base,material,color,tier,speed,durability] of [[120,'木','#ad804c',1,2,59],[130,'石','#8b8e8c',2,4,131],[140,'铁','#d1d8d8',3,6,250],[150,'钻石','#54d4cd',4,8,1561]]) {
 for (const [offset,name,tool,attack] of [[0,'镐','pickaxe',2],[1,'斧','axe',4],[2,'锹','shovel',1],[3,'剑','sword',5]]) item(base+offset,material+name,color,{tool,tier,speed,durability,stack:1,attack:attack+tier,category:'工具'});
}
export const CREATIVE_ITEMS = Object.values(ITEMS).filter(i=>i.id!==0 && i.id!==31);
export const isSolid = id => !!BLOCKS[id]?.solid;
export const getBlock = id => BLOCKS[id] || BLOCKS[0];
export const getItem = id => ITEMS[id] || ITEMS[0];
export const SAVE_VERSION=1;
