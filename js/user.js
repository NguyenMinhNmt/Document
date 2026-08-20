/* ==========================================================================
   USER.JS - Xử lý toàn bộ trang User: Tài liệu / Upload / Tìm kiếm / Thảo luận
   Dùng cho: html/user.html
   Phụ thuộc: js/config.js, js/comment.js (nhúng TRƯỚC file này)
   ========================================================================== */

// ---------- 1. TRẠNG THÁI DÙNG CHUNG TOÀN FILE ----------
let currentUser = null;      // { id, name }
let folderList = [];         // cache toàn bộ folder (lấy 1 lần)
let currentFolderId = null;  // folder đang được chọn xem, null = đang ở lưới folder
let searchDataLoaded = false; // tránh load lại danh sách tìm kiếm nhiều lần
let allSearchableFiles = []; // cache toàn bộ file dùng cho tab Tìm kiếm
let toastTimer;

// ---------- 2. LẤY PHẦN TỬ HTML HAY DÙNG ----------
const elSidebar = document.getElementById("sidebar");
const elBreadcrumbCurrent = document.getElementById("breadcrumbCurrent");
const elUserNameLabel = document.getElementById("userNameLabel");
const elUserAvatar = document.getElementById("userAvatar");

// ---------- 3. KHỞI CHẠY TRANG (auth guard + tải dữ liệu ban đầu) ----------
bootstrapUserPage();

async function bootstrapUserPage() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from("user")
    .select("user_name, status, is_admin")
    .eq("id", session.user.id)
    .single();

  if (error || !profile || !profile.status) {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
    return;
  }

  // Admin thì không ở trang User, đẩy sang trang riêng
  if (profile.is_admin) {
    window.location.href = "admin.html";
    return;
  }

  currentUser = { id: session.user.id, name: profile.user_name || "Người dùng", email: session.user.email };
  elUserNameLabel.textContent = currentUser.name;
  elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();

  await loadFolders();
  await CommentModule.init("commentRoot", { userId: currentUser.id, isAdmin: false });
  restorePageFromHash();
}

// ---------- 4. ĐIỀU HƯỚNG GIỮA CÁC TAB ----------
document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-page]");
  if (nav) switchPage(nav.dataset.page);
});

document.getElementById("menuToggle").addEventListener("click", () => {
  elSidebar.classList.toggle("open");
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

const pageTitles = {
  documents: "Tài liệu",
  upload: "Upload",
  search: "Tìm kiếm",
  discussion: "Thảo luận",
  account: "Tài khoản",
};

function switchPage(page) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });

  document.querySelectorAll(".page").forEach((section) => section.classList.remove("active"));
  document.getElementById(`${page}Page`).classList.add("active");
  elBreadcrumbCurrent.textContent = pageTitles[page];
  elSidebar.classList.remove("open");

  // Ghi nhớ tab đang mở vào URL -> F5 lại vẫn giữ đúng tab, không nhảy về tab đầu
  if (window.location.hash !== `#${page}`) {
    history.replaceState(null, "", `#${page}`);
  }

  if (page === "search" && !searchDataLoaded) {
    loadSearchData();
  }
}

// Khôi phục lại đúng tab đã mở trước đó (dựa vào URL hash) sau khi bootstrap xong
function restorePageFromHash() {
  const savedPage = window.location.hash.replace("#", "");
  if (savedPage && pageTitles[savedPage]) {
    switchPage(savedPage);
  }
}

// ==========================================================================
// TAB: TÀI LIỆU (folder -> file)
// ==========================================================================

async function loadFolders() {
  const { data, error } = await supabaseClient
    .from("folder")
    .select("id, display_name, bucket_name")
    .order("display_name");

  if (error) {
    showToast("Không tải được folder", error.message);
    return;
  }

  folderList = data || [];
  await loadFolderFileCounts();
  renderFolderGrid();
}

// Đếm số file (đang hoạt động) trong từng folder, hiện dưới tên folder
async function loadFolderFileCounts() {
  const results = await Promise.all(
    folderList.map(async (folder) => {
      const { count } = await supabaseClient
        .from("file")
        .select("id", { count: "exact", head: true })
        .eq("id_folder", folder.id)
        .eq("status", true);
      return { id: folder.id, count: count || 0 };
    })
  );
  const countMap = Object.fromEntries(results.map((r) => [r.id, r.count]));
  folderList = folderList.map((f) => ({ ...f, fileCount: countMap[f.id] || 0 }));
}

