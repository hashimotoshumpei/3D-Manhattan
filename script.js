// ===== Global shared objects =====
let globalState = {};
let globalAllPoints = [];
let globalDatasets = [];   // ← UI制御用（順序・ON/OFF・名前）
let globalActiveDatasets = [];

/* ================= Drag & Drop File Input ================= */

const dropZone  = document.getElementById("dropZone");
const fileInput = document.getElementById("csvInput");

/* クリックで file dialog を開く */
dropZone.addEventListener("click", () => {
  fileInput.click();
});

/* drag over */
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

/* drag leave */
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

/* drop */
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  /* 🔑 既存ロジックをそのまま使う */
  fileInput.files = files;
  fileInput.dispatchEvent(new Event("change"));
});


document.getElementById("csvInput").addEventListener("change", async (e)=>{
  const files = e.target.files;
  /* ===== 追加：ファイル選択状態の英語表示 ===== */
  const status = document.getElementById("fileStatus");
  if(status){
    if(files.length === 0){
      status.textContent = "No files selected";
    } else if(files.length === 1){
      status.textContent = files[0].name;
    } else {
      status.textContent = `${files.length} files selected`;
    }
  }
  /* ===== 追加ここまで ===== */










  if(files.length === 0) return;

  globalDatasets = [];

  for(let i=0;i<files.length;i++){
    const f = files[i];
    globalDatasets.push({
      name: f.name,
      data: parseCSV(await f.text()),
      enabled: true,
      order: i
    });
  }
  globalState.regions = [];
  buildDatasetUI();
});


/* ================= scene ================= */
const EXPORT_SCALE = 3;

const canvas = document.getElementById("canvas");
const scene = new THREE.Scene();

function getThemeSettings(){
  const mode = document.getElementById("themeToggle")?.checked ? "dark" : "light";
  if(mode === "dark"){
    return {
      mode,
      sceneBackground: "#0f172a",
      panelBackground: "#111827",
      plotBackground: "#0f172a",
      axisColor: "#e5e7eb",
      textColor: "#f9fafb",
      titleBackground: "rgba(15,23,42,0.86)",
      thresholdLineColor: "#f87171"
    };
  }
  return {
    mode,
    sceneBackground: "#ffffff",
    panelBackground: "#f5f7fb",
    plotBackground: "#ffffff",
    axisColor: "#000000",
    textColor: "#000000",
    titleBackground: "rgba(255,255,255,0.85)",
    thresholdLineColor: "#ff0000"
  };
}

function applyTheme(){
  const theme = getThemeSettings();
  document.body.dataset.theme = theme.mode;
  scene.background = new THREE.Color(theme.sceneBackground);
  if(globalState) globalState.theme = theme;
}

function refreshThemeOnly(){
  applyTheme();
  if(!points || !geometry || !globalState || !globalActiveDatasets.length) return;

  const theme = getThemeSettings();
  globalState.theme = theme;

  drawAxes(
    globalActiveDatasets.length,
    globalState.zSpacing || +document.getElementById("zSpacing").value,
    globalState.labelSize,
    globalState.axisOffset,
    globalState.labelOffset,
    globalState.chrMax,
    globalState.chrOffsetsSelected,
    globalState.totalLengthSelected,
    globalState.BP_SCALE,
    globalState.yScale,
    globalState.lodLine
  );

  const panel2d = document.getElementById("panel2d");
  panel2d.innerHTML = "";
  globalActiveDatasets.forEach(ds=>{
    draw2DManhattan(panel2d, ds.data, 0, globalState, ds.name);
  });
}

applyTheme();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth/(window.innerHeight-80),
  0.1,
  5000
);
camera.position.set(0,20, 220);

const baseCameraPosition = { x: 0, y: 20, z: 220 };
const cameraPanState = { horizontal: 0, vertical: 0 };

function applyCameraPan(){
  const panScale = Math.max(20, camera.position.z * 0.35);
  camera.position.x = baseCameraPosition.x + (cameraPanState.horizontal / 100) * panScale;
  camera.position.y = baseCameraPosition.y - (cameraPanState.vertical / 100) * panScale;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true
});

function resizeRenderer() {
  const controlsWidth = document.getElementById("controls").offsetWidth;
  const panel2dWidth  = document.getElementById("panel2d").offsetWidth;
  const width  = window.innerWidth - controlsWidth - panel2dWidth;
  const height = window.innerHeight;

  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}


resizeRenderer();

renderer.setPixelRatio(window.devicePixelRatio);

const sceneGroup = new THREE.Group();
scene.add(sceneGroup);

let points = null;
let geometry = null;
const axisGroup = new THREE.Group();
sceneGroup.add(axisGroup);

const lineGroup = new THREE.Group();
sceneGroup.add(lineGroup);


/* ================= shaders ================= */

const vertexShader = `
attribute vec3 color;
varying vec3 vColor;
uniform float pointSize;
void main(){
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = pointSize;
  gl_Position = projectionMatrix * mvPosition;
}`;

