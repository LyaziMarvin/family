// -------- Auth bootstrap --------
const token = localStorage.getItem('token');
if (!token) { window.location.href = "login.html"; }

let __currentUser = null;
let __currentRecordId = null;

async function loadCurrentUser() {
  try {
    const r = await window.api.getCurrentUser(token);
    if (r?.success && r.data) { __currentUser = r.data; }
  } catch (_) {}
  return __currentUser;
}

function logout() {
  try { window.api.logout?.(); } catch (e) {}
  if (slmProbeTimer) { clearInterval(slmProbeTimer); slmProbeTimer = null; }
  localStorage.clear();
  window.location.href = "login.html";
}

// -------- Inline notices (uploads) --------
function showRecordMessage(type, text) {
  const el = document.getElementById('recordMessage');
  if (!el) return;
  const color = type === 'success' ? '#0a7b34' : (type === 'danger' ? '#8c1c13' : '#3a3a3a');
  el.innerHTML = `<div style="padding:6px 10px;border-radius:6px;background:#f7f7f7;color:${color};border:1px solid rgba(0,0,0,08)">${text}</div>`;
  setTimeout(() => { if (el.textContent && el.textContent.includes(text)) el.innerHTML = ''; }, 4000);
}

// -------- Ollama status --------
let slmActive = false;
let slmProbeTimer = null;

function updateSLMStatus() {
  const a = document.getElementById("slmArrow");
  const t = document.getElementById("slmText");
  if (slmActive) { a.textContent = "🟢"; t.textContent = "Ollama Active"; }
  else { a.textContent = "🔴"; t.textContent = "Ollama Inactive"; }
}

async function probeOllama() {
  const arrow = document.getElementById("slmArrow");
  const text  = document.getElementById("slmText");
  try {
    text.textContent = "Checking...";
    const status = await window.api.getOllamaStatus();
    slmActive = !!status?.running;
    if (slmActive) {
      arrow.textContent = "🟢";
      text.textContent  = `Ollama${status.version ? " v" + status.version : ""} running`;
    } else {
      arrow.textContent = "🔴";
      text.textContent  = "Ollama not reachable";
    }
  } catch (e) {
    slmActive = false;
    arrow.textContent = "❌";
    text.textContent  = "Check failed";
  }
  updateSLMStatus();
}

async function startOllamaWatch() {
  try { await window.api.ensureOllamaStarted(); } catch (_) {}
  await probeOllama();
  if (slmProbeTimer) clearInterval(slmProbeTimer);
  slmProbeTimer = setInterval(probeOllama, 2000);
}

document.getElementById("slmToggleBtn").hidden = false;
document.getElementById("slmToggleBtn").textContent = "Recheck Ollama";
document.getElementById("slmToggleBtn").onclick = probeOllama;

updateSLMStatus();

