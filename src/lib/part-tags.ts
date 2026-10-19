/** Search clues, not identities, manufacturing evidence or builder support.
 * Missing tags are UNKNOWN, never an assertion that a feature is absent.
 * Multi-value groups describe coexisting properties (AND); size keeps bracket
 * panels in one value. No inventory or catalog data is modified here. */
import {CATALOG,COLORS,heightOf,parsePartId,type PartKind} from './bricks';
import {definition} from './connections';
import rebrickable from '../data/rebrickable.json';
import {popularMold} from './popular-molds';

import {readPartTags,type PartTags,type PartTagGroupId} from './part-tag-schema';
export {PART_TAG_GROUPS,readPartTags,type PartTags,type PartTagGroupId} from './part-tag-schema';

const canonicalNumber=(n:number)=>String(Math.round(n*1e6)/1e6);

const normalize=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/×/g,'x').replace(/[–—−]/g,'-').replace(/\s+/g,' ').trim();
const textTag=(s:string)=>normalize(s).replace(/[^a-z0-9 .,'&+()/:\-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,96).trim();
const numeric='(?:\\d{1,3}(?:\\.\\d+|(?:\\s+\\d+)?/\\d+)?)';
type Dimensions={w:number;d:number;h?:number;start:number;end:number};
const fraction=(s:string)=>{const ns=s.trim().split(/\s+/);const f=(v:string)=>v.includes('/')?Number(v.split('/')[0])/Number(v.split('/')[1]):Number(v);return ns.length===2?Number(ns[0])+f(ns[1]):f(ns[0]);};
function dimensions(s:string):Dimensions[]{
 return [...s.matchAll(new RegExp(`\\b(${numeric})\\s*x\\s*(${numeric})(?:\\s*x\\s*(${numeric}))?`,'g'))].map(m=>({w:fraction(m[1]),d:fraction(m[2]),...(m[3]?{h:fraction(m[3])}:{}),start:m.index!,end:m.index!+m[0].length})).filter(d=>[d.w,d.d,...(d.h===undefined?[]:[d.h])].every(n=>Number.isFinite(n)&&n>0&&n<=1024));
}
/** Strip decoration before physical inference. An earlier structural WITH
 * clause survives a later decorative WITH clause. Without a clause boundary,
 * retain only the dimensioned base rather than interpreting the print image. */
function structuralText(name:string):string {
 const decoration=name.search(/\b(?:prints?|patterns?|sticker(?:ed|s)?|decorat(?:ed|ion))\b/);if(decoration<0)return name;
 const prefix=name.slice(0,decoration),withAt=prefix.lastIndexOf(' with ');
 if(withAt>=0)return prefix.slice(0,withAt);
 const dims=dimensions(prefix);return dims.length?prefix.slice(0,dims.at(-1)!.end):prefix.split(/[,;]| - /)[0].replace(/\b(?:headlight|side stud).*$/,'').trim();
}
const add=(tags:PartTags,key:PartTagGroupId,value:string)=>{const a=tags[key]??(tags[key]=[]);if(!a.includes(value)&&a.length<24)a.push(value);};
/** Visible catalog features for search, never builder mating permissions. */
function addNamedConnections(tags:PartTags,name:string):void {
 const connections:[RegExp,string][]=[[/\bclips?\b/,'clip'],[/\b(?:tow\s*)?balls?\b(?!\s+(?:joint\s+)?sockets?\b)/,'ball'],[/\b(?:tow\s*)?ball(?:joint)?\s+sockets?\b|\bsocket for (?:a )?ball\b/,'socket'],[/\baxle\s+holes?\b|\bcross\s+holes?\b/,'axle-hole'],[/\bpin\s+holes?\b/,'pin-hole'],[/\bholes?\b/,'hole'],[/\bbars?\b/,'bar'],[/\bhinge\b/,'hinge'],[/\bhandles?\b/,'handle'],[/\bthread(?:ed)?\b/,'thread'],[/\bmagnet\b/,'magnet']];
 for(const [re,v]of connections)if(re.test(name))add(tags,'connections',v);
 if(/\baxles?\b(?!\s+holes?\b)/.test(name))add(tags,'connections','axle');if(/\bpins?\b(?!\s+holes?\b)/.test(name))add(tags,'connections','pin');
}
const words:Record<string,number>={one:1,two:2,three:3,four:4,six:6,eight:8};
const countValue=(s:string)=>words[s]??Number(s);
function familyFor(name:string,category:string):string|undefined {
 const primary=name.split(/\bwith\b/)[0];
 if(/^technic\b/.test(primary)||/^technic\b/.test(category))return 'technic';
 if(/\b(?:minifig|minidoll|figure)\b/.test(primary)&&/\b(?:head|torso|hips?|legs?|arms?|hands?|body|feet|foot)\b/.test(primary))return 'body-part';
 if(/\b(?:hair|helmet|hat|headwear|headdress)\b/.test(primary)||/headwear/.test(category))return 'headwear';
 if(/^minidoll\b/.test(primary)||/^minidoll/.test(category))return 'minidoll';
 if(/^minifig\b/.test(primary))return /accessor|weapon|tool|shield|neckwear|hipwear/.test(category)?'accessory':'minifig';
 const specific:[RegExp,string][]=[[/\bbracket\b/,'bracket'],[/\bhinge\b/,'hinge'],[/\bwindscreen\b|\bwindshield\b/,'windscreen'],[/\btyres?\b|\btires?\b/,'tire'],[/\bwheel\b/,'wheel'],[/\bwindow\b/,'window'],[/\bdoor\b/,'door'],[/\bpanel\b/,'panel'],[/\bturntable\b/,'turntable'],[/\bbaseplate\b/,'baseplate']];
 for(const [re,v]of specific)if(re.test(primary))return v;
 for(const v of ['brick','plate','tile','slope','clip','bar','fence','ladder','gear','axle','pin','hose','container','support','rock','flag','magnet','sticker','modulex','znap','clikits'])if(new RegExp(`^${v}\\b`).test(primary))return v;
 if(/plants|trees/.test(category)||/^(?:plant|tree|flower|leaf|leaves|bush)\b/.test(primary))return 'vegetation';
 if(/^animal|creature/.test(category))return /body parts/.test(category)?'body-part':/accessories/.test(category)?'accessory':'animal';
 if(/windscreens/.test(category))return 'windscreen';if(/transportation/.test(category))return 'vehicle';
 if(/minifig/.test(category))return /head|body/.test(category)?'body-part':'accessory';
 if(/pneumatic/.test(category))return 'pneumatic';if(/electronic/.test(category))return 'electronics';
 if(/large buildable/.test(category))return 'large-figure';if(/duplo|quatro|primo|fabuland|scala|belville/.test(category))return 'duplo';
 if(/non-system|non system/.test(category))return 'non-system';
 if(/string|bands|reels/.test(category))return 'string';if(/tubes|hoses/.test(category))return 'hose';
 if(/projectile|launcher/.test(category))return 'projectile';if(/gear parts/.test(category))return 'gear';
 if(/supports|girders|cranes/.test(category))return 'support';if(/containers/.test(category))return 'container';
 if(/^bricks/.test(category))return 'brick';if(/^plates/.test(category))return 'plate';if(/^tiles/.test(category))return 'tile';
 if(/^panels/.test(category))return 'panel';if(/^baseplates/.test(category))return 'baseplate';
 if(/^sticker/.test(category))return 'sticker';if(/^magnets/.test(category))return 'magnet';
 if(/^modulex/.test(category))return 'modulex';if(/^znap/.test(category))return 'znap';if(/^clikits/.test(category))return 'clikits';
 return undefined;
}

type NativeSource={rebrickable:string;name?:string};
const nativeShapes=rebrickable.shapes as Record<string,NativeSource>;
// Use the exact qualified mold crosswalk, not legacy display/BrickLink numbers.
// An ambiguous source number establishes no geometry for a catalog row.
const nativeNumbers=new Map<string,{shape:string;source:NativeSource}>();
const ambiguousNumbers=new Set<string>();
for(const [shape,source]of Object.entries(nativeShapes)){
 if(ambiguousNumbers.has(source.rebrickable))continue;
 if(nativeNumbers.has(source.rebrickable)){nativeNumbers.delete(source.rebrickable);ambiguousNumbers.add(source.rebrickable);}
 else nativeNumbers.set(source.rebrickable,{shape,source});
}
/** Actual geometry can establish counts/planes only for an exact qualified
 * native mold. No base-number, printed-variant or look-alike inheritance. */
function applyNative(tags:PartTags,k:PartKind):void {
 if(!CATALOG[k.type as keyof typeof CATALOG]?.includes(`${k.w}x${k.d}`))return;
 try{
  const def=definition(k),top=def.ports.filter(p=>p.kind==='stud'&&p.normal[2]===1),side=def.ports.some(p=>p.kind==='stud'&&p.normal[2]===0);
  const exact=popularMold(k);
  const families:Partial<Record<PartKind['type'],string>>={brick:'brick',plate:'plate',tile:'tile',slope:'slope',curve:'slope',invslope:'slope',cheese:'slope',roundbrick:'brick',roundplate:'plate',roundtile:'tile',cone:'brick',arch:'brick',cornerplate:'plate',cornertile:'tile',cornerbrick:'brick',sidebrick:'brick',sidebricktall:'brick',sidebrickadjacent:'brick',sidebrickall:'brick',headlight:'brick',bracket:'bracket',invertedbracket:'bracket',jumper:'plate',roundendplate:'plate',endstudplate:'plate',edgeplate:'plate',quartertile:'tile',halftile:'tile',quarterroundtile:'tile',offsetplate:'plate',roundjumper:'plate',triangletile:'tile',wedgeleft:'plate',wedgeright:'plate',quarterplate:'plate'};
  const shapes:Partial<Record<PartKind['type'],string>>={roundbrick:'round',roundplate:'round',roundtile:'round',roundjumper:'round',cone:'cone',arch:'arch',cornerplate:'l-shape',cornerbrick:'l-shape',cornertile:'l-shape',quartertile:'macaroni',quarterplate:'quarter-circle',halftile:'half-circle',quarterroundtile:'quarter-circle',triangletile:'triangle',roundendplate:'capsule',wedgeleft:'wedge',wedgeright:'wedge',bracket:'l-shape',invertedbracket:'l-shape'};
  // Family is catalog taxonomy, not the engine's geometry implementation type.
  // For example the source calls 11477 Brick Curved, not Slope Curved.
  if(!tags.family&&families[k.type])tags.family=[families[k.type]!];
  if(!exact||!tags.size)tags.size=k.type==='bracket'||k.type==='invertedbracket'?['1x2-1x2']:[`${k.w}x${k.d}`];
  if(!exact||!tags.shape)tags.shape=[shapes[k.type]??(k.w===k.d?'square':'rectangle')];
  if(!exact)tags.profile=[];
  if(['curve'].includes(k.type))add(tags,'profile','curved');
  if(['slope','invslope','cheese'].includes(k.type))add(tags,'profile','angled');
  if(['invslope','invertedbracket'].includes(k.type))add(tags,'profile','inverted');
  if(['brick','plate','tile','roundtile','roundplate','roundbrick','endstudplate','edgeplate','quartertile','halftile','quarterroundtile','offsetplate','roundjumper','triangletile','jumper','cornerplate','cornertile','cornerbrick','roundendplate','wedgeleft','wedgeright','quarterplate'].includes(k.type))add(tags,'profile','flat');
  if(k.type==='headlight')add(tags,'profile','stepped');if(k.type==='wedgeleft')add(tags,'profile','left');if(k.type==='wedgeright')add(tags,'profile','right');
  tags.height=[canonicalNumber(heightOf(k))];tags.studs=[String(top.length)];
  // Clear conflicting lexical top facts, keep only source-qualified facts.
  tags.top=top.length?['studded']:['smooth'];tags.connections=[];if(!exact)delete tags.details;
  if(top.length)add(tags,'connections','stud');if(side)add(tags,'connections','side-stud');
  if(def.ports.some(p=>p.kind==='grip'))add(tags,'connections','anti-stud');
  // Becoming buildable must not erase visible clips/balls/holes from search.
  // Re-derive them from the pinned exact mold name, not the caller's label.
  if(exact)addNamedConnections(tags,structuralText(normalize(exact.name)));
  if(['offsetplate','roundjumper','jumper'].includes(k.type))add(tags,'top',k.type==='offsetplate'?'offset-studs':'center-stud');
  if(k.type==='endstudplate')add(tags,'top','end-studs');if(k.type==='edgeplate')add(tags,'top','edge-studs');
  if(['offsetplate','roundjumper','roundendplate'].includes(k.type))add(tags,'top','open-studs');
  if(exact?.ports.some(p=>p.kind==='stud'&&p.normal[2]===1&&p.open))add(tags,'top','open-studs');
  if(exact&&exact.w*exact.d>1&&top.length===1&&top[0].point[0]===exact.widthLdu/2&&top[0].point[1]===exact.depthLdu/2)add(tags,'top','center-stud');
  if(k.type==='headlight')add(tags,'details','headlight');
 }catch{/* Unknown native geometry does not establish extra facts. */}
}

export function tagsForCatalogPart(p:{num:string;name:string;category?:string;shape?:string|null;look?:string|null},color?:string):PartTags {
 const tags:PartTags={};
 if(!p||typeof p.name!=='string'||p.name.length>2000||typeof p.num!=='string'||p.num.length>80)return tags;
 const exact=nativeNumbers.get(p.num);
 const full=normalize(p.name),name=structuralText(full),category=typeof p.category==='string'?textTag(p.category):'',sourceName=exact?.source.name?structuralText(normalize(exact.source.name)):name,family=familyFor(sourceName,category),dims=dimensions(name.split(/\bwith\b/)[0]);
 if(family)tags.family=[family];if(category)tags.category=[category];
 if(color&&Object.hasOwn(COLORS,color))tags.color=[color];
 if(dims.length){
  const paired=family==='bracket'?dims.slice(0,2):dims.slice(0,1);
  tags.size=[paired.map(d=>`${canonicalNumber(d.w)}x${canonicalNumber(d.d)}`).join('-')];
  if(dims[0].h!==undefined&&family!=='technic'&&/\b(?:brick|plate|tile|slope|window|door|panel|fence|arch|windscreen)\b/.test(name.split(/\bwith\b/)[0]))tags.height=[canonicalNumber(dims[0].h*3)];
 }
 const physical=(re:RegExp)=>re.test(name);
 const shape:[RegExp,string][]=[[/\bmacaroni\b|\bquarter ring\b/,'macaroni'],[/\bhalf circle\b|\bsemi[ -]?circle\b/,'half-circle'],[/\bquarter\b|\bcorner round\b/,'quarter-circle'],[/\btriangle\b|\btriangular\b|\b45.? cut\b/,'triangle'],[/\bwedge(?:d)?\b/,'wedge'],[/\barch\b/,'arch'],[/\bcone\b|\bconical\b/,'cone'],[/\bdome\b/,'dome'],[/\boval\b/,'oval'],[/\brounded ends\b|\bcapsule\b/,'capsule'],[/\bring\b/,'ring'],[/\bround\b|\bcircular\b/,'round'],[/\bcorner\b/,'l-shape'],[/\brectangular\b|\brectangle\b/,'rectangle'],[/\bcylinder\b|\bcylindrical\b/,'cylinder']];
 for(const [re,v]of shape)if(physical(re)){tags.shape=[v];break;}
 if(!tags.shape&&['brick','plate','tile'].includes(family??'')&&!physical(/\bspecial\b|\bmodified\b|\bcurved\b/) && dims.length)tags.shape=[dims[0].w===dims[0].d?'square':'rectangle'];
 for(const [re,v]of [[/\bcurved\b/,'curved'],[/\binverted\b/,'inverted'],[/\b(?:angled|sloped|slope)\b|\b\d+\s*(?:degrees?|°)\b/,'angled'],[/\bleft\b/,'left'],[/\bright\b/,'right'],[/\bbent\b/,'bent'],[/\btaper(?:ed)?\b/,'tapered'],[/\bstepped\b/,'stepped'],[/\b(?:beveled|bevelled|chamfered)\b/,'beveled'],[/\bribbed\b/,'ribbed'],[/\bgroove\b|\bgrooved\b/,'grooved'],[/\brounded\b/,'rounded']] as [RegExp,string][])if(physical(re))add(tags,'profile',v);
 const side=family==='brick'&&physical(/\bheadlight\b/)||physical(/\bside studs?\b|\bstuds? on (?:\d+ |one |two |the )?sides?\b/);
 if(side)add(tags,'connections','side-stud');
 addNamedConnections(tags,name);
 if(physical(/\bopen studs?\b|\bhollow studs?\b/))add(tags,'top','open-studs');if(physical(/\bsolid studs?\b/))add(tags,'top','solid-studs');
 if(physical(/\bjumper\b|\boffset studs?\b/))add(tags,'top','offset-studs');
 if(physical(/\bcent(?:er|re)(?:ed)? stud\b/)){add(tags,'top','center-stud');tags.studs=['1'];}
 if(physical(/\bstuds? (?:only )?(?:at|on) (?:the |both )?ends?\b|\bend studs?\b/))add(tags,'top','end-studs');
 if(physical(/\bstuds? (?:only )?(?:at|on) (?:the )?(?:one |1 )?edge\b/))add(tags,'top','edge-studs');
 if(physical(/\b(?:no|without|zero|0) (?:top )?studs?\b|\bsmooth top\b/)){tags.studs=['0'];add(tags,'top','smooth');}
 const count=name.match(/\b(?:only\s+)?(\d{1,3}|one|two|three|four|six|eight)\s+(?:top\s+|open\s+|hollow\s+)?studs?\b/);
 if(count){const after=name.slice(count.index!+count[0].length);if(!/^(?:\s+on)?\s+(?:(?:\d+|one|two|the)\s+)?sides?\b/.test(after))tags.studs=[String(countValue(count[1]))];}
 const ordinary=/^(?:brick|plate|tile)\s+(?:\d)/.test(name)&&!physical(/\bwith\b|\binverted\b|\bcurved\b|\bwedge\b/);
 if(ordinary&&dims.length&&family!=='technic'){
  if(family==='tile'){tags.studs=['0'];add(tags,'top','smooth');}
  else if(Number.isInteger(dims[0].w*dims[0].d)&&dims[0].w*dims[0].d<=4096){tags.studs=[String(dims[0].w*dims[0].d)];add(tags,'top','grid-studs');}
 }
 if(!tags.height&&ordinary&&(family==='plate'||family==='tile'))tags.height=['1'];
 if(!tags.height&&family==='brick'&&ordinary)tags.height=['3'];
 if(tags.studs?.[0]!=='0'&&tags.studs?.length){add(tags,'top','studded');add(tags,'connections','stud');}
 if(physical(/\bflat top\b|\bflat\b/))add(tags,'top','flat');
 if(/\bprints?\b|\bpatterns?\b|\bdecorat(?:ed|ion)\b/.test(full)||/pr\d/i.test(p.num))add(tags,'decoration','printed');
 if(/\bsticker(?:ed|s)?\b/.test(full))add(tags,'decoration','stickered');
 for(const v of ['marbled','metallic'])if(new RegExp(`\\b${v}\\b`).test(full))add(tags,'decoration',v);if(/\bglow in (?:the )?dark\b/.test(full))add(tags,'decoration','glow-in-dark');
 // Additional descriptors stay searchable without inventing a fixed exhaustive
 // ontology. Remove dimensional and broad family boilerplate first.
 let detailText=name;for(const d of dimensions(name).reverse())detailText=detailText.slice(0,d.start)+' '+detailText.slice(d.end);
 detailText=detailText.replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*\)/g,' ');
 const stop=new Set('a an and or the of on at for from in to with without no only special modified brick bricks plate plates tile tiles slope technic minifig minidoll x'.split(' '));
 for(const word of detailText.match(/[a-z][a-z0-9-]*/g)??[])if(word.length>2&&!stop.has(word))add(tags,'details',word);
 // A title describing both handed pieces or both stud forms is not a single
 // known handedness/stud form. Leave those attributes unknown.
 if(tags.profile?.includes('left')&&tags.profile.includes('right'))tags.profile=tags.profile.filter(v=>v!=='left'&&v!=='right');
 if(tags.top?.includes('open-studs')&&tags.top.includes('solid-studs'))tags.top=tags.top.filter(v=>v!=='open-studs'&&v!=='solid-studs');
 if(exact){const k=parsePartId(`${exact.shape}-white`);if(k)applyNative(tags,k);}
 return readPartTags(tags);
}