function renderFolderGrid() {
  const grid = document.getElementById("folderGrid");
  grid.innerHTML = folderList
    .map(
      (folder) => /* html */ `
      <article class="stat-card" data-folder-id="${folder.id}">
        <span class="stat-icon">▦</span>
        <div class="stat-copy">
          <strong>${escapeHTML(folder.display_name)}</strong>
          <span>${folder.fileCount ?? 0} file</span>
        </div>
        <b>›</b>
      </article>`
    )
    .join("");

  grid.querySelectorAll("[data-folder-id]").forEach((card) => {
    card.addEventListener("click", () => openFolder(card.dataset.folderId));
  });

  // Chỉ hiện mũi tên lướt ngang khi tràn khỏi màn hình (không cần thiết thì tự ẩn)
  const prevBtn = document.getElementById("folderPrevBtn");
  const nextBtn = document.getElementById("folderNextBtn");
  const canScroll = grid.scrollWidth > grid.clientWidth;
  prevBtn.hidden = !canScroll;
  nextBtn.hidden = !canScroll;
}

document.getElementById("folderPrevBtn").addEventListener("click", () => {
  document.getElementById("folderGrid").scrollBy({ left: -240, behavior: "smooth" });
});
document.getElementById("folderNextBtn").addEventListener("click", () => {
  document.getElementById("folderGrid").scrollBy({ left: 240, behavior: "smooth" });
});

async function openFolder(folderId) {
  currentFolderId = folderId;
  const folder = folderList.find((f) => f.id === folderId);

  document.getElementById("documentsTitle").textContent = folder.display_name;
  document.getElementById("documentsDesc").textContent = "Danh sách file trong folder này";

  // Mobile (màn hẹp): chuyển hẳn qua màn hình file, ẩn lưới folder đi
  // PC (màn rộng): giữ nguyên lưới folder ở trên, chỉ hiện thêm khối file bên dưới
  const isMobile = window.innerWidth <= 640;
  document.querySelector(".folder-scroll-wrap").hidden = isMobile;

  document.getElementById("fileListCard").hidden = false;
  document.getElementById("backToFoldersBtn").hidden = false;

  await loadFilesInFolder(folderId);
}

document.getElementById("backToFoldersBtn").addEventListener("click", () => {
  currentFolderId = null;
  document.getElementById("documentsTitle").textContent = "Tất cả folder";
  document.getElementById("documentsDesc").textContent = "Chọn 1 folder để xem file bên trong";
  document.querySelector(".folder-scroll-wrap").hidden = false;
  document.getElementById("fileListCard").hidden = true;
  document.getElementById("backToFoldersBtn").hidden = true;
});

async function loadFilesInFolder(folderId) {
  const { data, error } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, bio, created_at, id_user, status, user:id_user(user_name)")
    .eq("id_folder", folderId)
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Không tải được file", error.message);
    return;
  }

  // User thấy: mọi file đang hoạt động (status=true) + file CỦA CHÍNH MÌNH dù đang bị ẩn
  const visibleFiles = (data || []).filter((f) => f.status || f.id_user === currentUser.id);
  renderFileList(visibleFiles);
}

function renderFileList(files) {
  const body = document.getElementById("fileListBody");
  document.getElementById("fileCount").textContent = files.length;
  document.getElementById("fileEmptyState").hidden = files.length > 0;
  document.querySelector("#fileListCard .table-scroll").hidden = files.length === 0;

  body.innerHTML = files.map((file) => renderFileRow(file)).join("");
  attachFileRowEvents(body);
}