// -------- Section switching --------
function showSection(id) {
  document.querySelectorAll('.section').forEach(div => div.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');

  const titles = {
    dashboard: "🏠 Dashboard",
    profile: "🙍‍♂️ User Profile",
    upload: "📄 Shared Documents",
    installedAgents: "🧠 Installed Agents",
    qa: "💬 Ask a Question"
  };
  document.getElementById("sectionTitle").textContent = titles[id] || id;

  if (id === 'installedAgents') {
    loadAgentTemplates();
    document.getElementById("agentFeatureContent").textContent = "Select a feature to view its details.";
  }
  if (id === 'upload') loadDocumentRecords();
  if (id === 'profile') loadProfile();
  if (id === 'qa') {
    applyModelUIFromStorage();
    prepareScopePickerOnEnterQA();
    updateCollectionBadge();
  }
}

// -------- Profile --------
async function loadProfile() {
  const el = document.getElementById("profileDetails");
  el.textContent = '⏳ Loading.';
  try {
    const r = await window.api.getCurrentUser(token);
    if (r && r.success) {
      const u = r.data || {};
      __currentUser = u;
      updateCollectionBadge();

      el.innerHTML = `
        <div class="d-flex align-items-center gap-3">
          <img src="${u.profile_photo_path ? `file://${u.profile_photo_path}` : ''}" 
               alt="Profile photo" 
               style="width:48px;height:48px;border-radius:50%;object-fit:cover;${u.profile_photo_path ? '' : 'display:none;'}"
               id="profileDetailsPhoto">
          <div>
            <div><strong>${u.name || 'Unnamed User'}</strong></div>
            <div class="small-muted">${u.email || 'N/A'}</div>
          </div>
        </div>
      `;

      const form = document.getElementById("profileForm");
      form.style.display = 'block';

      document.getElementById("profileEmail").value   = u.email || '';
      document.getElementById("profileName").value    = u.name || '';
      document.getElementById("profilePhone").value   = u.phone || '';
      document.getElementById("profileDob").value     = u.dob || '';
      document.getElementById("profileAge").value     = (u.age ?? '') === null ? '' : (u.age ?? '');
      document.getElementById("profileGender").value  = u.gender || '';
      document.getElementById("profileAddress").value = u.address || '';

      const preview = document.getElementById("profilePhotoPreview");
      if (u.profile_photo_path) { preview.src = `file://${u.profile_photo_path}`; preview.style.display = ''; }
      else { preview.style.display = 'none'; }

      document.getElementById("profileDob").addEventListener("change", () => {
        const dobStr = document.getElementById("profileDob").value;
        const ageInput = document.getElementById("profileAge");
        if (dobStr) {
          const today = new Date();
          const [y,m,d] = dobStr.split('-').map(Number);
          if (y && m && d) {
            let age = today.getFullYear() - y;
            const bd = new Date(y, m - 1, d);
            const hasHadBirthday = (today.getMonth() > bd.getMonth()) ||
                                   (today.getMonth() === bd.getMonth() && today.getDate() >= bd.getDate());
            if (!hasHadBirthday) age -= 1;
            ageInput.value = Math.max(0, age);
          }
        }
      });

      document.getElementById("profilePhoto").addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) {
          const src = file.path ? `file://${file.path}` : URL.createObjectURL(file);
          preview.src = src;
          preview.style.display = '';
        }
      });

      document.getElementById("saveProfileBtn").onclick = async () => {
        const updatedData = {
          email:   document.getElementById("profileEmail").value.trim(),
          name:    document.getElementById("profileName").value.trim(),
          phone:   document.getElementById("profilePhone").value.trim(),
          dob:     document.getElementById("profileDob").value || null,
          age:     document.getElementById("profileAge").value,
          gender:  document.getElementById("profileGender").value || null,
          address: document.getElementById("profileAddress").value.trim(),
        };

        const photoFile = document.getElementById("profilePhoto").files?.[0];
        if (photoFile && photoFile.path) updatedData.photoPath = photoFile.path;

        if (updatedData.age === '' || isNaN(Number(updatedData.age))) {
          updatedData.age = null;
        } else {
          updatedData.age = Number(updatedData.age);
        }

        const saveEl = document.getElementById("saveStatus");
        saveEl.textContent = 'Saving...';

        try {
          let res = null;
          if (window.api?.updateUserProfile) {
            res = await window.api.updateUserProfile(updatedData, token);
          } else if (window.api?.updateCurrentUser) {
            res = await window.api.updateCurrentUser(token, updatedData);
          } else if (window.api?.updateProfile) {
            res = await window.api.updateProfile(token, updatedData);
          } else if (window.api?.saveProfile) {
            res = await window.api.saveProfile(token, updatedData);
          } else {
            throw new Error("No update method found (updateUserProfile / updateCurrentUser / updateProfile / saveProfile).");
          }

          if (res && res.success) {
            saveEl.textContent = '✅ Saved successfully!';
            const nu = res.data || {};
            __currentUser = nu;
            updateCollectionBadge();
            const detailsImg = document.getElementById('profileDetailsPhoto');
            if (nu.profile_photo_path) {
              detailsImg.src = `file://${nu.profile_photo_path}`;
              detailsImg.style.display = '';
              preview.src = `file://${nu.profile_photo_path}`;
              preview.style.display = '';
            }
          } else {
            saveEl.textContent = `❌ ${(res && res.error) || 'Failed to save.'}`;
          }
        } catch (e) {
          saveEl.textContent = `❌ ${e.message || 'Error'}`;
        } finally {
          setTimeout(() => (saveEl.textContent = ''), 4000);
        }
      };
    } else {
      el.textContent = `❌ ${(r && r.error) || 'Failed to load profile.'}`;
    }
  } catch (err) {
    el.textContent = `❌ ${err.message || 'Failed to load profile.'}`;
  }
}

// -------- Uploads (docs/photos/music) --------
function selectUploadTab(tabId) {
  document.querySelectorAll('.upload-tab').forEach(t => t.classList.remove('active'));
  const el = document.getElementById(tabId);
  if (el) el.classList.add('active');
  if (tabId === 'photos') loadUploadedPhotos();
  if (tabId === 'music') loadUploadedMusic();
}

function showAutoSummary(text) {
  const box = document.getElementById('autoSummaryBox');
  const txt = document.getElementById('autoSummaryText');
  if (!box || !txt) return;
  txt.textContent = text || 'No summary available.';
  box.style.display = '';
  box.style.transition = 'transform 220ms ease, box-shadow 220ms ease, opacity 220ms ease';
  box.style.transform = 'translateY(-6px)';
  box.style.opacity = '0.98';
  setTimeout(() => {
    box.style.transform = '';
    setTimeout(() => {
      box.style.opacity = '0';
      setTimeout(() => { box.style.display = 'none'; box.style.opacity = ''; }, 220);
    }, 12000);
  }, 10);
}

