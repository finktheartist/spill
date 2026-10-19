import {expect,it} from 'vitest';
import {Box3,Vector3} from 'three';
import {gripCells,heightOf,parsePartId,settle,validate,type Build,type Placed} from './bricks';
import {attachPart,connectionPairs,definition,frame,solidContains} from './connections';
import {constructionIssues} from './construction';
import {checkFeatures} from './identify';
import {partObject} from './render';
import {buildCounts} from './library';
import {loadDiscoveries,saveDiscovery} from './library-discoveries';
import {reviewGeometryCurrent,reviewGeometryRevision} from './review-geometry';

const p=(partId:string,x=0,y=0,z=0,rot=0):Placed=>({partId,x,y,z,rot});
const build=(parts:Placed[]):Build=>({engine:'connections-v2',name:'Curved mount',description:'Exact stepped socket fixture.',steps:parts.map(p=>({caption:'Connect',parts:[p]}))});

it('uses exact mold heights in scanning, nominal bounds and rendering',()=>{
  for(const [size,height] of [['1x2',2],['2x2',2],['1x3',3]] as const){
    const k=parsePartId(`curve-${size}-tan`)!;
    expect(heightOf(k)).toBe(height);
    const features={outline:'rectangle' as const,topShape:'curved' as const,studsOnTop:0,heightPlates:height};
    expect(checkFeatures('curve',k.w,k.d,features)).toMatchObject({type:'curve',w:k.w,d:k.d});
    expect(checkFeatures('curve',k.w,k.d,{...features,heightPlates:height===3?2:3})).toHaveProperty('other');
    const bounds=new Box3().setFromObject(partObject(k).root);
    // Render-only seam is .004 stud; source facet rounding is <.00001 stud.
    expect(bounds.max.y).toBeCloseTo(height*.4-.004,4);
    expect(bounds.min.y).toBeCloseTo(0,7);
    expect(definition(k).ports.every(c=>c.kind==='grip')).toBe(true);
  }
  expect(parsePartId('curve-1x4-tan')).toBeNull();
});

it.each(['1x2','2x2','1x3'])('accepts real stepped mounts and rejects a fabricated flat back socket for %s',size=>{
  const k=parsePartId(`curve-${size}-tan`)!,back=k.d-1;
  const base=p(k.w===2?'plate-2x2-blue':`plate-1x${k.d}-blue`,0,0,0,k.w===1?90:0);
  const riser=p(k.w===2?'plate-1x2-red':'plate-1x1-red',0,back,1);
  const curve=p(k.partId,0,0,1),b=build([base,riser,curve]);
  b.requiredContacts=[{a:0,b:2,aPort:'stud:0:0',bPort:'grip:0:0'},
    {a:1,b:2,aPort:'stud:0:0',bPort:`grip:0:${back}`}];
  // With a 90-degree base, local stud IDs rotate: assert actual world contacts.
  const first=connectionPairs(frame(base),frame(curve)).find(([,grip])=>grip==='grip:0:0')!;
  b.requiredContacts[0].aPort=first[0];
  expect(constructionIssues(b,buildCounts(b),24)).toEqual([]);
  expect(validate({...b,engine:undefined},buildCounts(b))).toEqual([]);
  expect(settle({...b,engine:undefined},buildCounts(b)).moved).toBe(0);
  expect(connectionPairs(frame(riser),frame(curve))).toContainEqual(['stud:0:0',`grip:0:${back}`]);
  const rear=[10,back*20+10,12] as [number,number,number];
  expect(frame(curve).solids.some(s=>solidContains(s,rear))).toBe(false);
  expect(frame(curve).solids.some(s=>solidContains(s,[10,back*20+10,20]))).toBe(true);
  const falseFlat=build([base,curve]);
  const rearStud=frame(base).ports.find(c=>c.kind==='stud'&&Math.abs(c.point[1]-rear[1])<1e-6&&c.point[0]===10)!;
  falseFlat.requiredContacts=[{a:0,b:1,aPort:rearStud.id,bPort:`grip:0:${back}`}];
  expect(constructionIssues(falseFlat,buildCounts(falseFlat),24).some(i=>i.message.includes('Required connection'))).toBe(true);
  const clash=build([base,{...riser,z:2},curve]);
  expect(constructionIssues(clash,buildCounts(clash),24).some(i=>i.kind==='overlap')).toBe(true);
});

it('retains raised rear sockets through all four grid rotations without flat back joins',()=>{
  const k=parsePartId('curve-1x3-tan')!;
  for(const [rot,point] of [[0,[0,2,5]],[90,[0,0,5]],[180,[0,0,5]],[270,[2,0,5]]] as const){
    const placed=p(k.partId,0,0,4,rot);
    expect(gripCells(k,placed)).toContainEqual(point);
    expect(gripCells(k,placed)).not.toContainEqual([point[0],point[1],4]);
  }
});

it('preserves stepped grip coordinates through a real sideways mount and arbitrary twist',()=>{
  const parent=p('sidebrick-1x1-red',4,4,5,90);
  const child=attachPart(parent,'side:0','curve-1x3-tan','grip:0:2',23);
  expect(connectionPairs(frame(parent),frame(child))).toContainEqual(['side:0','grip:0:2']);
  const k=parsePartId(child.partId)!,obj=partObject(k,child).root;obj.updateMatrixWorld(true);
  const local=definition(k).ports.find(c=>c.id==='grip:0:2')!.point;
  const rendered=new Vector3(local[0]/20-k.w/2,local[2]/20,k.d/2-local[1]/20).applyMatrix4(obj.matrixWorld);
  const actual=frame(child).ports.find(c=>c.id==='grip:0:2')!.point;
  expect(rendered.distanceTo(new Vector3(actual[0]/20,actual[2]/20,-actual[1]/20))).toBeLessThan(1e-8);
});

it('requires a fresh review only for saved builds affected by the curved mold correction',()=>{
  const curved=build([p('plate-2x2-red'),...Array.from({length:19},(_,i)=>p('plate-2x2-red',0,0,i+1)),p('curve-2x2-tan',0,0,20)]);
  const plain=build(curved.steps.flatMap(s=>s.parts).slice(0,20));
  expect(reviewGeometryCurrent(plain)).toBe(true);
  expect(reviewGeometryCurrent(curved)).toBe(false);
  expect(reviewGeometryCurrent(curved,'old-revision')).toBe(false);
  expect(reviewGeometryCurrent(curved,reviewGeometryRevision(curved))).toBe(true);
  let data='';const storage={getItem:()=>data,setItem:(_key:string,value:string)=>{data=value;}};
  const verdict={looksLike:'sculpture',recognizable:4,complete:4,colors:4,impressive:4,fixes:[],review:'blind-v1' as const,subjectMatched:true};
  expect(saveDiscovery(curved,verdict,buildCounts(curved),storage).status).toBe('saved');
  expect(loadDiscoveries(storage)).toHaveLength(1);
  const envelope=JSON.parse(data);delete envelope.items[0].geometryRevision;data=JSON.stringify(envelope);
  expect(loadDiscoveries(storage)).toEqual([]);
  expect(data).toContain('Curved mount'); // Quarantined on read, never erased.
});
