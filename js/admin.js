/* ==========================================================================
   ADMIN.JS - Tối ưu SWR + Sửa Tên File / Folder / Hashtag cho Tất cả File
   ========================================================================== */

const pageTitles = {
  files: "Quản lý tài liệu",
  folders: "Quản lý Folder",
  hashtags: "Quản lý Hashtag",
  users: "Quản lý user",
  leaderboard: "Bảng xếp hạng",
  upload: "Upload",
  history: "Lịch sử",
  discussion: "Thảo luận",
  settings: "Cài đặt",
  trash: "Thùng rác hệ thống",
  account: "Tài khoản"
};

let currentUser = null;
let allFilesData = JSON.parse(localStorage.getItem("cache_admin_files") || "[]");
let allFoldersData = JSON.parse(localStorage.getItem("cache_folders") || "[]");
let allUsersData = JSON.parse(localStorage.getItem("cache_admin_users") || "[]");
let allHashtagsData = JSON.parse(localStorage.getItem("cache_hashtags") || "[]");
let selectedFilterTagIds = [];
let selectedTagsList = [];
let editSelectedTagsList = [];
let toastTimer;

const elSidebar = document.getElementById("sidebar");
const elBreadcrumbCurrent = document.getElementById("breadcrumbCurrent");
const elUserNameLabel = document.getElementById("userNameLabel");
const elUserAvatar = document.getElementById("userAvatar");

bootstrapAdminPage();

async function bootstrapAdminPage() {
  restorePageFromHash();
  renderFromCache();

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }

  const { data: profile } = await supabaseClient
    .from("user")
    .select("user_name, status, is_admin, is_super_admin, color")
    .eq("id", session.user.id)
    .single();

  if (!profile || !profile.status || !profile.is_admin) {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
    return;
  }

  currentUser = {
    id: session.user.id,
    name: profile.user_name || "Admin",
    email: session.user.email,
    isAdmin: true,
    isSuperAdmin: !!profile.is_super_admin
  };

  if (elUserNameLabel) elUserNameLabel.textContent = currentUser.name + (currentUser.isSuperAdmin ? " (Super Admin)" : "");
  if (elUserAvatar) elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();

  initThemeToggle(profile.color);
  await CommentModule.init("commentRoot", { userId: currentUser.id, isAdmin: true });

  const currentTab = window.location.hash.replace("#", "") || "files";
  revalidateTabData(currentTab);
}

window.addEventListener("hashchange", () => {
  restorePageFromHash();
  const currentTab = window.location.hash.replace("#", "") || "files";
  revalidateTabData(currentTab);
});

function renderFromCache() {
  populateFilterDropdowns();
  renderHashtagFilterContainer();
  renderFileTable();
  renderFolderManageList();
  renderHashtagManageList();
  renderUserTable();
}

async function revalidateTabData(tab) {
  if (tab === "files") {
    await Promise.all([loadFolders(), loadUsersList(), loadHashtagsList(), loadAllFiles()]);
    populateFilterDropdowns();
    renderHashtagFilterContainer();
    renderFileTable();
  } else if (tab === "folders") {
    await loadFolders();
    renderFolderManageList();
  } else if (tab === "hashtags") {
    await loadHashtagsList();
    renderHashtagManageList();
  } else if (tab === "users") {
    await loadUsersList();
  } else if (tab === "leaderboard") {
    await loadLeaderboard();
  } else if (tab === "history") {
    await loadHistory();
  } else if (tab === "settings") {
    await loadSettings();
  } else if (tab === "trash") {
    await loadAdminTrashBin();
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
  const { data } = await supabaseClient.from("user").select("id, user_name, status, is_admin, is_super_admin, last_sign_in_at").order("user_name");
  if (data) {
    allUsersData = data;
    localStorage.setItem("cache_admin_users", JSON.stringify(data));
    renderUserTable();
  }
}

async function loadHashtagsList() {
  const { data } = await supabaseClient.from("hashtag").select("id, name, created_at").order("name");
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
    .select("id, file_name, storage_path, bio, created_at, id_user, id_folder, status, user:id_user(user_name), folder:id_folder(display_name, bucket_name), file_hashtag(hashtag:id_hashtag(id, name))")
    .order("created_at", { ascending: false });

  if (data) {
    allFilesData = data;
    localStorage.setItem("cache_admin_files", JSON.stringify(data));
  }
}

function populateFilterDropdowns() {
  const fFolder = document.getElementById("filterFolder");
  const fUploader = document.getElementById("filterUploader");

  if (fFolder) fFolder.innerHTML = '<option value="">Tất cả Folder</option>' + allFoldersData.map(f => `<option value="${f.id}">${escapeHTML(f.display_name)}</option>`).join('');
  if (fUploader) fUploader.innerHTML = '<option value="">Tất cả người đăng</option>' + allUsersData.map(u => `<option value="${u.id}">${escapeHTML(u.user_name)}</option>`).join('');

  [document.getElementById("filterKeyword"), fFolder, fUploader].forEach(el => {
    el?.removeEventListener("input", renderFileTable);
    el?.addEventListener("input", renderFileTable);
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
      renderFileTable();
    });
  });
}

