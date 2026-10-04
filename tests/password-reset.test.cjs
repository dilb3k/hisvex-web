const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const jsx=(type,props)=>({type,props:props??{}});
function load(file,mocks,globals={}) {
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
 {exports,require:name=>mocks[name]??require(name),URLSearchParams,TextEncoder,Error,...globals});return exports;
}
const take=load('src/lib/passwordResetToken.ts',{}).takePasswordResetToken;
test('fragment proof is removed from history, preserves router state and rejects missing/duplicate/forged tokens',()=>{
 const state={router:true},changes=[],history={state,replaceState:(...args)=>changes.push(args)};
 assert.equal(take({hash:'#token='+'A'.repeat(43),pathname:'/reset-password'},history),'A'.repeat(43));
 assert.equal(changes[0][0],state);assert.equal(changes[0][2],'/reset-password');
 for(const hash of ['', '#token=bad', '#token='+'A'.repeat(43)+'&token='+'B'.repeat(43)]) assert.equal(take({hash,pathname:'/reset-password'},history),'');
});
function harness({owner='owner',work=async()=>({data:{reset:true,userId:'owner'}}),hash='#token='+'A'.repeat(43)}={}) {
 let cursor=0,dirty=false,tree;const state=[],effects=[],requests=[],history=[],logouts=[];
 const PasswordInput=()=>{};
 const react={
  useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=value;dirty=true;}];},
  useRef(initial){const i=cursor++;return state[i]??={current:initial};},
  useEffect(fn,deps){const i=cursor++;if(!effects[i])effects[i]={fn,pending:true};},
 };
 const location={hash,pathname:'/reset-password'};
 const {default:Page}=load('src/app/reset-password/page.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'next/link':()=>{},
  '@/components/PasswordInput':{PasswordInput},'@/components/TelegramIcon':{TelegramIcon:()=>{}},
  '@/lib/i18n':{t:key=>key},'@/lib/passwordResetToken':{takePasswordResetToken:take},
  '@/lib/api':{authApi:{resetPassword:async(...args)=>{requests.push(args);return work();}}},
  '@/lib/authStore':{useAuthStore:{getState:()=>({user:{_id:owner},logout:()=>logouts.push(owner)})}},
 },{window:{location,history:{state:{router:true},replaceState:(...args)=>{history.push(args);location.hash='';}}}});
 function render(){for(let i=0;i<10;i++){cursor=0;dirty=false;tree=Page();for(const e of effects.filter(Boolean))if(e.pending){e.pending=false;e.fn();e.fn();}if(!dirty)return;}throw Error('render loop');}
 function all(node,predicate,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){for(const child of node)all(child,predicate,result);return result;}if(predicate(node))result.push(node);all(node.props?.children,predicate,result);return result;}
 render();
 return {render,requests,history,logouts,get tree(){return tree;},inputs:()=>all(tree,n=>n.type===PasswordInput),forms:()=>all(tree,n=>n.type==='form'),
  fill(password,confirm=password){const inputs=this.inputs();inputs[0].props.onChange({target:{value:password}});inputs[1].props.onChange({target:{value:confirm}});render();},
  submit(){return this.forms()[0].props.onSubmit({preventDefault(){}});},alerts:()=>all(tree,n=>n.props?.role==='alert').map(n=>n.props.children)};
}
test('form validates matching passwords, suppresses concurrent submissions and clears secrets after success',async()=>{
 let finish;const h=harness({work:()=>new Promise(resolve=>finish=resolve)});
 assert.equal(h.history.length,1);assert.equal(JSON.stringify(h.tree).includes('A'.repeat(43)),false);
 h.fill('🔐'.repeat(19));await h.submit();h.render();assert.equal(h.requests.length,0);assert.equal(h.alerts()[0],'resetPasswordTooLong');
 h.fill('password-one','password-two');await h.submit();h.render();assert.equal(h.requests.length,0);assert.equal(h.alerts()[0],'passwordsDoNotMatch');
 h.fill('new-password');const first=h.submit(), second=h.submit();assert.equal(h.requests.length,1);await second;
 finish({data:{reset:true,userId:'owner'}});await first;h.render();assert.equal(h.forms().length,0);assert.deepEqual(h.logouts,['owner']);
 assert.equal(JSON.stringify(h.tree).includes('new-password'),false);
});
test('a failed attempt can retry; success does not sign out an unrelated browser account',async()=>{
 let failures=0;const h=harness({owner:'other-account',work:async()=>{if(failures++===0)throw Error('retry safely');return {data:{reset:true,userId:'owner'}};}});
 h.fill('new-password');await h.submit();h.render();assert.equal(h.alerts()[0],'retry safely');
 await h.submit();h.render();assert.equal(h.requests.length,2);assert.equal(h.requests[0][0],h.requests[1][0]);assert.equal(h.logouts.length,0);assert.equal(h.forms().length,0);
});
test('opening the page without a valid proof presents the bot link and cannot send a reset',()=>{
 const h=harness({hash:''});assert.equal(h.forms().length,0);assert.equal(h.requests.length,0);
 assert.ok(JSON.stringify(h.tree).includes('https://t.me/hisvex_bot?start=reset_password'));
});
