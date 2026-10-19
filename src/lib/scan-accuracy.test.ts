import {afterEach,expect,it,vi} from 'vitest';
import {applyDetections,checkParts,correctDetections,countStuds,findInAngle,judgeHeights,parseClump,recheck,scanImage,type Detection} from './gemini';
import {dedupe,deepScan,decideFromAngles} from './scan';
import {COLORS,parsePartId} from './bricks';
import {isMade} from './catalog';
import {counts,editPiece,emptyInventory,observationKey,resolveOther,type Box} from './inventory';

vi.mock('./render',()=>({scanKey:async()=>undefined,colorKey:()=>undefined}));
const box:Box=[100,100,200,300];
const det=(id='plate-1x2-white',b:Box=box,confidence=.8):Detection=>({kind:parsePartId(id),description:id,color:parsePartId(id)!.color,box:b,confidence});
const raw=(extra:Record<string,unknown>={})=>({type:'plate',size:'1x2',color:'white',heightPlates:1,confidence:.8,description:'white plate',buildsAs:'',...extra});
const native=(value:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(value)}]}}]}));
function wire(...values:unknown[]){let i=0;const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{const value=values[i++];if(value instanceof Error)throw value;if(value===undefined)throw Error('Unexpected mock request');return native(value);});vi.stubGlobal('fetch',fetch);return fetch;}
const image='data:image/jpeg;base64,test-only-image';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('preserves supported high-confidence stock and idempotently ignores repeated scanner additions',()=>{
 const a=det(),inv=applyDetections(emptyInventory(),[a,a],1);
 expect(counts(inv)).toEqual({'plate-1x2-white':1});expect(applyDetections(inv,[structuredClone(a)],1)).toEqual(inv);expect(inv.parts[a.kind!.partId].confirmedCount).toBe(0);
});
it('does not substitute the closest manufactured color or unsupported dimensions',async()=>{
 const color=Object.keys(COLORS).find(c=>!isMade(`plate-8x8-${c}`));expect(color).toBeDefined();
 wire({parts:[raw({size:'8x8',color,box_2d:box}),raw({type:'cheese',size:'2x2',heightPlates:2,box_2d:[300,100,400,200]})],estimatedTotal:2});
 const result=await scanImage(image,{max:5});expect(result.detections).toHaveLength(2);
 expect(result.detections.every(d=>d.kind===null&&d.unknown)).toBe(true);expect(result.detections[0].color).toBe(color);
 const inv=applyDetections(emptyInventory(),result.detections,1);expect(counts(inv)).toEqual({});expect(inv.others).toHaveLength(2);
});
it('keeps guessed stand-ins and clumps as observations without charging any hidden pieces',async()=>{
 wire({parts:[raw({type:'other',buildsAs:'brick-1x2',heightPlates:3,description:'log brick',box_2d:box}),raw({type:'other',clump:'brick-2x4-white ×6',description:'joined bricks',box_2d:[300,100,400,200]})],estimatedTotal:2});
 const out=await scanImage(image,{max:3}),inv=applyDetections(emptyInventory(),out.detections,1);
 expect(counts(inv)).toEqual({});expect(inv.others).toHaveLength(2);expect(inv.others.every(o=>o.unknown)).toBe(true);
 expect(parseClump('cheese-2x2-red ×2, plate-3x3-white ×2','white')).toEqual([]);
});
it('quarantines incompatible height and rejects third-dimension truncation without throwing on unknown curves',async()=>{
 wire({parts:[raw({type:'brick',heightPlates:6,box_2d:box}),raw({size:'1x2x2',box_2d:[300,0,400,100]}),raw({type:'curve',size:'1x4',heightPlates:3,box_2d:[500,0,600,100]})],estimatedTotal:3});
 const out=await scanImage(image,{max:4});expect(out.detections).toHaveLength(3);expect(out.detections.every(d=>d.kind===null&&d.unknown)).toBe(true);
});
it('still corrects a named brick to an actual thin plate from complete matching features',()=>{
 const next=recheck(det('brick-1x2-white'),raw({outline:'rectangle',topShape:'flat',studsOnTop:2,studLayout:'grid'}));
 expect(next?.kind?.partId).toBe('plate-1x2-white');
});
it('bounds boxes and confidence before projecting crop coordinates',async()=>{
 const rows=[raw({box_2d:box}),raw({box_2d:[100,0,50,20]}),raw({box_2d:[0,-1,20,20]}),raw({box_2d:[0,0,1001,20]}),raw({box_2d:[0,0,20]}),raw({box_2d:box,confidence:2}),raw({box_2d:box,confidence:'0.8'})];
 wire({parts:rows,estimatedTotal:7});const out=await scanImage(image,{max:10,crop:{x:100,y:200,w:500,h:500}});
 expect(out.detections).toHaveLength(1);expect(out.detections[0].box).toEqual([250,150,300,250]);
});
it('rejects nonfinite inventory observations and invalid replacement geometry without deleting the original',()=>{
 const first=det(),inv=applyDetections(emptyInventory(),[first],1);
 expect(applyDetections(inv,[{...det(),confidence:NaN},{...det(),box:[0,0,Infinity,1]}],2)).toEqual(inv);
 expect(correctDetections(inv,[{from:first,to:{...det('brick-1x2-white'),box:[0,0,0,1]}}],1)).toEqual(inv);
 expect(correctDetections(inv,[{from:first,to:det('brick-1x2-white',[0,0,1,1])}],1)).toEqual(inv);
});
it('uses an explicit non-part close-up result to remove the observation rather than retain it as unknown',async()=>{
 const fetch=wire({parts:[{n:1,...raw({type:'non-part',description:'background shadow',heightPlates:0})}]});
 const readings=await checkParts(image,1,undefined),first=det(),negative=recheck(first,readings.get(1)!);
 expect(negative?.nonPart).toBe(true);expect(counts(correctDetections(applyDetections(emptyInventory(),[first],1),[{from:first,to:negative}],1))).toEqual({});
 expect(applyDetections(emptyInventory(),[negative!],1).others).toEqual([]);
 const request=JSON.parse(String(fetch.mock.calls[0][1]?.body));expect(request.generationConfig.responseSchema.properties.parts.items.properties.type.enum).toContain('non-part');
});
it('invalidates duplicate cell IDs and rejects fractional/string IDs and malformed dimensions',async()=>{
 const duplicate={n:1,...raw()};wire({parts:[duplicate,duplicate,{n:2.5,...raw()},{n:'2',...raw()}]},{parts:[{n:1,long:'8',short:2},{n:2,long:2.5,short:1},{n:3,long:17,short:1},{n:4,long:6,short:2}]});
 expect((await checkParts(image,3,undefined)).size).toBe(0);
 expect([...await countStuds(image,4)]).toEqual([[4,{long:6,short:2}]]);
});
it('bounds angle boxes, confidence, booleans and height votes',async()=>{
 wire({parts:[{n:1,found:true,box_2d:[100,100,0,0],confidence:.9},{n:2,found:true,box_2d:box,confidence:1.1},{n:3,found:'true',box_2d:box,confidence:.9}]},{parts:[{n:1,sameShape:true,sideClear:true,stacked:false,heightPlates:3.5,confidence:.9},{n:2,sameShape:true,sideClear:true,stacked:'false',heightPlates:3,confidence:.9}]});
 expect((await findInAngle(image,3,image)).size).toBe(0);expect((await judgeHeights(image,2)).size).toBe(0);
 expect(decideFromAngles(parsePartId('plate-1x2-white')!,[{heightPlates:3,stacked:false,confidence:Infinity}])).toMatchObject({kind:{type:'plate'}});
});
it('dedupes near-identical conflicting readings without collapsing adjacent or contained real pieces',()=>{
 const first=det(),conflict=det('brick-1x2-red',[101,101,200,300]);
 expect(dedupe([],[first,conflict])).toEqual([first]);expect(dedupe([first],[conflict])).toEqual([]);
 const adjacent=det('plate-1x2-white',[100,290,200,490]),inside=det('plate-1x1-white',[120,140,150,170]);
 expect(dedupe([first],[adjacent,inside])).toEqual([adjacent,inside]);
});
it('requires original ownership at the same photo and prevents missing-source resurrection or replay',()=>{
 const first=det(),replacement=det('brick-1x2-white'),initial=applyDetections(emptyInventory(),[first],1),saved=structuredClone(initial);
 const once=correctDetections(initial,[{from:first,to:replacement}],1);
 expect(correctDetections(once,[{from:first,to:replacement}],1)).toEqual(once);expect(initial).toEqual(saved);
 expect(correctDetections(emptyInventory(),[{from:first,to:replacement}],1)).toEqual(emptyInventory());
 expect(correctDetections(initial,[{from:first,to:replacement}],2)).toEqual(initial);
 const both=applyDetections(initial,[first],2),one=correctDetections(both,[{from:first,to:replacement}],2);
 expect(one.parts['plate-1x2-white'].boxes[0].photo).toBe(1);expect(one.parts['brick-1x2-white'].boxes[0].photo).toBe(2);
});
it('ignores late scanner additions/corrections after manual edits or removals, including shifted boxes',()=>{
 const first=det(),inv=applyDetections(emptyInventory(),[first],1),removed=editPiece(inv,box,1,{remove:true});
 expect(removed.manualLocks).toContain(observationKey(1,box));
 const shifted=det('plate-1x2-white',[101,101,201,301]);expect(applyDetections(removed,[first,shifted],1)).toEqual(removed);
 expect(correctDetections(removed,[{from:first,to:det('brick-1x2-white')}],1)).toEqual(removed);
 const fixed=editPiece(inv,box,1,{kind:parsePartId('brick-1x2-white')!});expect(correctDetections(fixed,[{from:first,to:det('plate-1x2-red')}],1)).toEqual(fixed);
 const unknown:Detection={kind:null,description:'visible piece',color:'white',box,confidence:.5,unknown:true},other=applyDetections(emptyInventory(),[unknown],1),manual=resolveOther(other,box,1,{name:'My confirmed piece'});
 expect(correctDetections(manual,[{from:unknown,to:first}],1)).toEqual(manual);
});
it('keeps same-kind confidence corrections effective and protects a newer confidence reading',()=>{
 const first=det(),low={...first,confidence:.2},inv=applyDetections(emptyInventory(),[first],1);
 const reading=recheck(first,raw({confidence:.2,outline:'rectangle',topShape:'flat',studsOnTop:2,studLayout:'grid'}));expect(reading?.confidence).toBe(.2);
 const updated=correctDetections(inv,[{from:first,to:low}],1);expect(counts(updated)).toEqual({});expect(updated.parts[first.kind!.partId].count).toBe(1);
 expect(correctDetections(updated,[{from:first,to:det('brick-1x2-white')}],1)).toEqual(updated);
});
it('does not count multiple proposed components on one outline and validates a whole replacement before removal',()=>{
 const first=det(),inv=applyDetections(emptyInventory(),[first],1);
 const out=correctDetections(inv,[{from:first,to:[det(),det('brick-1x2-white')]}],1);
 expect(counts(out)).toEqual({});expect(out.others).toHaveLength(1);expect(out.others[0].unknown).toBe(true);
});
it('requires complete close-up identity features while retaining visibly unknown pieces with unknown height',async()=>{
 wire({parts:[{n:1,...raw()},{n:2,...raw({type:'unknown',size:'',heightPlates:0,description:'part partly hidden'})}]});
 const result=await checkParts(image,2,undefined);expect(result.has(1)).toBe(false);expect(result.get(2)?.type).toBe('unknown');
 const next=recheck(det(),raw());expect(next?.kind).toBeNull();expect(next?.unknown).toBe(true);
});