const fragmentShader = `
varying vec3 vColor;
void main(){
  vec2 c = gl_PointCoord - vec2(0.5);
  if(length(c) > 0.5) discard;
  gl_FragColor = vec4(vColor,1.0);
}`;




function getThresholdHighlightSettings(){
  return {
    enabled: !!document.getElementById("useThresholdHighlight")?.checked,
    color: new THREE.Color(
      document.getElementById("thresholdHighlightColor")?.value || "#ff4d6d"
    )
  };
}

function parseSnpIdInput(text){
  return new Set(
    String(text || "")
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function getSnpIdHighlightSettings(){
  const ids = parseSnpIdInput(
    document.getElementById("snpIdList")?.value || ""
  );

  return {
    enabled: !!document.getElementById("useSnpIdHighlight")?.checked && ids.size > 0,
    ids,
    color: new THREE.Color(
      document.getElementById("snpIdHighlightColor")?.value || "#8b5cf6"
    )
  };
}

function resolveMarkerColor(marker, oddColor, evenColor, state = globalState){
  let color = (marker.chr % 2 === 1) ? oddColor : evenColor;

  const thresholdHighlight = state?.thresholdHighlight || getThresholdHighlightSettings();
  const snpIdHighlight = state?.snpIdHighlight || getSnpIdHighlightSettings();
  const thresholdValue = Number.isFinite(state?.lodLine)
    ? state.lodLine
    : +document.getElementById("lodLine").value;

  if(thresholdHighlight.enabled && marker.lod >= thresholdValue){
    color = thresholdHighlight.color;
  }

  if(snpIdHighlight.enabled && marker.snp && snpIdHighlight.ids.has(marker.snp)){
    color = snpIdHighlight.color;
  }

  const regions = state?.regions || getRegionHighlightSettings();
  for(const region of regions){
    if(marker.chr === region.chr &&
       marker.bp >= region.start &&
       marker.bp <= region.end){
      color = region.color;
    }
  }

  return color;
}


/* ================= multiple region highlights ================= */

function getRegionOptionHTML(chrMax = globalState.chrMax || {}){
  const options = ['<option value="">Select chromosome</option>'];
  Object.keys(chrMax)
    .map(Number)
    .sort((a,b)=>a-b)
    .forEach(chr=>{
      options.push(`<option value="${chr}">Chr${chr}</option>`);
    });
  return options.join("");
}

function renumberRegionRows(){
  document.querySelectorAll("#regionList .region-row").forEach((row, i)=>{
    const title = row.querySelector(".region-row-title");
    if(title) title.textContent = `Region ${i + 1}`;
    const removeBtn = row.querySelector(".removeRegionBtn");
    if(removeBtn) removeBtn.style.display = i === 0 ? "none" : "inline-flex";
  });
}

function syncRegionChrOptions(chrMax = globalState.chrMax || {}){
  document.querySelectorAll("#regionList .regionChr").forEach(select=>{
    const current = select.value;
    select.innerHTML = getRegionOptionHTML(chrMax);
    select.value = current;
  });
}

function createRegionHighlightRow(){
  const list = document.getElementById("regionList");
  const base = list.querySelector(".region-row");
  if(!base) return;

  const row = base.cloneNode(true);
  row.removeAttribute("id");

  row.querySelectorAll("[id]").forEach(el=>el.removeAttribute("id"));
  row.querySelectorAll("input").forEach(input=>{
    if(input.type === "checkbox") input.checked = false;
    else if(input.type === "color"){
      if(input.classList.contains("regionColor")) input.value = "#e11d48";
      if(input.classList.contains("lineColor")) input.value = "#10b981";
    } else {
      input.value = "";
    }
  });

  const select = row.querySelector(".regionChr");
  if(select){
    select.innerHTML = getRegionOptionHTML(globalState.chrMax || {});
    select.value = "";
  }

  list.appendChild(row);
  renumberRegionRows();
}

function getRegionHighlightSettings(){
  return Array.from(document.querySelectorAll("#regionList .region-row"))
    .map(row=>{
      const chr = parseInt(row.querySelector(".regionChr")?.value);
      const rawStart = +row.querySelector(".regionStart")?.value;
      const rawEnd = +row.querySelector(".regionEnd")?.value;
      const start = Math.min(rawStart, rawEnd);
      const end = Math.max(rawStart, rawEnd);
      const color = new THREE.Color(row.querySelector(".regionColor")?.value || "#e11d48");
      const lineColor = new THREE.Color(row.querySelector(".lineColor")?.value || "#10b981");
      const connect = !!row.querySelector(".drawLines")?.checked;

      return { chr, start, end, color, lineColor, connect };
    })
    .filter(region =>
      Number.isFinite(region.chr) &&
      Number.isFinite(region.start) &&
      Number.isFinite(region.end) &&
      region.start > 0 &&
      region.end > 0
    );
}

function refreshRegionHighlights(){
  // Region settings are intentionally applied only when Render is pressed.
  // This avoids slow real-time redraws while users are editing multiple regions.
}

function initRegionHighlightUI(){
  renumberRegionRows();

  const addBtn = document.getElementById("addRegionBtn");
  if(addBtn){
    addBtn.addEventListener("click", ()=>{
      createRegionHighlightRow();
    });
  }

  const list = document.getElementById("regionList");
  if(list){
    list.addEventListener("click", e=>{
      if(!e.target.classList.contains("removeRegionBtn")) return;
      const rows = list.querySelectorAll(".region-row");
      if(rows.length <= 1) return;
      e.target.closest(".region-row")?.remove();
      renumberRegionRows();
    });
  }
}

/* ================= CSV ================= */

function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split("\t"); // ← タブ区切りなら "\t"
  
  const idx = {
    snp: header.indexOf("SNP"),
    chr: header.indexOf("CHR"),
    bp:  header.indexOf("BP"),
    p:   header.indexOf("P")
  };

  return lines.slice(1).map(l=>{
    const f = l.split("\t");
    const pval = parseFloat(f[idx.p]);

    return {
      snp: idx.snp >= 0 ? String(f[idx.snp]).trim() : "",
      chr: parseInt(f[idx.chr]),
      bp:  parseFloat(f[idx.bp]),
      lod: pval
    };
  });
}



function computeChrMaxBP(datasets){
  const chrMax = {};
  datasets.flat().forEach(p=>{
    if(!chrMax[p.chr] || p.bp > chrMax[p.chr]){
      chrMax[p.chr] = p.bp;
    }
  });
  return chrMax;
}

function computeChrOffsets(chrMax){
  const offsets = {};
  let cumulative = 0;
  Object.keys(chrMax).map(Number).sort((a,b)=>a-b).forEach(chr=>{
    offsets[chr] = cumulative;
    cumulative += chrMax[chr];
  });
  return { offsets, totalLength: cumulative };
}

function computeChrOffsetsSelected(chrMax, selectedChrs){
  const offsets = {};
  let cumulative = 0;

  selectedChrs.forEach(chr=>{
    offsets[chr] = cumulative;
    cumulative += chrMax[chr];
  });

  return { offsets, totalLength: cumulative };
}


/* ================= chromosome filter ================= */

function buildDatasetUI(){
  const list = document.getElementById("datasetList");
  list.innerHTML = "";

  globalDatasets
    .sort((a,b)=>a.order-b.order)
    .forEach(ds=>{
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "4px";

      row.innerHTML = `
        <input type="checkbox" ${ds.enabled ? "checked":""}>
        <span style="flex:1; font-size:11px; overflow:hidden; text-overflow:ellipsis;">
          ${ds.name}
        </span>
        <button>▲</button>
        <button>▼</button>
      `;

      // ON / OFF
      row.querySelector("input").onchange = e=>{
        ds.enabled = e.target.checked;
        document.getElementById("renderBtn").click();
      };

      // 並び替え
      const [up, down] = row.querySelectorAll("button");

      up.onclick = ()=>{
        swapDatasetOrder(ds.order, ds.order-1);
        buildDatasetUI();
        document.getElementById("renderBtn").click();
      };
      down.onclick = ()=>{
        swapDatasetOrder(ds.order, ds.order+1);
        buildDatasetUI();
        document.getElementById("renderBtn").click();
      };

      list.appendChild(row);
    });
}

function swapDatasetOrder(a,b){
  const A = globalDatasets.find(d=>d.order===a);
  const B = globalDatasets.find(d=>d.order===b);
  if(!A || !B) return;
  [A.order, B.order] = [B.order, A.order];
}

// 染色体チェックボックスを生成
function buildChrCheckboxes(chrMax){
  const container = document.getElementById("chrFilter");
  container.innerHTML = "<label>表示する染色体</label>";

  Object.keys(chrMax)
    .map(Number)
    .sort((a,b)=>a-b)
    .forEach(chr=>{
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "4px";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = chr;
      cb.checked = true; // 初期状態は全表示

      const label = document.createElement("label");
      label.textContent = `Chr${chr}`;

      wrapper.appendChild(cb);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });

  syncRegionChrOptions(chrMax);
}

// チェックされている染色体番号を取得
function getSelectedChromosomes(){
  return Array.from(
    document.querySelectorAll("#chrFilter input[type=checkbox]:checked")
  ).map(cb => parseInt(cb.value));
}


/* ================= text ================= */

function makeTextSprite(message, fontSize, color = getThemeSettings().textColor){
  const RESOLUTION_SCALE = 4;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const drawSize = fontSize * RESOLUTION_SCALE;
  ctx.font = `${drawSize}px Arial`;
  const w = ctx.measureText(message).width;

  canvas.width = w + drawSize;
  canvas.height = drawSize * 1.5;

  ctx.font = `${drawSize}px Arial`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(message, drawSize*0.5, canvas.height/2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide
  });

  const aspect = canvas.width / canvas.height;
  const h = fontSize * 0.35;
  const w3 = h * aspect;

  return new THREE.Mesh(
    new THREE.PlaneGeometry(w3, h),
    material
  );
}

