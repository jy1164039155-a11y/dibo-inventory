/* Shared by the app and the format regression tests. No vendor SDK required. */
(function (root) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const FACTORS = {mm:1, cm:10, m:1000};
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  function number(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !numeric.test(value.trim()))) throw new Error('扫描数据包含无效数字');
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('扫描数据包含无效数字');
    return n;
  }
  function positive(value) {
    if (value == null || value === '') return null;
    const n = number(value);
    if (n <= 0) throw new Error('扫描尺寸和体积必须大于 0');
    return n;
  }
  function bounds() {
    const low = [Infinity,Infinity,Infinity], high = [-Infinity,-Infinity,-Infinity];
    let count = 0;
    return {
      add(xyz) { if(xyz.length!==3) throw new Error('顶点坐标不完整'); xyz.forEach((v,i) => { const n=number(v); low[i]=Math.min(low[i],n); high[i]=Math.max(high[i],n); }); count++; },
      result() {
        if (!count) throw new Error('文件中没有可读取的顶点');
        const dims = high.map((v,i)=>v-low[i]);
        if (dims.some(v=>!Number.isFinite(v) || v<=0)) throw new Error('模型缺少有效的三维尺寸');
        return {rawDimensions:dims, rawVolume:null, declaredUnit:null, geometry:true, vertexCount:count};
      }
    };
  }
  function jsonDimensions(data) {
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('扫描 JSON 必须是一个对象');
    const explicit = ['length_mm','width_mm','height_mm'].some(k=>data[k]!=null);
    const keys = explicit ? ['length_mm','width_mm','height_mm'] : ['length','width','height'];
    const unit = explicit ? 'mm' : data.unit || data.units || null;
    if (unit && !FACTORS[unit]) throw new Error('不支持该单位，请使用 mm、cm 或 m');
    const dims = keys.map(k=>positive(data[k]));
    if (dims.every(v=>v==null)) throw new Error('未找到尺寸字段');
    let volume = positive(data.volume_mm3 ?? data.volume);
    let volumeUnit = data.volume_mm3 != null ? 'mm' : unit;
    if (data.volume_unit && data.volume_mm3 == null) {
      volumeUnit = String(data.volume_unit).replace(/[³3]/g,'');
      if (!FACTORS[volumeUnit]) throw new Error('体积单位无效');
    }
    return {rawDimensions:dims, rawVolume:volume, declaredUnit:unit, volumeUnit, geometry:false, scanId:String(data.scan_id || data.scanner_id || '').slice(0,100)};
  }
  function parsePly(bytes) {
    const head = new TextDecoder().decode(bytes.subarray(0,65536));
    const match = head.match(/^end_header\r?\n/m);
    if (!match || !/^ply\r?\n/.test(head)) throw new Error('PLY 文件头无效');
    const headerText=head.slice(0,match.index+match[0].length);
    const offset=new TextEncoder().encode(headerText).length;
    const format=headerText.match(/^format (\S+)/m)?.[1];
    let active=false, count=0, beforeVertices=0;
    const props=[];
    for (const line of headerText.split(/\r?\n/)) {
      const p=line.trim().split(/\s+/);
      if (p[0]==='element') { active=p[1]==='vertex'; if(active) count=Number(p[2]); else if(!count) beforeVertices+=Number(p[2]); }
      if (active && p[0]==='property') {
        if(p[1]==='list') throw new Error('暂不支持带列表属性的 PLY 顶点');
        props.push({type:p[1],name:p[2]});
      }
    }
    if(beforeVertices || !Number.isInteger(count) || count<1 || count>5000000) throw new Error('PLY 顶点段无效或过大');
    const xyz=['x','y','z'].map(k=>props.findIndex(p=>p.name===k));
    if(xyz.some(i=>i<0)) throw new Error('PLY 缺少 x、y、z 属性');
    const b=bounds();
    if(format==='ascii') {
      const lines=new TextDecoder().decode(bytes.subarray(offset)).trim().split(/\r?\n/);
      if(lines.length<count) throw new Error('PLY 顶点数据不完整');
      for(let i=0;i<count;i++) { const cols=lines[i].trim().split(/\s+/); b.add(xyz.map(j=>cols[j])); }
    } else if(['binary_little_endian','binary_big_endian'].includes(format)) {
      const types={char:[1,'getInt8'],uchar:[1,'getUint8'],short:[2,'getInt16'],ushort:[2,'getUint16'],int:[4,'getInt32'],uint:[4,'getUint32'],float:[4,'getFloat32'],double:[8,'getFloat64'],int8:[1,'getInt8'],uint8:[1,'getUint8'],int16:[2,'getInt16'],uint16:[2,'getUint16'],int32:[4,'getInt32'],uint32:[4,'getUint32'],float32:[4,'getFloat32'],float64:[8,'getFloat64']};
      let stride=0;
      for(const p of props) { if(!types[p.type]) throw new Error('PLY 属性类型不支持'); p.offset=stride; stride+=types[p.type][0]; }
      if(offset+count*stride>bytes.length) throw new Error('PLY 二进制数据不完整');
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      for(let i=0;i<count;i++) b.add(xyz.map(j=>view[types[props[j].type][1]](offset+i*stride+props[j].offset,format==='binary_little_endian')));
    } else throw new Error('不支持该 PLY 编码');
    return b.result();
  }
  function parseModel(bytes, ext) {
    if(ext==='ply') return parsePly(bytes);
    const b=bounds();
    if(ext==='stl' && bytes.length>=84) {
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), n=view.getUint32(80,true);
      if(n>0 && 84+n*50===bytes.length) {
        for(let i=0;i<n;i++) for(let j=0;j<3;j++) b.add([0,1,2].map(k=>view.getFloat32(84+i*50+12+j*12+k*4,true)));
        return b.result();
      }
    }
    const lines=new TextDecoder().decode(bytes).split(/\r?\n/).map(s=>s.replace(/#.*/,'').trim()).filter(Boolean);
    if(ext==='off') {
      if(lines.shift()!=='OFF') throw new Error('OFF 文件头无效');
      const count=Number(lines.shift()?.split(/\s+/)[0]);
      if(!Number.isInteger(count) || count<1 || count>lines.length) throw new Error('OFF 顶点数据不完整');
      for(let i=0;i<count;i++) b.add(lines[i].split(/\s+/).slice(0,3));
    } else {
      for(const line of lines) {
        const cols=line.split(/[\s,;]+/);
        if((ext==='obj' && cols[0]==='v') || (ext==='stl' && cols[0].toLowerCase()==='vertex')) b.add(cols.slice(1,4));
        else if(ext==='txt' && cols.length>=3 && cols.slice(0,3).every(v=>numeric.test(v))) b.add(cols.slice(0,3));
      }
    }
    return b.result();
  }
  async function parse(file) {
    if(!file.size) throw new Error('扫描文件为空');
    if(file.size>MAX_BYTES) throw new Error('扫描文件超过 20 MB，请先在电脑简化模型');
    const ext=file.name.split('.').pop().toLowerCase();
    let data;
    if(ext==='xpro') return {file, fileName:file.name, archiveOnly:true, rawDimensions:[null,null,null], rawVolume:null, declaredUnit:null, geometry:false};
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(ext==='json') {
      try { data=jsonDimensions(JSON.parse(new TextDecoder().decode(bytes).replace(/^\uFEFF/,''))); }
      catch(error) { throw new Error(error instanceof SyntaxError ? 'JSON 格式错误，请检查扫描输出' : error.message); }
    } else if(ext==='csv' || ext==='txt') {
      const text=new TextDecoder().decode(bytes).replace(/^\uFEFF/,''), lines=text.trim().split(/\r?\n/);
      const fields={};
      for(const line of lines) { const m=line.match(/^\s*(length_mm|width_mm|height_mm|volume_mm3|length|width|height|volume|unit)\s*[:=：]\s*(.+?)\s*$/i); if(m) fields[m[1].toLowerCase()]=m[2]; }
      if(!Object.keys(fields).length && lines.length>=2 && /length|width|height/i.test(lines[0])) {
        const keys=lines[0].split(/[,;\t]/).map(v=>v.trim().replace(/^"|"$/g,''));
        const vals=lines[1].split(/[,;\t]/).map(v=>v.trim().replace(/^"|"$/g,''));
        if(lines.length>2) throw new Error('每个扫描文件只能包含一件物品');
        keys.forEach((k,i)=>fields[k]=vals[i]);
      }
      data=Object.keys(fields).length ? jsonDimensions(fields) : ext==='txt' ? parseModel(bytes,ext) : (()=>{throw new Error('CSV 缺少尺寸字段');})();
    } else if(['obj','stl','ply','off'].includes(ext)) data=parseModel(bytes,ext);
    else throw new Error('不支持该扫描文件格式');
    return {...data,file,fileName:file.name};
  }
  function measured(scan, selectedUnit) {
    const unit=scan.declaredUnit || selectedUnit;
    if(scan.archiveOnly) return {lengthMm:null,widthMm:null,heightMm:null,volumeMm3:null};
    if(!FACTORS[unit]) throw new Error('请选择扫描文件使用的单位');
    const values=scan.rawDimensions.map(v=>v==null?null:v*FACTORS[unit]);
    const volumeUnit=scan.volumeUnit || unit;
    const volume=scan.rawVolume==null?null:scan.rawVolume*FACTORS[volumeUnit]**3;
    if([...values,volume].some(v=>v!=null && !Number.isFinite(v)))throw new Error('换算后的测量值过大');
    return {lengthMm:values[0],widthMm:values[1],heightMm:values[2],volumeMm3:volume};
  }
  const api={parse,measured,MAX_BYTES};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.ScannerFormat=api;
})(globalThis);
