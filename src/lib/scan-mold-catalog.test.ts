import {afterEach,describe,expect,it,vi} from 'vitest';
import {scanImage,checkParts,recheck,applyDetections} from './gemini';
import {ALL_MOLDS} from './popular-molds';
import {counts,emptyInventory} from './inventory';

const image='data:image/jpeg;base64,offline-test';
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('exact mold recognition catalog',()=>{
 it('describes every registered mold in the actual survey and close-up requests',async()=>{
  const requests:Record<string,any>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,options:RequestInit)=>{
   requests.push(JSON.parse(String(options.body)));
   return reply(requests.length===1?{parts:[],estimatedTotal:0}:{parts:[{n:1,type:'unknown',size:'3x3',color:'azure',confidence:.3}]});
  }));
  await scanImage(image,{max:5});await checkParts(image,1,undefined);
  expect(requests).toHaveLength(2);
  for(const request of requests){
   const prompt=request.contents[0].parts.map((p:{text?:string})=>p.text??'').join('\n');
   expect(prompt).not.toContain('undefined');
   expect(prompt).toContain('rectangular, one brick tall, studs on top');
   for(const mold of ALL_MOLDS){
    expect(prompt).toContain(`- ${mold.type}: ${mold.num}: ${mold.name};`);
    expect(request.generationConfig.responseSchema.properties.parts.items.properties.type.enum).toContain(mold.type);
   }
  }
 });
 it('retains an exact mold reading for review without silently creating usable inventory',async()=>{
  const raw={type:'mold76797',size:'3x3',color:'azure',description:'Brick Round Corner, Curved 3 x 3 x 1 Quarter Circle',heightPlates:3,confidence:.95,buildsAs:'',outline:'quarter-circle',topShape:'curved',studsOnTop:0,studLayout:'none'};
  const gate:unknown[]=[];vi.stubGlobal('__spillGate',gate);
  let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>reply(++calls===1?{parts:[{...raw,box_2d:[100,100,500,500]}],estimatedTotal:1}:{parts:[{...raw,n:1}]})));
  const result=await scanImage(image,{max:5});const readings=await checkParts(image,1,undefined);
  const detection=recheck(result.detections[0],readings.get(1)!)??result.detections[0];
  expect(detection.kind).toBeNull();expect(detection.review).toMatch(/Confirm the exact special mold/);
  expect(gate).toContainEqual(expect.objectContaining({named:'mold76797-3x3'}));
  expect(counts(applyDetections(emptyInventory(),[detection],1))).toEqual({});
 });
});