function fakeCanvas(){
 const noop=()=>{},context=new Proxy({},{get:()=>noop,set:()=>true});
 return {width:1000,height:1000,getContext:()=>context,toDataURL:()=>image} as unknown as HTMLCanvasElement;
}
it('dedupes the whole survey before inventory callbacks and commits explicit non-part removal',async()=>{
 vi.stubGlobal('document',{createElement:()=>fakeCanvas()});
 wire({parts:[raw({box_2d:box}),raw({type:'brick',heightPlates:3,color:'red',box_2d:box})],estimatedTotal:2},{parts:[{n:1,...raw({type:'non-part',description:'not a piece',heightPlates:0})}]});
 let inv=emptyInventory();const added:number[]=[];
 await deepScan(fakeCanvas(),{onDetections:ds=>{added.push(ds.length);inv=applyDetections(inv,ds,1);},onCorrections:cs=>{inv=correctDetections(inv,cs,1);},onProgress:()=>{}});
 expect(added).toEqual([1]);expect(counts(inv)).toEqual({});expect(inv.others).toEqual([]);
});
it.each(['missing','failed'])('quarantines only unchecked observations after a %s close-up response',async mode=>{
 vi.stubGlobal('document',{createElement:()=>fakeCanvas()});
 wire({parts:[raw({box_2d:box})],estimatedTotal:1},mode==='missing'?{parts:[]}:new Error('test check failed'));
 let inv=emptyInventory();await deepScan(fakeCanvas(),{onDetections:ds=>{inv=applyDetections(inv,ds,1);},onCorrections:cs=>{inv=correctDetections(inv,cs,1);},onProgress:()=>{}});
 expect(counts(inv)).toEqual({});expect(inv.others).toHaveLength(1);expect(inv.others[0].unknown).toBe(true);
});