function renderFileRow(file) {
  const isOwner = file.id_user === currentUser.id;
  const uploaderName = file.user?.user_name || "?";
  const statusBadge = file.status
    ? `<span class="status active">Hoạt động</span>`
    : `<span class="status inactive">Đã ẩn</span>`;

  return /* html */ `
    <tr data-file-id="${file.id}" data-storage-path="${escapeAttr(file.storage_path)}">
      <td>${escapeHTML(file.file_name)}</td>
      <td>${escapeHTML(uploaderName)}</td>
      <td>${formatDate(file.created_at)}</td>
      <td>${escapeHTML(file.bio || "-")}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="actions">
          <button class="action-btn" data-view-file title="Xem">👁</button>
          <button class="action-btn" data-download-file title="Tải về">⬇</button>
          ${isOwner ? `<button class="action-btn" data-rename-file title="Đổi tên">✎</button>` : ""}
          ${isOwner
      ? `<button class="action-btn" data-toggle-status="${file.status}" title="${file.status ? "Ẩn file" : "Hiện lại file"}">${file.status ? "🚫" : "↺"}</button>`
      : ""}
        </div>
      </td>
    </tr>`;
}

function attachFileRowEvents(container) {
  container.querySelectorAll("tr[data-file-id]").forEach((row) => {
    const fileId = row.dataset.fileId;
    const storagePath = row.dataset.storagePath;

    row.querySelector("[data-view-file]")?.addEventListener("click", () => {
      // Mở sẵn 1 tab trắng NGAY LÚC bấm (đồng bộ) để trình duyệt mobile không chặn popup
      const newTab = window.open("", "_blank");
      openFileUrl(storagePath, false, newTab);
    });
    row.querySelector("[data-download-file]")?.addEventListener("click", () => {
      const newTab = window.open("", "_blank");
      openFileUrl(storagePath, true, newTab);
    });
    row.querySelector("[data-rename-file]")?.addEventListener("click", () => renameFile(fileId, row));

    const toggleBtn = row.querySelector("[data-toggle-status]");
    if (toggleBtn) {
      const currentStatus = toggleBtn.dataset.toggleStatus === "true";
      toggleBtn.addEventListener("click", () => toggleFileStatus(fileId, currentStatus));
    }
  });
}

async function openFileUrl(storagePath, isDownload, targetWindow) {
  const bucketName = storagePath.split("/")[0];
  const pathInsideBucket = storagePath.split("/").slice(1).join("/");
  const extension = pathInsideBucket.split(".").pop().toLowerCase();

  const { data, error } = await supabaseClient.storage
    .from(bucketName)
    .createSignedUrl(pathInsideBucket, 300, isDownload ? { download: true } : undefined);

  if (error) {
    showToast("Không mở được file", error.message);
    targetWindow?.close();
    return;
  }

  if (isDownload) {
    if (targetWindow) targetWindow.location.href = data.signedUrl;
    else window.open(data.signedUrl, "_blank");
    return;
  }

  // PDF/ảnh trình duyệt tự xem được -> mở thẳng
  // Word/Excel/PowerPoint trình duyệt KHÔNG tự xem được -> nhờ Google Docs Viewer hiển thị hộ
  const officeExtensions = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  const finalUrl = officeExtensions.includes(extension)
    ? `https://docs.google.com/gview?url=${encodeURIComponent(data.signedUrl)}&embedded=true`
    : data.signedUrl;

  if (targetWindow) targetWindow.location.href = finalUrl;
  else window.open(finalUrl, "_blank");
}