export function tagsForNativeKind(k:PartKind):PartTags {
 const parsed=k&&parsePartId(k.partId);
 if(!parsed||parsed.type!==k.type||parsed.w!==k.w||parsed.d!==k.d||parsed.color!==k.color)return {};
 const names:Partial<Record<PartKind['type'],string>>={headlight:'Brick Special with Headlight',invertedbracket:'Bracket Inverted',sidebrick:'Brick Special with Side Studs',sidebricktall:'Brick Special with Side Studs',sidebrickadjacent:'Brick Special with Side Studs',sidebrickall:'Brick Special with Side Studs',curve:'Slope Curved',invslope:'Slope Inverted',cheese:'Slope',roundbrick:'Brick Round',roundplate:'Plate Round',roundtile:'Tile Round',quartertile:'Tile Curved Macaroni',halftile:'Tile Half Circle',quarterroundtile:'Tile Quarter',triangletile:'Tile Triangle',offsetplate:'Plate Jumper',roundjumper:'Plate Round Jumper',endstudplate:'Plate Special with End Studs',edgeplate:'Plate Special with Studs on One Edge',roundendplate:'Plate Rounded Ends with Open Studs',jumper:'Plate Jumper',bracket:'Bracket',cornerplate:'Plate Corner',cornerbrick:'Brick Corner',cornertile:'Tile Corner',wedgeleft:'Plate Wedge Left',wedgeright:'Plate Wedge Right',quarterplate:'Plate Quarter',cone:'Cone',arch:'Brick Arch'};
 const shape=`${k.type}-${k.w}x${k.d}`,source=nativeShapes[shape],num=source?.rebrickable??'',name=source?.name??`${names[k.type]??k.type} ${k.w} x ${k.d}`;
 const tags=tagsForCatalogPart({num,name,shape},k.color);
 tags.size=k.type==='bracket'||k.type==='invertedbracket'?['1x2-1x2']:[`${k.w}x${k.d}`];applyNative(tags,k);
 return readPartTags(tags);
}
