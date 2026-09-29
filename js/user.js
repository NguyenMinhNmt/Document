/* ==========================================================================
   USER.JS - Tối ưu SWR + Sửa Tên File / Folder / Hashtag (Owner Only)
   ========================================================================== */

const pageTitles = {
  documents: "Tài liệu",
  leaderboard: "Bảng xếp hạng",
  upload: "Upload",
  discussion: "Thảo luận",
  trash: "Thùng rác của tôi",
  account: "Tài khoản"
};

let currentUser = null;
let allFilesData = JSON.parse(localStorage.getItem("cache_files") || "[]");
let allFoldersData = JSON.parse(localStorage.getItem("cache_folders") || "[]");
let allUsersData = JSON.parse(localStorage.getItem("cache_users") || "[]");
let allHashtagsData = JSON.parse(localStorage.getItem("cache_hashtags") || "[]");
let selectedFilterTagIds = [];
let selectedTagsList = [];
let editSelectedTagsList = [];
let toastTimer;

const elSidebar = document.getElementById("sidebar");
const elBreadcrumbCurrent = document.getElementById("breadcrumbCurrent");
const elUserNameLabel = document.getElementById("userNameLabel");
const elUserAvatar = document.getElementById("userAvatar");

bootstrapUserPage();

async function bootstrapUserPage() {
  restorePageFromHash();
  renderFromCache();

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
  if (elUserNameLabel) elUserNameLabel.textContent = currentUser.name;
  if (elUserAvatar) elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();

  initThemeToggle(profile.color);
  await CommentModule.init("commentRoot", { userId: currentUser.id, isAdmin: false });

  const currentTab = window.location.hash.replace("#", "") || "documents";
  revalidateTabData(currentTab);
}

window.addEventListener("hashchange", () => {
  restorePageFromHash();
  const currentTab = window.location.hash.replace("#", "") || "documents";
  revalidateTabData(currentTab);
});

function renderFromCache() {
  populateFilterDropdowns();
  renderHashtagFilterContainer();
  renderDocTable();
}

async function revalidateTabData(tab) {
  if (tab === "documents") {
    await Promise.all([loadFolders(), loadUsersList(), loadHashtagsList(), loadAllFiles()]);
    populateFilterDropdowns();
    renderHashtagFilterContainer();
    renderDocTable();
  } else if (tab === "leaderboard") {
    await loadLeaderboard();
  } else if (tab === "upload") {
    await Promise.all([loadFolders(), loadHashtagsList()]);
  } else if (tab === "trash") {
    await loadUserTrashBin();
  }
}

async function loadFolders() {
  const { data } = await supabaseClient.from("folder").select("id, display_name, bucket_name").order("display_name");
  if (data) {
    allFoldersData = data;
    localStorage.setItem("cache_folders", JSON.stringify(data));
    const select = document.getElementById("uploadFolderSelect");
    if (select) {
      select.innerHTML = '<option value="">-- Chọn Folder --</option>' +
        allFoldersData.map(f => `<option value="${f.id}">${escapeHTML(f.display_name)}</option>`).join('');
    }
  }
}

async function loadUsersList() {
  const { data } = await supabaseClient.from("user").select("id, user_name").order("user_name");
  if (data) {
    allUsersData = data;
    localStorage.setItem("cache_users", JSON.stringify(data));
  }
}

async function loadHashtagsList() {
  const { data } = await supabaseClient.from("hashtag").select("id, name").order("name");
  if (data) {
    allHashtagsData = data;
    localStorage.setItem("cache_hashtags", JSON.stringify(data));
    renderAvailableTagsSelect();
    renderHashtagFilterContainer();
  }
}

async function loadAllFiles() {
  const { data } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, bio, created_at, id_user, id_folder, status, is_deleted, user:id_user(user_name), folder:id_folder(display_name, bucket_name), file_hashtag(hashtag:id_hashtag(id, name))")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("created_at", { ascending: false });

  if (data) {
    allFilesData = data.filter(f => f.status || f.id_user === currentUser?.id);
    localStorage.setItem("cache_files", JSON.stringify(allFilesData));
    const countEl = document.getElementById("userFileCountLabel");
    if (countEl && currentUser) {
      countEl.textContent = `${allFilesData.filter(f => f.id_user === currentUser.id).length} file đã upload`;
    }
  }
}

