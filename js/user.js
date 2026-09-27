/* ==========================================================================
   USER.JS - Xử lý toàn bộ logic trang User (Full Update)
   ========================================================================== */

let currentUser = null;
let allFilesData = [];
let allFoldersData = [];
let allUsersData = [];
let allHashtagsData = [];
let selectedTagsList = []; // Mảng chứa các hashtag đã chọn khi upload
let toastTimer;

const elSidebar = document.getElementById("sidebar");
const elBreadcrumbCurrent = document.getElementById("breadcrumbCurrent");
const elUserNameLabel = document.getElementById("userNameLabel");
const elUserAvatar = document.getElementById("userAvatar");

bootstrapUserPage();

async function bootstrapUserPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }

  const { data: profile } = await supabaseClient
    .from("user")
    .select("user_name, status, is_admin, color")
    .eq("id", session.user.id)
    .single();

  if (!profile || !profile.status) {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
    return;
  }
  if (profile.is_admin) { window.location.href = "admin.html"; return; }

  currentUser = { id: session.user.id, name: profile.user_name || "Người dùng", email: session.user.email };
  elUserNameLabel.textContent = currentUser.name;
  elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();

  initThemeToggle(profile.color);
  await loadInitData();
  await CommentModule.init("commentRoot", { userId: currentUser.id, isAdmin: false });
  restorePageFromHash();
}

async function loadInitData() {
  await Promise.all([
    loadFolders(),
    loadUsersList(),
    loadHashtagsList(),
    loadAllFiles(),
    loadLeaderboard()
  ]);
  populateFilterDropdowns();
  renderDocTable();
}

// 1. TẢI DỮ LIỆU
async function loadFolders() {
  const { data } = await supabaseClient.from("folder").select("id, display_name, bucket_name").order("display_name");
  allFoldersData = data || [];
  const select = document.getElementById("uploadFolderSelect");
  if (select) {
    select.innerHTML = '<option value="">-- Chọn Folder --</option>' +
      allFoldersData.map(f => `<option value="${f.id}">${escapeHTML(f.display_name)}</option>`).join('');
  }
}

async function loadUsersList() {
  const { data } = await supabaseClient.from("user").select("id, user_name").order("user_name");
  allUsersData = data || [];
}

async function loadHashtagsList() {
  const { data } = await supabaseClient.from("hashtag").select("id, name").order("name");
  allHashtagsData = data || [];
  renderAvailableTagsSelect();
}

async function loadAllFiles() {
  const { data } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, bio, created_at, id_user, id_folder, status, user:id_user(user_name), folder:id_folder(display_name, bucket_name), file_hashtag(hashtag:id_hashtag(id, name))")
    .order("created_at", { ascending: false });

  allFilesData = (data || []).filter(f => f.status || f.id_user === currentUser.id);
  document.getElementById("userFileCountLabel").textContent = `${allFilesData.filter(f => f.id_user === currentUser.id).length} file đã upload`;
}

// 2. BỘ LỌC TÌM KIẾM TỔNG HỢP (TAB TÀI LIỆU)
function populateFilterDropdowns() {
  const fFolder = document.getElementById("filterFolder");
  const fUploader = document.getElementById("filterUploader");
  const fTag = document.getElementById("filterHashtag");

  fFolder.innerHTML = '<option value="">Tất cả Folder</option>' + allFoldersData.map(f => `<option value="${f.id}">${escapeHTML(f.display_name)}</option>`).join('');
  fUploader.innerHTML = '<option value="">Tất cả người đăng</option>' + allUsersData.map(u => `<option value="${u.id}">${escapeHTML(u.user_name)}</option>`).join('');
  fTag.innerHTML = '<option value="">Tất cả Hashtag</option>' + allHashtagsData.map(t => `<option value="${t.id}">#${escapeHTML(t.name)}</option>`).join('');

  [document.getElementById("filterKeyword"), fFolder, fUploader, fTag].forEach(el => {
    el.addEventListener("input", renderDocTable);
  });
}