/* ================= axes ================= */


/* ================= 2D Manhattan ================= */

function draw2DManhattan(container, dataset, index, state, filename) {
  const W = container.clientWidth - 16;
  const H = 200;
  const PAD_L = state.axisOffset * 8 + 12;  // 左余白（Y軸＋数字）
  const PAD_B = state.axisOffset * 8 + 10;  // 下余白（X軸＋Chr）
  const PAD_T = 20;
  const PAD_R = 10;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const theme = state.theme || getThemeSettings();

  const {
    BP_SCALE,
    yScale,
    chrOffsetsSelected,
    selectedChrs,
    totalLengthSelected,
    oddColor,
    evenColor,
    labelSize,
    labelOffset,
    lodLine
  } = state;


  // ===== 2D 用：3D の 0.6 倍の軸ラベルサイズ =====
  const labelSize2D = 6;


  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xScale = plotW / (totalLengthSelected * BP_SCALE);
  const yMax = 10 * yScale;
  const yScalePx = plotH / yMax;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = theme.plotBackground;
  ctx.fillRect(0,0,W,H);

  /* ===== 軸 ===== */

  ctx.strokeStyle = theme.axisColor;
  ctx.lineWidth = 1;

  // X axis
  ctx.beginPath();
  ctx.moveTo(PAD_L, H-PAD_B);
  ctx.lineTo(W-PAD_R, H-PAD_B);
  ctx.stroke();

  // Y axis
  ctx.beginPath();
  ctx.moveTo(PAD_L, H-PAD_B);
  ctx.lineTo(PAD_L, PAD_T);
  ctx.stroke();

  ctx.font = `${labelSize2D}px sans-serif`;
  ctx.fillStyle = theme.textColor;

  /* ===== Y ticks & labels ===== */
  for(let l=0; l<=10; l+=2){
    const yVal = l * yScale;
    const y = H - PAD_B - yVal * yScalePx;

    ctx.beginPath();
    ctx.moveTo(PAD_L-5, y);
    ctx.lineTo(PAD_L, y);
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(l, PAD_L - 8, y);
  }

  /* ===== LOD line ===== */
  const lodY = H - PAD_B - lodLine * yScale * yScalePx;
  ctx.strokeStyle = theme.thresholdLineColor;
  ctx.setLineDash([4,3]);
  ctx.beginPath();
  ctx.moveTo(PAD_L, lodY);
  ctx.lineTo(W-PAD_R, lodY);
  ctx.stroke();
  ctx.setLineDash([]);

  /* ===== X ticks & Chr labels ===== */
  Object.keys(chrOffsetsSelected).map(Number).forEach(chr=>{
    const x = PAD_L + chrOffsetsSelected[chr] * BP_SCALE * xScale;

    ctx.beginPath();
    ctx.moveTo(x, H-PAD_B);
    ctx.lineTo(x, H-PAD_B+5);
    ctx.stroke();

    const chrCenter =
      (chrOffsetsSelected[chr] +
       state.chrMax[chr]/2) * BP_SCALE * xScale + PAD_L;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`Chr${chr}`, chrCenter, H-PAD_B + 6);
  });

  /* ===== SNP ===== */
