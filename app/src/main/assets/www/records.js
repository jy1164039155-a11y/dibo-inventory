// Scene-specific presentation over the existing boxes/items stores.
const SCENE_FORMS = {
  warehouse:{title:'开箱登记', id:'箱号', group:'', location:'当前库位', placeholder:'如：工位 A-01', photo:'拍箱体照片'},
  display:{title:'展厅登记', id:'展厅记录号', group:'展厅名称', location:'展柜 / 位置', placeholder:'如：展柜 03', photo:'拍展厅或展柜照片'},
  facility:{title:'楼层与位置登记', id:'位置记录号', group:'楼层', location:'具体位置', placeholder:'如：东侧机房', photo:'拍位置照片'}
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
  return box.scene==='facility'&&box.currentLocation?`${name} · ${box.currentLocation}`:name;
}
function updateSceneForm(){
  const scene=state.scene,config=SCENE_FORMS[scene];
  $('groupHeading').textContent=config.title;$('groupIdLabel').textContent=config.id;
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
function recordButton(title,description,kind,id){
  const button=document.createElement('button');button.type='button';button.className='scene-card saved-record';
  button.dataset[kind]=id;
  button.innerHTML=`<span class="record-copy"><b>${escapeHtml(title)}</b><small>${escapeHtml(description)}</small></span><i aria-hidden="true">›</i>`;
  return button;
}
function renderLocalRecords(boxes,items){
  const container=$('localRecords');container.replaceChildren();
  if(!boxes.length){const empty=document.createElement('p');empty.className='small muted';empty.textContent='登记后可在这里查看和继续清查。';container.append(empty);return;}
  const counts=new Map();for(const item of items)counts.set(item.boxId,(counts.get(item.boxId)||0)+1);
  for(const scene of ['warehouse','display','facility']){
    const records=boxes.filter(box=>box.scene===scene).reverse();if(!records.length)continue;
    const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=SCENE_NAMES[scene];section.append(heading);
    for(const box of records){
      const text=[scene==='facility'?'':box.currentLocation,box.operator,`${counts.get(box.id)||0} 件`,box.status].filter(Boolean).join(' · ');
      const button=recordButton(groupTitle(box),text,'recordId',box.id);
      button.addEventListener('click',()=>openGroup(box.id).catch(error=>toast(error.message)));section.append(button);
    }
    container.append(section);
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
  showScreen('records');
}
async function renderRecords(){
  const box=state.currentBox;if(!box)return;
  $('recordsTitle').textContent=groupTitle(box);$('recordsScene').textContent=SCENE_NAMES[box.scene];
  $('recordsId').textContent=`${SCENE_FORMS[box.scene].id}：${box.id}`;
  $('recordsMeta').textContent=[box.currentLocation,box.operator,box.status,box.openedAt].filter(Boolean).join(' · ');
  $('editGroup').textContent=box.scene==='warehouse'?'修改开箱信息':box.scene==='display'?'修改展厅信息':'修改楼层与位置';
  showPreview('recordsPhotoPreview',box.photoId).catch(error=>toast(error.message));
  const items=(await dbAll('items')).filter(item=>item.boxId===box.id);
  if(state.currentBox?.id!==box.id)return;
  $('recordsCount').textContent=`${items.length} 件`;$('recordItems').replaceChildren();
  for(const item of items){
    const text=[CATEGORY_NAMES[item.category]||item.category,item.location,item.exception?'异常':'',item.id].filter(Boolean).join(' · ');
    const button=recordButton(item.name,text,'itemId',item.id);
    button.addEventListener('click',()=>editItem(item.id).catch(error=>toast(error.message)));$('recordItems').append(button);
  }
  if(!items.length){const empty=document.createElement('p');empty.className='small muted';empty.textContent='尚未登记物品，点“继续登记物品”开始。';$('recordItems').append(empty);}
}
async function editItem(id){
  if(!canSwitchRecord())return;
  const item=await dbGet('items',id);if(!item||item.boxId!==state.currentBox?.id){toast('物品不属于当前记录');return;}
  resetItem();state.editingItem=item;$('itemId').textContent=item.id;
  for(const [field,key] of Object.entries({itemCategory:'category',itemName:'name',lengthMm:'lengthMm',widthMm:'widthMm',heightMm:'heightMm',weightG:'weightG',itemQuantity:'quantity',itemValue:'bookValue',itemLocation:'location'}))$(field).value=item[key]??(key==='quantity'?1:'');
  $('itemException').checked=!!item.exception;$('itemPhotoStatus').textContent=item.photoIds?.length?'已保存照片，选择新照片可替换':'';
  $('savedScanInfo').textContent=item.scanFileId?`已保存扫描：${item.scanId||'扫描文件'}${item.volumeMm3!=null?' · 体积 '+item.volumeMm3+' mm³':''}`:'';
  $('savedScanInfo').classList.toggle('hidden',!item.scanFileId);
  showPreview('itemPhotoPreview',item.photoIds?.[0]).catch(error=>toast(error.message));showScreen('item');
}
function bindRecordEvents(){
  $('continueItems').addEventListener('click',()=>{if(!canSwitchRecord())return;resetItem();showScreen('item');});
  $('editGroup').addEventListener('click',()=>{if(!canSwitchRecord())return;state.groupReturn=true;restoreBoxForm();showScreen('box');});
  $('backToRecords').addEventListener('click',()=>{if(!canSwitchRecord())return;resetItem();state.pendingBoxPhoto=null;state.boxDirty=false;restoreBoxForm();showScreen('records');});
}