function renderDocTable() {
  const kw = document.getElementById("filterKeyword").value.trim().toLowerCase();
  const folderId = document.getElementById("filterFolder").value;
  const uploaderId = document.getElementById("filterUploader").value;
  const tagId = document.getElementById("filterHashtag").value;

  const filtered = allFilesData.filter(f => {
    const matchKw = !kw || f.file_name.toLowerCase().includes(kw) || (f.bio || "").toLowerCase().includes(kw);
    const matchFolder = !folderId || f.id_folder === folderId;
    const matchUploader = !uploaderId || f.id_user === uploaderId;
    const matchTag = !tagId || (f.file_hashtag && f.file_hashtag.some(fh => fh.hashtag?.id === tagId));
    return matchKw && matchFolder && matchUploader && matchTag;
  });

  document.getElementById("docResultCount").textContent = filtered.length;
  document.getElementById("docEmptyState").hidden = filtered.length > 0;
  document.querySelector("#documentsPage .table-scroll").hidden = filtered.length === 0;

  const body = document.getElementById("docTableBody");
  body.innerHTML = filtered.map((file, idx) => {
    const isOwner = file.id_user === currentUser.id;
    const tagsHtml = (file.file_hashtag || [])
      .map(fh => fh.hashtag?.name ? `<span class="badge">#${escapeHTML(fh.hashtag.name)}</span>` : '')
      .join(' ') || '-';

    return /* html */ `
      <tr data-file-id="${file.id}">
        <td>${idx + 1}</td>
        <td><strong>${escapeHTML(file.file_name)}</strong></td>
        <td>${escapeHTML(file.folder?.display_name || "-")}</td>
        <td>${tagsHtml}</td>
        <td>${escapeHTML(file.user?.user_name || "-")}</td>
        <td>${formatDate(file.created_at)}</td>
        <td>
          <div class="actions">
            <button class="action-btn" data-preview-btn="${file.id}" title="Xem chi tiết">👁</button>
            ${isOwner ? `<button class="action-btn delete" data-delete-btn="${file.id}" title="Xóa">⌫</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  body.querySelectorAll("[data-preview-btn]").forEach(btn => {
    btn.addEventListener("click", () => openPreviewModal(btn.dataset.previewBtn));
  });
  body.querySelectorAll("[data-delete-btn]").forEach(btn => {
    btn.addEventListener("click", () => deleteFile(btn.dataset.deleteBtn));
  });
}

// 3. MODAL XEM TRƯỚC FILE (SPLIT VIEW)
async function openPreviewModal(fileId) {
  const file = allFilesData.find(f => f.id === fileId);
  if (!file) return;

  document.getElementById("prevFileName").textContent = file.file_name;
  document.getElementById("prevFileFolder").textContent = file.folder?.display_name || "Chưa phân folder";
  document.getElementById("prevFileUser").textContent = file.user?.user_name || "-";
  document.getElementById("prevFileTime").textContent = formatDateTime(file.created_at);
  document.getElementById("prevFileBio").textContent = file.bio || "Không có mô tả.";

  const tagsHtml = (file.file_hashtag || [])
    .map(fh => fh.hashtag?.name ? `<span class="badge">#${escapeHTML(fh.hashtag.name)}</span>` : '')
    .join(' ');
  document.getElementById("prevFileTags").innerHTML = tagsHtml || '-';

  // Xử lý tách Bucket & Path an toàn cho cả file cũ lẫn file mới
  let bucket = "documents";
  let pathInsideBucket = file.storage_path;

  if (file.storage_path.includes("/")) {
    const parts = file.storage_path.split("/");
    bucket = parts[0];
    pathInsideBucket = parts.slice(1).join("/");
  }

  const ext = file.file_name.split('.').pop().toLowerCase();

  // Tạo URL tải về từ Supabase Storage
  const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(pathInsideBucket, 300);
  const signedUrl = data?.signedUrl || "#";

  document.getElementById("prevDownloadBtn").href = signedUrl;

  const viewerBox = document.getElementById("previewViewerBox");

  if (error || !data?.signedUrl) {
    viewerBox.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#fff; text-align:center; padding:1.5rem;">
        <span style="font-size:3rem; margin-bottom:1rem;">⚠️</span>
        <p style="font-size:1rem; font-weight:600;">Không thể tải bản xem trước của file này</p>
        <p style="font-size:0.8rem; color:#aaa; margin-top:0.5rem;">File có thể đã bị xóa hoặc đường dẫn lưu trữ cũ không khả dụng.</p>
      </div>`;
    document.getElementById("previewFileModal").classList.add("open");
    return;
  }

  // Phân loại hiển thị theo định dạng file
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    viewerBox.innerHTML = `<img src="${signedUrl}" alt="Preview" style="max-width:100%; max-height:100%; object-fit:contain; margin:auto; display:block;">`;
  } else if (ext === "pdf") {
    viewerBox.innerHTML = `<iframe src="${signedUrl}" style="width:100%; height:100%; border:none;"></iframe>`;
  } else {
    // Với file Word, Excel, PowerPoint (.docx, .xlsx, .pptx)
    const docViewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(signedUrl)}&embedded=true`;
    viewerBox.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%;">
        <iframe src="${docViewerUrl}" style="flex:1; width:100%; border:none;"></iframe>
        <div style="padding:0.6rem; background:#2a2a2a; color:#fff; text-align:center; font-size:0.8rem;">
          Đang xem file <strong>.${ext.toUpperCase()}</strong>. Nếu không hiển thị, vui lòng bấm nút <a href="${signedUrl}" target="_blank" style="color:var(--accent-1); text-decoration:underline;">Tải tài liệu về</a> ở bên phải.
        </div>
      </div>`;
  }

  document.getElementById("previewFileModal").classList.add("open");
}
document.querySelectorAll("[data-close-preview]").forEach(el => {
  el.addEventListener("click", () => document.getElementById("previewFileModal").classList.remove("open"));
});

// 4. INTERACTIVE TAG PICKER (UPLOAD)
function renderAvailableTagsSelect() {
  const select = document.getElementById("availableTagsSelect");
  const available = allHashtagsData.filter(t => !selectedTagsList.includes(t.name));
  select.innerHTML = '<option value="">-- Chọn hashtag có sẵn --</option>' +
    available.map(t => `<option value="${escapeHTML(t.name)}">#${escapeHTML(t.name)}</option>`).join('');
}

function renderSelectedTagsBox() {
  const box = document.getElementById("selectedTagsBox");
  if (selectedTagsList.length === 0) {
    box.innerHTML = '<span style="color:var(--text-faint); font-size:0.8rem;">Chưa chọn hashtag nào</span>';
    return;
  }
  box.innerHTML = selectedTagsList.map((tag, idx) => `
    <span class="tag-chip">#${escapeHTML(tag)} <button type="button" data-remove-tag="${idx}">✕</button></span>
  `).join('');

  box.querySelectorAll("[data-remove-tag]").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedTagsList.splice(parseInt(btn.dataset.removeTag), 1);
      renderSelectedTagsBox();
      renderAvailableTagsSelect();
    });
  });
}

