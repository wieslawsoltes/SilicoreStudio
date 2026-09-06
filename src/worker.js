import { validateLogic, compileHDL, simulate, legalize, routeDesign, analyzeTiming, checkDesign } from './core.js';
self.onmessage = ({data}) => {
  const {id,type,payload,revision}=data;
  try {
    const begin=performance.now();let result;
    switch(type) {
      case 'compile':result=validateLogic(compileHDL(payload));break;
      case 'simulate':result=simulate(payload.logic,payload.cycles,payload.overrides);break;
      case 'place':result=legalize(payload);break;
      case 'route':result=routeDesign(payload,p=>self.postMessage({id,progress:p}));break;
      case 'timing':result=analyzeTiming(payload);break;
      case 'check':result=checkDesign(payload);break;
      default:throw new Error(`Unknown worker task: ${type}`);
    }
    self.postMessage({id,revision,result,elapsed:performance.now()-begin});
  } catch(error) {self.postMessage({id,error:{message:error.message,name:error.name,line:error.line,column:error.column}});}
};