function populateFilterDropdowns() {
  const fFolder = document.getElementById("filterFolder");
  const fUploader = document.getElementById("filterUploader");

  if (fFolder) fFolder.innerHTML = '<option value="">Tất cả Folder</option>' + allFoldersData.map(f => `<option value="${f.id}">${escapeHTML(f.display_name)}</option>`).join('');
  if (fUploader) fUploader.innerHTML = '<option value="">Tất cả người đăng</option>' + allUsersData.map(u => `<option value="${u.id}">${escapeHTML(u.user_name)}</option>`).join('');

  [document.getElementById("filterKeyword"), fFolder, fUploader].forEach(el => {
    el?.removeEventListener("input", renderDocTable);
    el?.addEventListener("input", renderDocTable);
  });
}

function renderHashtagFilterContainer() {
  const container = document.getElementById("filterHashtagContainer");
  if (!container) return;

  if (allHashtagsData.length === 0) {
    container.innerHTML = '<span style="color:var(--text-faint); font-size:0.85rem;">Chưa có hashtag nào</span>';
    return;
  }

  container.innerHTML = allHashtagsData.map(t => {
    const isChecked = selectedFilterTagIds.includes(t.id);
    return `
      <button type="button" class="badge ${isChecked ? 'active' : ''}" data-filter-tag-id="${t.id}" style="cursor:pointer; border:${isChecked ? '1px solid var(--accent-1)' : '1px solid transparent'}; background:${isChecked ? 'var(--accent-1)' : ''}; color:${isChecked ? '#fff' : ''};">
        #${escapeHTML(t.name)} ${isChecked ? '✓' : ''}
      </button>
    `;
  }).join('');

  container.querySelectorAll("[data-filter-tag-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tagId = btn.dataset.filterTagId;
      if (selectedFilterTagIds.includes(tagId)) {
        selectedFilterTagIds = selectedFilterTagIds.filter(id => id !== tagId);
      } else {
        selectedFilterTagIds.push(tagId);
      }
      renderHashtagFilterContainer();
      renderDocTable();
    });
  });
}

function renderDocTable() {
  const kw = (document.getElementById("filterKeyword")?.value || "").trim().toLowerCase();
  const folderId = document.getElementById("filterFolder")?.value || "";
  const uploaderId = document.getElementById("filterUploader")?.value || "";

  const filtered = allFilesData.filter(f => {
    const matchKw = !kw || f.file_name.toLowerCase().includes(kw) || (f.bio || "").toLowerCase().includes(kw);
    const matchFolder = !folderId || f.id_folder === folderId;
    const matchUploader = !uploaderId || f.id_user === uploaderId;

    let matchTags = true;
    if (selectedFilterTagIds.length > 0) {
      const fileTagIds = (f.file_hashtag || []).map(fh => fh.hashtag?.id).filter(Boolean);
      matchTags = selectedFilterTagIds.every(reqId => fileTagIds.includes(reqId));
    }

    return matchKw && matchFolder && matchUploader && matchTags;
  });

  const countEl = document.getElementById("docResultCount");
  if (countEl) countEl.textContent = filtered.length;
  const emptyEl = document.getElementById("docEmptyState");
  if (emptyEl) emptyEl.hidden = filtered.length > 0;
  const scrollEl = document.querySelector("#documentsPage .table-scroll");
  if (scrollEl) scrollEl.hidden = filtered.length === 0;

  const body = document.getElementById("docTableBody");
  if (!body) return;

  body.innerHTML = filtered.map((file, idx) => {
    const isOwner = file.id_user === currentUser?.id;
    const tagsHtml = (file.file_hashtag || [])
      .map(fh => fh.hashtag?.name ? `<span class="badge">#${escapeHTML(fh.hashtag.name)}</span>` : '')
      .join(' ') || '-';

    return /* html */ `
      <tr data-file-id="${file.id}" style="cursor:pointer;">
        <td>${idx + 1}</td>
        <td><strong>${escapeHTML(file.file_name)}</strong></td>
        <td>${escapeHTML(file.folder?.display_name || "-")}</td>
        <td>${tagsHtml}</td>
        <td>${escapeHTML(file.user?.user_name || "-")}</td>
        <td>${formatDate(file.created_at)}</td>
        <td onclick="event.stopPropagation();">
          <div class="actions">
            <button class="action-btn" data-download-btn="${file.id}" title="Tải về trực tiếp">⬇</button>
            ${isOwner ? `<button class="action-btn" data-edit-btn="${file.id}" title="Chỉnh sửa tài liệu">✏</button>` : ''}
            ${isOwner ? `<button class="action-btn delete" data-delete-btn="${file.id}" title="Xóa">⌫</button>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  body.querySelectorAll("tr[data-file-id]").forEach(row => {
    row.addEventListener("click", () => openPreviewModal(row.dataset.fileId));
  });

  body.querySelectorAll("[data-download-btn]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadFileDirectly(btn.dataset.downloadBtn);
    });
  });

  body.querySelectorAll("[data-edit-btn]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.editBtn);
    });
  });

  body.querySelectorAll("[data-delete-btn]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFile(btn.dataset.deleteBtn);
    });
  });
}

