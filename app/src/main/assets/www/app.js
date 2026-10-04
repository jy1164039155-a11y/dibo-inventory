const DB_NAME = 'museum-inventory-app';
const DB_VERSION = 1;
const SCENE_NAMES = {warehouse:'仓库开箱', display:'馆内展柜', facility:'设备设施'};
const SCENE_CODES = {warehouse:'A', display:'D', facility:'F'};
const state = {scene:'warehouse', currentBox:null, itemIndex:1, pendingBoxPhoto:null, pendingItemPhoto:null, scan:null, generation:0, processing:0, saving:false, dirty:false};

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dbReady = new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('boxes')) db.createObjectStore('boxes', {keyPath:'id'});
    if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', {keyPath:'id'});
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', {keyPath:'id'});
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function dbPut(storeName, value) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error || new Error('保存失败'));
    tx.onerror = () => reject(tx.error);
  });
}
async function dbAll(storeName) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('show'), 2200);
}
function showScreen(name) {
  const titles = {home:'地博清查', box:'开箱登记', item:'物品登记', scanner:'扫描仪接入', export:'导出', settings:'设置'};
  $('appTitle').textContent = titles[name] || titles.home;
  $('settingsButton').style.visibility = name === 'settings' ? 'hidden' : 'visible';
  $$('.screen').forEach((node) => node.classList.toggle('active', node.dataset.screen === name));
  $$('[data-action-screen]').forEach((node) => node.classList.toggle('hidden', node.dataset.actionScreen !== name));
  $('actionDock').classList.toggle('hidden', !['box', 'item', 'export'].includes(name));
  $$('.bottom-nav button').forEach((node) => node.classList.toggle('active', node.dataset.nav === name));
  document.querySelector('.content').scrollTop = 0;
  if (name === 'home') refreshCounts();
  if (name === 'item') { prepareItemId().catch(error=>toast(error.message)); updateAssetFields(); }
  if (name === 'export') refreshExportCounts();
}
function nowText() { return new Date().toLocaleString('zh-CN', {hour12:false}).replace(/\//g,'-'); }
function dateCode() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; }
function safeName(name) { return name.replace(/[\\/:*?"<>|\s]+/g,'_').slice(0,120); }
function deviceCode() {
  let code=localStorage.getItem('inventory-device-code');
  if (!code) { code=Array.from(crypto.getRandomValues(new Uint8Array(3)),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase(); localStorage.setItem('inventory-device-code',code); }
  return code;
}
async function nextBoxId() {
  const boxes=await dbAll('boxes'), prefix=`${SCENE_CODES[state.scene]}-${dateCode()}-${deviceCode()}-`;
  const count=boxes.filter(b=>b.id.startsWith(prefix)).reduce((max,b)=>Math.max(max,Number(b.id.slice(prefix.length))||0),0)+1;
  return prefix+String(count).padStart(3,'0');
}
function resetScan() {
  state.scan=null; state.generation++;
  $('scanResult').classList.add('hidden'); $('scanError').classList.add('hidden');
  $('scanFile').value=''; $('scanUnit').value=''; $('scannerState').textContent='未导入'; $('scannerState').classList.add('gray');
}
function resetItem() {
  $('itemForm').reset(); state.pendingItemPhoto=null; $('itemPhotoStatus').textContent=''; resetScan();
  if(state.scene==='facility') $('itemCategory').value='equipment';
  $('itemLocation').value=state.currentBox?.currentLocation || '';
  state.dirty=false; updateAssetFields();
}
function updateAssetFields() { $('assetFields').classList.toggle('hidden',!['equipment','facility'].includes($('itemCategory').value)); }
async function prepareNewBox() {
  state.currentBox=null; state.pendingBoxPhoto=null;
  localStorage.removeItem('inventory-current-box');
  $('boxForm').reset(); $('boxId').value=await nextBoxId();
  $('boxSceneChip').textContent=SCENE_NAMES[state.scene]; $('boxPhotoStatus').textContent='';
  resetItem(); $('itemId').textContent='—';
}
async function prepareItemId() {
  if(!state.currentBox) return;
  const boxId=state.currentBox.id, items=await dbAll('items');
  if(state.currentBox?.id!==boxId) return;
  const prefix=boxId+'-';
  const count=items.filter(item=>item.boxId===boxId).reduce((max,item)=>Math.max(max,Number(item.id.slice(prefix.length))||0),0)+1;
  state.itemIndex=count; $('itemId').textContent=prefix+String(count).padStart(2,'0');
}
function restoreBoxForm() {
  const box=state.currentBox; if(!box)return;
  $('boxId').value=box.id; $('boxSceneChip').textContent=SCENE_NAMES[box.scene];
  $('boxOriginalLocation').value=box.originalLocation; $('boxCurrentLocation').value=box.currentLocation;
  $('boxOperator').value=box.operator; $('boxStatus').value=box.status;
  $('boxPhotoStatus').textContent=box.photoId?'已保存照片':'';
}

async function compressPhoto(file) {
  if (!file) return null;
  const bitmap = await createImageBitmap(file);
  const max = 1800;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = .86;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  while (blob && blob.size > 5 * 1024 * 1024 && quality > .42) {
    quality -= .08;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  bitmap.close();
  if(!blob || blob.size>=5*1024*1024) throw new Error('照片压缩失败');
  return {blob, width:canvas.width, height:canvas.height, originalName:file.name, originalSize:file.size};
}
async function handlePhoto(input,statusNode,kind) {
  const file=input.files?.[0]; if(!file)return;
  if(state.processing || state.saving){toast('请等待当前操作完成');input.value='';return;}
  const generation=state.generation, target=kind==='box'?'pendingBoxPhoto':'pendingItemPhoto';
  state[target]=null; state.processing++; statusNode.textContent='处理中…';
  try {
    const result=await compressPhoto(file);
    if(generation!==state.generation)return;
    state[target]=result; state.dirty=true;
    statusNode.textContent=`已添加 · ${Math.round(result.blob.size/1024)} KB`;
  } catch(error) { if(generation===state.generation) { statusNode.textContent='照片处理失败，请重新选择'; toast('照片处理失败'); } }
  finally { state.processing--; }
}
function parseNumber(value) {
  const text=String(value??'').trim();
  if(!text)return null;
  return /^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)) ? Number(text) : NaN;
}
function setScanTab(name) {
  ['device','file'].forEach(key=>{ $(key+'Panel').classList.toggle('hidden',key!==name); $(key+'Tab').setAttribute('aria-selected',String(key===name)); });
}
async function parseScanFile(file) {
  const result=await ScannerFormat.parse(file);
  return {...result, scanId:result.scanId || 'SCAN-'+crypto.randomUUID().slice(0,8), targetId:$('itemId').textContent};
}
function renderScan() {
  const scan=state.scan; if(!scan)return;
  $('scanUnitField').classList.toggle('hidden',!!scan.declaredUnit || !!scan.archiveOnly);
  $('scanResultTitle').textContent=scan.geometry?'模型外接尺寸':'扫描结果';
  $('scanId').textContent=scan.scanId; $('scanFileName').textContent=scan.fileName;
  $('scanApplyState').textContent=scan.applied?'已应用':'待应用';
  const ready=!!(scan.declaredUnit || $('scanUnit').value || scan.archiveOnly);
  $('applyScan').disabled=!ready;
  $('applyScan').textContent=scan.archiveOnly?'保留原文件':'填入当前物品';
  if(!ready) { $('scanDimensions').textContent=scan.rawDimensions.map(v=>v??'—').join(' × ')+'（单位待选）'; $('scanVolume').textContent='单位待选'; return; }
  let values;
  try {values=ScannerFormat.measured(scan,$('scanUnit').value); $('scanError').classList.add('hidden');}
  catch(error) { $('applyScan').disabled=true; $('scanDimensions').textContent='无法换算'; $('scanVolume').textContent='—'; $('scanError').textContent=error.message; $('scanError').classList.remove('hidden'); return; }
  $('scanDimensions').textContent=scan.archiveOnly?'Xpro 仅归档': [values.lengthMm,values.widthMm,values.heightMm].map(v=>v==null?'—':v.toFixed(2)).join(' × ')+' mm';
  $('scanVolume').textContent=values.volumeMm3==null?'—':values.volumeMm3.toFixed(2)+' mm³';
}
function showScanResult(scan) {
  state.scan=scan; $('scannerState').textContent='已读取'; $('scannerState').classList.remove('gray');
  $('scanResult').classList.remove('hidden'); $('scanError').classList.add('hidden');
  $('scanUnit').value=''; renderScan();
}
async function importScan(file) {
  if(!file)return;
  if(!state.currentBox) {toast('请先保存开箱记录');return;}
  if(state.processing || state.saving) {toast('请等待当前操作完成');return;}
  const generation=state.generation, targetId=$('itemId').textContent;
  state.processing++; $('scannerState').textContent='读取中…';
  state.scan=null; $('scanResult').classList.add('hidden'); $('scanError').classList.add('hidden');
  try {
    const scan=await parseScanFile(file);
    if(generation!==state.generation || targetId!==$('itemId').textContent)return;
    showScanResult({...scan,targetId}); state.dirty=true;
  } catch(error) {
    if(generation===state.generation) { $('scannerState').textContent='读取失败'; $('scanError').textContent=error.message; $('scanError').classList.remove('hidden'); }
  } finally {state.processing--; $('scanFile').value='';}
}
function applyScanToForm() {
  const scan=state.scan; if(!scan)return;
  if(scan.targetId!==$('itemId').textContent) {toast('物品已切换，请重新读取扫描结果');return;}
  let values; try {values=ScannerFormat.measured(scan,$('scanUnit').value);} catch(error){toast(error.message);return;}
  const fields=['lengthMm','widthMm','heightMm'];
  const conflicts=fields.filter(key=>values[key]!=null && $(key).value.trim() && Number($(key).value)!==values[key]);
  if(conflicts.length && !confirm('扫描尺寸与已填尺寸不同，是否覆盖已填尺寸？'))return;
  fields.forEach(key=>{if(values[key]!=null) $(key).value=String(Number(values[key].toFixed(4)));});
  Object.assign(scan,values,{applied:true,appliedUnit:scan.declaredUnit||$('scanUnit').value});
  state.dirty=true; renderScan(); showScreen('item'); toast(scan.archiveOnly?'原文件将在保存物品时归档':'扫描尺寸已填入');
}

function fileRecord(id, ownerType, ownerId, kind, name, data, meta={}) { return {id, ownerType, ownerId, kind, name, data, createdAt:nowText(), ...meta}; }
function photoRecord(ownerType,ownerId,pending,label) {
  if(!pending)return null;
  return fileRecord(`photo:${ownerType}:${ownerId}:${label}`,ownerType,ownerId,'photo',`${safeName(ownerId)}_${label}.jpg`,pending.blob,{width:pending.width,height:pending.height,originalSize:pending.originalSize});
}
async function persistRecord(storeName,record,files,add=false) {
  const db=await dbReady;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction([storeName,'files'],'readwrite');
    for(const file of files.filter(Boolean))tx.objectStore('files').put(file);
    tx.objectStore(storeName)[add?'add':'put'](record);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error || new Error('保存失败')); tx.onabort=()=>reject(tx.error || new Error('保存中断'));
  });
}
async function saveTask(action) {
  if(state.saving || state.processing) {toast('请等待当前操作完成');return;}
  state.saving=true; $$('[data-action-screen]').forEach(b=>b.disabled=true);
  try { await action(); } catch(error) {toast('未保存：'+(error.name==='ConstraintError'?'编号重复，请重新登记':error.message));}
  finally {state.saving=false; $$('[data-action-screen]').forEach(b=>b.disabled=false);}
}

async function refreshCounts() {
  const [boxes, items] = await Promise.all([dbAll('boxes'), dbAll('items')]);
  $('itemCount').textContent = items.length;
  $('boxCount').textContent = boxes.length;
}
async function refreshExportCounts() {
  const [boxes, items] = await Promise.all([dbAll('boxes'), dbAll('items')]);
  $('exportCounts').textContent = `${items.length} 件 · ${boxes.length} 箱`;
}

async function chooseScene(scene) {
  if(state.saving || state.processing) {toast('请等待当前操作完成');return;}
  if(state.dirty && !confirm('当前记录尚未保存，是否放弃并新建清查？'))return;
  state.scene=scene; await prepareNewBox(); showScreen('box');
}
async function submitBox(event) {
  event.preventDefault();
  return saveTask(async()=>{
    const operator=$('boxOperator').value.trim(); if(!operator)throw new Error('请填写登记人');
    const id=$('boxId').value; if(!id)throw new Error('请先选择清查场景');
    const old=state.currentBox?.id===id?state.currentBox:null;
    const photo=photoRecord('box',id,state.pendingBoxPhoto,'箱体');
    const box={id,scene:state.scene,sceneName:SCENE_NAMES[state.scene],originalLocation:$('boxOriginalLocation').value.trim(),currentLocation:$('boxCurrentLocation').value.trim(),operator,status:$('boxStatus').value,openedAt:old?.openedAt||nowText(),photoId:photo?.id||old?.photoId||null};
    await persistRecord('boxes',box,[photo],!old); state.currentBox=box;
    localStorage.setItem('inventory-current-box',id); state.pendingBoxPhoto=null; state.dirty=false;
    if(!old)resetItem();
    else state.dirty=!!(state.pendingItemPhoto || state.scan || $('itemName').value.trim() || ['lengthMm','widthMm','heightMm','weightG'].some(key=>$(key).value.trim()));
    await prepareItemId(); showScreen('item'); toast('开箱记录已保存');
  });
}
async function submitItem(event) {
  event.preventDefault();
  return saveTask(async()=>{
    if(!state.currentBox)throw new Error('请先保存开箱记录');
    const name=$('itemName').value.trim(); if(!name)throw new Error('请填写名称或外观描述');
    const values={};
    for(const key of ['lengthMm','widthMm','heightMm','weightG']) {
      values[key]=parseNumber($(key).value);
      if(values[key]!=null && (!Number.isFinite(values[key]) || values[key]<=0))throw new Error('尺寸和重量须填写大于 0 的数字');
    }
    const category=$('itemCategory').value, asset=['equipment','facility'].includes(category);
    if(category==='jewelry' && !values.weightG && !$('itemException').checked)throw new Error('请填写珠宝重量，或标记异常');
    const quantity=asset?parseNumber($('itemQuantity').value):1, bookValue=asset?parseNumber($('itemValue').value):null;
    if(!Number.isSafeInteger(quantity)||quantity<1)throw new Error('数量须为正整数');
    if(bookValue!=null && (!Number.isFinite(bookValue)||bookValue<0))throw new Error('账面价值须为非负数字');
    const id=$('itemId').textContent;
    if(!id.startsWith(state.currentBox.id+'-'))throw new Error('编号尚未准备好，请稍后重试');
    const photo=photoRecord('item',id,state.pendingItemPhoto,'照片01');
    const scan=state.scan;
    if(scan && scan.targetId!==id)throw new Error('扫描数据与当前物品不符');
    const scanFile=scan?.file?fileRecord(`scan:${id}`, 'item',id,'scan',safeName(id)+'_'+safeName(scan.file.name),scan.file,{scannerId:scan.scanId,unit:scan.appliedUnit||'',geometry:!!scan.geometry}):null;
    const item={id,boxId:state.currentBox.id,scene:state.scene,sceneName:SCENE_NAMES[state.scene],category,name,...values,quantity,bookValue,location:$('itemLocation').value.trim(),photoIds:photo?[photo.id]:[],scanId:scan?.scanId||'',scanFileId:scanFile?.id||null,volumeMm3:scan?.applied?scan.volumeMm3:null,exception:$('itemException').checked,createdAt:nowText()};
    await persistRecord('items',item,[photo,scanFile],true);
    resetItem(); await prepareItemId(); await refreshCounts(); toast('已保存');
  });
}

function csvCell(value) { let text=String(value??''); if(typeof value==='string' && /^[=+@\-\t\r]/.test(text))text="'"+text; return '"'+text.replace(/"/g,'""')+'"'; }
function buildCsv(boxes, items, files) {
  const rows = [['清查号','箱号','场景','分类','名称','长(mm)','宽(mm)','高(mm)','重量(g)','当前位置','照片文件','扫描编号','扫描文件','数量','账面价值(元)','体积(mm³)','异常','录入时间']];
  for (const item of items) {
    const photos = files.filter((f) => item.photoIds?.includes(f.id)).map((f) => `原图/${f.name}`).join(';');
    const scan = files.find((f) => f.id === item.scanFileId);
    rows.push([item.id,item.boxId,item.sceneName,item.category,item.name,item.lengthMm,item.widthMm,item.heightMm,item.weightG,item.location,photos,item.scanId,scan?`扫描文件/${scan.name}`:'',item.quantity??1,item.bookValue??'',item.volumeMm3??'',item.exception?'是':'否',item.createdAt]);
  }
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function blobDataUrl(blob) { return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(''); reader.readAsDataURL(blob); }); }
async function buildHtmlTable(items, files) {
  const rows = [];
  for (const item of items) {
    const photo = files.find((f) => item.photoIds?.includes(f.id));
    const src = photo ? await blobDataUrl(photo.data) : '';
    rows.push(`<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml([item.lengthMm,item.widthMm,item.heightMm].filter(Boolean).join(' × '))}</td><td>${escapeHtml(item.weightG)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.quantity??1)}</td><td>${escapeHtml(item.bookValue??'')}</td><td>${escapeHtml(item.volumeMm3??'')}</td><td>${src?`<img src="${src}" alt="${escapeHtml(item.id)}">`:''}</td></tr>`);
  }
  return `<!doctype html><meta charset="utf-8"><title>清查表</title><style>body{font-family:Arial,"Microsoft YaHei"}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px;font-size:12px}img{width:90px;max-height:90px;object-fit:contain}</style><h1>湖南省地质博物馆资产清查表</h1><table><thead><tr><th>清查号</th><th>分类</th><th>名称</th><th>尺寸(mm)</th><th>重量(g)</th><th>位置</th><th>数量</th><th>账面价值(元)</th><th>体积(mm³)</th><th>照片</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function crc32(bytes) { let table = crc32.table; if (!table) { table = crc32.table = []; for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);table[n]=c>>>0;} } let c=0xffffffff;for(const byte of bytes)c=table[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0; }
function u16(value){return new Uint8Array([value&255,(value>>>8)&255]);} function u32(value){return new Uint8Array([value&255,(value>>>8)&255,(value>>>16)&255,(value>>>24)&255]);}
async function buildZip(files) { const encoder = new TextEncoder(); const local=[]; const central=[]; let offset=0; const now=new Date(); const time=(now.getHours()<<11)|(now.getMinutes()<<5)|Math.floor(now.getSeconds()/2); const date=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate(); for(const file of files){const name=encoder.encode(file.name);const data=file.data instanceof Uint8Array?file.data:new Uint8Array(await file.data.arrayBuffer());const crc=crc32(data);const header=new Uint8Array([...u32(0x04034b50),...u16(20),...u16(0x800),...u16(0),...u16(time),...u16(date),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)]);local.push(header,name,data);const centralHeader=new Uint8Array([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x800),...u16(0),...u16(time),...u16(date),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]);central.push(centralHeader,name);offset+=header.length+name.length+data.length;}const centralSize=central.reduce((sum,x)=>sum+x.length,0);const end=new Uint8Array([...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(centralSize),...u32(offset),...u16(0)]);return new Blob([...local,...central,end],{type:'application/zip'}); }
function download(blob,name){
  if(window.AndroidBridge){
    const reader=new FileReader();
    reader.onload=()=>window.AndroidBridge.saveBase64(name,reader.result.split(',')[1],blob.type||'application/octet-stream');
    reader.readAsDataURL(blob);
    return;
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
}
async function exportPackage() { return saveTask(async()=>{ const [boxes,items,files] = await inventorySnapshot(); if(!boxes.length && !items.length){toast('暂无可导出的记录');return;} const csv=buildCsv(boxes,items,files);const html=await buildHtmlTable(items,files);const boxCsv='\ufeff'+[['箱号','场景','原位置','当前库位','登记人','状态','箱体照片','登记时间'],...boxes.map(b=>[b.id,b.sceneName,b.originalLocation,b.currentLocation,b.operator,b.status,files.find(f=>f.id===b.photoId)?.name||'',b.openedAt])].map(row=>row.map(csvCell).join(',')).join('\r\n');const zipFiles=[{name:'箱目录.csv',data:new TextEncoder().encode(boxCsv)},{name:'清查表.csv',data:new TextEncoder().encode(csv)},{name:'清查表.xls',data:new TextEncoder().encode(html)},{name:'导出说明.txt',data:new TextEncoder().encode(`导出时间：${nowText()}\n照片表内一份，原图在“原图”文件夹；扫描原文件在“扫描文件”文件夹。\n当前为离线标准包，馆藏系统接口接入后可继续导入。`)}]; for(const file of files){const folder=file.kind==='scan'?'扫描文件':'原图';zipFiles.push({name:`${folder}/${safeName(file.name)}`,data:file.data});} const blob=await buildZip(zipFiles);download(blob,`清查导出_${dateCode()}.zip`);toast(window.AndroidBridge ? '请选择清查包保存位置' : `已导出 ${items.length} 件、${boxes.length} 箱`); }); }

async function inventorySnapshot() {
  const db=await dbReady;
  return new Promise((resolve,reject)=>{
    const names=['boxes','items','files'], tx=db.transaction(names,'readonly'), values=[];
    names.forEach((name,i)=>{const request=tx.objectStore(name).getAll(); request.onsuccess=()=>values[i]=request.result;});
    tx.oncomplete=()=>resolve(values); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
  });
}
function bindEvents() {
  $('deviceTab').addEventListener('click',()=>setScanTab('device'));
  $('fileTab').addEventListener('click',()=>setScanTab('file'));
  $('scanUnit').addEventListener('change',()=>{if(state.scan)state.scan.applied=false;renderScan();});
  $('deviceForm').addEventListener('submit',event=>{event.preventDefault();localStorage.setItem('inventory-scanner-config',JSON.stringify({model:$('scannerModel').value.trim(),connection:$('scannerConnection').value}));toast('设备信息已保存，接入待适配');});
  $('itemCategory').addEventListener('change',updateAssetFields);
  ['boxForm','itemForm'].forEach(id=>$(id).addEventListener('input',()=>state.dirty=true));
  $$('[data-scene]').forEach((node) => node.addEventListener('click', () => chooseScene(node.dataset.scene)));
  $$('[data-nav]').forEach((node) => node.addEventListener('click', async () => {
    const view=node.dataset.nav;
    if(state.saving || state.processing){toast('请等待当前操作完成');return;}
    if (view==='box' && !$('boxId').value) await prepareNewBox();
    if (view==='item' && !state.currentBox) { toast('请先保存开箱记录'); return; }
    showScreen(view);
  }));
  $('checkUpdates').addEventListener('click', () => {
    const url = $('updateUrl').value.trim();
    if (url && !validUpdateUrl(url)) { toast('更新地址必须使用 HTTPS'); return; }
    localStorage.setItem('inventory-update-url', url);
    if (!url) { toast('已清除更新地址'); return; }
    if (window.AndroidBridge?.checkUpdates) { toast('正在检查新版本…'); window.AndroidBridge.checkUpdates(url, false); }
    else toast('已保存地址，请在手机 App 中检查更新');
  });
  $('settingsButton').addEventListener('click', () => showScreen('settings'));
  $('settingsBack').addEventListener('click', () => showScreen('home'));
  $('boxForm').addEventListener('submit', submitBox);
  $('itemForm').addEventListener('submit', submitItem);
  $('openScanner').addEventListener('click', () => {setScanTab('device');showScreen('scanner');});
  $('backToItem').addEventListener('click', () => showScreen('item'));
  $('applyScan').addEventListener('click', applyScanToForm);
  $('exportButton').addEventListener('click', exportPackage);
  $('boxPhoto').addEventListener('change', (e) => handlePhoto(e.target, $('boxPhotoStatus'), 'box'));
  $('itemPhoto').addEventListener('change', (e) => handlePhoto(e.target, $('itemPhotoStatus'), 'item'));
  $('scanFile').addEventListener('change',e=>importScan(e.target.files?.[0]));
}

function validUpdateUrl(value) {try {const url=new URL(value);return url.protocol==='https:' && !!url.hostname && !url.username && !url.password;}catch{return false;}}
async function init() { bindEvents(); $('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); await refreshCounts(); const lastBox=localStorage.getItem('inventory-current-box');
  if(lastBox) { state.currentBox=(await dbAll('boxes')).find(b=>b.id===lastBox)||null; if(state.currentBox) state.scene=state.currentBox.scene; }
  restoreBoxForm(); resetItem();
  try {const config=JSON.parse(localStorage.getItem('inventory-scanner-config')||'{}'); $('scannerModel').value=config.model||''; $('scannerConnection').value=config.connection||'pending';}catch{}
  $('updateUrl').value=localStorage.getItem('inventory-update-url') ?? 'https://github.com/jy1164039155-a11y/dibo-inventory/releases/latest/download/version.json';
  if(window.AndroidBridge) {
    document.body.classList.add('android-app');
    if ($('updateUrl').value && window.AndroidBridge.checkUpdates) window.AndroidBridge.checkUpdates($('updateUrl').value, true);
  }
  if(!window.AndroidBridge && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{}); }
init().catch(() => toast('本地数据库初始化失败，请用本地服务器打开'));