async function runAutoSummaryAtStartup() {
  if (!token) return;
  try {
    const q = "What is the main topic of this document?";
    const res = await window.api.askQuestionOn(q, token, { type: 'latest' });
    if (res && res.success && res.answer) {
      showAutoSummary(res.answer);
      const ans = document.getElementById('answer');
      if (ans && !document.getElementById('qa').classList.contains('hidden')) {
        ans.innerHTML = `<b>System summary:</b>\n\n${res.answer}`;
      }
    }
  } catch (e) {
    console.warn('Auto-summary startup failed:', e);
  }
}

async function handleUpload() {
  const docInput = document.getElementById("docUpload");
  const doc = docInput?.files?.[0];
  const statusEl = document.getElementById("uploadStatus");
  if (!token || !doc) {
    statusEl.textContent = "❌ Please log in and select a document.";
    return;
  }

  const okMime = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ];
  const name = (doc.name || "").toLowerCase();
  const byExt = name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx");
  const byMime = okMime.includes(doc.type);
  if (!byExt && !byMime) {
    statusEl.textContent = "❌ Only .pdf, .doc, or .docx files are allowed.";
    return;
  }

  statusEl.textContent = '⏳ Uploading...';
  try {
    const res = await window.api.uploadFiles({ docPath: doc.path, photoPaths: [], musicPaths: [], token });
    statusEl.textContent = res && res.success ? "✅ Import successful" : `❌ ${(res && res.error) || 'Upload failed.'}`;

    if (res && res.success) {
      await loadDocumentRecords();
      if (document.getElementById('scopeSelected')) { refreshScopeFiles(); }

      // Auto-summary after upload
      try {
        const recordId = res.data && res.data.recordId;
        if (recordId) {
          const q = "What is the main topic of this document?";
          const streamScope = { type: 'ids', ids: [recordId] };
          try {
            const done = await startAskStream(q, streamScope);
            if (!done || done.error) {
              showRecordMessage('danger', `Auto-summary failed: ${done?.error || 'unknown'}`);
            } else {
              showRecordMessage('success', 'System auto-summary ready.');
            }
          } catch (e) {
            console.warn('Auto-summary (stream) after upload failed:', e);
          }
        } else {
          runAutoSummaryAtStartup();
        }
      } catch (e) {
        console.warn('Auto-summary after upload failed:', e);
      }
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Upload failed.'}`;
  }
}
document.getElementById("docUpload").addEventListener("change", handleUpload);

async function loadDocumentRecords() {
  const c = document.getElementById("recordItems");
  c.innerHTML = '<div class="small-muted">⏳ Loading records.</div>';
  try {
    const res = await window.api.getAllRecords(token);
    c.innerHTML = '';
    if (!res || !res.success || !Array.isArray(res.data) || res.data.length === 0) {
      c.innerHTML = '<div class="text-muted">No files found.</div>';
      document.getElementById("selectedFileMeta").textContent = '';
      document.getElementById("extractedText").textContent = '';
      document.getElementById("regenTopicBtn").disabled = true;
      __currentRecordId = null;
      return;
    }

    res.data.forEach(r => {
      const row = document.createElement("div");
      row.className = "record-item";
      row.dataset.id = r.id;

      // LEFT: icon + filename ONLY (topic not inline)
      const left = document.createElement("div");
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '8px';
      left.innerHTML = `<span aria-hidden="true">📄</span> <span>${r.file_name || ('Record ' + r.id)}</span>`;

      const right = document.createElement("div");
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '10px';

      const date = document.createElement("small");
      date.className = 'small-muted';
      date.textContent = r.uploaded_at || '';

      const delBtn = document.createElement("button");
      delBtn.type = 'button';
      delBtn.className = 'btn btn-sm btn-outline-danger';
      delBtn.title = 'Delete this file';
      delBtn.setAttribute('aria-label', 'Delete imported file');
      delBtn.textContent = '🗑️';

      delBtn.onclick = (e) => {
        e.stopPropagation();
        inlineConfirm(
          right,
          `Delete "${r.file_name || ('Record ' + r.id)}"? This cannot be undone.`,
          async () => {
            try {
              delBtn.disabled = true;
              delBtn.textContent = '…';
              const delRes = await window.api.deleteRecord(r.id, token);
              if (delRes && delRes.success) {
                const metaEl = document.getElementById("selectedFileMeta");
                if (metaEl.textContent && metaEl.textContent.startsWith(r.file_name || `Record ${r.id}`)) {
                  metaEl.textContent = '';
                  document.getElementById("extractedText").textContent = '';
                  document.getElementById("regenTopicBtn").disabled = true;
                  __currentRecordId = null;
                }
                showRecordMessage('success', '✅ File deleted.');
                await loadDocumentRecords();
                if (document.getElementById('scopeSelected')) { refreshScopeFiles(); }
              } else {
                showRecordMessage('danger', `❌ Failed to delete: ${(delRes && delRes.error) || 'Unknown error'}`);
                delBtn.disabled = false;
                delBtn.textContent = '🗑️';
              }
            } catch (err) {
              showRecordMessage('danger', `❌ Error: ${err.message || 'Failed to delete'}`);
              delBtn.disabled = false;
              delBtn.textContent = '🗑️';
            }
          },
          () => { showRecordMessage('info', 'Deletion cancelled.'); }
        );
      };

      right.appendChild(date);
      right.appendChild(delBtn);

      row.appendChild(left);
      row.appendChild(right);

      row.onclick = async () => {
        try {
          const s = await window.api.getRecordById(r.id, token);
          const m = document.getElementById("selectedFileMeta");
          const t = document.getElementById("extractedText");
          if (!s || !s.success) { m.textContent = ''; t.textContent = '❌ Failed to load text.'; return; }
          const fl = s.data.file_name || r.file_name || `Record ${r.id}`;
          const dl = s.data.uploaded_at || r.uploaded_at || '';
          m.textContent = `${fl}${dl ? ' • ' + dl : ''}`;
          const topic = s.data.topic && String(s.data.topic).trim();
          t.textContent = topic || '(No topic yet)';
          __currentRecordId = r.id;
          document.getElementById("regenTopicBtn").disabled = false;
        } catch (err) {
          document.getElementById("extractedText").textContent = `❌ ${err.message || 'Error'}`;
        }
      };

      c.appendChild(row);
    });
  } catch (err) {
    c.innerHTML = `<div class="text-danger">❌ ${(err && err.message) || 'Failed to load records.'}</div>`;
  }
}