/* ================= MODAL SỬA FILE (TÊN FILE, FOLDER, HASHTAGS) ================= */
function openEditModal(fileId) {
  const file = allFilesData.find(f => f.id === fileId);
  if (!file) return;

  document.getElementById("editFileId").value = file.id;
  document.getElementById("editFileName").value = file.file_name || "";
  document.getElementById("editFileBio").value = file.bio || "";

  // Set dropdown Folders
  const folderSelect = document.getElementById("editFileFolder");
  folderSelect.innerHTML = allFoldersData.map(f => `<option value="${f.id}" ${f.id === file.id_folder ? 'selected' : ''}>${escapeHTML(f.display_name)}</option>`).join('');

  // Lấy danh sách Hashtags của file hiện tại
  editSelectedTagsList = (file.file_hashtag || []).map(fh => fh.hashtag?.name).filter(Boolean);

  renderEditSelectedTagsBox();
  renderEditAvailableTagsSelect();

  document.getElementById("editFileModal").classList.add("open");
}

function renderEditSelectedTagsBox() {
  const box = document.getElementById("editSelectedTagsBox");
  if (!box) return;

  if (editSelectedTagsList.length === 0) {
    box.innerHTML = '<span style="color:var(--text-faint); font-size:0.8rem;">Chưa chọn hashtag nào</span>';
    return;
  }

  box.innerHTML = editSelectedTagsList.map((tag, idx) => `
    <span class="tag-chip">#${escapeHTML(tag)} <button type="button" data-remove-edit-tag="${idx}">✕</button></span>
  `).join('');

  box.querySelectorAll("[data-remove-edit-tag]").forEach(btn => {
    btn.addEventListener("click", () => {
      editSelectedTagsList.splice(parseInt(btn.dataset.removeEditTag), 1);
      renderEditSelectedTagsBox();
      renderEditAvailableTagsSelect();
    });
  });
}

function renderEditAvailableTagsSelect() {
  const select = document.getElementById("editAvailableTagsSelect");
  if (!select) return;
  const available = allHashtagsData.filter(t => !editSelectedTagsList.includes(t.name));
  select.innerHTML = '<option value="">-- Chọn hashtag có sẵn --</option>' +
    available.map(t => `<option value="${escapeHTML(t.name)}">#${escapeHTML(t.name)}</option>`).join('');
}

document.getElementById("btnEditAddSelectedTag")?.addEventListener("click", () => {
  const val = document.getElementById("editAvailableTagsSelect").value;
  if (val && !editSelectedTagsList.includes(val)) {
    editSelectedTagsList.push(val);
    renderEditSelectedTagsBox();
    renderEditAvailableTagsSelect();
  }
});