dataset.forEach(p=>{
  if(!selectedChrs.includes(p.chr)) return;

  const x = PAD_L + (chrOffsetsSelected[p.chr] + p.bp) * BP_SCALE * xScale;
  const y = H - PAD_B - p.lod * yScale * yScalePx;

  let color = resolveMarkerColor(p, oddColor, evenColor, state).getStyle();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, Math.PI*2);
  ctx.fill();
});


  /* ===== タイトル ===== */
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "12px sans-serif";
  ctx.fillStyle = theme.textColor;
  ctx.font = "11px sans-serif";
ctx.fillStyle = theme.titleBackground;
ctx.fillRect(PAD_L-4, 0, ctx.measureText(filename).width+8, 16);

ctx.fillStyle = theme.textColor;
ctx.fillText(filename, PAD_L, 2);

  const wrap = document.createElement("div");
  wrap.className = "manhattan2d";
  wrap.appendChild(canvas);
  container.appendChild(wrap);
}


function drawAxes(
  numDatasets,
  zSpacing,
  labelSize,
  axisOffset,
  labelOffset,
  chrMax,
  chrOffsets,
  totalLengthSelected,
  BP_SCALE,
  yScale,
  lodLine
){
  axisGroup.clear();
  const theme = globalState.theme || getThemeSettings();
  const axisLineColor = new THREE.Color(theme.axisColor);
  const thresholdLineColor = new THREE.Color(theme.thresholdLineColor);

  const BASE_Y_MAX = 10;   // LODの最大表示値（論理）
  const yMax = BASE_Y_MAX * yScale;
  const totalLength = totalLengthSelected * BP_SCALE;

  const chrList = Object.keys(chrMax).map(Number).sort((a,b)=>a-b);
  const lodY = lodLine * yScale;

  for(let d=0; d<numDatasets; d++){
    const z = (d-(numDatasets-1)/2)*zSpacing;

    /* ----- X axis ----- */
    axisGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -axisOffset, z),
        new THREE.Vector3(totalLength, -axisOffset, z)
      ]),
      new THREE.LineBasicMaterial({color: axisLineColor})
    ));

    /* ----- X ticks (下向き) ----- */
    const X_TICK_LENGTH = 0.6;   // 下向きの目盛り線の長さ
    const X_LABEL_OFFSET = 0.8;  // 数字をさらに下に出す距離

        // 染色体ごとに「区切り位置」に目盛りを付ける
        Object.keys(chrOffsets).map(Number).sort((a,b)=>a-b).forEach(chr=>{
        const x = chrOffsets[chr] * BP_SCALE;

        // --- 目盛り線（下向き） ---
        axisGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, -axisOffset, z),                       // 軸上
            new THREE.Vector3(x, -axisOffset - X_TICK_LENGTH, z)        // 下向き
            ]),
            new THREE.LineBasicMaterial({ color: axisLineColor })
        ));
    });

    /* ----- Y axis ----- */
    axisGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-axisOffset, 0, z),
        new THREE.Vector3(-axisOffset, yMax, z)
      ]),
      new THREE.LineBasicMaterial({color: axisLineColor})
    ));

    /* ----- Y ticks (外向き) ----- */
    const TICK_LENGTH = 0.6; // 目盛り線の長さ（外向き）

    for(let l = 0; l <= BASE_Y_MAX; l += 2){
    const y = l * yScale;

        // --- 目盛り線（Y軸から外側へ） ---
        axisGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-axisOffset, y, z),                 // 軸上
            new THREE.Vector3(-axisOffset - TICK_LENGTH, y, z)    // 外側
            ]),
            new THREE.LineBasicMaterial({ color: axisLineColor })
        ));

        // --- 数値ラベル（さらに外側） ---
        const lbl = makeTextSprite(String(l), labelSize, theme.textColor);
        lbl.position.set(
            -axisOffset - TICK_LENGTH - labelOffset,
            y,
            z
        );
        axisGroup.add(lbl);
    }
    /* ----- LOD threshold ----- */
    axisGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, lodY, z),
            new THREE.Vector3(totalLength, lodY, z)
        ]),
        new THREE.LineBasicMaterial({
            color: thresholdLineColor,
            linewidth: 1   // 見た目用（後で太さはBox化）
        })
    ));

    /* ----- Chromosome labels & boundaries ----- */
    chrList.forEach(chr=>{
      const start = chrOffsets[chr];
      const end   = chrOffsets[chr] + chrMax[chr];
      const center = (start + end) / 2 * BP_SCALE;
      const xStart = start * BP_SCALE;

      // Chr label
      const chrLbl = makeTextSprite(`Chr${chr}`, labelSize, theme.textColor);
      chrLbl.position.set(center, -axisOffset - labelOffset, z);
      axisGroup.add(chrLbl);

    });
  }
}

