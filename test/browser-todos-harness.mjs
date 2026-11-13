import './runtime.mjs';
const React=window.qjReact,Dom=window.qjReactDom;
window.errors=[];
window.addEventListener('error',e=>window.errors.push(e.message));
window.addEventListener('unhandledrejection',e=>window.errors.push(String(e.reason)));
const port=location.hash.slice(1);
if(port){
 const nativeFetch=window.fetch.bind(window);window.fetch=(path,options)=>nativeFetch('http://127.0.0.1:'+port+path,options);
 let Page;window.__ModuleLoader__={load({factory}){const plugin=factory(()=>React);plugin.apply({effect:f=>f(),locale:{register(){},bind:()=>k=>k},slots:{inject(name,f){f()?.next?.();},register(spec,component){if(spec.name==='main')Page=component;}}});}};
 await import('./client.mjs');Dom.createRoot(document.getElementById('root')).render(React.createElement(Page,{t:k=>k}));
}