document.getElementById("btnEditAddCustomTag")?.addEventListener("click", () => {
  const input = document.getElementById("editCustomTagInput");
  const val = input.value.trim().replace(/^#/, "");
  if (val && !editSelectedTagsList.includes(val)) {
    editSelectedTagsList.push(val);
    input.value = "";
    renderEditSelectedTagsBox();
    renderEditAvailableTagsSelect();
  }
});

document.querySelectorAll("[data-close-edit]").forEach(el => {
  el.addEventListener("click", () => document.getElementById("editFileModal").classList.remove("open"));
});

// Xử lý Lưu Sửa File
document.getElementById("editFileForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fileId = document.getElementById("editFileId").value;
  const newName = document.getElementById("editFileName").value.trim();
  const newFolderId = document.getElementById("editFileFolder").value;
  const newBio = document.getElementById("editFileBio").value.trim();
  const submitBtn = document.getElementById("editFileSubmitBtn");

  if (!newName) return showToast("Lỗi", "Vui lòng nhập tên file.");

  submitBtn.disabled = true;
  submitBtn.textContent = "⏳ Đang lưu...";

  try {
    // 1. Cập nhật Tên file, Folder, Mô tả trong DB
    const { error: updateError } = await supabaseClient
      .from("file")
      .update({ file_name: newName, id_folder: newFolderId, bio: newBio })
      .eq("id", fileId);

    if (updateError) throw updateError;

    // 2. Xóa toàn bộ liên kết Hashtags cũ của file
    await supabaseClient.from("file_hashtag").delete().eq("id_file", fileId);

    // 3. Thêm liên kết Hashtags mới
    for (const tagName of editSelectedTagsList) {
      let { data: tag } = await supabaseClient.from("hashtag").select("id").eq("name", tagName).single();
      if (!tag) {
        const { data: cTag } = await supabaseClient.from("hashtag").insert({ name: tagName, created_by: currentUser.id }).select().single();
        tag = cTag;
      }
      if (tag) {
        await supabaseClient.from("file_hashtag").insert({ id_file: fileId, id_hashtag: tag.id });
      }
    }

    showToast("Thành công", "Đã cập nhật thông tin tài liệu.");
    document.getElementById("editFileModal").classList.remove("open");

    // Revalidate lại bảng file
    await loadAllFiles();
    renderDocTable();
  } catch (err) {
    showToast("Cập nhật thất bại", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "✓ Lưu thay đổi";
  }
});

async function downloadFileDirectly(fileId) {
  const file = allFilesData.find(f => f.id === fileId);
  if (!file) return;

  let bucket = "documents";
  let pathInsideBucket = file.storage_path;

  if (file.storage_path.includes("/")) {
    const parts = file.storage_path.split("/");
    bucket = parts[0];
    pathInsideBucket = parts.slice(1).join("/");
  }

  const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(pathInsideBucket, 300, { download: true });
  if (error || !data?.signedUrl) return showToast("Lỗi tải về", "Không thể lấy đường dẫn tải file.");

  window.open(data.signedUrl, "_blank");
}

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

  let bucket = "documents";
  let pathInsideBucket = file.storage_path;

  if (file.storage_path.includes("/")) {
    const parts = file.storage_path.split("/");
    bucket = parts[0];
    pathInsideBucket = parts.slice(1).join("/");
  }

  const ext = file.file_name.split('.').pop().toLowerCase();
  const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(pathInsideBucket, 300);
  const signedUrl = data?.signedUrl || "#";

  document.getElementById("prevDownloadBtn").href = signedUrl;

  const viewerBox = document.getElementById("previewViewerBox");

  if (error || !data?.signedUrl) {
    viewerBox.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#fff; text-align:center; padding:1.5rem;">
        <span style="font-size:3rem; margin-bottom:1rem;">⚠️</span>
        <p style="font-size:1rem; font-weight:600;">Không thể tải bản xem trước của file này</p>
      </div>`;
    document.getElementById("previewFileModal").classList.add("open");
    return;
  }

  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    viewerBox.innerHTML = `<img src="${signedUrl}" alt="Preview" style="max-width:100%; max-height:100%; object-fit:contain; margin:auto; display:block;">`;
  } else if (ext === "pdf") {
    viewerBox.innerHTML = `<iframe src="${signedUrl}" style="width:100%; height:100%; border:none;"></iframe>`;
  } else {
    const docViewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(signedUrl)}&embedded=true`;
    viewerBox.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%;">
        <iframe src="${docViewerUrl}" style="flex:1; width:100%; border:none;"></iframe>
        <div style="padding:0.6rem; background:#2a2a2a; color:#fff; text-align:center; font-size:0.8rem;">
          Đang xem file <strong>.${ext.toUpperCase()}</strong>. Nếu không hiển thị, bấm <a href="${signedUrl}" target="_blank" style="color:var(--accent-1); text-decoration:underline;">Tải về</a> ở bên phải.
        </div>
      </div>`;
  }

  document.getElementById("previewFileModal").classList.add("open");
}

document.querySelectorAll("[data-close-preview]").forEach(el => {
  el.addEventListener("click", () => document.getElementById("previewFileModal").classList.remove("open"));
});

function renderAvailableTagsSelect() {
  const select = document.getElementById("availableTagsSelect");
  if (!select) return;
  const available = allHashtagsData.filter(t => !selectedTagsList.includes(t.name));
  select.innerHTML = '<option value="">-- Chọn hashtag có sẵn --</option>' +
    available.map(t => `<option value="${escapeHTML(t.name)}">#${escapeHTML(t.name)}</option>`).join('');
}

function renderSelectedTagsBox() {
  const box = document.getElementById("selectedTagsBox");
  if (!box) return;
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
  if (submitBtn.disabled) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "⏳ Đang tải lên...";

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
    await loadAllFiles();
    renderDocTable();
    switchPage("documents");
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "⬆ Tải lên";
  }
});

