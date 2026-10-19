import { compileConnections, type ConnectionOperation, type ConnectionProgram } from './connections';

/** Capability fixture, not an allocation from the user's photo stock. All moves are real connector operations. */
export function surveyRobotProgram(armAngle=20):ConnectionProgram {
  if(![0,10,20,30].includes(armAngle))throw Error('Choose a supported arm angle');
  const operations:ConnectionOperation[]=[];
  const put=(partId:string,parent=-1,parentPort='',childPort='grip:0:0',twist=0)=>{operations.push({partId,parent,parentPort,childPort,twist});return operations.length-1;};
  const root=put('plate-4x6-dark-gray');
  const leftFoot=put('brick-1x2-dark-gray',root,'stud:0:2');
  const rightFoot=put('brick-1x2-dark-gray',root,'stud:4:2');
  put('curve-2x2-orange',root,'stud:0:0');put('curve-2x2-orange',root,'stud:4:0');
  const leftLeg=put('brick-1x2-light-gray',leftFoot,'stud:0:0');
  put('brick-1x2-light-gray',rightFoot,'stud:0:0');
  const hip=put('plate-1x6-dark-gray',leftLeg,'stud:0:0');
  const body=put('brick-2x2-orange',hip,'stud:2:0','grip:0:1');
  const torso=put('brick-2x2-orange',body,'stud:0:0');
  for(const [x,turn,twist] of [[0,-90,90+armAngle],[5,90,90-armAngle]]){
    const support=put('brick-1x1-dark-gray',hip,`stud:${x}:0`);
    const shoulder=put('sidebrick-1x1-light-gray',support,'stud:0:0','grip:0:0',turn);
    const arm=put('plate-1x4-black',shoulder,'side:0','grip:3:0',twist);
    put('tile-1x2-orange',arm,'stud:1:0');
    put('roundplate-1x1-light-gray',arm,'stud:3:0');
    put('roundbrick-1x1-dark-gray',arm,'stud:0:0');
  }
  const chest=put('bracket-1x2-light-gray',torso,'stud:0:0');
  put('tile-1x2-dark-gray',chest,'side:0');
  const top=put('plate-2x6-orange',chest,'stud:0:0','grip:2:0');
  const neck=put('jumper-1x2-light-gray',top,'stud:2:0');
  const head=put('sidebrick-1x1-yellow',neck,'stud:center');
  put('roundtile-1x1-trans-clear',head,'side:0');
  const crown=put('plate-1x3-yellow',head,'stud:0:0','grip:1:0');
  put('cheese-1x1-yellow',crown,'stud:0:0');put('cheese-1x1-yellow',crown,'stud:2:0','grip:0:0',180);
  put('roundplate-1x1-black',crown,'stud:1:0');
  return {name:'Survey robot',description:'A construction trial with forward-angled arm panels, side-mounted chest trim and a centered head. The display plinth and connector pieces are included in its parts list.',operations};
}
export function programStock(program:ConnectionProgram):Record<string,number>{const have:Record<string,number>={};for(const p of program.operations)have[p.partId]=(have[p.partId]??0)+1;return have;}
export function surveyRobot(angle=20){const program=surveyRobotProgram(angle),stock=programStock(program);return {program,stock,build:compileConnections(program,stock)};}