// -------- Photos --------
function displayPhotos(photoPaths) {
  const container = document.getElementById('uploadedPhotos');
  container.innerHTML = '';
  if (!Array.isArray(photoPaths) || photoPaths.length === 0) {
    container.innerHTML = '<div class="small-muted">No photos uploaded.</div>';
    return;
  }
  photoPaths.forEach(photoPath => {
    const img = document.createElement('img');
    img.src = `file://${photoPath}`;
    img.style.width = '120px';
    img.style.height = '120px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    container.appendChild(img);
  });
}

async function loadUploadedPhotos() {
  const statusEl = document.getElementById("photoUploadStatus");
  statusEl.textContent = '⏳ Loading photos.';
  try {
    const res = await window.api.getAllPhotos(token);
    if (res && res.success) {
      displayPhotos(res.data || []);
      statusEl.textContent = '';
    } else {
      statusEl.textContent = `❌ ${(res && res.error) || 'Failed to load photos.'}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Failed to load photos.'}`;
  }
}

async function loadUploadedMusic() {
  const statusEl = document.getElementById("musicUploadStatus");
  statusEl.textContent = '⏳ Loading music.';
  try {
    const res = await window.api.getAllMusic(token);
    if (res && res.success) {
      displayMusic(res.data || []);
      statusEl.textContent = '';
    } else {
      statusEl.textContent = `❌ ${(res && res.error) || 'Failed to load music.'}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Failed to load music.'}`;
  }
}

function displayMusic(trackPaths) {
  const container = document.getElementById('uploadedMusic');
  container.innerHTML = '';
  if (!Array.isArray(trackPaths) || trackPaths.length === 0) {
    container.innerHTML = '<div class="small-muted">No music uploaded.</div>';
    return;
  }

  trackPaths.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center justify-content-between border rounded p-2';

    const left = document.createElement('div');
    left.className = 'd-flex align-items-center gap-2';
    const name = document.createElement('span');
    name.textContent = `🎵 ${p.split(/[\\/]/).pop()}`;
    left.appendChild(name);

    const right = document.createElement('div');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = `file://${p}`;
    audio.style.width = '260px';
    right.appendChild(audio);

    row.appendChild(left);
    row.appendChild(right);
    container.appendChild(row);
  });
}

document.getElementById("photoUpload").addEventListener("change", async () => {
  const photos = Array.from(document.getElementById("photoUpload").files || []);
  const statusEl = document.getElementById("photoUploadStatus");
  if (!token || !photos.length) { statusEl.textContent = "❌ Please select photos to upload."; return; }
  statusEl.textContent = '⏳ Uploading photos...';
  try {
    const photoPaths = photos.map(f => f.path);
    const res = await window.api.uploadFiles({ docPath: null, photoPaths, musicPaths: [], token });
    statusEl.textContent = res && res.success ? "✅ Photos uploaded!" : `❌ ${(res && res.error) || 'Upload failed.'}`;
    if (res && res.success) loadUploadedPhotos();
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Upload failed.'}`;
  }
});