async function loadLeaderboard() {
  const { data } = await supabaseClient.from("user").select("user_name, score").order("score", { ascending: false }).limit(20);
  const users = data || [];

  const podiumBox = document.getElementById("podiumTop3");
  const restBody = document.getElementById("leaderboardRestBody");

  if (!podiumBox) return;
  if (users.length === 0) { podiumBox.innerHTML = '<p>Chưa có dữ liệu xếp hạng</p>'; return; }

  const top1 = users[0], top2 = users[1], top3 = users[2];
  let podiumHtml = '';
  if (top2) podiumHtml += `<div class="podium-card rank-2"><div class="podium-badge">2</div><div class="podium-avatar">${escapeHTML(top2.user_name.slice(0, 2).toUpperCase())}</div><strong>${escapeHTML(top2.user_name)}</strong><p style="color:var(--text-sub); font-size:0.85rem; margin-top:0.3rem;">${top2.score || 0} tài liệu</p></div>`;
  if (top1) podiumHtml += `<div class="podium-card rank-1"><div class="podium-badge">1</div><div class="podium-avatar">${escapeHTML(top1.user_name.slice(0, 2).toUpperCase())}</div><strong style="font-size:1.05rem;">${escapeHTML(top1.user_name)}</strong><p style="color:#f59e0b; font-weight:700; margin-top:0.3rem;">${top1.score || 0} tài liệu</p></div>`;
  if (top3) podiumHtml += `<div class="podium-card rank-3"><div class="podium-badge">3</div><div class="podium-avatar">${escapeHTML(top3.user_name.slice(0, 2).toUpperCase())}</div><strong>${escapeHTML(top3.user_name)}</strong><p style="color:var(--text-sub); font-size:0.85rem; margin-top:0.3rem;">${top3.score || 0} tài liệu</p></div>`;

  podiumBox.innerHTML = podiumHtml;

  const restUsers = users.slice(3);
  if (restBody) {
    restBody.innerHTML = restUsers.map((u, i) => `
      <tr>
        <td><strong>#${i + 4}</strong></td>
        <td>${escapeHTML(u.user_name)}</td>
        <td><strong>${u.score || 0}</strong> tài liệu</td>
      </tr>
    `).join('');
  }
}

document.getElementById("btnGoToUpload")?.addEventListener("click", () => switchPage("upload"));
document.addEventListener("click", (e) => { const nav = e.target.closest("[data-page]"); if (nav) switchPage(nav.dataset.page); });
document.getElementById("menuToggle")?.addEventListener("click", () => elSidebar.classList.toggle("open"));
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  localStorage.clear();
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

function switchPage(p) {
  const targetPage = pageTitles[p] ? p : "documents";

  document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i.dataset.page === targetPage));
  document.querySelectorAll(".page").forEach(s => s.classList.remove("active"));

  const activeEl = document.getElementById(`${targetPage}Page`);
  if (activeEl) activeEl.classList.add("active");

  if (elBreadcrumbCurrent) elBreadcrumbCurrent.textContent = pageTitles[targetPage];
  if (elSidebar) elSidebar.classList.remove("open");

  if (window.location.hash !== `#${targetPage}`) {
    history.pushState(null, "", `#${targetPage}`);
  }
}

function restorePageFromHash() {
  const saved = window.location.hash.replace("#", "");
  if (saved && pageTitles[saved]) switchPage(saved);
  else switchPage("documents");
}

function showToast(t, m) { clearTimeout(toastTimer); document.getElementById("toastTitle").textContent = t; document.getElementById("toastMessage").textContent = m; document.getElementById("toast").classList.add("show"); toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 2800); }
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
// User xóa mềm (chuyển vào Thùng rác)
async function deleteFile(fileId) {
  if (!confirm("Bạn có muốn chuyển tài liệu này vào Thùng rác?")) return;
  const { error } = await supabaseClient
    .from("file")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", fileId);

  if (error) return showToast("Lỗi", error.message);
  await loadAllFiles();
  renderDocTable();
  showToast("Đã chuyển vào Thùng rác", "");
}

