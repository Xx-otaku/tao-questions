const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
const extension=path.resolve(process.env.EXTENSION_DIR || path.join(__dirname,'..'));
const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tao-questions-test-'));
const {execFileSync}=require('node:child_process');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(temp,'key'),'-out',path.join(temp,'cert'),'-subj','/CN=fixture'],{stdio:'ignore'});
const https=require('node:https');
const visits=[];
const server=https.createServer({key:fs.readFileSync(path.join(temp,'key')),cert:fs.readFileSync(path.join(temp,'cert'))},(req,res)=>{
 const url=new URL(req.url,'https://'+req.headers.host);
 res.setHeader('Content-Type','text/html;charset=utf-8');
 const report = text => '<div><span>问</span><strong>'+text+'</strong></div>';
 if (url.pathname==='/search') {
   res.end('<button aria-selected=true>销量</button>'+ (url.searchParams.get('page')==='2'
     ? '<a href="https://item.taobao.com/item.htm?id=2">普通商品</a><button disabled>下一页</button>'
     : '<a href="https://detail.tmall.com/item.htm?id=1&xxc=ad_ztc">广告商品</a><a href="https://detail.tmall.com/item.htm?id=1">重复商品</a><a href="https://s.taobao.com/search?page=2">下一页</a>'));
   return;
 }
 if (url.pathname!=='/item.htm') {res.end('');return;}
 const product=url.searchParams.get('id');
 visits.push(product);
 const first=product==='1';
 const total=first?3:102;
 const initial=first?report('包施工吗')+report('包施工吗'):report('第二页问题')+Array.from({length:12},(_,i)=>report('第 '+(i+2)+' 条')).join('');
 const name='批刮大理石漆多彩喷涂水包砂仿石漆水包沙真石漆外墙漆户外艺术漆';
 const metaProduct={ '@type':'Product',url:'https://'+url.host+'/item.htm?id='+product,name };
 const titleBlock=(line,body)=>'<div class="ItemTitle--n4_pxQxz "><span>工厂优选</span><div class="rightWrap--MAQN9OY9"><div class="MainTitle--PiA4nmJz '+line+'"><span class="mainTitle--R75fTcZL" title="'+name+'">'+body+'</span></div></div></div>';
 const productHeader=product!=='3'?'<div class="ItemHeadFixed--sWkEKm0G">'+titleBlock('f-els-1','批刮大理石漆多彩喷涂水包砂仿石…')+'<div class="normalPrice--BXrHJ8Qk"><span>店铺优惠后</span><b> ￥186</b></div></div><div class="scrollWrap--ou3MEdhf">'+titleBlock('f-els-2',name)+'</div>':'';
 res.end(`<title>${name} - 淘宝网</title><meta property="og:title" content="${name}">
 <script type="application/ld+json">${JSON.stringify(metaProduct)}</script>
 <div><h1>用户评价·1000+</h1><h2 itemprop="name">砂岩纹理</h2><h2 class="mainTitle--spec">中国大陆</h2></div>
 ${productHeader}<h2>问大家 · ${total}</h2>
 <button onclick="document.querySelector('dialog').showModal()">查看全部问答</button>
 <dialog><h2>问大家 · ${total}</h2><input placeholder="搜索">
 <div id="rows" style="overflow-y:auto;height:160px">${initial}<p>商家：这里是回答</p></div></dialog>
 <script>
 const rows=document.getElementById('rows');
 if (${!first}) rows.addEventListener('scroll',()=>{
   if (rows.scrollTop+rows.clientHeight>=rows.scrollHeight-10 && !rows.dataset.loaded) {
     rows.dataset.loaded='yes';
     rows.insertAdjacentHTML('beforeend',Array.from({length:89},(_,i)=>'<div><span>问</span><strong>第 '+(i+14)+' 条</strong></div>').join(''));
   }
 });
 </script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context;
try {
const port=server.address().port;
const rule=['s.taobao.com','detail.tmall.com','item.taobao.com'].map(host=>'MAP '+host+' 127.0.0.1:'+port).join(',');
context=await chromium.launchPersistentContext(path.join(temp,'chrome'),{
  headless:true, channel:'chromium', ignoreHTTPSErrors:true,
  args:['--no-proxy-server','--ignore-certificate-errors','--host-resolver-rules='+rule,
  '--disable-extensions-except='+extension,'--load-extension='+extension]
});
const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:12000});
const id=new URL(worker.url()).hostname;
await worker.evaluate(()=>chrome.storage.local.clear());
const search=await context.newPage();
await search.goto('https://s.taobao.com/search');
const panel=await context.newPage();
panel.on('pageerror',e=>console.error(e));
await panel.goto('chrome-extension://'+id+'/panel.html');
const tabId=await worker.evaluate(async()=> (await chrome.tabs.query({url:'https://s.taobao.com/*'}))[0].id);
const answer=await panel.evaluate(tabId=>chrome.runtime.sendMessage({action:'start',target:100,tabId}),tabId);
assert.equal(answer.ok,true);
try { await panel.waitForFunction(()=>document.querySelectorAll('li').length===100,{},{timeout:24000}); }
catch (error) { console.error(await panel.evaluate(async()=> (await chrome.storage.local.get('task')).task)); throw error; }
assert.deepEqual((await panel.locator('li').allTextContents()).slice(0,3),['包施工吗','包施工吗','第二页问题']);
assert.equal(await panel.locator('#count').innerText(),'100 / 100');
assert.equal(await panel.locator('#message').innerText(),'已达到目标。');
assert.equal(new URL(search.url()).searchParams.get('page'),'2');
assert.equal(await panel.locator('#copy').isEnabled(),true);
assert.deepEqual(visits,['1','2']);
await panel.reload();
assert.deepEqual((await panel.locator('li').allTextContents()).slice(0,3),['包施工吗','包施工吗','第二页问题']);
assert.equal(await panel.evaluate(async()=> (await import('./model.js')).plainText(['包施工吗','A\nB'])),'包施工吗\nA B');
assert.equal(await panel.evaluate(async()=> (await import('./model.js')).mergeRows([{text:'甲',id:''}],[{text:'乙',id:''}])),null);
await panel.setViewportSize({width:340,height:750});

const send=(action, fields={})=>panel.evaluate(data=>chrome.runtime.sendMessage(data),{action,...fields});
assert.deepEqual(await panel.locator('.group-heading a').allTextContents(),Array(2).fill('批刮大理石漆多彩喷涂水包砂仿石漆水包沙真石漆外墙漆户外艺术漆'));

assert.deepEqual(await panel.locator('.group-heading a').evaluateAll(links=>links.map(link=>link.href)),[
 'https://detail.tmall.com/item.htm?id=1','https://item.taobao.com/item.htm?id=2']);
panel.once('dialog', dialog=>dialog.dismiss());
await panel.getByRole('button',{name:'删除本商品问题'}).first().click();
assert.equal(await panel.locator('li').count(),100);
panel.once('dialog',async dialog=>{assert.match(dialog.message(),/批刮大理石漆.*2/);await dialog.accept();});
await panel.getByRole('button',{name:'删除本商品问题'}).first().click();
await panel.getByRole('button',{name:'继续补采'}).waitFor();
assert.equal(await panel.locator('li').count(),98);
assert.equal(await panel.locator('.group-heading a').count(),1);
await panel.reload();
assert.equal(await panel.locator('li').count(),98);
await panel.getByRole('button',{name:'继续补采'}).click();
await panel.waitForFunction(()=>document.querySelectorAll('li').length===100);
assert.deepEqual(visits,['1','2']);
const copied=await panel.evaluate(async()=>{const {plainText}=await import('./model.js');return plainText((await chrome.storage.local.get('task')).task.questions);});
assert.equal(copied.split('\n').length,100);
assert.ok(!copied.includes('包施工吗')&&!copied.includes('https://')&&!copied.includes('批刮大理石漆'));
assert.match((await send('start',{target:5,tabId})).error,/清空/);
assert.equal((await send('start',{target:104,tabId,replace:true})).ok,true);
assert.equal((await send('pause')).ok,true);
await panel.waitForFunction(()=>document.querySelector('#status').textContent==='已暂停');
assert.equal((await send('resume')).ok,true);
await panel.waitForFunction(()=>document.querySelector('#message').textContent.includes('未达到目标'),{},{timeout:12000});
assert.equal(await panel.locator('#count').innerText(),'102 / 104');
assert.equal((await send('delete-product',{productId:'2'})).ok,true);
await panel.waitForFunction(()=>document.querySelectorAll('li').length===0);
assert.equal(await panel.locator('#copy').isDisabled(),true);
const probe=await context.newPage();
await probe.goto('https://item.taobao.com/item.htm?id=3');
await probe.locator('button').first().click();
await probe.waitForSelector('dialog[open]');
await probe.addScriptTag({path:path.join(extension,'page.js')});
assert.equal((await probe.evaluate(()=>inspectTaobao('questions'))).productTitle,'');
await worker.evaluate(async()=>{const {task}=await chrome.storage.local.get('task');task.questions=['旧问题',{text:'有链接的问题',productId:'3',title:'中国大陆',url:'https://item.taobao.com/item.htm?id=3'}];await chrome.storage.local.set({task});});
await panel.getByRole('heading',{name:'旧版记录 · 无来源'}).waitFor();
assert.deepEqual(await panel.locator('li').allTextContents(),['旧问题','有链接的问题']);
assert.equal(await panel.getByRole('button',{name:'删除本商品问题'}).count(),1);
assert.equal(await panel.getByRole('link',{name:'商品标题待核实'}).count(),1);
console.log('PASS: product sources, deletion, resume to 100, legacy data,'); 
console.log('PASS: MV3 load, ads, duplicated product, identical questions, second page, exact limit, restore on panel reopen, clipboard format, unsafe merge, confirmed replacement, pause, resume, partial result');
}finally{await context?.close();server.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
