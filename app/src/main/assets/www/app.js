const DB_NAME = 'museum-inventory-app';
const DB_VERSION = 1;
const SCENE_NAMES = {warehouse:'仓库开箱', display:'馆内展柜', facility:'设备设施'};
const SCENE_CODES = {warehouse:'A', display:'D', facility:'F'};
const state = {scene:'warehouse', currentBox:null, itemIndex:1, pendingBoxPhoto:null, pendingItemPhoto:null, scan:null};

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
  $$('.screen').forEach((node) => node.classList.toggle('active', node.dataset.screen === name));
  $$('.bottom-nav button').forEach((node) => node.classList.toggle('active', node.dataset.nav === name));
  document.querySelector('.content').scrollTop = 0;
  if (name === 'home') refreshCounts();
  if (name === 'item') prepareItemId();
  if (name === 'export') refreshExportCounts();
}
function nowText() { return new Date().toLocaleString('zh-CN', {hour12:false}).replace(/\//g,'-'); }
function dateCode() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; }
function safeName(name) { return name.replace(/[\\/:*?"<>|\s]+/g,'_').slice(0,120); }
async function nextBoxId() {
  const boxes = await dbAll('boxes');
  const code = SCENE_CODES[state.scene];
  const prefix = `${code}-${dateCode()}-`;
  const count = boxes.filter((b) => String(b.id).startsWith(prefix)).length + 1;
  return `${prefix}${String(count).padStart(3,'0')}`;
}
async function prepareNewBox() {
  state.currentBox = null;
  state.pendingBoxPhoto = null;
  state.pendingItemPhoto = null;
  state.scan = null;
  const id = await nextBoxId();
  $('boxId').value = id;
  $('boxSceneChip').textContent = SCENE_NAMES[state.scene];
  $('boxForm').reset();
  $('boxId').value = id;
  $('boxSceneChip').textContent = SCENE_NAMES[state.scene];
  $('boxPhotoStatus').textContent = '';
}
async function prepareItemId() {
  if (!state.currentBox) return;
  const items = await dbAll('items');
  const prefix = `${state.currentBox.id}-`;
  const count = items.filter((item) => String(item.id).startsWith(prefix)).length + 1;
  state.itemIndex = count;
  $('itemId').textContent = `${state.currentBox.id}-${String(count).padStart(2,'0')}`;
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
  return {blob, width:canvas.width, height:canvas.height, originalName:file.name, originalSize:file.size};
}
async function handlePhoto(input, statusNode, kind) {
  const file = input.files?.[0];
  if (!file) return;
  statusNode.textContent = '处理中…';
  try {
    const result = await compressPhoto(file);
    const target = kind === 'box' ? 'pendingBoxPhoto' : 'pendingItemPhoto';
    state[target] = result;
    statusNode.textContent = `已添加 · ${Math.round(result.blob.size / 1024)} KB`;

  } catch (error) {
    statusNode.textContent = '照片处理失败，请重试';
    toast('照片处理失败');
  }
}

function parseNumber(value) {
  const match = String(value ?? '').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
function labelledNumber(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}\\s*[:=：]?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'));
    if (match) return Number(match[1]);
  }
  return null;
}
function dimensionsFromVertices(vertices) {
  if (!vertices.length) return null;
  const xs = vertices.map((v) => v[0]), ys = vertices.map((v) => v[1]), zs = vertices.map((v) => v[2]);
  const values = [Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys), Math.max(...zs)-Math.min(...zs)].map((n) => Math.abs(n));
  if (values.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return {lengthMm:values[0], widthMm:values[1], heightMm:values[2], volumeMm3:null};
}
function parseVertices(text, extension) {
  const vertices = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    let match = null;
    if (extension === 'obj' && /^v\s+/.test(trimmed)) match = trimmed.match(/^v\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    if (extension === 'stl' && /^vertex\s+/i.test(trimmed)) match = trimmed.match(/^vertex\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);
    if (extension === 'ply' && /^-?\d/.test(trimmed)) match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    if (match) vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  return dimensionsFromVertices(vertices);
}
async function parseScanFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  let text = '';
  try { text = await file.text(); } catch (_) { text = ''; }
  let result = null;
  if (extension === 'json' && text.trim()) {
    try {
      const data = JSON.parse(text);
      result = {lengthMm:parseNumber(data.length_mm ?? data.length), widthMm:parseNumber(data.width_mm ?? data.width), heightMm:parseNumber(data.height_mm ?? data.height), volumeMm3:parseNumber(data.volume_mm3 ?? data.volume), scannerId:data.scanner_id || data.scan_id};
    } catch (_) { /* fall through to text parsing */ }
  }
  if (!result) {
    result = {lengthMm:labelledNumber(text,['length_mm','length','长']), widthMm:labelledNumber(text,['width_mm','width','宽']), heightMm:labelledNumber(text,['height_mm','height','高']), volumeMm3:labelledNumber(text,['volume_mm3','volume','体积'])};
  }
  if (!result.lengthMm || !result.widthMm || !result.heightMm) {
    const fromVertices = parseVertices(text, extension);
    if (fromVertices) result = {...result, ...fromVertices, needsUnitConfirmation:true};
  }
  const scanId = result.scannerId || `XSC-${dateCode()}-${String(Date.now()).slice(-4)}`;
  return {file, fileName:file.name, scanId, ...result, volumeMm3:result.volumeMm3 ?? null};
}
function showScanResult(scan) {
  state.scan = scan;
  $('scannerState').textContent = '已导入';
  $('scannerState').classList.remove('gray');
  $('scanResult').classList.remove('hidden');
  $('scanId').textContent = scan.scanId;
  $('scanDimensions').textContent = scan.lengthMm && scan.widthMm && scan.heightMm ? `${scan.lengthMm.toFixed(2)} × ${scan.widthMm.toFixed(2)} × ${scan.heightMm.toFixed(2)} mm` : '未识别，请手动填写';
  $('scanVolume').textContent = scan.volumeMm3 != null ? `${scan.volumeMm3.toFixed(2)} mm³` : '—';
  $('scanFileName').textContent = scan.fileName;
}
function applyScanToForm() {
  if (!state.scan) return;
  if (state.scan.needsUnitConfirmation && !confirm('该模型未声明单位。确认扫描软件导出使用毫米（mm）？取消可保留文件并手动填写尺寸。')) { state.scan.lengthMm=null; state.scan.widthMm=null; state.scan.heightMm=null; showScreen('item'); return; }
  if (state.scan.lengthMm) $('lengthMm').value = state.scan.lengthMm.toFixed(2);
  if (state.scan.widthMm) $('widthMm').value = state.scan.widthMm.toFixed(2);
  if (state.scan.heightMm) $('heightMm').value = state.scan.heightMm.toFixed(2);
  toast(state.scan.lengthMm ? '扫描结果已回填' : '已保留原始扫描文件');
  showScreen('item');
}

function fileRecord(id, ownerType, ownerId, kind, name, data, meta={}) { return {id, ownerType, ownerId, kind, name, data, createdAt:nowText(), ...meta}; }
async function savePendingPhoto(ownerType, ownerId, pending, label) {
  if (!pending) return null;
  const name = `${safeName(ownerId)}_${label}.jpg`;
  const id = `photo:${ownerType}:${ownerId}:${label}`;
  await dbPut('files', fileRecord(id, ownerType, ownerId, 'photo', name, pending.blob, {width:pending.width,height:pending.height,originalSize:pending.originalSize}));
  return id;
}
async function savePendingScan(itemId) {
  if (!state.scan?.file) return null;
  const file = state.scan.file;
  const id = `scan:${itemId}:${safeName(file.name)}`;
  await dbPut('files', fileRecord(id, 'item', itemId, 'scan', safeName(itemId) + '_' + safeName(file.name), file, {scannerId:state.scan.scanId,extension:file.name.split('.').pop().toLowerCase()}));
  return id;
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
  state.scene = scene;
  await prepareNewBox();
  showScreen('box');

}
async function submitBox(event) {
  event.preventDefault();
  const id = $('boxId').value;
  const photoId = await savePendingPhoto('box', id, state.pendingBoxPhoto, '箱体');
  state.currentBox = {id, scene:state.scene, sceneName:SCENE_NAMES[state.scene], originalLocation:$('boxOriginalLocation').value.trim(), currentLocation:$('boxCurrentLocation').value.trim(), operator:$('boxOperator').value.trim(), status:$('boxStatus').value, openedAt:nowText(), photoId};
  await dbPut('boxes', state.currentBox);
  localStorage.setItem('inventory-current-box', state.currentBox.id);
  await prepareItemId();
  showScreen('item');
  toast('开箱记录已保存');
}
async function submitItem(event) {
  event.preventDefault();
  if (!state.currentBox) { toast('请先建立开箱记录'); showScreen('home'); return; }
  const id = $('itemId').textContent;
  const photoId = await savePendingPhoto('item', id, state.pendingItemPhoto, '照片01');
  const scanId = state.scan?.scanId || '';
  const scanFileId = await savePendingScan(id);
  const item = {id, boxId:state.currentBox.id, scene:state.scene, sceneName:SCENE_NAMES[state.scene], category:$('itemCategory').value, name:$('itemName').value.trim(), lengthMm:parseNumber($('lengthMm').value), widthMm:parseNumber($('widthMm').value), heightMm:parseNumber($('heightMm').value), weightG:parseNumber($('weightG').value), location:$('itemLocation').value.trim(), photoIds:photoId?[photoId]:[], scanId, scanFileId, volumeMm3:state.scan?.volumeMm3 ?? null, exception:$('itemException').checked, createdAt:nowText()};
  await dbPut('items', item);
  state.pendingItemPhoto = null; state.scan = null;
  $('itemForm').reset(); $('itemPhotoStatus').textContent = ''; $('scanResult').classList.add('hidden');
  $('scanFile').value = ''; $('scannerState').textContent = '未导入'; $('scannerState').classList.add('gray');
  await prepareItemId(); refreshCounts();
  toast('已保存');
}

function csvCell(value) { return `"${String(value ?? '').replace(/"/g,'""')}"`; }
function buildCsv(boxes, items, files) {
  const rows = [['清查号','箱号','场景','分类','名称','长(mm)','宽(mm)','高(mm)','重量(g)','当前位置','照片文件','扫描编号','扫描文件','异常','录入时间']];
  for (const item of items) {
    const photos = files.filter((f) => item.photoIds?.includes(f.id)).map((f) => `原图/${f.name}`).join(';');
    const scan = files.find((f) => f.id === item.scanFileId);
    rows.push([item.id,item.boxId,item.sceneName,item.category,item.name,item.lengthMm,item.widthMm,item.heightMm,item.weightG,item.location,photos,item.scanId,scan?`扫描文件/${scan.name}`:'',item.exception?'是':'否',item.createdAt]);
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
    rows.push(`<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml([item.lengthMm,item.widthMm,item.heightMm].filter(Boolean).join(' × '))}</td><td>${escapeHtml(item.weightG)}</td><td>${escapeHtml(item.location)}</td><td>${src?`<img src="${src}" alt="${escapeHtml(item.id)}">`:''}</td></tr>`);
  }
  return `<!doctype html><meta charset="utf-8"><title>清查表</title><style>body{font-family:Arial,"Microsoft YaHei"}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:6px;font-size:12px}img{width:90px;max-height:90px;object-fit:contain}</style><h1>湖南省地质博物馆资产清查表</h1><table><thead><tr><th>清查号</th><th>分类</th><th>名称</th><th>尺寸(mm)</th><th>重量(g)</th><th>位置</th><th>照片</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
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
async function exportPackage() { const [boxes,items,files] = await Promise.all([dbAll('boxes'),dbAll('items'),dbAll('files')]); const csv=buildCsv(boxes,items,files);const html=await buildHtmlTable(items,files);const zipFiles=[{name:'清查表.csv',data:new TextEncoder().encode(csv)},{name:'清查表.xls',data:new TextEncoder().encode(html)},{name:'导出说明.txt',data:new TextEncoder().encode(`导出时间：${nowText()}\n照片表内一份，原图在“原图”文件夹；扫描原文件在“扫描文件”文件夹。\n当前为离线标准包，馆藏系统接口接入后可继续导入。`)}]; for(const file of files){const folder=file.kind==='scan'?'扫描文件':'原图';zipFiles.push({name:`${folder}/${safeName(file.name)}`,data:file.data});} const blob=await buildZip(zipFiles);download(blob,`清查导出_${dateCode()}.zip`);toast(window.AndroidBridge ? '请选择清查包保存位置' : `已导出 ${items.length} 件、${boxes.length} 箱`); }

function bindEvents() {
  $$('[data-scene]').forEach((node) => node.addEventListener('click', () => chooseScene(node.dataset.scene)));
  $$('[data-nav]').forEach((node) => node.addEventListener('click', async () => {
    const view=node.dataset.nav;
    if (view==='box' && !$('boxId').value) await prepareNewBox();
    if (view==='item' && !state.currentBox) { toast('请先保存开箱记录'); return; }
    showScreen(view);
  }));
  $('checkUpdates').addEventListener('click', () => {
    const url = $('updateUrl').value.trim();
    if (url && !/^https:\/\//.test(url)) { toast('更新地址必须使用 HTTPS'); return; }
    localStorage.setItem('inventory-update-url', url);
    if (!url) { toast('已清除更新地址'); return; }
    if (window.AndroidBridge?.checkUpdates) { toast('正在检查新版本…'); window.AndroidBridge.checkUpdates(url, false); }
    else toast('已保存地址，请在手机 App 中检查更新');
  });
  $('settingsButton').addEventListener('click', () => showScreen('settings'));
  $('settingsBack').addEventListener('click', () => showScreen('home'));
  $('boxForm').addEventListener('submit', submitBox);
  $('itemForm').addEventListener('submit', submitItem);
  $('openScanner').addEventListener('click', () => showScreen('scanner'));
  $('backToItem').addEventListener('click', () => showScreen('item'));
  $('applyScan').addEventListener('click', applyScanToForm);
  $('exportButton').addEventListener('click', exportPackage);
  $('boxPhoto').addEventListener('change', (e) => handlePhoto(e.target, $('boxPhotoStatus'), 'box'));
  $('itemPhoto').addEventListener('change', (e) => handlePhoto(e.target, $('itemPhotoStatus'), 'item'));
  $('scanFile').addEventListener('change', async (e) => { const file=e.target.files?.[0];if(!file)return;showScanResult(await parseScanFile(file));toast('扫描文件已读取'); });
}

async function init() { bindEvents(); $('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); await refreshCounts(); const lastBox=localStorage.getItem('inventory-current-box');
  if(lastBox) { state.currentBox=(await dbAll('boxes')).find(b=>b.id===lastBox)||null; if(state.currentBox) state.scene=state.currentBox.scene; }
  $('updateUrl').value=localStorage.getItem('inventory-update-url') ?? 'https://github.com/jy1164039155-a11y/dibo-inventory/releases/latest/download/version.json';
  if(window.AndroidBridge) {
    document.body.classList.add('android-app');
    if ($('updateUrl').value && window.AndroidBridge.checkUpdates) window.AndroidBridge.checkUpdates($('updateUrl').value, true);
  }
  if(!window.AndroidBridge && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{}); }
init().catch(() => toast('本地数据库初始化失败，请用本地服务器打开'));