document.getElementById("musicUpload").addEventListener("change", async () => {
  const musicFiles = Array.from(document.getElementById("musicUpload").files || []);
  const statusEl = document.getElementById("musicUploadStatus");
  if (!token || !musicFiles.length) { statusEl.textContent = "❌ Please select music files to upload."; return; }
  statusEl.textContent = '⏳ Uploading music...';
  try {
    const musicPaths = musicFiles.map(f => f.path);
    const res = await window.api.uploadFiles({ docPath: null, photoPaths: [], musicPaths, token });
    statusEl.textContent = res && res.success ? "✅ Music uploaded!" : `❌ ${(res && res.error) || 'Upload failed.'}`;
    if (res && res.success) loadUploadedMusic();
  } catch (err) {
    statusEl.textContent = `❌ ${err.message || 'Upload failed.'}`;
  }
});

// -------- Model selection + collection badge --------
const MODEL_KEY = 'qaModel';           // 'offline' | 'online' | 'none'
const EMBED_MODEL_UI = 'all-minilm';   // keep in sync with backend
function modelKey() { return EMBED_MODEL_UI.replace(/[^a-z0-9]+/gi, '_'); }
function collectionNameForUser(userId) { return userId ? `user_${userId}_records_${modelKey()}` : '—'; }

function updateCollectionBadge() {
  const badge = document.getElementById('collectionBadge');
  const state = getStoredModel();
  const uid = __currentUser?.id;
  if (!badge) return;

  if (!uid) {
    badge.textContent = 'Index: —';
    badge.className = 'badge bg-secondary';
    return;
  }

  const name = collectionNameForUser(uid);
  badge.textContent = `Index: ${name}`;
  badge.className = state === 'none' ? 'badge bg-info text-dark' : 'badge bg-success';
}

function getStoredModel() { return localStorage.getItem(MODEL_KEY) || 'none'; }
function storeModel(value) { localStorage.setItem(MODEL_KEY, value); }

function setAskControlsEnabled(enabled) {
  const askBtn = document.getElementById('askBtn');
  const qEl = document.getElementById('questionInput');
  if (askBtn) askBtn.disabled = !enabled;
  if (qEl) qEl.disabled = !enabled;
  if (qEl) qEl.placeholder = enabled ? 'Type your question…' : 'Select a model to enable asking…';
}

function updateModelBadge(state) {
  const badge = document.getElementById('modelStatusBadge');
  if (!badge) return;
  if (state === 'none')      { badge.textContent = 'No model selected'; badge.className = 'badge bg-warning text-dark'; }
  else if (state === 'offline') { badge.textContent = 'Model: Local / Offline'; badge.className = 'badge bg-success'; }
  else if (state === 'online')  { badge.textContent = 'Model: Online Granite';  badge.className = 'badge bg-success'; }
}

function clearModelButtonsActive() {
  ['btnModelOffline','btnModelOnline'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('btn-primary');
    el.classList.add('btn-outline-secondary');
  });
}
function activateButton(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('btn-outline-secondary');
  el.classList.add('btn-primary');
}

function emphasizeNotice() {
  const picker = document.getElementById('modelPicker');
  const notice = document.getElementById('modelNotice');
  picker?.classList.add('attention');
  if (notice) {
    notice.style.boxShadow = '0 0 0 3px rgba(255,193,7,35)';
    setTimeout(() => notice.style.boxShadow = '', 1200);
  }
  setTimeout(() => picker?.classList.remove('attention'), 1200);
}

document.getElementById('btnModelOffline')?.addEventListener('click', () => {
  storeModel('offline'); updateModelBadge('offline'); clearModelButtonsActive(); activateButton('btnModelOffline'); setAskControlsEnabled(true); updateCollectionBadge();
});
document.getElementById('btnModelOnline')?.addEventListener('click', () => {
  storeModel('online'); updateModelBadge('online'); clearModelButtonsActive(); activateButton('btnModelOnline'); setAskControlsEnabled(true); updateCollectionBadge();
});
function applyModelUIFromStorage() {
  const st = getStoredModel();
  if (st === 'offline') activateButton('btnModelOffline');
  if (st === 'online')  activateButton('btnModelOnline');
  updateModelBadge(st);
  setAskControlsEnabled(st !== 'none');
}

// -------- Scope helper and UI --------
async function refreshScopeFiles() {
  try {
    const res = await window.api.getAllRecords(token);
    const rows = (res?.success && Array.isArray(res.data)) ? res.data : [];
    renderScopeFileList(rows);
  } catch { renderScopeFileList([]); }
}