let chrCheckboxInitialized = false;



function applyStyle(){
  if(!points || !geometry) return;

  const zSpacing   = +document.getElementById("zSpacing").value;
  const pointSize  = +document.getElementById("pointSize").value;
  const yScale     = +document.getElementById("yScale").value;
  const labelSize  = +document.getElementById("labelSize").value;
  const axisOffset = +document.getElementById("axisOffset").value;
  const labelOffset= +document.getElementById("labelOffset").value;
  const lodLine    = +document.getElementById("lodLine").value;

  const oddColor  = new THREE.Color(
    document.getElementById("oddColor").value
  );
  const evenColor = new THREE.Color(
    document.getElementById("evenColor").value
  );

  /* ===== Point size ===== */
  points.material.uniforms.pointSize.value = pointSize;

  /* ===== Chromosome colors ===== */
  const colAttr = geometry.getAttribute("color");
  const meta = points.userData.meta;

 meta.forEach((m,i)=>{
  const c = resolveMarkerColor(m, oddColor, evenColor, globalState);
  colAttr.setXYZ(i, c.r, c.g, c.b);
});
colAttr.needsUpdate = true;
  colAttr.needsUpdate = true;


  /* ===== Z spacing & Y-scale ===== */
  const posAttr = geometry.getAttribute("position");
  
  const numDatasets = globalActiveDatasets.length;

  let idx = 0;
  globalActiveDatasets.forEach((ds,d)=>{
    const z = (d-(numDatasets-1)/2) * zSpacing;
    ds.data.forEach(p=>{
      if(!globalState.selectedChrs.includes(p.chr)) return;

      // Z
      posAttr.setZ(idx, z);

      // Y（lod × yScale）
      posAttr.setY(idx, meta[idx].lod * yScale);

      idx++;
    });
  });

  posAttr.needsUpdate = true;



  /* ===== Axis ===== */
  globalState.zSpacing = zSpacing;
  globalState.yScale = yScale;
  globalState.labelSize = labelSize;
  globalState.axisOffset = axisOffset;
  globalState.labelOffset = labelOffset;
  globalState.lodLine = lodLine;
  globalState.oddColor = oddColor;
  globalState.evenColor = evenColor;
  applyTheme();
  globalState.theme = getThemeSettings();
  globalState.thresholdHighlight = getThresholdHighlightSettings();
  globalState.snpIdHighlight = getSnpIdHighlightSettings();

  drawAxes(
    globalActiveDatasets.length,
    zSpacing,
    labelSize,
    axisOffset,
    labelOffset,
    globalState.chrMax,
    globalState.chrOffsetsSelected,
    globalState.totalLengthSelected,
    globalState.BP_SCALE,
    yScale,
    lodLine
  );

  applyRegionOnly();

  /* ===== 2D 再描画 ===== */
  const panel2d = document.getElementById("panel2d");
  panel2d.innerHTML = "";
  globalActiveDatasets.forEach(ds=>{
    draw2DManhattan(panel2d, ds.data, 0, globalState, ds.name);
  });
}