function renderFileTable() {
  const kw = (document.getElementById("filterKeyword")?.value || "").trim().toLowerCase();
  const folderId = document.getElementById("filterFolder")?.value || "";
  const uploaderId = document.getElementById("filterUploader")?.value || "";

  const filtered = allFilesData.filter(f => {
    const matchKw = !kw || f.file_name.toLowerCase().includes(kw) || (f.bio || "").toLowerCase().includes(kw) || (f.user?.user_name || "").toLowerCase().includes(kw);
    const matchFolder = !folderId || f.id_folder === folderId;
    const matchUploader = !uploaderId || f.id_user === uploaderId;

    let matchTags = true;
    if (selectedFilterTagIds.length > 0) {
      const fileTagIds = (f.file_hashtag || []).map(fh => fh.hashtag?.id).filter(Boolean);
      matchTags = selectedFilterTagIds.every(reqId => fileTagIds.includes(reqId));
    }

    return matchKw && matchFolder && matchUploader && matchTags;
  });

  const countEl = document.getElementById("fileResultCount");
  if (countEl) countEl.textContent = filtered.length;
  const emptyEl = document.getElementById("fileEmptyState");
  if (emptyEl) emptyEl.hidden = filtered.length > 0;
  const scrollEl = document.querySelector("#filesPage .table-scroll");
  if (scrollEl) scrollEl.hidden = filtered.length === 0;

  const body = document.getElementById("fileTableBody");
  if (!body) return;

  body.innerHTML = filtered.map((file, idx) => {
    const statusBadge = file.status
      ? `<span class="status active">Hoạt động</span>`
      : `<span class="status inactive">Đã ẩn</span>`;

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
        <td>${statusBadge}</td>
        <td>${formatDate(file.created_at)}</td>
        <td onclick="event.stopPropagation();">
          <div class="actions">
            <button class="action-btn" data-download-btn="${file.id}" title="Tải về trực tiếp">⬇</button>
            <button class="action-btn" data-edit-btn="${file.id}" title="Chỉnh sửa tài liệu">✏</button>
            <button class="action-btn" data-toggle-status="${file.id}" title="${file.status ? 'Ẩn' : 'Hiện'}">${file.status ? '🚫' : '↺'}</button>
            <button class="action-btn delete" data-delete-btn="${file.id}" title="Xóa vĩnh viễn">⌫</button>
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

  body.querySelectorAll("[data-toggle-status]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFileStatus(btn.dataset.toggleStatus);
    });
  });

  body.querySelectorAll("[data-delete-btn]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      purgeFile(btn.dataset.deleteBtn);
    });
  });
}