function renderScopeFileList(rows) {
  const list = document.getElementById('scopeFileList');
  if (!list) return;
  list.innerHTML = '';
  if (!rows?.length) { list.innerHTML = '<div class="text-muted">No files available.</div>'; return; }

  rows.forEach(r => {
    const id = `scopeFile_${r.id}`;
    const wrap = document.createElement('div');
    wrap.className = 'form-check';
    wrap.innerHTML = `
      <input class="form-check-input" type="checkbox" value="${r.id}" id="${id}">
      <label class="form-check-label" for="${id}">
        ${r.file_name || `Record ${r.id}`} <span class="small-muted">• ${r.uploaded_at || ''}</span>
      </label>
    `;
    list.appendChild(wrap);
  });
}

function currentScopeFromUI() {
  const latest = document.getElementById('scopeLatest')?.checked;
  const all    = document.getElementById('scopeAll')?.checked;
  const ids    = document.getElementById('scopeSelected')?.checked;

  if (latest) return { type: 'latest' };
  if (all)    return { type: 'all' };

  const list = document.querySelectorAll('#scopeFileList input[type="checkbox"]:checked');
  const selectedIds = Array.from(list).map(el => Number(el.value)).filter(Number.isInteger);
  return { type: 'ids', ids: selectedIds };
}

['scopeLatest','scopeAll','scopeSelected'].forEach(id => {
  const el = document.getElementById(id);
  el?.addEventListener('change', async () => {
    const area = document.getElementById('scopePickerArea');
    if (document.getElementById('scopeSelected').checked) {
      area.style.display = '';
      await refreshScopeFiles();
    } else {
      area.style.display = 'none';
    }
  });
});

function prepareScopePickerOnEnterQA() {
  const area = document.getElementById('scopePickerArea');
  if (document.getElementById('scopeSelected').checked) {
    area.style.display = '';
    refreshScopeFiles();
  } else {
    area.style.display = 'none';
  }
}

// --- Map backend errors to friendly UI guidance ---
function mapErrorToFriendly(msg = '') {
  const m = (msg || '').toLowerCase();
  if (m.includes('not found') || m.includes('404')) {
    return '❌ No index found for this model. Please upload a document first so we can build your search index.';
  }
  if (m.includes('vector-size') || m.includes('mismatch') || m.includes('bad request')) {
    return '❌ Vector size mismatch. Your index was created with a different embedding model. Delete the old collection or re-upload to rebuild with the current model.';
  }
  if (m.includes('embedding') && m.includes('empty')) {
    return '❌ Embedding failed. Ensure the Ollama model (all-minilm) is available and running.';
  }
  return `❌ ${msg || 'An error occurred.'}`;
}

// -------- Streaming helpers (with typing start timing) --------
function safeParseJSON(s) { try { return JSON.parse(s); } catch (_) { return null; } }

function appendToAnswer(text) {
  const a = document.getElementById('answer');
  if (!a) return;
  if (!a.innerHTML) a.innerHTML = '<b>Answer:</b>\n\n';
  a.innerHTML += text;
}