// Tải danh sách Thùng rác cá nhân của User
async function loadUserTrashBin() {
  if (!currentUser) return;
  const { data } = await supabaseClient
    .from("file")
    .select("id, file_name, deleted_at, folder:id_folder(display_name)")
    .eq("id_user", currentUser.id)
    .eq("is_deleted", true)
    .order("deleted_at", { ascending: false });

  const trashList = data || [];
  const emptyEl = document.getElementById("userTrashEmptyState");
  if (emptyEl) emptyEl.hidden = trashList.length > 0;

  const body = document.getElementById("userTrashTableBody");
  if (!body) return;

  body.innerHTML = trashList.map((file, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${escapeHTML(file.file_name)}</strong></td>
      <td>${escapeHTML(file.folder?.display_name || "-")}</td>
      <td>${formatDateTime(file.deleted_at)}</td>
      <td>
        <button class="action-btn" onclick="restoreUserFile('${file.id}')" title="Khôi phục">↺ Khôi phục</button>
      </td>
    </tr>
  `).join('');
}

// User khôi phục file từ Thùng rác (User KHÔNG CÓ NÚT XÓA VĨNH VIỄN)
async function restoreUserFile(fileId) {
  await supabaseClient.from("file").update({ is_deleted: false, deleted_at: null }).eq("id", fileId);
  showToast("Đã khôi phục tài liệu thành công!", "");
  await loadUserTrashBin();
  await loadAllFiles();
}
/* ==========================================================================
   BỔ SUNG: CHỨC NĂNG THÙNG RÁC CHO USER (KHÔNG XÓA VĨNH VIỄN)
   ========================================================================== */

// 1. Chuyển file vào Thùng rác (Xóa mềm)
async function moveToTrash(fileId) {
  if (!confirm("Bạn có muốn chuyển tài liệu này vào Thùng rác không?")) return;

  try {
    const { error } = await supabaseClient
      .from('file')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString()
      })
      .eq('id', fileId);

    if (error) throw error;
    alert("✓ Đã chuyển tài liệu vào Thùng rác.");
    // Bạn có thể gọi hàm load danh sách file cũ của bạn tại đây để cập nhật UI
  } catch (err) {
    alert("❌ Lỗi chuyển vào thùng rác: " + err.message);
  }
}

// 2. Lấy danh sách file trong Thùng rác của chính User này
async function getUserTrashFiles(userId) {
  try {
    const { data, error } = await supabaseClient
      .from('file')
      .select('*')
      .eq('id_user', userId)
      .eq('is_deleted', true)
      .order('deleted_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Lỗi lấy danh sách thùng rác:", err.message);
    return [];
  }
}

// 3. Khôi phục file từ Thùng rác về danh sách chính
async function restoreUserFile(fileId) {
  try {
    const { error } = await supabaseClient
      .from('file')
      .update({
        is_deleted: false,
        deleted_at: null
      })
      .eq('id', fileId);

    if (error) throw error;
    alert("✓ Khôi phục tài liệu thành công!");
  } catch (err) {
    alert("❌ Lỗi khôi phục: " + err.message);
  }
}
// Tải Cài Đặt Tên & Logo cho giao diện User
async function loadUserSiteBrand() {
  try {
    const { data } = await supabaseClient
      .from("site_settings")
      .select("site_name, site_logo")
      .eq("id", 1)
      .maybeSingle();

    if (data) {
      const brandEl = document.querySelector(".brand");
      if (!brandEl) return;

      const brandMark = brandEl.querySelector(".brand-mark");
      const brandTitle = brandEl.querySelector("strong");

      if (brandTitle && data.site_name) {
        brandTitle.textContent = data.site_name;
        document.title = data.site_name;
      }

      if (brandMark && data.site_logo) {
        if (data.site_logo.startsWith("http://") || data.site_logo.startsWith("https://")) {
          brandMark.innerHTML = `<img src="${escapeHTML(data.site_logo)}" alt="Logo" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;
        } else {
          brandMark.textContent = data.site_logo.toUpperCase().slice(0, 2);
        }
      }
    }
  } catch (err) {
    console.warn("Chưa tải được cài đặt giao diện user:", err);
  }
}

// Gọi hàm này trong bootstrapUserPage()
document.addEventListener("DOMContentLoaded", loadUserSiteBrand);