/* ================= render ================= */

document.getElementById("renderBtn").onclick = async ()=>{



  const files = document.getElementById("csvInput").files;
  lineGroup.clear();

  if(files.length === 0) return;

  const BP_SCALE = 1e-6; // 1 Mb = 1 unit




  if(points){
    sceneGroup.remove(points);
    points.material.dispose();
    geometry.dispose();
  }

    const zSpacing   = +document.getElementById("zSpacing").value;
    const pointSize  = +document.getElementById("pointSize").value;
    const yScale    = +document.getElementById("yScale").value;
    const labelSize  = +document.getElementById("labelSize").value;
    const axisOffset = +document.getElementById("axisOffset").value;
    const labelOffset= +document.getElementById("labelOffset").value;
    const lodLine = +document.getElementById("lodLine").value;
    const oddColor   = new THREE.Color(
    document.getElementById("oddColor").value
    );
    const evenColor  = new THREE.Color(
    document.getElementById("evenColor").value
    );
    const activeDatasets = globalDatasets
  .filter(d => d.enabled)
  .sort((a,b) => a.order - b.order);

if(activeDatasets.length === 0) return;
globalActiveDatasets = activeDatasets;










buildDatasetUI();





  const chrMax = computeChrMaxBP(
  activeDatasets.map(d => d.data)
);

  if(!chrCheckboxInitialized){
    buildChrCheckboxes(chrMax);
    chrCheckboxInitialized = true;
  }
  const selectedChrs = getSelectedChromosomes();


const {
  offsets: chrOffsetsSelected,
  totalLength: totalLengthSelected
} = computeChrOffsetsSelected(chrMax, selectedChrs);

globalState = {
  BP_SCALE,
  zSpacing,
  yScale,
  oddColor,
  evenColor,
  thresholdHighlight: getThresholdHighlightSettings(),
  snpIdHighlight: getSnpIdHighlightSettings(),
  regions: getRegionHighlightSettings(),

  labelSize,
  axisOffset,
  labelOffset,
  lodLine,

  chrOffsetsSelected,
  selectedChrs,
  totalLengthSelected,
  chrMax,
  theme: getThemeSettings(),


};





    drawAxes(
    activeDatasets.length,
    zSpacing,
    labelSize,
    axisOffset,
    labelOffset,
    chrMax,
    chrOffsetsSelected,
    totalLengthSelected,
    BP_SCALE,
    yScale,
    lodLine 
    );





const total = activeDatasets.reduce((sum, ds)=>{
  return sum + ds.data.filter(p => selectedChrs.includes(p.chr)).length;
}, 0);

  const pos = new Float32Array(total*3);
  const col = new Float32Array(total*3);
  const meta = [];   // ← 追加（chr, bp）





  let i=0;
activeDatasets.forEach((ds,d)=>{
  const z = (d-(activeDatasets.length-1)/2)*zSpacing;
  ds.data.forEach(p=>{

      if(!selectedChrs.includes(p.chr)) return;
      pos[i*3] = (chrOffsetsSelected[p.chr] + p.bp) * BP_SCALE;
      pos[i*3+1] = p.lod * yScale;
      pos[i*3+2] = z;

      const c = resolveMarkerColor(p, oddColor, evenColor, globalState);
      col[i*3] = c.r;
      col[i*3+1] = c.g;
      col[i*3+2] = c.b;

      meta.push({ snp: p.snp, chr: p.chr, bp: p.bp, lod: p.lod });  // ←【追加】
      i++;
    });
  });

  geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos,3));
  geometry.setAttribute("color", new THREE.BufferAttribute(col,3));

  points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms:{ pointSize:{value:pointSize} }
    })
  );

  points.userData.meta = meta;

  sceneGroup.add(points);
  // ===== 2D Manhattan =====