// NEW: measure both stream-start and first-visible-typing timestamps
function startAskStream(question, scope = { type: 'all' }, topK = 4, initiatedAt = null) {
  return new Promise((resolve) => {
    try { window.api.removeAskStreamListeners(); } catch (_) {}

    const answerEl = document.getElementById('answer');

    // Info banner shows timing
    const infoId = 'streamStartInfo';
    let infoBox = document.getElementById(infoId);
    if (!infoBox) {
      infoBox = document.createElement('div');
      infoBox.id = infoId;
      infoBox.className = 'mt-2 small-muted';
      if (answerEl) answerEl.insertAdjacentElement('beforebegin', infoBox);
    }
    infoBox.textContent = '⏳ Waiting for stream to start…';

    if (answerEl) answerEl.innerHTML = '<b>Answer:</b>\n\n';

    const startedAt = typeof initiatedAt === 'number' ? initiatedAt : performance.now();
    let firstChunkAt = null; // first byte from backend
    let firstTypedAt = null; // first visible characters appended

    // helper to update banner to include both when available
    function updateBanner() {
      const box = document.getElementById(infoId);
      if (!box) return;
      const parts = [];
      if (firstChunkAt) {
        const s = ((firstChunkAt - startedAt) / 1000).toFixed(2);
        parts.push(`⏱ Stream started in ${s}s`);
      }
      if (firstTypedAt) {
        const t = ((firstTypedAt - startedAt) / 1000).toFixed(2);
        parts.push(`✍️ Typing began at ${t}s`);
      }
      if (parts.length) box.textContent = parts.join(' • ');
    }

    let stallTimer = setTimeout(() => {
      const waited = ((performance.now() - startedAt) / 1000).toFixed(2);
      const box = document.getElementById(infoId);
      if (box && !firstChunkAt) box.textContent = `⏳ Still waiting… ${waited}s`;
    }, 7000);

    // Detects if a chunk carries visible text
    function extractVisibleFromParsed(parsed) {
      if (!parsed) return '';
      if (typeof parsed.response === 'string') return parsed.response;
      if (typeof parsed.text === 'string') return parsed.text;
      if (typeof parsed.delta === 'string') return parsed.delta;
      if (typeof parsed.chunk === 'string') return parsed.chunk;
      if (typeof parsed.message === 'string') return parsed.message;
      return '';
    }

    const onChunk = (data) => {
      if (!data) return;

      const trimmed = String(data).trim();
      const parsed = safeParseJSON(trimmed);

      // mark first byte arrival
      if (!firstChunkAt) {
        firstChunkAt = performance.now();
        clearTimeout(stallTimer);
        updateBanner();
      }

      let visible = '';
      if (parsed) {
        if (parsed.type === 'done' || parsed.done === true) {
          try { window.api.removeAskStreamListeners(); } catch {}
          updateBanner();
          resolve({ success: true });
          return;
        }
        // ignore any "sources" metadata entirely
        if (parsed.type === 'sources') return;

        visible = extractVisibleFromParsed(parsed);
      } else {
        visible = trimmed;
      }

      if (visible) {
        appendToAnswer(visible);
        // first time we actually *append* user-visible text
        if (!firstTypedAt && /\S/.test(visible)) {
          firstTypedAt = performance.now();
          updateBanner();
        }
        try { showAutoSummary((document.getElementById('answer').innerText || '').trim().slice(0, 4000)); } catch {}
      }
    };

    const onErr = (msg) => {
      try { window.api.removeAskStreamListeners(); } catch {}
      clearTimeout(stallTimer);
      const box = document.getElementById(infoId);
      if (box && !firstChunkAt) {
        const waited = ((performance.now() - startedAt) / 1000).toFixed(2);
        box.textContent = `⚠️ Stream failed after waiting ${waited}s`;
      }
      const a = document.getElementById('answer');
      if (a) a.innerHTML += `\n\n❌ Stream error: ${msg}`;
      resolve({ success: false, error: msg });
    };

    window.api.onAskStreamChunk(onChunk);
    window.api.onAskStreamError(onErr);

    try {
      window.api.askStreamStart({ question, token, scope, topK });
    } catch (e) {
      try { window.api.removeAskStreamListeners(); } catch {}
      clearTimeout(stallTimer);
      resolve({ success: false, error: e?.message || String(e) });
    }
  });
}

async function askQuestion() {
  const qEl = document.getElementById("questionInput");
  const a   = document.getElementById("answer");
  const q   = (qEl?.value || '').trim();

  const chosen = (localStorage.getItem('qaModel') || 'none');
  if (chosen === 'none') {
    const notice = document.getElementById('modelNotice');
    if (notice) { notice.style.boxShadow = '0 0 0 3px rgba(255,193,7,.35)'; setTimeout(() => notice.style.boxShadow = '', 1200); }
    a.innerHTML = `<div class="text-muted">Select a model above to continue.</div>`;
    return;
  }
  if (!q) { a.textContent = "❌ Please enter a question."; return; }

  const scope = currentScopeFromUI();

  const showThinking = (label) => {
    a.innerHTML = `<div class="d-flex align-items-center text-muted">
      <div class="spinner-border spinner-border-sm me-2"></div>
      <span>Exploring (${label})…</span>
    </div>`;
  };

  await new Promise(requestAnimationFrame);

  try {
    const label = (chosen === 'online') ? 'Online Granite' : 'Local / Offline';

    if (chosen === 'online') {
      const existingInfo = document.getElementById('streamStartInfo');
      if (existingInfo) existingInfo.remove();
      a.innerHTML = '';
      showThinking('Online Granite');

      const initiatedAt = performance.now();
      const res = await startAskStream(q, scope, 4, initiatedAt);
      const totalElapsed = ((performance.now() - initiatedAt)/1000).toFixed(2);

      if (res && res.success) {
        const footer = document.createElement('div');
        footer.className = 'small-muted mt-2';
        footer.textContent = `✅ Answer complete (${totalElapsed}s).`;
        a.appendChild(footer);
      } else {
        a.innerHTML += `\n\n❌ ${(res && res.error) || 'Stream ended abnormally.'}`;
      }
    } else {
      a.innerHTML = '<div class="text-muted">Local/offline QA not implemented in this build.</div>';
    }
  } catch (err) {
    console.error('QA error', err);
    document.getElementById('answer').textContent = `❌ ${err.message || 'Error'}`;
  }
}

