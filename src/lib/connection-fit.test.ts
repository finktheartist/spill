import {expect,it} from 'vitest';
import {fitConnectionProgram} from './connection-fit';
import {compileConnections} from './connections';
import {surveyRobot} from './connection-models';
import {constructionIssues} from './construction';
import {buildCounts} from './library';
import trial from './fixtures/connection-trial-stock.json';
import photoProgram from './fixtures/connection-photo-stock.json';
import photo from '../../test/fixtures/photo-stock.json';
it('preserves already-valid programs exactly',()=>{
 const {program,stock,build}=surveyRobot();const result=fitConnectionProgram(program,stock);
 expect(result.program).toBe(program);expect(result.build).toEqual(build);expect(result.changes).toEqual([]);expect(result.checks).toBe(0);
});
it('repairs the recorded collisions without changing inventory or the parent graph',()=>{
 for(const [program,stock,changed]of [[trial,surveyRobot().stock,2],[photoProgram,photo.stock,1]] as const){
  const before=JSON.stringify(program);expect(()=>compileConnections(program,stock)).toThrow(/overlap/);
  const fitted=fitConnectionProgram(program,stock);
  expect(fitted.changes).toHaveLength(changed);expect(fitted.checks).toBeLessThanOrEqual(320);expect(constructionIssues(fitted.build,stock,24)).toEqual([]);
  expect(JSON.stringify(program)).toBe(before);
  expect(fitted.program.operations.map(p=>[p.partId,p.parent])).toEqual(program.operations.map(p=>[p.partId,p.parent]));
  const expected:Record<string,number>={};for(const p of program.operations)expected[p.partId]=(expected[p.partId]??0)+1;
  expect(buildCounts(fitted.build)).toEqual(expected);
 }
});
it('never invents stock, connectors or a partial fallback',()=>{
 const program=structuredClone(trial),stock=surveyRobot().stock;
 expect(()=>fitConnectionProgram(program,{})).toThrow(/stock/);
 program.operations[1].parentPort='not-a-port';expect(()=>fitConnectionProgram(program,stock)).toThrow();
});
