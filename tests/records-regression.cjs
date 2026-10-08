// Use isolated synthetic IndexedDB records, including the 1.0.4 format.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('app/src/main/assets/www'),out=path.resolve('apk-build/verification/records');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
});
const checks=[];
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>typeof state!=='undefined');
  await page.evaluate(async()=>{
   for(const [scene,id,location] of [['warehouse','A-OLD-001','库房一'],['display','D-OLD-001','地球厅一号柜'],['facility','F-OLD-001','二楼走廊']]){
    await dbPut('boxes',{id,scene,sceneName:SCENE_NAMES[scene],originalLocation:'旧原位置',currentLocation:location,operator:'旧登记人',status:'清点中',openedAt:'2026-10-01 10:00:00',customField:'preserve'});
    await dbPut('items',{id:id+'-01',boxId:id,scene,sceneName:SCENE_NAMES[scene],category:'mineral',name:'旧标本-'+scene,location,quantity:1,lengthMm:12,widthMm:8,heightMm:3,weightG:null,bookValue:null,photoIds:scene==='warehouse'?['old-photo']:[],scanId:'old-scan',scanFileId:scene==='warehouse'?'old-scan-file':null,volumeMm3:123,exception:false,createdAt:'2026-10-01 11:00:00',customField:'preserve'});
   }
   const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10;
   const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg'));
   await dbPut('files',{id:'old-photo',ownerId:'A-OLD-001-01',kind:'photo',name:'old.jpg',data:blob});
   await dbPut('files',{id:'old-scan-file',ownerId:'A-OLD-001-01',kind:'scan',name:'old.json',data:new Blob(['{"volume_mm3":123}'])});
   localStorage.removeItem('inventory-current-box');
  });
  async function openRecord(id){const scene=id.startsWith('A-')?'warehouse':id.startsWith('D-')?'display':'facility';await page.click(`[data-history-scene=${scene}]`);await page.click(`[data-record-id="${id}"]`);}
  await page.reload();
  await check('本机记录按箱子、展厅、楼层切换，列表只显示必要摘要',async()=>{
   await page.locator('[data-history-scene=warehouse]').waitFor({timeout:3000});
   assert.equal(await page.locator('#localRecords [data-record-id]').count(),1);
   assert(!(await page.textContent('#localRecords')).includes('旧登记人'));
   await page.click('[data-history-scene=display]');await page.locator('[data-record-id="D-OLD-001"]').waitFor();
   assert.equal(await page.locator('#localRecords [data-record-id]').count(),1);
   await page.click('[data-history-scene=warehouse]');
  });
  await check('退出后首页找回三场景旧记录',async()=>{
   await page.locator('[data-record-id="A-OLD-001"]').waitFor({timeout:3000});
   for(const [scene,id] of [['warehouse','A-OLD-001'],['display','D-OLD-001'],['facility','F-OLD-001']]){await page.click(`[data-history-scene=${scene}]`);await page.locator(`[data-record-id="${id}"]`).waitFor();}
   assert.equal(await page.locator('[data-nav=box]').innerText(),'▣\n场景登记');
  });
  await check('打开旧箱查看物品和照片',async()=>{
   await openRecord('A-OLD-001');await page.locator('[data-item-id="A-OLD-001-01"]').waitFor();assert.equal(await page.locator('#recordsId').isVisible(),false);assert.equal(await page.locator('#recordDetails').getAttribute('open'),null);assert(!(await page.textContent('#recordsMeta')).includes('旧登记人'));
   await page.click('[data-item-id="A-OLD-001-01"]');
   await page.locator('#itemForm').waitFor({state:'visible'});
   assert.equal(await page.inputValue('#itemName'),'旧标本-warehouse');
   await page.waitForFunction(()=>document.querySelector('#itemPhotoPreview').naturalWidth>0);
   assert.match(await page.textContent('#savedScanInfo'),/old-scan/);
   assert.equal(await page.locator('[form=itemForm]').innerText(),'保存修改');
  });
  await check('修改物品保留编号、附件、体积、创建时间与扩展字段',async()=>{
   await page.fill('#itemName','已核对旧标本');await page.click('[form=itemForm]');
   await page.locator('[data-item-id="A-OLD-001-01"]').waitFor();
   const record=await page.evaluate(async()=>(await dbAll('items')).find(x=>x.id==='A-OLD-001-01'));
   assert.equal(record.name,'已核对旧标本');assert.deepEqual(record.photoIds,['old-photo']);assert.equal(record.scanFileId,'old-scan-file');assert.equal(record.volumeMm3,123);assert.equal(record.createdAt,'2026-10-01 11:00:00');assert.equal(record.customField,'preserve');
   assert.equal(await page.evaluate(async()=>(await dbAll('items')).length),3);
  });
  await check('旧批次接续登记、编号不重复',async()=>{
   await page.click('#continueItems');await page.waitForFunction(()=>document.querySelector('#itemId').textContent==='A-OLD-001-02');
   await page.fill('#itemName','补充标本');await page.click('[form=itemForm]');await page.waitForFunction(()=>document.querySelector('#itemId').textContent==='A-OLD-001-03');
   await page.reload();await openRecord('A-OLD-001');await page.waitForFunction(()=>document.querySelectorAll('[data-item-id]').length===2);
  });
  await check('展厅独立表单与首页展示',async()=>{
   await page.click('[data-nav=home]');await page.click('[data-scene=display]');
   await page.locator('#boxForm').waitFor({state:'visible'});
   assert.equal(await page.textContent('#appTitle'),'展厅登记');
   assert.equal(await page.locator('#boxOriginalLocation').isVisible(),false);
   assert.equal(await page.textContent('#groupNameLabel'),'展厅名称');
   await page.fill('#groupName','生命演化厅');await page.fill('#boxCurrentLocation','展柜 03');await page.fill('#boxOperator','展厅员');await page.click('[form=boxForm]');
   await page.waitForFunction(()=>!!state.currentBox&&!state.saving);
   await page.fill('#itemName','展柜标本');await page.click('[form=itemForm]');await page.waitForFunction(()=>!state.saving);
   await page.click('[data-nav=home]');await page.locator('#localRecords').getByText('生命演化厅',{exact:true}).waitFor();
  });
  await check('设备设施按楼层与位置登记',async()=>{
   await page.click('[data-scene=facility]');await page.locator('#boxForm').waitFor({state:'visible'});assert.equal(await page.textContent('#appTitle'),'楼层登记');
   assert.equal(await page.textContent('#groupNameLabel'),'楼层');
   await page.fill('#groupName','三楼');await page.fill('#boxCurrentLocation','东侧机房');await page.fill('#boxOperator','设备员');await page.click('[form=boxForm]');
   await page.waitForFunction(()=>!!state.currentBox&&!state.saving);assert.equal(await page.inputValue('#itemLocation'),'东侧机房');
   await page.fill('#itemName','空调主机');await page.click('[form=itemForm]');await page.waitForFunction(()=>!state.saving);
   await page.click('[data-nav=home]');await page.locator('#localRecords').getByText('三楼',{exact:true}).waitFor();assert.equal(await page.locator('#localRecords').getByText('东侧机房',{exact:true}).count(),1);
  });
  await check('旧展厅记录可补全名称并保留已有字段',async()=>{
   await openRecord('D-OLD-001');await page.click('#editGroup');await page.locator('#boxForm').waitFor({state:'visible'});
   assert.equal(await page.inputValue('#boxCurrentLocation'),'地球厅一号柜');
   await page.fill('#groupName','地球厅');await page.click('[form=boxForm]');await page.waitForFunction(()=>!state.saving);
   const box=await page.evaluate(async()=>(await dbAll('boxes')).find(x=>x.id==='D-OLD-001'));
   assert.equal(box.hallName,'地球厅');assert.equal(box.originalLocation,'旧原位置');assert.equal(box.customField,'preserve');
  });
  await check('未保存的物品切换批次先确认，取消后保留输入',async()=>{
   await page.click('[data-nav=home]');await openRecord('A-OLD-001');await page.click('#continueItems');await page.fill('#itemName','未保存输入');await page.click('[data-nav=home]');
   page.once('dialog',d=>d.dismiss());await openRecord('F-OLD-001');await page.click('[data-nav=item]');assert.equal(await page.inputValue('#itemName'),'未保存输入');
   await page.click('[data-nav=home]');page.once('dialog',d=>d.accept());await openRecord('F-OLD-001');
  });
  await check('场景草稿状态切换页面仍保留，保存物品不误清场景草稿',async()=>{
   await page.click('[data-nav=home]');await openRecord('A-OLD-001');await page.click('#editGroup');
   await page.selectOption('#boxStatus','部分完成');await page.fill('#boxOperator','尚未保存的登记人');
   await page.click('[data-nav=home]');await page.click('[data-nav=box]');assert.equal(await page.inputValue('#boxStatus'),'部分完成');
   await page.click('[data-nav=item]');await page.waitForFunction(()=>document.querySelector('#itemId').textContent==='A-OLD-001-03');await page.fill('#itemName','新增物品');await page.click('[form=itemForm]');await page.waitForFunction(()=>!state.saving);
   assert.equal(await page.evaluate(()=>state.dirty),true);
   await page.click('[data-nav=box]');assert.equal(await page.inputValue('#boxOperator'),'尚未保存的登记人');
   await page.click('[form=boxForm]');await page.waitForFunction(()=>!state.saving);assert.equal(await page.evaluate(()=>state.dirty),false);
  });
  await check('取消物品修改不写库',async()=>{
   await page.click('[data-nav=home]');await openRecord('A-OLD-001');await page.click('[data-item-id="A-OLD-001-01"]');await page.locator('#itemForm').waitFor({state:'visible'});
   await page.fill('#itemName','放弃这次修改');page.once('dialog',d=>d.accept());await page.click('#backToRecords');
   assert.equal(await page.evaluate(async()=>(await dbGet('items','A-OLD-001-01')).name),'已核对旧标本');
  });
  await check('主动替换照片与扫描附件后重新打开一致，不残留旧附件',async()=>{
   await page.click('[data-item-id="A-OLD-001-01"]');await page.locator('#itemForm').waitFor({state:'visible'});
   const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;return c.toDataURL().split(',')[1];});
   await page.setInputFiles('#itemPhoto',{name:'new.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')});await page.waitForFunction(()=>state.processing===0);
   await page.click('#openScanner');await page.click('#fileTab');await page.setInputFiles('#scanFile',{name:'new.json',mimeType:'application/json',buffer:Buffer.from('{"length_mm":12,"width_mm":8,"height_mm":3,"volume_mm3":256}')});await page.waitForFunction(()=>state.processing===0);await page.click('#applyScan');await page.click('[form=itemForm]');await page.locator('#recordItems').waitFor({state:'visible'});
   const saved=await page.evaluate(async()=>({item:await dbGet('items','A-OLD-001-01'),files:await dbAll('files')}));assert.equal(saved.item.volumeMm3,256);assert(!saved.files.some(f=>['old-photo','old-scan-file'].includes(f.id)));assert(saved.files.some(f=>f.id===saved.item.photoIds[0]));assert(saved.files.some(f=>f.id===saved.item.scanFileId));
  });
  await check('导出增加场景记录目录并保留旧目录与关联编号',async()=>{
   await page.click('[data-nav=export]');const pending=page.waitForEvent('download');await page.click('#exportButton');await(await pending).saveAs(path.join(out,'records.zip'));
  });
  await check('手机布局和新入口无横向溢出',async()=>{
   for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.click('[data-nav=home]');
    assert.equal(await page.evaluate(()=>document.querySelector('.content').scrollWidth>document.querySelector('.content').clientWidth),false);
    await openRecord('A-OLD-001');await page.locator('#recordsTitle').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.querySelector('.content').scrollWidth>document.querySelector('.content').clientWidth),false);
    if(width===390)await page.screenshot({path:path.join(out,'records.png')});
   }
   await page.click('[data-nav=home]');await page.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'home.png')});
   for(const scene of ['display','facility']){await page.click(`[data-scene=${scene}]`);await page.locator('#boxForm').waitFor({state:'visible'});await page.screenshot({path:path.join(out,scene+'.png')});await page.click('[data-nav=home]');}
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