/* ================= MODAL SỬA FILE (ADMIN HAS ALL RIGHTS) ================= */
function openEditModal(fileId) {
  const file = allFilesData.find(f => f.id === fileId);
  if (!file) return;

  document.getElementById("editFileId").value = file.id;
  document.getElementById("editFileName").value = file.file_name || "";
  document.getElementById("editFileBio").value = file.bio || "";

  // Set dropdown Folders
  const folderSelect = document.getElementById("editFileFolder");
  folderSelect.innerHTML = allFoldersData.map(f => `<option value="${f.id}" ${f.id === file.id_folder ? 'selected' : ''}>${escapeHTML(f.display_name)}</option>`).join('');

  // Lấy danh sách Hashtags của file
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
    // 1. Cập nhật Tên file, Folder, Mô tả
    const { error: updateError } = await supabaseClient
      .from("file")
      .update({ file_name: newName, id_folder: newFolderId, bio: newBio })
      .eq("id", fileId);

    if (updateError) throw updateError;

    // 2. Xóa các Hashtags cũ
    await supabaseClient.from("file_hashtag").delete().eq("id_file", fileId);

    // 3. Thêm các Hashtags mới
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
    renderFileTable();
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

document.querySelectorAll("[data-close-preview]").forEach(el => el.addEventListener("click", () => document.getElementById("previewFileModal").classList.remove("open")));

function renderFolderManageList() {
  const body = document.getElementById("folderManageBody");
  if (!body) return;
  body.innerHTML = allFoldersData.map(f => `
    <tr>
      <td><strong>${escapeHTML(f.display_name)}</strong></td>
      <td><code>${escapeHTML(f.bucket_name)}</code></td>
      <td><button class="action-btn delete" data-delete-folder="${f.id}">⌫</button></td>
    </tr>
  `).join('');

  body.querySelectorAll("[data-delete-folder]").forEach(b => b.addEventListener("click", () => deleteFolder(b.dataset.deleteFolder)));
}

document.getElementById("folderForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("folderSubmitBtn");
  const input = document.getElementById("folderDisplayName");
  const name = input.value.trim();
  if (!name || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = "⏳ Đang tạo...";

  try {
    const bucketName = slugify(name);

    const { data: newFolder, error } = await supabaseClient
      .from("folder")
      .insert({ display_name: name, bucket_name: bucketName, created_by: currentUser.id })
      .select()
      .single();

    if (error) throw error;

    supabaseClient.functions.invoke("create-bucket", { body: { bucketName } });

    allFoldersData.push(newFolder);
    localStorage.setItem("cache_folders", JSON.stringify(allFoldersData));
    renderFolderManageList();
    populateFilterDropdowns();

    showToast("Đã tạo Folder mới", name);
    input.value = "";
  } catch (err) {
    showToast("Không tạo được Folder", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Thêm Folder";
  }
});

async function deleteFolder(id) {
  if (!confirm("Xóa Folder này?")) return;
  const { error } = await supabaseClient.from("folder").delete().eq("id", id);
  if (error) return showToast("Lỗi xóa", "Folder vẫn còn chứa file.");

  allFoldersData = allFoldersData.filter(f => f.id !== id);
  localStorage.setItem("cache_folders", JSON.stringify(allFoldersData));
  renderFolderManageList();
  populateFilterDropdowns();
  showToast("Đã xóa Folder", "");
}

function renderHashtagManageList() {
  const body = document.getElementById("hashtagManageBody");
  if (!body) return;
  body.innerHTML = allHashtagsData.map(h => `
    <tr>
      <td><strong>#${escapeHTML(h.name)}</strong></td>
      <td>${formatDate(h.created_at)}</td>
      <td><button class="action-btn delete" data-delete-hashtag="${h.id}">⌫</button></td>
    </tr>
  `).join('');

  body.querySelectorAll("[data-delete-hashtag]").forEach(b => b.addEventListener("click", () => deleteHashtag(b.dataset.deleteHashtag)));
}

document.getElementById("hashtagForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("hashtagSubmitBtn");
  const input = document.getElementById("hashtagName");
  const name = input.value.trim().replace(/^#/, "");
  if (!name || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = "⏳ Đang tạo...";

  try {
    const { data: newTag, error } = await supabaseClient
      .from("hashtag")
      .insert({ name, created_by: currentUser.id })
      .select()
      .single();

    if (error) throw error;

    allHashtagsData.push(newTag);
    localStorage.setItem("cache_hashtags", JSON.stringify(allHashtagsData));
    renderHashtagManageList();
    renderAvailableTagsSelect();
    renderHashtagFilterContainer();
    populateFilterDropdowns();

    showToast("Đã tạo Hashtag mới", `#${name}`);
    input.value = "";
  } catch (err) {
    showToast("Không tạo được Hashtag", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Thêm Hashtag";
  }
});

async function deleteHashtag(id) {
  if (!confirm("Xóa Hashtag này?")) return;
  await supabaseClient.from("hashtag").delete().eq("id", id);
  allHashtagsData = allHashtagsData.filter(h => h.id !== id);
  localStorage.setItem("cache_hashtags", JSON.stringify(allHashtagsData));
  renderHashtagManageList();
  renderAvailableTagsSelect();
  renderHashtagFilterContainer();
  populateFilterDropdowns();
  showToast("Đã xóa Hashtag", "");
}

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
    renderFileTable();
    switchPage("files");
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "⬆ Tải lên";
  }
});

function renderUserTable() {
  const kw = (document.getElementById("userSearchInput")?.value || "").trim().toLowerCase();
  const list = allUsersData.filter(u => (u.user_name || "").toLowerCase().includes(kw));

  const countEl = document.getElementById("userResultCount");
  if (countEl) countEl.textContent = list.length;
  const emptyEl = document.getElementById("userEmptyState");
  if (emptyEl) emptyEl.hidden = list.length > 0;
  const scrollEl = document.querySelector("#usersPage .table-scroll");
  if (scrollEl) scrollEl.hidden = list.length === 0;

  const body = document.getElementById("userTableBody");
  if (!body) return;

  body.innerHTML = list.map(user => {
    const isSelf = user.id === currentUser?.id;
    const canManageRole = currentUser?.isSuperAdmin && !isSelf && !user.is_super_admin;
    const canDelete = !isSelf && !user.is_super_admin && (currentUser?.isSuperAdmin || !user.is_admin);
    const canToggleStatus = !isSelf && (currentUser?.isSuperAdmin || !user.is_admin);

    let roleHtml = `<span class="badge">User</span>`;
    if (user.is_super_admin) roleHtml = `<span class="badge">Super Admin</span>`;
    else if (user.is_admin) roleHtml = `<span class="badge">Admin</span>`;

    return /* html */ `
      <tr>
        <td><strong>${escapeHTML(user.user_name || "-")}</strong></td>
        <td>${user.status ? '<span class="status active">Đã duyệt</span>' : '<span class="status inactive">Chờ duyệt</span>'}</td>
        <td>${roleHtml}</td>
        <td>${allFilesData.filter(f => f.id_user === user.id).length}</td>
        <td>${user.last_sign_in_at ? formatDate(user.last_sign_in_at) : "-"}</td>
        <td>
          <div class="actions">
            ${!user.status && canToggleStatus ? `<button class="action-btn" data-approve-user="${user.id}">✓</button>` : ""}
            ${user.status && canToggleStatus ? `<button class="action-btn" data-lock-user="${user.id}">🔒</button>` : ""}
            ${canManageRole ? `<button class="action-btn" data-toggle-admin="${user.id}">${user.is_admin ? "▾" : "▴"}</button>` : ""}
            ${canDelete ? `<button class="action-btn delete" data-delete-user="${user.id}">⌫</button>` : ""}
          </div>
        </td>
      </tr>`;
  }).join('');

  body.querySelectorAll("[data-approve-user]").forEach(b => b.addEventListener("click", () => setUserStatus(b.dataset.approveUser, true)));
  body.querySelectorAll("[data-lock-user]").forEach(b => b.addEventListener("click", () => setUserStatus(b.dataset.lockUser, false)));
  body.querySelectorAll("[data-toggle-admin]").forEach(b => b.addEventListener("click", () => toggleAdmin(b.dataset.toggleAdmin)));
  body.querySelectorAll("[data-delete-user]").forEach(b => b.addEventListener("click", () => deleteUser(b.dataset.deleteUser)));
}

async function setUserStatus(id, status) {
  await supabaseClient.from("user").update({ status }).eq("id", id);
  const u = allUsersData.find(x => x.id === id);
  if (u) u.status = status;
  localStorage.setItem("cache_admin_users", JSON.stringify(allUsersData));
  renderUserTable();
  showToast("Đã cập nhật trạng thái", "");
}

async function toggleAdmin(id) {
  const user = allUsersData.find(u => u.id === id);
  if (!user) return;
  await supabaseClient.from("user").update({ is_admin: !user.is_admin }).eq("id", id);
  user.is_admin = !user.is_admin;
  localStorage.setItem("cache_admin_users", JSON.stringify(allUsersData));
  renderUserTable();
  showToast("Đã đổi quyền Admin", "");
}

async function deleteUser(id) {
  if (!confirm("Xóa tài khoản này?")) return;
  await supabaseClient.functions.invoke("delete-user", { body: { userId: id } });
  allUsersData = allUsersData.filter(u => u.id !== id);
  localStorage.setItem("cache_admin_users", JSON.stringify(allUsersData));
  renderUserTable();
  showToast("Đã xóa user", "");
}

async function loadLeaderboard() {
  const { data } = await supabaseClient.from("user").select("user_name, score").order("score", { ascending: false }).limit(20);
  const users = data || [];

  const podiumBox = document.getElementById("podiumTop3");
  const restBody = document.getElementById("leaderboardRestBody");

  if (!podiumBox) return;
  if (users.length === 0) { podiumBox.innerHTML = '<p>Chưa có dữ liệu</p>'; return; }

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

async function loadHistory() {
  const [fHist, aHist] = await Promise.all([
    supabaseClient.from("history_file").select("id, created_at, change, file:id_file(file_name), user:id_user(user_name)").order("created_at", { ascending: false }).limit(100),
    supabaseClient.from("history_admin").select("id, created_at, action, actor:actor_id(user_name), target:target_id(user_name)").order("created_at", { ascending: false }).limit(100)
  ]);

  const fEntries = (fHist.data || []).map(h => ({ time: h.created_at, target: h.file?.file_name || "(file đã bị xóa)", actor: h.user?.user_name || "-", action: h.change }));
  const aEntries = (aHist.data || []).map(h => ({ time: h.created_at, target: h.target?.user_name || "-", actor: h.actor?.user_name || "-", action: h.action }));
  const merged = [...fEntries, ...aEntries].sort((a, b) => new Date(b.time) - new Date(a.time));

  const emptyEl = document.getElementById("historyEmptyState");
  if (emptyEl) emptyEl.hidden = merged.length > 0;
  const scrollEl = document.querySelector("#historyPage .table-scroll");
  if (scrollEl) scrollEl.hidden = merged.length === 0;

  const body = document.getElementById("historyTableBody");
  if (body) {
    body.innerHTML = merged.map(h => `
      <tr>
        <td>${formatDateTime(h.time)}</td>
        <td>${escapeHTML(h.target)}</td>
        <td>${escapeHTML(h.actor)}</td>
        <td>${escapeHTML(h.action)}</td>
      </tr>
    `).join('');
  }
}

async function loadSettings() {
  const { data } = await supabaseClient.from("site_setting").select("phone, email, facebook").eq("id", 1).single();
  if (!data) return;
  if (document.getElementById("settingPhone")) document.getElementById("settingPhone").value = data.phone || "";
  if (document.getElementById("settingEmail")) document.getElementById("settingEmail").value = data.email || "";
  if (document.getElementById("settingFacebook")) document.getElementById("settingFacebook").value = data.facebook || "";
}

document.getElementById("settingsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSiteSettings(); // Gọi lưu Tên web, Logo & Số ngày thùng rác
  await supabaseClient.from("site_setting").upsert({
    id: 1,
    phone: document.getElementById("settingPhone").value.trim(),
    email: document.getElementById("settingEmail").value.trim(),
    facebook: document.getElementById("settingFacebook").value.trim(),
    updated_at: new Date().toISOString()
  });
  showToast("Đã lưu tất cả cài đặt", "");
});

document.getElementById("accountForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("accountNewName").value.trim();
  const pass = document.getElementById("accountNewPassword").value;
  const currPass = document.getElementById("accountCurrentPassword").value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email: currentUser.email, password: currPass });
  if (error) return showToast("Thất bại", "Mật khẩu hiện tại không đúng.");

  if (name) await supabaseClient.from("user").update({ user_name: name }).eq("id", currentUser.id);
  if (pass) await supabaseClient.auth.updateUser({ password: pass });

  showToast("Cập nhật thành công!", "");
  document.getElementById("accountForm").reset();
});