document.getElementById("btnAddSelectedTag")?.addEventListener("click", () => {
  const val = document.getElementById("availableTagsSelect").value;
  if (val && !selectedTagsList.includes(val)) {
    selectedTagsList.push(val);
    renderSelectedTagsBox();
    renderAvailableTagsSelect();
  }
});

document.getElementById("btnAddCustomTag")?.addEventListener("click", () => {
  const input = document.getElementById("customTagInput");
  const val = input.value.trim().replace(/^#/, "");
  if (val && !selectedTagsList.includes(val)) {
    selectedTagsList.push(val);
    input.value = "";
    renderSelectedTagsBox();
    renderAvailableTagsSelect();
  }
});

document.getElementById("uploadForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("uploadSubmitBtn");
  submitBtn.disabled = true;

  try {
    const folderId = document.getElementById("uploadFolderSelect").value;
    const rawFile = document.getElementById("uploadFile").files[0];
    const bio = document.getElementById("uploadBio").value.trim();
    let displayName = document.getElementById("uploadName").value.trim() || rawFile.name;

    if (!folderId) throw new Error("Vui lòng chọn Folder.");
    if (!rawFile) throw new Error("Vui lòng chọn file.");
    if (selectedTagsList.length === 0) throw new Error("Vui lòng chọn/tạo ít nhất 1 Hashtag.");

    const folder = allFoldersData.find(f => f.id === folderId);
    const safeExt = rawFile.name.includes(".") ? rawFile.name.split(".").pop() : "";
    const storageFileName = `${crypto.randomUUID()}.${safeExt}`;
    const storagePath = `${folder.bucket_name}/${currentUser.id}/${storageFileName}`;

    const { error: uploadError } = await supabaseClient.storage.from(folder.bucket_name).upload(`${currentUser.id}/${storageFileName}`, rawFile);
    if (uploadError) throw uploadError;

    const { data: newFile, error: insertError } = await supabaseClient
      .from("file")
      .insert({ file_name: displayName, storage_path: storagePath, id_folder: folderId, id_user: currentUser.id, bio })
      .select().single();
    if (insertError) throw insertError;

    for (const tagName of selectedTagsList) {
      let { data: tag } = await supabaseClient.from("hashtag").select("id").eq("name", tagName).single();
      if (!tag) {
        const { data: cTag } = await supabaseClient.from("hashtag").insert({ name: tagName, created_by: currentUser.id }).select().single();
        tag = cTag;
      }
      if (tag) {
        await supabaseClient.from("file_hashtag").insert({ id_file: newFile.id, id_hashtag: tag.id });
      }
    }

    showToast("Tải lên thành công!", "");
    document.getElementById("uploadForm").reset();
    selectedTagsList = [];
    renderSelectedTagsBox();
    await loadInitData();
    switchPage("documents");
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

// 5. BẢNG XẾP HẠNG (PODIUM TOP 3)
async function loadLeaderboard() {
  const { data } = await supabaseClient.from("user").select("user_name, score").order("score", { ascending: false }).limit(20);
  const users = data || [];

  const podiumBox = document.getElementById("podiumTop3");
  const restBody = document.getElementById("leaderboardRestBody");

  if (users.length === 0) {
    podiumBox.innerHTML = '<p>Chưa có dữ liệu xếp hạng</p>';
    return;
  }

  const top1 = users[0];
  const top2 = users[1];
  const top3 = users[2];

  let podiumHtml = '';
  if (top2) {
    podiumHtml += `
      <div class="podium-card rank-2">
        <div class="podium-badge">2</div>
        <div class="podium-avatar">${escapeHTML(top2.user_name.slice(0, 2).toUpperCase())}</div>
        <strong>${escapeHTML(top2.user_name)}</strong>
        <p style="color:var(--text-sub); font-size:0.85rem; margin-top:0.3rem;">${top2.score || 0} tài liệu</p>
      </div>`;
  }
  if (top1) {
    podiumHtml += `
      <div class="podium-card rank-1">
        <div class="podium-badge">1</div>
        <div class="podium-avatar">${escapeHTML(top1.user_name.slice(0, 2).toUpperCase())}</div>
        <strong style="font-size:1.05rem;">${escapeHTML(top1.user_name)}</strong>
        <p style="color:#f59e0b; font-weight:700; margin-top:0.3rem;">${top1.score || 0} tài liệu</p>
      </div>`;
  }
  if (top3) {
    podiumHtml += `
      <div class="podium-card rank-3">
        <div class="podium-badge">3</div>
        <div class="podium-avatar">${escapeHTML(top3.user_name.slice(0, 2).toUpperCase())}</div>
        <strong>${escapeHTML(top3.user_name)}</strong>
        <p style="color:var(--text-sub); font-size:0.85rem; margin-top:0.3rem;">${top3.score || 0} tài liệu</p>
      </div>`;
  }
  podiumBox.innerHTML = podiumHtml;

  const restUsers = users.slice(3);
  restBody.innerHTML = restUsers.map((u, i) => `
    <tr>
      <td><strong>#${i + 4}</strong></td>
      <td>${escapeHTML(u.user_name)}</td>
      <td><strong>${u.score || 0}</strong> tài liệu</td>
    </tr>
  `).join('');
}

// HÀM TIỆN ÍCH DÙNG CHUNG
document.getElementById("btnGoToUpload")?.addEventListener("click", () => switchPage("upload"));

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-page]");
  if (nav) switchPage(nav.dataset.page);
});
document.getElementById("menuToggle")?.addEventListener("click", () => elSidebar.classList.toggle("open"));
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

