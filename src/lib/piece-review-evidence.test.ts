import {describe,expect,it} from 'vitest';
import {OUTLINES,STUD_LAYOUTS,TOP_SHAPES} from './identify';
import {readPieceReviewEvidence,scanPieceReviewEvidence} from './piece-review-evidence';
import {PART_TAG_GROUPS,readPartTags,type PartTags} from './part-tag-schema';
import {PART_TAG_GROUPS as compatibilityGroups,readPartTags as compatibilityRead} from './part-tags';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

describe('piece review suggestion evidence',()=>{
 it('copies valid nested evidence without retaining mutable input references',()=>{
  const input={description:'  plate with end studs  ',size:' 1 x 4 ',features:{studsOnTop:2,studLayout:'row',topShape:'flat',outline:'rectangle',heightPlates:1,handedness:'unknown',openStuds:false}};
  const before=structuredClone(input),out=readPieceReviewEvidence(input)!;
  expect(out).toEqual({...input,description:'plate with end studs',size:'1 x 4'});
  expect(out).not.toBe(input);expect(out.features).not.toBe(input.features);
  out.features!.studsOnTop=0;out.description='edited';
  expect(input).toEqual(before);
 });

 it('adapts only actual flat scan fields and never carries identity or confidence',()=>{
  const raw=Object.freeze({description:'half circle tile',size:'1x2',studsOnTop:0,studLayout:'none',topShape:'flat',outline:'other',heightPlates:1,openStuds:false,type:'roundtile',color:'azure',confidence:.99,confirmed:true,partId:'roundtile-1x2-azure',catalog:{num:'24246'},features:{outline:'round'}});
  expect(scanPieceReviewEvidence(raw)).toEqual({description:'half circle tile',size:'1x2',features:{studsOnTop:0,studLayout:'none',topShape:'flat',outline:'other',heightPlates:1,openStuds:false}});
  expect(scanPieceReviewEvidence({features:{outline:'round'}})).toBeUndefined();
 });

 it('does not mistake flat or legacy identity fields for stored nested evidence',()=>{
  for(const value of [undefined,null,false,1,'plate',[],{}, {kind:{type:'plate',w:1,d:4},confidence:1}, {studsOnTop:2,heightPlates:1}, {evidence:{description:'plate'}}]){
   expect(readPieceReviewEvidence(value)).toBeUndefined();
  }
 });

 it('uses every current exact feature enum, including explicit unknown and other',()=>{
  for(const studLayout of STUD_LAYOUTS)expect(readPieceReviewEvidence({features:{studLayout}})).toEqual({features:{studLayout}});
  for(const topShape of TOP_SHAPES)expect(readPieceReviewEvidence({features:{topShape}})).toEqual({features:{topShape}});
  for(const outline of OUTLINES)expect(readPieceReviewEvidence({features:{outline}})).toEqual({features:{outline}});
  for(const handedness of ['left','right','unknown'])expect(readPieceReviewEvidence({features:{handedness}})).toEqual({features:{handedness}});
 });

 it('preserves inclusive numeric boundaries and explicit false rather than treating them as absent',()=>{
  expect(readPieceReviewEvidence({features:{studsOnTop:0,heightPlates:0,openStuds:false}})).toEqual({features:{studsOnTop:0,heightPlates:0,openStuds:false}});
  expect(readPieceReviewEvidence({features:{studsOnTop:256,heightPlates:80,openStuds:true}})).toEqual({features:{studsOnTop:256,heightPlates:80,openStuds:true}});
 });

 it('discards malformed features independently without numeric or enum coercion',()=>{
  for(const bad of [-1,.5,NaN,Infinity,'2',null,257])expect(readPieceReviewEvidence({features:{studsOnTop:bad,outline:'L'}})).toEqual({features:{outline:'L'}});
  for(const bad of [-1,.5,NaN,Infinity,'1',null,81])expect(scanPieceReviewEvidence({heightPlates:bad,openStuds:false})).toEqual({features:{openStuds:false}});
  expect(readPieceReviewEvidence({description:'usable text',features:{studLayout:'GRID',topShape:'convex',outline:'l',handedness:'either',openStuds:'false',extra:'ignored'}})).toEqual({description:'usable text'});
  expect(readPieceReviewEvidence({features:[]})).toBeUndefined();
 });

 it('bounds descriptions and accepts only bounded explicit dimension strings',()=>{
  expect(readPieceReviewEvidence({description:'a'.repeat(501)})).toEqual({description:'a'.repeat(500)});
  for(const size of ['1x4','2 X 3','2 × 2','1x2x1.67','1x2x2/3'])expect(readPieceReviewEvidence({size})).toEqual({size});
  for(const size of ['', ' ', '1', '0x2','-1x2','1x2 studs','1x2 or 2x2','1x2x3x4','1x2x1/0','1xInfinity','1'.repeat(40)+'x2',2])expect(readPieceReviewEvidence({size})).toBeUndefined();
 });

 it('reads own fields only, safely discarding malformed getters and revoked objects',()=>{
  const inherited=Object.create({description:'inherited claim',features:{heightPlates:1}});
  expect(readPieceReviewEvidence(inherited)).toBeUndefined();
  const bad={description:'retained',features:{get outline(){throw Error('bad');},heightPlates:1}};
  expect(readPieceReviewEvidence(bad)).toEqual({description:'retained',features:{heightPlates:1}});
  const {proxy,revoke}=Proxy.revocable({},{});revoke();
  expect(()=>readPieceReviewEvidence(proxy)).not.toThrow();expect(scanPieceReviewEvidence(proxy)).toBeUndefined();
 });

 it('roundtrips copied JSON evidence and retains conflicting hints as suggestions without resolving identity',()=>{
  const input={description:'side clips or studs',size:'2x2',features:{studsOnTop:0,studLayout:'grid',topShape:'flat',outline:'rectangle'},type:'edgeplate',confirmed:true};
  const out=readPieceReviewEvidence(input);
  expect(out).toEqual({description:'side clips or studs',size:'2x2',features:input.features});
  expect(readPieceReviewEvidence(JSON.parse(JSON.stringify(out)))).toEqual(out);
 });

 it('stores explicit scan featureTags as copied tags and reads only the stored tags field',()=>{
  const tags:PartTags={family:['plate'],size:['1x4'],profile:['flat'],top:['studded','end-studs'],studs:['2'],connections:['stud','anti-stud'],details:['end studs']};
  const input={description:'end studs',size:'1x4',studsOnTop:2,featureTags:tags},before=structuredClone(input),out=scanPieceReviewEvidence(input)!;
  expect(out).toEqual({description:'end studs',size:'1x4',features:{studsOnTop:2},tags});
  expect(out.tags).not.toBe(tags);expect(out.tags!.profile).not.toBe(tags.profile);
  expect(readPieceReviewEvidence(JSON.parse(JSON.stringify(out)))).toEqual(out);
  out.tags!.profile!.push('curved');expect(input).toEqual(before);
  expect(scanPieceReviewEvidence({tags})).toBeUndefined();
  expect(readPieceReviewEvidence({featureTags:tags})).toBeUndefined();
 });

 it('records explicit tags without deriving identity, color, quantity or confirmation from other scan fields',()=>{
  const identity={type:'plate',color:'azure',w:1,d:4,partId:'plate-1x4-azure',catalog:{num:'92593',color:'azure'},confidence:1,confirmed:true,count:50,stock:{'plate-1x4-azure':50}};
  expect(scanPieceReviewEvidence(identity)).toBeUndefined();expect(readPieceReviewEvidence(identity)).toBeUndefined();
  expect(scanPieceReviewEvidence({...identity,featureTags:{profile:['curved']}})).toEqual({tags:{profile:['curved']}});
  expect(scanPieceReviewEvidence({...identity,featureTags:{color:['tan']}})).toEqual({tags:{color:['tan']}});
 });

 it('discards malformed tag groups independently while preserving existing features and valid tag groups',()=>{
  const out=readPieceReviewEvidence({description:'retained',features:{heightPlates:1},tags:{family:['brick'],height:['bad'],profile:['curved'],studs:['2.5'],color:['invented-blue'],details:['24 teeth'],extra:['ignored']}});
  expect(out).toEqual({description:'retained',features:{heightPlates:1},tags:{family:['brick'],profile:['curved'],details:['24 teeth']}});
  for(const tags of [null,[],42,'brick',{profile:['curved','curved']},{family:['brick','plate']},{profile:Array(25).fill('curved')},{details:['x'.repeat(97)]},{size:['1/2x2']},{profile:['upright','inverted']}]){
   expect(scanPieceReviewEvidence({description:'retained',featureTags:tags,openStuds:false})).toEqual({description:'retained',features:{openStuds:false}});
  }
  expect(readPieceReviewEvidence({tags:{}})).toBeUndefined();
  expect(readPieceReviewEvidence({tags:{category:['unlisted catalog category'],details:['visible flange'],size:['1.5x2-2x3'],height:['0.375'],studs:['0']}})).toEqual({tags:{size:['1.5x2-2x3'],height:['0.375'],studs:['0'],category:['unlisted catalog category'],details:['visible flange']}});
 });

 it('does not promote either conflicting top/count claim and preserves unrelated suggested tags',()=>{
  expect(scanPieceReviewEvidence({featureTags:{family:['tile'],profile:['curved'],top:['smooth'],studs:['2']}})).toEqual({tags:{family:['tile'],profile:['curved']}});
  expect(readPieceReviewEvidence({tags:{top:['studded'],studs:['0']}})).toBeUndefined();
  expect(readPieceReviewEvidence({features:{studsOnTop:0},tags:{studs:['2']}})).toEqual({features:{studsOnTop:0},tags:{studs:['2']}});
 });

 it('uses own data fields only and never invokes accessors on evidence, groups or tag arrays',()=>{
  let calls=0;const accessed=()=>{calls++;throw Error('accessor must not run');};
  const array:string[]=[];Object.defineProperty(array,'0',{enumerable:true,get:accessed});array.length=1;
  const stored={description:'retained',tags:{profile:['curved'],top:array,height:['1']}};
  Object.defineProperty(stored.tags,'family',{enumerable:true,get:accessed});
  expect(readPieceReviewEvidence(stored)).toEqual({description:'retained',tags:{height:['1'],profile:['curved']}});
  const raw={heightPlates:1};Object.defineProperty(raw,'featureTags',{enumerable:true,get:accessed});Object.defineProperty(raw,'description',{enumerable:true,get:accessed});
  expect(scanPieceReviewEvidence(raw)).toEqual({features:{heightPlates:1}});
  expect(calls).toBe(0);
 });

 it('does not inherit tag claims, pollute prototypes or crash on revoked/throwing proxies',()=>{
  const inherited=Object.create({featureTags:{family:['brick']},tags:{family:['brick']}});
  expect(scanPieceReviewEvidence(inherited)).toBeUndefined();expect(readPieceReviewEvidence(inherited)).toBeUndefined();
  const input=JSON.parse('{"tags":{"__proto__":{"polluted":true},"constructor":["brick"],"profile":["curved"]}}');
  const out=readPieceReviewEvidence(input)!;expect(out).toEqual({tags:{profile:['curved']}});expect(Object.getPrototypeOf(out.tags)).toBe(Object.prototype);expect(Object.hasOwn(Object.prototype,'polluted')).toBe(false);
  const {proxy,revoke}=Proxy.revocable({},{});revoke();
  for(const tags of [proxy,new Proxy({},{getPrototypeOf(){throw Error('blocked');}})]){
   expect(()=>readPieceReviewEvidence({description:'retained',tags})).not.toThrow();expect(readPieceReviewEvidence({description:'retained',tags})).toEqual({description:'retained'});
  }
  const nullProto=Object.assign(Object.create(null),{profile:['curved']});expect(readPieceReviewEvidence({tags:nullProto})).toEqual({tags:{profile:['curved']}});
 });

 it('preserves schema compatibility exports and safely rejects malformed explicit tag objects',()=>{
  expect(compatibilityGroups).toBe(PART_TAG_GROUPS);expect(compatibilityRead).toBe(readPartTags);
  let calls=0;const bad={};Object.defineProperty(bad,'family',{enumerable:true,get(){calls++;throw Error('never invoke');}});
  const badArray:string[]=[];Object.defineProperty(badArray,'0',{get(){calls++;throw Error('never invoke');}});
  const {proxy,revoke}=Proxy.revocable({},{});revoke();
  const inherited=Array(1);Object.setPrototypeOf(inherited,{0:'curved'});
  for(const value of [bad,{family:badArray},{profile:Array(1)},{profile:inherited},proxy])expect(()=>readPartTags(value)).toThrow(RangeError);
  expect(calls).toBe(0);
 });

 it('keeps the shared schema runtime dependency graph data-only',async()=>{
  const result=await build({entryPoints:[fileURLToPath(new URL('./part-tag-schema.ts',import.meta.url))],bundle:true,write:false,platform:'neutral',format:'esm',metafile:true,logLevel:'silent'});
  const inputs=Object.keys(result.metafile!.inputs);expect(inputs.some(p=>p.endsWith('part-tag-schema.ts'))).toBe(true);
  expect(inputs.every(p=>p.endsWith('part-tag-schema.ts')||p.endsWith('.json'))).toBe(true);
 });
});