async function toggleFileStatus(id) {
  const file = allFilesData.find(f => f.id === id);
  if (!file) return;
  await supabaseClient.from("file").update({ status: !file.status }).eq("id", id);
  file.status = !file.status;
  localStorage.setItem("cache_admin_files", JSON.stringify(allFilesData));
  renderFileTable();
  showToast("Đã cập nhật trạng thái", "");
}

// Chuyển file thành xóa mềm (vào Thùng rác)
async function purgeFile(id) {
  if (!confirm("Bạn có chắc muốn chuyển tài liệu này vào Thùng rác?")) return;
  const { error } = await supabaseClient
    .from("file")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return showToast("Lỗi", error.message);
  await loadAllFiles();
  renderFileTable();
  showToast("Đã chuyển vào Thùng rác", "");
}

// Tải danh sách Thùng rác cho Admin
async function loadAdminTrashBin() {
  const { data } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, deleted_at, id_user, folder:id_folder(display_name, bucket_name), user:id_user(user_name)")
    .eq("is_deleted", true)
    .order("deleted_at", { ascending: false });

  const trashList = data || [];
  const emptyEl = document.getElementById("adminTrashEmptyState");
  if (emptyEl) emptyEl.hidden = trashList.length > 0;

  const body = document.getElementById("adminTrashTableBody");
  if (!body) return;

  body.innerHTML = trashList.map((file, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${escapeHTML(file.file_name)}</strong></td>
      <td>${escapeHTML(file.folder?.display_name || "-")}</td>
      <td>${escapeHTML(file.user?.user_name || "Người dùng ẩn danh")}</td>
      <td>${formatDateTime(file.deleted_at)}</td>
      <td>
        <div class="actions">
          <button class="action-btn" onclick="restoreFileFromTrash('${file.id}')" title="Khôi phục">↺</button>
          <button class="action-btn delete" onclick="hardDeleteFile('${file.id}', '${file.folder?.bucket_name || 'documents'}', '${file.storage_path}')" title="Xóa vĩnh viễn">⌫</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Khôi phục file
async function restoreFileFromTrash(id) {
  await supabaseClient.from("file").update({ is_deleted: false, deleted_at: null }).eq("id", id);
  showToast("Đã khôi phục tài liệu", "");
  await loadAdminTrashBin();
  await loadAllFiles();
}

// Xóa vĩnh viễn file khỏi CSDL & Storage (Chỉ Admin)
async function hardDeleteFile(id, bucket, storagePath) {
  if (!confirm("CẢNH BÁO: Xóa vĩnh viễn sẽ mất hoàn toàn file và không thể khôi phục. Tiếp tục?")) return;
  const cleanPath = storagePath.replace(`${bucket}/`, "");
  await supabaseClient.storage.from(bucket).remove([cleanPath]);
  await supabaseClient.from("file").delete().eq("id", id);
  showToast("Đã xóa vĩnh viễn khỏi hệ thống", "");
  await loadAdminTrashBin();
}

// Lưu Tên Web, Logo & Số ngày giữ thùng rác (Bảng site_settings)
async function saveSiteSettings() {
  const siteName = document.getElementById("settingSiteName")?.value.trim();
  const siteLogo = document.getElementById("settingSiteLogo")?.value.trim();
  const trashDays = parseInt(document.getElementById("settingTrashDays")?.value) || 30;

  const { error } = await supabaseClient.from("site_settings").upsert({
    id: 1,
    site_name: siteName,
    site_logo: siteLogo,
    trash_retention_days: trashDays
  });

  if (error) showToast("Lỗi lưu cấu hình", error.message);
  else showToast("Đã lưu cấu hình hệ thống", "");
}
// 1. Chuyển file vào Thùng rác (Xóa mềm - Soft Delete)
async function purgeFile(id) {
  if (!confirm("Bạn có chắc muốn chuyển tài liệu này vào Thùng rác?")) return;
  const { error } = await supabaseClient
    .from("file")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return showToast("Lỗi", error.message);
  await loadAllFiles();
  renderFileTable();
  showToast("Đã chuyển vào Thùng rác", "");
}

// 2. Tải danh sách Thùng rác hệ thống dành cho Admin
async function loadAdminTrashBin() {
  const { data } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, deleted_at, id_user, folder:id_folder(display_name, bucket_name), user:id_user(user_name)")
    .eq("is_deleted", true)
    .order("deleted_at", { ascending: false });

  const trashList = data || [];
  const emptyEl = document.getElementById("adminTrashEmptyState");
  if (emptyEl) emptyEl.hidden = trashList.length > 0;

  const body = document.getElementById("adminTrashTableBody");
  if (!body) return;

  body.innerHTML = trashList.map((file, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${escapeHTML(file.file_name)}</strong></td>
      <td>${escapeHTML(file.folder?.display_name || "-")}</td>
      <td>${escapeHTML(file.user?.user_name || "Người dùng ẩn danh")}</td>
      <td>${formatDateTime(file.deleted_at)}</td>
      <td>
        <div class="actions">
          <button class="action-btn" onclick="restoreFileFromTrash('${file.id}')" title="Khôi phục">↺</button>
          <button class="action-btn delete" onclick="hardDeleteFile('${file.id}', '${file.folder?.bucket_name || 'documents'}', '${file.storage_path}')" title="Xóa vĩnh viễn">⌫</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// 3. Khôi phục file từ Thùng rác về danh sách chính
async function restoreFileFromTrash(id) {
  await supabaseClient.from("file").update({ is_deleted: false, deleted_at: null }).eq("id", id);
  showToast("Đã khôi phục tài liệu", "");
  await loadAdminTrashBin();
  await loadAllFiles();
}

// 4. Xóa vĩnh viễn file khỏi CSDL & Storage (Chỉ dành cho Admin)
async function hardDeleteFile(id, bucket, storagePath) {
  if (!confirm("CẢNH BÁO: Xóa vĩnh viễn sẽ mất hoàn toàn file và không thể khôi phục. Tiếp tục?")) return;
  const cleanPath = storagePath.replace(`${bucket}/`, "");
  await supabaseClient.storage.from(bucket).remove([cleanPath]);
  await supabaseClient.from("file").delete().eq("id", id);
  showToast("Đã xóa vĩnh viễn khỏi hệ thống", "");
  await loadAdminTrashBin();
}

// 5. Lưu Cấu hình Website (Tên Web, Logo, Số ngày lưu Thùng rác)
async function saveSiteSettings() {
  const siteName = document.getElementById("settingSiteName")?.value.trim();
  const siteLogo = document.getElementById("settingSiteLogo")?.value.trim();
  const trashDays = parseInt(document.getElementById("settingTrashDays")?.value) || 30;

  const { error } = await supabaseClient.from("site_settings").upsert({
    id: 1,
    site_name: siteName,
    site_logo: siteLogo,
    trash_retention_days: trashDays
  });

  if (error) showToast("Lỗi lưu cấu hình", error.message);
  else showToast("Đã lưu cấu hình hệ thống", "");
}
function slugify(t) { return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
document.getElementById("btnGoToUpload")?.addEventListener("click", () => switchPage("upload"));
document.addEventListener("click", (e) => { const nav = e.target.closest("[data-page]"); if (nav) switchPage(nav.dataset.page); });
document.getElementById("menuToggle")?.addEventListener("click", () => elSidebar.classList.toggle("open"));
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  localStorage.clear();
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

function switchPage(p) {
  const targetPage = pageTitles[p] ? p : "files";

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
  else switchPage("files");
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
/* ==========================================================================
   BỔ SUNG: CÀI ĐẶT HỆ THỐNG & THÙNG RÁC CHO ADMIN
   ========================================================================== */

// 1. Lưu Cài đặt Website (Tên web, Logo, Số ngày lưu thùng rác)
async function saveSiteSettings() {
  const nameInput = document.getElementById('settingSiteName')?.value.trim();
  const logoInput = document.getElementById('settingSiteLogo')?.value.trim();
  const trashDaysInput = parseInt(document.getElementById('settingTrashDays')?.value) || 30;

  try {
    const { error } = await supabaseClient
      .from('site_settings')
      .upsert({
        id: 1,
        site_name: nameInput,
        site_logo: logoInput,
        trash_retention_days: trashDaysInput
      });

    if (error) throw error;
    alert("✓ Đã lưu cài đặt hệ thống thành công!");
    window.location.reload();
  } catch (err) {
    alert("❌ Lỗi lưu cài đặt: " + err.message);
  }
}

// 2. Admin lấy toàn bộ danh sách file trong Thùng rác hệ thống
async function adminGetTrashBinFiles() {
  try {
    const { data, error } = await supabaseClient
      .from('file')
      .select('*, user(user_name)')
      .eq('is_deleted', true)
      .order('deleted_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("Lỗi lấy danh sách thùng rác Admin:", err.message);
    return [];
  }
}

// 3. Admin XÓA VĨNH VIỄN file khỏi hệ thống (Dành riêng cho Admin)
async function adminPermanentDelete(fileId, storagePath) {
  if (!confirm("⚠️ CẢNH BÁO: Bạn có chắc chắn muốn XÓA VĨNH VIỄN tài liệu này? Thao tác này KHÔNG THỂ HOÀN TÁC!")) {
    return;
  }

  try {
    // Xóa file trong Storage nếu có đường dẫn
    if (storagePath) {
      await supabaseClient.storage.from('documents').remove([storagePath]);
    }

    // Xóa bản ghi trong Database
    const { error: dbErr } = await supabaseClient
      .from('file')
      .delete()
      .eq('id', fileId);

    if (dbErr) throw dbErr;

    alert("✓ Đã xóa vĩnh viễn tài liệu khỏi hệ thống!");
  } catch (err) {
    alert("❌ Lỗi khi xóa vĩnh viễn: " + err.message);
  }
}