const pageTitles = { documents: "Tài liệu", leaderboard: "Bảng xếp hạng", upload: "Upload", discussion: "Thảo luận", account: "Tài khoản" };
function switchPage(page) {
  document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.page === page));
  document.querySelectorAll(".page").forEach(s => s.classList.remove("active"));
  document.getElementById(`${page}Page`)?.classList.add("active");
  elBreadcrumbCurrent.textContent = pageTitles[page] || "Tài liệu";
  elSidebar.classList.remove("open");
  if (window.location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
}
function restorePageFromHash() {
  const saved = window.location.hash.replace("#", "");
  if (saved && pageTitles[saved]) switchPage(saved);
}

function showToast(title, message) {
  clearTimeout(toastTimer);
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastMessage").textContent = message;
  document.getElementById("toast").classList.add("show");
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 2800);
}
function formatDate(iso) { return new Date(iso).toLocaleDateString("vi-VN"); }
function formatDateTime(iso) { return new Date(iso).toLocaleString("vi-VN"); }
function escapeHTML(v = "") { return String(v).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function initThemeToggle(isDark) {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const toggle = document.getElementById("darkModeToggle");
  if (!toggle) return;
  toggle.checked = !!isDark;
  toggle.addEventListener("change", async () => {
    document.documentElement.dataset.theme = toggle.checked ? "dark" : "light";
    await supabaseClient.from("user").update({ color: toggle.checked }).eq("id", currentUser.id);
  });
}
async function deleteFile(fileId) {
  if (!confirm("Xóa vĩnh viễn file này?")) return;
  const file = allFilesData.find(f => f.id === fileId);
  if (!file) return;
  const bucket = file.folder?.bucket_name || "documents";
  await supabaseClient.storage.from(bucket).remove([file.storage_path.replace(`${bucket}/`, "")]);
  await supabaseClient.from("file").delete().eq("id", fileId);
  showToast("Đã xóa file", "");
  await loadInitData();
}