async function renameFile(fileId, row) {
  const oldName = row.children[0].textContent;
  const newName = prompt("Nhập tên mới cho file:", oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;

  const { error } = await supabaseClient
    .from("file")
    .update({ file_name: newName.trim(), updated_at: new Date().toISOString() })
    .eq("id", fileId);

  if (error) {
    showToast("Không đổi tên được", error.message);
    return;
  }

  await logHistory(fileId, "Đã sửa");
  showToast("Đã đổi tên file", "");
  if (currentFolderId) await loadFilesInFolder(currentFolderId);
}

async function toggleFileStatus(fileId, currentStatus) {
  const newStatus = !currentStatus;
  const confirmMsg = newStatus
    ? "Hiện lại file này? Mọi user khác sẽ thấy được trong folder."
    : "Ẩn file này? Chỉ mình bạn còn thấy được (Admin vẫn thấy), có thể hiện lại bất kỳ lúc nào.";
  if (!confirm(confirmMsg)) return;

  const { error } = await supabaseClient.from("file").update({ status: newStatus }).eq("id", fileId);

  if (error) {
    showToast("Không cập nhật được", error.message);
    return;
  }

  await logHistory(fileId, newStatus ? "Đã sửa" : "Đã xóa");
  showToast(newStatus ? "Đã hiện lại file" : "Đã ẩn file", "");
  if (currentFolderId) await loadFilesInFolder(currentFolderId);
}

async function logHistory(fileId, change) {
  await supabaseClient.from("history_file").insert({
    id_file: fileId,
    id_user: currentUser.id,
    change,
  });
}

// ==========================================================================
// TAB: UPLOAD
// ==========================================================================

document.getElementById("uploadForm").addEventListener("submit", handleUpload);

// Đổ danh sách folder vào ô select ngay khi có dữ liệu folder (gọi lại sau loadFolders)
const originalLoadFolders = loadFolders;
loadFolders = async function () {
  await originalLoadFolders();
  const select = document.getElementById("uploadFolder");
  select.innerHTML =
    `<option value="">-- Chọn folder --</option>` +
    folderList.map((f) => `<option value="${f.id}">${escapeHTML(f.display_name)}</option>`).join("");
};

async function handleUpload(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("uploadSubmitBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Đang tải lên...";

  try {
    const folderId = document.getElementById("uploadFolder").value;
    const folder = folderList.find((f) => f.id === folderId);
    const fileInput = document.getElementById("uploadFile");
    const rawFile = fileInput.files[0];
    const bio = document.getElementById("uploadBio").value.trim();
    let displayName = document.getElementById("uploadName").value.trim() || rawFile.name;

    if (!folder) throw new Error("Vui lòng chọn folder.");
    if (!rawFile) throw new Error("Vui lòng chọn file để tải lên.");

    // Kiểm tra trùng tên: chỉ chặn nếu trùng với file của CHÍNH MÌNH trong CÙNG folder
    displayName = await resolveDuplicateName(displayName, folderId);

    // Tên file lưu trong Storage tách biệt với tên hiển thị, tránh trùng/ký tự lạ
    const safeExt = rawFile.name.includes(".") ? rawFile.name.split(".").pop() : "";
    const storageFileName = `${crypto.randomUUID()}${safeExt ? "." + safeExt : ""}`;
    const storagePath = `${folder.bucket_name}/${currentUser.id}/${storageFileName}`;
    const pathInsideBucket = `${currentUser.id}/${storageFileName}`;

    const { error: uploadError } = await supabaseClient.storage
      .from(folder.bucket_name)
      .upload(pathInsideBucket, rawFile);
    if (uploadError) throw uploadError;

    const { data: newFile, error: insertError } = await supabaseClient
      .from("file")
      .insert({
        file_name: displayName,
        storage_path: storagePath,
        id_folder: folderId,
        id_user: currentUser.id,
        bio,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    await logHistory(newFile.id, "Đã thêm");

    showToast("Tải lên thành công", `File "${displayName}" đã được lưu.`);
    document.getElementById("uploadForm").reset();
    searchDataLoaded = false; // để lần sau vào tab Tìm kiếm sẽ tải lại danh sách mới
  } catch (error) {
    showToast("Tải lên thất bại", error.message || "Vui lòng thử lại.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "⬆ Tải lên";
  }
}

// Nếu trùng tên với file của chính user này trong cùng folder -> tự thêm hậu tố (1), (2)...
async function resolveDuplicateName(name, folderId) {
  const { data } = await supabaseClient
    .from("file")
    .select("file_name")
    .eq("id_folder", folderId)
    .eq("id_user", currentUser.id)
    .eq("status", true);

  const existingNames = new Set((data || []).map((f) => f.file_name));
  if (!existingNames.has(name)) return name;

  let counter = 1;
  let candidate = `${name} (${counter})`;
  while (existingNames.has(candidate)) {
    counter += 1;
    candidate = `${name} (${counter})`;
  }
  return candidate;
}

// ==========================================================================
// TAB: TÌM KIẾM (live search, lọc phía client giống bảng dữ liệu thông thường)
// ==========================================================================

document.getElementById("searchInput").addEventListener("input", renderSearchResults);

async function loadSearchData() {
  const { data, error } = await supabaseClient
    .from("file")
    .select("id, file_name, storage_path, id_user, status, user:id_user(user_name), folder:id_folder(display_name)")
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Không tải được dữ liệu tìm kiếm", error.message);
    return;
  }

  // Chỉ hiện: file đang hoạt động, HOẶC file của chính mình dù đang bị ẩn
  allSearchableFiles = (data || []).filter((f) => f.status || f.id_user === currentUser.id);
  searchDataLoaded = true;
  renderSearchResults();
}

function renderSearchResults() {
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();

  const results = allSearchableFiles.filter((file) => {
    const haystack = `${file.id} ${file.file_name} ${file.user?.user_name || ""}`.toLowerCase();
    return haystack.includes(keyword);
  });

  document.getElementById("searchResultCount").textContent = results.length;
  document.getElementById("searchEmptyState").hidden = results.length > 0;
  document.querySelector("#searchPage .table-scroll").hidden = results.length === 0;

  const body = document.getElementById("searchResultBody");
  body.innerHTML = results
    .map((file) => {
      const isOwner = file.id_user === currentUser.id;
      const statusBadge = file.status
        ? `<span class="status active">Hoạt động</span>`
        : `<span class="status inactive">Đã ẩn</span>`;
      return /* html */ `
      <tr data-file-id="${file.id}" data-storage-path="${escapeAttr(file.storage_path)}">
        <td>#${file.id}</td>
        <td>${escapeHTML(file.file_name)}</td>
        <td>${escapeHTML(file.folder?.display_name || "-")}</td>
        <td>${escapeHTML(file.user?.user_name || "-")}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="actions">
            <button class="action-btn" data-view-file title="Xem">👁</button>
            <button class="action-btn" data-download-file title="Tải về">⬇</button>
            ${isOwner
          ? `<button class="action-btn" data-toggle-status="${file.status}" title="${file.status ? "Ẩn file" : "Hiện lại file"}">${file.status ? "🚫" : "↺"}</button>`
          : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  attachFileRowEvents(body);
}

// ==========================================================================
// TAB: TÀI KHOẢN (đổi tên hiển thị / đổi mật khẩu - cần xác thực mật khẩu hiện tại)
// ==========================================================================

document.getElementById("accountForm").addEventListener("submit", handleUpdateAccount);

async function handleUpdateAccount(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("accountSubmitBtn");
  submitBtn.disabled = true;

  try {
    const newName = document.getElementById("accountNewName").value.trim();
    const newPassword = document.getElementById("accountNewPassword").value;
    const confirmPassword = document.getElementById("accountConfirmPassword").value;
    const currentPassword = document.getElementById("accountCurrentPassword").value;

    if (!newName && !newPassword) {
      throw new Error("Bạn chưa nhập gì để cập nhật.");
    }
    if (newPassword && newPassword !== confirmPassword) {
      throw new Error("Mật khẩu mới nhập lại không khớp.");
    }
    if (newPassword && newPassword.length < 6) {
      throw new Error("Mật khẩu mới cần tối thiểu 6 ký tự.");
    }

    // Xác thực lại bằng mật khẩu HIỆN TẠI trước khi cho đổi bất cứ thứ gì
    const { error: reauthError } = await supabaseClient.auth.signInWithPassword({
      email: currentUser.email,
      password: currentPassword,
    });
    if (reauthError) throw new Error("Mật khẩu hiện tại không đúng.");

    if (newName) {
      const { error } = await supabaseClient.from("user").update({ user_name: newName }).eq("id", currentUser.id);
      if (error) throw error;
      currentUser.name = newName;
      elUserNameLabel.textContent = currentUser.name;
      elUserAvatar.textContent = currentUser.name.slice(0, 2).toUpperCase();
    }

    if (newPassword) {
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      if (error) throw error;
    }

    showToast("Đã cập nhật tài khoản", "");
    document.getElementById("accountForm").reset();
  } catch (error) {
    showToast("Không cập nhật được", error.message || "Vui lòng thử lại.");
  } finally {
    submitBtn.disabled = false;
  }
}

// ==========================================================================
// HÀM TIỆN ÍCH DÙNG CHUNG
// ==========================================================================

function showToast(title, message) {
  clearTimeout(toastTimer);
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastMessage").textContent = message;
  document.getElementById("toast").classList.add("show");
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 2800);
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("vi-VN");
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
  });
}

function escapeAttr(value = "") {
  return escapeHTML(value);
}