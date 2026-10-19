import {expect,it} from 'vitest';
import {connectorShapeText,connectorText,definition} from './connections';
import {patchConnectionDraft,type ConnectionDraft} from './connection-revision';
import {parsePartId} from './bricks';
import baseline from './fixtures/gateway-revision-baseline.json';
import stockFixture from './fixtures/large-pile-stock.json';
const draft=baseline as ConnectionDraft;
it('describes color-independent ports once without dropping stock IDs or quantities',()=>{
 const stock={'plate-1x2-white':2,'plate-1x2-red':3,'sidebrick-1x1-light-gray':1};
 const text=connectorShapeText(stock);
 expect(text.match(/plate-1x2 \(all stocked colors\)/g)).toHaveLength(1);
 for(const [id,n]of Object.entries(stock))expect(text).toContain(`${id} × ${n}`);
 expect(text).toContain('grip:1:0');expect(text).toContain('side:0');expect(text).toContain('normal 0,-1,0');
 expect(text).not.toContain('sidebrick-1x1-red');
});
it('substantially reduces the large-pile connector context while retaining every listed piece',()=>{
 const stock=Object.fromEntries(Object.entries(stockFixture.stock).filter(([id])=>{try{definition(parsePartId(id)!);return true;}catch{return false;}}));
 const text=connectorShapeText(stock);
 expect(text.length).toBeLessThan(connectorText(stock).length/2);
 for(const [id,n]of Object.entries(stock))expect(text).toContain(`${id} × ${n}`);
});
it('reports all revision stock shortages with exact IDs and original logical indices',()=>{
 const result=patchConnectionDraft(draft,{focus:'Invalid stock test',updates:[{index:28,...draft.program.operations[28],partId:'arch-1x4-reddish-brown'},{index:30,...draft.program.operations[30],partId:'tile-1x2-purple'}],remove:[],add:[]},stockFixture.stock);
 expect(result.draft).toBeUndefined();expect(result.issues.join()).toContain('arch-1x4-reddish-brown: needs 2, stock has 1; logical indices 27, 28');
 expect(result.issues.join()).toContain('tile-1x2-purple: needs 1, stock has 0; logical indices 30');
});
it('maps collision feedback back to patch indices after deletions have shifted compiler steps',()=>{
 const result=patchConnectionDraft(draft,{focus:'Colliding duplicate',updates:[],remove:[30],add:[draft.program.operations[21]]},stockFixture.stock);
 expect(result.draft).toBeUndefined();expect(result.issues.join()).toContain('logical operations 21 (brick-1x2-reddish-brown) and 39 (brick-1x2-reddish-brown) overlap');
 expect(draft.program.operations).toHaveLength(39);
});
it('inserts a new support under an existing piece and orders the graph without moving the roof',()=>{
 const result=patchConnectionDraft(draft,{focus:'Raise one eave tile on a plate',updates:[{index:30,...draft.program.operations[30],parent:39,parentPort:'stud:0:0'}],remove:[],add:[{...draft.program.operations[30],partId:'plate-1x2-reddish-brown'}]},stockFixture.stock);
 expect(result.issues).toEqual([]);expect(result.changed).toEqual([30]);
 const next=result.draft!;expect(next.program.operations).toHaveLength(40);
 expect(next.program.operations.every((op,i)=>i===0?op.parent===-1:op.parent<i)).toBe(true);
 const oldParts=draft.build.steps.flatMap(s=>s.parts),newParts=next.build.steps.flatMap(s=>s.parts);
 next.receipts[0].parts.forEach((index,i)=>expect(newParts[index]).toEqual(oldParts[draft.receipts[0].parts[i]]));
});
it('rejects cycles introduced through a new support instead of hanging or detaching the model',()=>{
 const result=patchConnectionDraft(draft,{focus:'Invalid cycle',updates:[{index:30,...draft.program.operations[30],parent:39}],remove:[],add:[{...draft.program.operations[30],partId:'plate-1x2-reddish-brown',parent:30}]},stockFixture.stock);
 expect(result.draft).toBeUndefined();expect(result.issues.join()).toMatch(/cycle/);
});