const panel2d = document.getElementById("panel2d");
panel2d.innerHTML = "";

globalState.chrOffsetsSelected = chrOffsetsSelected;
globalState.selectedChrs = selectedChrs;
globalState.totalLengthSelected = totalLengthSelected;
globalState.chrMax = chrMax;


globalActiveDatasets.forEach((ds, i)=>{
  draw2DManhattan(panel2d, ds.data, i, globalState, ds.name);
});



  const LEFT_MARGIN = 0; // ← ★ ここだけ触る（単位 = Mb）
  sceneGroup.position.x =  -(totalLengthSelected * BP_SCALE) / 2 - LEFT_MARGIN;
  //sceneGroup.position.z =  200
  //sceneGroup.position.x = 200;



  csvCount.textContent = files.length;
  snpCount.textContent = total.toLocaleString();
  applyRegionOnly();   // ← ①で作ったやつ
  applyStyle();        // ← ②で追加したやつ
};







function applyRegionOnly(){
  if(!points || !geometry) return;

  lineGroup.clear();
  const regions = globalState.regions || [];

  const meta = points.userData.meta;
  const posAttr = geometry.getAttribute("position");

  const numDatasets = globalActiveDatasets.length || +csvCount.textContent;
  const zSpacing = +document.getElementById("zSpacing").value;

  regions.forEach(region=>{
    if(!region.connect) return;

    const snpMap = new Map();

    meta.forEach((m,i)=>{
      if(m.chr === region.chr && m.bp >= region.start && m.bp <= region.end){
        const z = posAttr.getZ(i);
        const d = Math.round(z / zSpacing + (numDatasets-1)/2);
        const key = `${m.chr}_${m.bp}`;

        if(!snpMap.has(key)) snpMap.set(key, []);
        snpMap.get(key).push({
          x: posAttr.getX(i),
          y: posAttr.getY(i),
          z,
          d
        });
      }
    });

    snpMap.forEach(list=>{
      if(list.length < 2) return;
      list.sort((a,b)=>a.d-b.d);

      const curve = new THREE.CatmullRomCurve3(
        list.map(p => new THREE.Vector3(p.x, p.y, p.z))
      );

      const radius = 0.2;
      const tubeGeom = new THREE.TubeGeometry(
        curve,
        64,
        radius,
        8,
        false
      );

      const tubeMat = new THREE.MeshBasicMaterial({
        color: region.lineColor
      });

      lineGroup.add(new THREE.Mesh(tubeGeom, tubeMat));
    });
  });
}



document.getElementById("panVertical").addEventListener("input", (e)=>{
  cameraPanState.vertical = +e.target.value;
  applyCameraPan();
});

const themeToggle = document.getElementById("themeToggle");
if(themeToggle){
  themeToggle.addEventListener("change", refreshThemeOnly);
}

document.getElementById("panHorizontal").addEventListener("input", (e)=>{
  cameraPanState.horizontal = +e.target.value;
  applyCameraPan();
});


/*
  Threshold line / threshold highlight / SNP ID highlight are intentionally
  NOT updated in real time. Their current UI values are read and applied only
  when the Render button is pressed. This avoids expensive redraws while users
  are typing SNP IDs or adjusting highlight settings.
*/

initRegionHighlightUI();
applyCameraPan();



/* ================= interaction ================= */

let drag=false, prev={x:0,y:0}, rot={x:0,y:0};

canvas.addEventListener("mousedown",e=>{
  drag=true;
  prev={x:e.clientX,y:e.clientY};
});

canvas.addEventListener("mousemove",e=>{
  if(drag){
    rot.y += (e.clientX-prev.x)*0.005;
    rot.x += (e.clientY-prev.y)*0.005;
    prev={x:e.clientX,y:e.clientY};
  }
});

canvas.addEventListener("mouseup",()=>drag=false);

canvas.addEventListener("wheel",e=>{
  e.preventDefault();
  camera.position.z += e.deltaY * 0.3;
  camera.position.z = Math.max(40, Math.min(2000, camera.position.z));
  applyCameraPan();
},{ passive:false });

function animate(){
  requestAnimationFrame(animate);
  sceneGroup.rotation.x = rot.x;
  sceneGroup.rotation.y = rot.y;
  //camera.lookAt(sceneGroup.position);
  renderer.render(scene,camera);
}
animate();

window.addEventListener("resize", resizeRenderer);



async function exportPDF(){
  const { jsPDF } = window.jspdf;

  // 念のため再描画
  renderer.render(scene, camera);

  const imgData = canvas.toDataURL("image/png", 1.0);

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [canvas.width, canvas.height]
  });

  pdf.addImage(
    imgData,
    "PNG",
    0,
    0,
    canvas.width,
    canvas.height
  );

  pdf.save("manhattan-3d.pdf");
}


