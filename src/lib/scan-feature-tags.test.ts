import {afterEach,describe,expect,it,vi} from 'vitest';
import {scanImage,checkParts,recheck,applyDetections,type Detection} from './gemini';
import {emptyInventory,counts,proposedCounts} from './inventory';
import {readInventorySnapshot} from './inventory-snapshot';
import {initialPieceGuessState} from './piece-guess-tags';

const image='data:image/jpeg;base64,offline-test',box:[number,number,number,number]=[100,100,200,300];
const tags={family:['bracket'],size:['1x2'],profile:['inverted'],connections:['clip'],details:['notch']};
const raw={type:'unknown',size:'1x2',color:'white',description:'small inverted clip bracket',heightPlates:1,confidence:.4,featureTags:tags};
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('scanner feature tags reach initial recommendations',()=>{
 it('asks for feature tags in the existing survey call and retains them for an unknown physical piece',async()=>{
  const fetch=vi.fn(async()=>reply({parts:[{...raw,box_2d:box}],estimatedTotal:1}));vi.stubGlobal('fetch',fetch);
  const result=await scanImage(image,{max:5}),d=result.detections[0];
  expect(fetch).toHaveBeenCalledTimes(1);expect(d.kind).toBeNull();expect(d.reviewEvidence?.tags).toEqual(tags);
  const body=JSON.parse(String((fetch.mock.calls[0] as unknown as [unknown,RequestInit])[1].body)),partSchema=body.generationConfig.responseSchema.properties.parts.items;
  expect(partSchema.required).toContain('featureTags');expect(partSchema.properties.featureTags.properties.connections.items.enum).toContain('clip');
  expect(body.contents[0].parts.map((p:{text?:string})=>p.text??'').join(' ')).toContain('For EVERY visible piece, include featureTags');
  const inv=applyDetections(emptyInventory(),result.detections,1),saved=readInventorySnapshot({inventory:inv,observedStock:proposedCounts(inv)});
  expect(saved.others[0].reviewEvidence?.tags).toEqual(tags);expect(counts(saved)).toEqual({});
  expect(initialPieceGuessState(saved.others[0].color,saved.others[0].reviewEvidence).guesses).toMatchObject(tags);
 });
 it('uses close-up feature-only corrections without requiring an identity change or creating stock',async()=>{
  const fetch=vi.fn(async()=>reply({parts:[{n:1,...raw}]}));vi.stubGlobal('fetch',fetch);
  const readings=await checkParts(image,1,undefined),first:Detection={kind:null,unknown:true,color:'white',description:raw.description,confidence:.4,box};
  const next=recheck(first,readings.get(1)!)!;
  expect(next.reviewEvidence?.tags).toEqual(tags);expect(next.kind).toBeNull();expect(recheck(next,readings.get(1)!)).toBeNull();
  const body=JSON.parse(String((fetch.mock.calls[0] as unknown as [unknown,RequestInit])[1].body));
  expect(body.generationConfig.responseSchema.properties.parts.items.required).toContain('featureTags');expect(fetch).toHaveBeenCalledTimes(1);
  expect(counts(applyDetections(emptyInventory(),[next],1))).toEqual({});
 });
 it('leaves valid observations reviewable when individual AI tags are malformed',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply({parts:[{...raw,featureTags:{family:['imaginary'],profile:['curved'],size:['-2x4'],connections:['clip'],confirmed:true},box_2d:box}],estimatedTotal:1})));
  const {detections}=await scanImage(image,{max:5});expect(detections).toHaveLength(1);
  expect(detections[0].reviewEvidence?.tags).toEqual({profile:['curved'],connections:['clip']});
  expect(counts(applyDetections(emptyInventory(),detections,1))).toEqual({});
 });
});