// --- Regenerate Topic button ---
async function regenerateTopicForCurrent() {
  const btn = document.getElementById('regenTopicBtn');
  const t = document.getElementById('extractedText');
  if (!__currentRecordId) return;
  btn.disabled = true;
  const textBackup = t.textContent;
  t.textContent = '⏳ Regenerating topic…';
  try {
    if (typeof window.api.regenerateTopic === 'function') {
      const res = await window.api.regenerateTopic(__currentRecordId, token);
      if (res && res.success && res.data && res.data.topic) {
        t.textContent = res.data.topic;
        showRecordMessage('success', '✅ Topic updated.');
        await loadDocumentRecords(); // refresh list
      } else {
        t.textContent = textBackup;
        showRecordMessage('danger', `❌ ${(res && res.error) || 'Failed to regenerate topic'}`);
      }
    } else {
      // Fallback: just re-ask and display (no DB save)
      const q = "What is the main topic of this document?";
      const scope = { type: 'ids', ids: [__currentRecordId] };
      const initiatedAt = performance.now();
      const done = await startAskStream(q, scope, 4, initiatedAt);
      if (!done || done.error) {
        t.textContent = textBackup;
        showRecordMessage('danger', `❌ ${(done && done.error) || 'Failed to regenerate (fallback)'}`);
      } else {
        showRecordMessage('info', 'ℹ️ Display updated from SLM (not saved to DB).');
      }
    }
  } catch (e) {
    t.textContent = textBackup;
    showRecordMessage('danger', `❌ ${e.message || 'Failed to regenerate topic'}`);
  } finally {
    btn.disabled = false;
  }
}
document.getElementById('regenTopicBtn').addEventListener('click', regenerateTopicForCurrent);

function inlineConfirm(targetEl, message, onConfirm, onCancel) {
  targetEl.querySelectorAll('.inline-confirm-wrap').forEach(n => n.remove());
  const wrap = document.createElement('div');
  wrap.className = 'inline-confirm-wrap d-inline-flex align-items-center gap-2';
  wrap.innerHTML = `
    <span class="small text-muted">${message}</span>
    <button type="button" class="btn btn-sm btn-danger">Yes</button>
    <button type="button" class="btn btn-sm btn-secondary">No</button>
  `;
  const [yesBtn, noBtn] = wrap.querySelectorAll('button');
  yesBtn.addEventListener('click', () => { wrap.remove(); onConfirm?.(); });
  noBtn.addEventListener('click', () => { wrap.remove(); onCancel?.(); });
  targetEl.appendChild(wrap);
  yesBtn.focus();
}

// -------- Agents --------
const agentTemplatesData = [
  { name: "Agent Template", agents: ["Private Data", "Family Calendar", "Misplaced Items", "Relationships"] }
];

function loadAgentTemplates() {
  const container = document.getElementById("agentTemplates");
  container.innerHTML = '';
  document.getElementById("templateAgents").classList.add("hidden");

  agentTemplatesData.forEach(template => {
    const div = document.createElement("div");
    div.className = "agent-template-folder";
    div.innerHTML = `<div style="font-size:28px;line-height:1">📁</div><div style="margin-top:8px;font-weight:600">${template.name}</div>`;
    div.onclick = () => showAgents(template);
    container.appendChild(div);
  });
}

function showAgents(template) {
  document.getElementById("agentTemplates").classList.add("hidden");
  const agentsContainer = document.getElementById("templateAgents");
  const list = document.getElementById("agentsList");
  const nameSpan = document.getElementById("selectedTemplateName");
  nameSpan.textContent = template.name || 'Agent Template';
  list.innerHTML = '';
  (template.agents || []).forEach(agent => {
    const btn = document.createElement("button");
    btn.type = 'button';
    btn.className = "list-group-item list-group-item-action";
    btn.textContent = `🧠 ${agent}`;
    btn.onclick = () => { showAgentFeature(agent.toLowerCase().replace(/\s+/g, "")); };
    list.appendChild(btn);
  });
  agentsContainer.classList.remove("hidden");
  document.getElementById("agentFeatureContent").textContent = "Select a feature to view its details.";
}

function backToTemplates() {
  document.getElementById("templateAgents").classList.add("hidden");
  document.getElementById("agentTemplates").classList.remove("hidden");
  document.getElementById("agentFeatureContent").textContent = "Select a feature to view its details.";
}

function showAgentFeature(feature) {
  const c = document.getElementById("agentFeatureContent");
  const map = {
    private: "📄 Private Data Feature Coming Soon",
    calendar: "📅 Family Calendar Feature Coming Soon",
    misplaced: "🧳 Misplaced Items Feature Coming Soon",
    relationships: "👪 Relationships Feature Coming Soon"
  };
  const key = Object.keys(map).find(k => feature.includes(k)) || feature;
  c.textContent = map[key] || "Select a feature to view its details.";
}

// -------- Initialize --------
showSection('dashboard');
loadAgentTemplates();
startOllamaWatch();
loadCurrentUser().then(async () => {
  updateCollectionBadge();
  try { await runAutoSummaryAtStartup(); } catch (_) {}
});

// Debug helpers
window.__fc = { showSection };