document.getElementById("exportBtn").onclick = async ()=>{
  const format = document.getElementById("exportFormat").value;

  // 一度描画を確実に更新
  renderer.render(scene, camera);

  if(format === "png" || format === "jpg"){
    exportRaster(format);
  }
  else if(format === "pdf"){
    await exportPDF();
  }
  else if(format === "svg"){
    exportSVGInfo();
  }
};


function exportRaster(format){
  const scale = EXPORT_SCALE;

  const prevPixelRatio = renderer.getPixelRatio();
  const prevSize = renderer.getSize(new THREE.Vector2());

  // 🔹 元の pointSize を保存
  const material = points.material;
  const prevPointSize = material.uniforms.pointSize.value;

  // 🔹 解像度分だけ点を大きくする
  material.uniforms.pointSize.value = prevPointSize * scale;

  // 解像度アップ
  renderer.setPixelRatio(prevPixelRatio * scale);
  renderer.render(scene, camera);

  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  const dataURL = renderer.domElement.toDataURL(mime, 1.0);

  // ダウンロード
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = `manhattan-3d_${scale}x.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 🔹 元に戻す
  material.uniforms.pointSize.value = prevPointSize;
  renderer.setPixelRatio(prevPixelRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);

  renderer.render(scene, camera);
}

/* ================= hover tooltip for SNP / P value ================= */

// ツールチップ本体をJSで生成（HTML/CSSは変更しない）
const hoverTooltip = document.createElement("div");
hoverTooltip.style.position = "fixed";
hoverTooltip.style.zIndex = "9999";
hoverTooltip.style.pointerEvents = "none";
hoverTooltip.style.padding = "8px 10px";
hoverTooltip.style.borderRadius = "8px";
hoverTooltip.style.background = "rgba(17, 24, 39, 0.92)";
hoverTooltip.style.color = "#ffffff";
hoverTooltip.style.fontSize = "12px";
hoverTooltip.style.lineHeight = "1.45";
hoverTooltip.style.boxShadow = "0 4px 14px rgba(0,0,0,0.18)";
hoverTooltip.style.whiteSpace = "nowrap";
hoverTooltip.style.display = "none";
document.body.appendChild(hoverTooltip);

// Raycaster
const hoverRaycaster = new THREE.Raycaster();
const hoverMouse = new THREE.Vector2();

// 点群のヒット判定のしやすさ
hoverRaycaster.params.Points.threshold = 3.5;

// hover中はドラッグ回転と干渉させないため、最後に当たったindexを保持
let hoveredPointIndex = -1;

function formatPValue(v){
  if (v === null || v === undefined || Number.isNaN(v)) return "NA";
  // 非常に小さい値にも対応
  if (Math.abs(v) < 1e-4 || Math.abs(v) >= 1e4) {
    return Number(v).toExponential(3);
  }
  return String(v);
}

function showHoverTooltip(clientX, clientY, meta){
  hoverTooltip.innerHTML = `
    <div><strong>Marker</strong>: ${meta.snp || "(no SNP ID)"}</div>
    <div><strong>P</strong>: ${formatPValue(meta.lod)}</div>
    <div><strong>Chr</strong>: ${meta.chr}</div>
    <div><strong>BP</strong>: ${meta.bp}</div>
  `;

  const offsetX = 14;
  const offsetY = 14;
  hoverTooltip.style.left = `${clientX + offsetX}px`;
  hoverTooltip.style.top  = `${clientY + offsetY}px`;
  hoverTooltip.style.display = "block";
}

function hideHoverTooltip(){
  hoverTooltip.style.display = "none";
  hoveredPointIndex = -1;
}

canvas.addEventListener("mousemove", (e) => {
  // 点がまだ無ければ何もしない
  if (!points || !geometry || !points.userData?.meta) {
    hideHoverTooltip();
    return;
  }

  // ドラッグ中はツールチップ非表示
  if (drag) {
    hideHoverTooltip();
    return;
  }

  const rect = canvas.getBoundingClientRect();

  hoverMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  hoverMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  hoverRaycaster.setFromCamera(hoverMouse, camera);

  const intersects = hoverRaycaster.intersectObject(points);

  if (!intersects || intersects.length === 0) {
    hideHoverTooltip();
    return;
  }

  const hit = intersects[0];
  const idx = hit.index;

  if (idx === undefined || idx === null) {
    hideHoverTooltip();
    return;
  }

  const meta = points.userData.meta[idx];
  if (!meta) {
    hideHoverTooltip();
    return;
  }

  hoveredPointIndex = idx;
  showHoverTooltip(e.clientX, e.clientY, meta);
});

canvas.addEventListener("mouseleave", () => {
  hideHoverTooltip();
});

canvas.addEventListener("mousedown", () => {
  hideHoverTooltip();
});

window.addEventListener("scroll", () => {
  hideHoverTooltip();
});