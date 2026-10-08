// Scene-specific presentation over the existing boxes/items stores.
const SCENE_FORMS = {
  warehouse:{title:'开箱登记', id:'箱号', group:'', location:'当前库位', placeholder:'如：工位 A-01', photo:'拍箱体照片'},
  display:{title:'展厅登记', id:'展厅记录号', group:'展厅名称', location:'展柜 / 位置', placeholder:'如：展柜 03', photo:'拍展厅或展柜照片'},
  facility:{title:'楼层登记', id:'位置记录号', group:'楼层', location:'具体位置', placeholder:'如：东侧机房', photo:'拍现场照片'}
};
const CATEGORY_NAMES={mineral:'矿物、岩石及标本',jewelry:'珠宝',equipment:'电子设备',facility:'陈列及基础设施'};
const previewUrls=new Map(), previewRequests=new Map();
function clearPreview(id){
  previewRequests.set(id,(previewRequests.get(id)||0)+1);
  if(previewUrls.has(id))URL.revokeObjectURL(previewUrls.get(id));
  previewUrls.delete(id);$(id).removeAttribute('src');$(id).classList.add('hidden');
}
async function showPreview(id,fileId){
  clearPreview(id);if(!fileId)return;
  const request=previewRequests.get(id),file=await dbGet('files',fileId);
  if(request!==previewRequests.get(id)||!file?.data)return;
  const url=URL.createObjectURL(file.data);previewUrls.set(id,url);$(id).src=url;$(id).classList.remove('hidden');
}
function groupName(box){return box.scene==='display'?box.hallName:box.scene==='facility'?box.floorName:'';}
function groupTitle(box){
  if(box.scene==='warehouse')return box.id;
  const name=groupName(box)||(box.scene==='display'?'展厅待补全':'楼层待补全');
  return name;
}
function updateSceneForm(){
  const scene=state.scene,config=SCENE_FORMS[scene];
  $('groupHeading').textContent=config.title;$('groupIdLabel').textContent=config.id;
  $('groupIdField').classList.toggle('hidden',scene!=='warehouse');
  $('groupNameField').classList.toggle('hidden',!config.group);$('groupNameLabel').textContent=config.group;
  $('groupName').required=!!config.group;$('groupName').placeholder=scene==='display'?'如：生命演化厅':'如：三楼';
  $('originalLocationField').classList.toggle('hidden',scene!=='warehouse');
  $('currentLocationField').parentElement.classList.toggle('single-col',scene!=='warehouse');
  $('currentLocationLabel').textContent=config.location;$('boxCurrentLocation').placeholder=config.placeholder;
  $('boxCurrentLocation').required=scene==='facility';$('groupPhotoLabel').textContent=config.photo;
  const oldStatus=state.currentBox?.status,selectedStatus=$('boxStatus').value;
  const statuses=['清点中','部分完成',scene==='warehouse'?'已回存':'已完成'];
  if(oldStatus&&!statuses.includes(oldStatus))statuses.push(oldStatus);
  $('boxStatus').replaceChildren(...statuses.map(value=>new Option(value,value)));
  $('boxStatus').value=statuses.includes(selectedStatus)?selectedStatus:oldStatus||statuses[0];
  $('itemLocation').placeholder=scene==='display'?'如：展柜 03 / 第二层':scene==='facility'?'如：东侧机房':'库位 / 工位';
  if(document.querySelector('[data-screen=box]').classList.contains('active'))$('appTitle').textContent=config.title;
}
function recordButton(title,description,kind,id,badge=''){
  const button=document.createElement('button');button.type='button';button.className='scene-card saved-record';
  button.dataset[kind]=id;
  button.setAttribute('aria-label','查看'+title);
  button.innerHTML=`<span class="record-copy"><b>${escapeHtml(title)}</b><small>${escapeHtml(description)}</small></span>${badge?`<span class="chip gray">${escapeHtml(badge)}</span>`:''}<i aria-hidden="true">›</i>`;
  return button;
}
function renderLocalRecords(boxes,items){
  const container=$('localRecords');container.replaceChildren();
  const counts=new Map();for(const item of items)counts.set(item.boxId,(counts.get(item.boxId)||0)+1);
  const scene=state.historyScene;
  $$('[data-history-scene]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.historyScene===scene)));
  const records=boxes.filter(box=>box.scene===scene).reverse();
  if(!records.length){const empty=document.createElement('p');empty.className='small muted';empty.textContent='暂无'+({warehouse:'箱子',display:'展厅',facility:'楼层'}[scene])+'记录';container.append(empty);return;}
  for(const box of records){
    const text=box.currentLocation||'未填写位置';
    const button=recordButton(groupTitle(box),text,'recordId',box.id,`${counts.get(box.id)||0} 件`);
    button.addEventListener('click',()=>openGroup(box.id).catch(error=>toast(error.message)));container.append(button);
  }
}
function canSwitchRecord(){
  if(state.processing||state.saving){toast('请等待当前操作完成');return false;}
  return !state.dirty||confirm('当前内容尚未保存，是否放弃并切换记录？');
}
async function openGroup(id){
  if(!canSwitchRecord())return;
  const box=await dbGet('boxes',id);if(!box){toast('记录不存在');return;}
  state.currentBox=box;state.scene=box.scene;state.pendingBoxPhoto=null;state.groupReturn=false;state.boxDirty=false;
  localStorage.setItem('inventory-current-box',id);restoreBoxForm();resetItem();
  $('recordDetails').open=false;
  showScreen('records');
}
async function renderRecords(){
  const box=state.currentBox;if(!box)return;
  $('recordsTitle').textContent=groupTitle(box);$('recordsScene').textContent=box.status||'清点中';
  $('recordsId').textContent=box.id;$('recordsOperator').textContent=box.operator||'—';$('recordsTime').textContent=box.openedAt||'—';
  $('recordsMeta').textContent='位置：'+(box.currentLocation||'未填写');
  $('editGroup').textContent=box.scene==='warehouse'?'修改开箱信息':box.scene==='display'?'修改展厅信息':'修改楼层信息';
  showPreview('recordsPhotoPreview',box.photoId).catch(error=>toast(error.message));
  const items=(await dbAll('items')).filter(item=>item.boxId===box.id);
  if(state.currentBox?.id!==box.id)return;
  $('recordsCount').textContent=`${items.length} 件`;$('recordItems').replaceChildren();
  for(const item of items){
    const text=[CATEGORY_NAMES[item.category]||item.category,item.exception?'异常':''].filter(Boolean).join(' · ');
    const button=recordButton(item.name,text,'itemId',item.id);
    button.addEventListener('click',()=>editItem(item.id).catch(error=>toast(error.message)));$('recordItems').append(button);
  }
  if(!items.length){const empty=document.createElement('p');empty.className='small muted';empty.textContent='暂无物品，点“继续登记”添加。';$('recordItems').append(empty);}
}
async function editItem(id){
  if(!canSwitchRecord())return;
  const item=await dbGet('items',id);if(!item||item.boxId!==state.currentBox?.id){toast('物品不属于当前记录');return;}
  resetItem();state.editingItem=item;$('itemId').textContent=item.id;
  for(const [field,key] of Object.entries({itemCategory:'category',itemName:'name',lengthMm:'lengthMm',widthMm:'widthMm',heightMm:'heightMm',weightG:'weightG',itemQuantity:'quantity',itemValue:'bookValue',itemLocation:'location'}))$(field).value=item[key]??(key==='quantity'?1:'');
  $('itemException').checked=!!item.exception;$('itemPhotoStatus').textContent=item.photoIds?.length?'已保存照片':'';
  $('savedScanInfo').textContent=item.scanFileId?`已保存扫描：${item.scanId||'扫描文件'}${item.volumeMm3!=null?' · 体积 '+item.volumeMm3+' mm³':''}`:'';
  $('savedScanDetails').classList.toggle('hidden',!item.scanFileId);$('savedScanDetails').open=false;
  showPreview('itemPhotoPreview',item.photoIds?.[0]).catch(error=>toast(error.message));showScreen('item');
}
function bindRecordEvents(){
  $$('[data-history-scene]').forEach(button=>button.addEventListener('click',()=>{state.historyScene=button.dataset.historyScene;refreshCounts().catch(error=>toast(error.message));}));
  $('continueItems').addEventListener('click',()=>{if(!canSwitchRecord())return;resetItem();showScreen('item');});
  $('editGroup').addEventListener('click',()=>{if(!canSwitchRecord())return;state.groupReturn=true;restoreBoxForm();showScreen('box');});
  $('backToRecords').addEventListener('click',()=>{if(!canSwitchRecord())return;resetItem();state.pendingBoxPhoto=null;state.boxDirty=false;restoreBoxForm();showScreen('records');});
}
