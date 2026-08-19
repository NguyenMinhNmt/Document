/* ==========================================================================
   AUTH.JS - Xử lý Đăng nhập / Đăng ký / Điều hướng theo vai trò
   Dùng cho: html/login.html
   Phụ thuộc: js/config.js (biến supabaseClient) phải nhúng TRƯỚC file này
   ========================================================================== */

// ---------- 1. LẤY CÁC PHẦN TỬ TRÊN GIAO DIỆN ----------
const elTabLoginBtn = document.getElementById("tabLoginBtn");
const elTabRegisterBtn = document.getElementById("tabRegisterBtn");
const elLoginForm = document.getElementById("loginForm");
const elRegisterForm = document.getElementById("registerForm");
const elAuthMessage = document.getElementById("authMessage");
const elLoginSubmitBtn = document.getElementById("loginSubmitBtn");
const elRegisterSubmitBtn = document.getElementById("registerSubmitBtn");

const elAuthContact = document.getElementById("authContact");
const elAuthContactList = document.getElementById("authContactList");

// ---------- 2. KHỞI CHẠY KHI VÀO TRANG ----------
bootstrapAuthPage();

async function bootstrapAuthPage() {
  // Nếu người dùng đã đăng nhập sẵn (còn phiên), tự động điều hướng luôn
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await redirectByRole(session.user.id);
  }

  loadContactInfo();
}

// Lấy thông tin liên hệ Admin (bảng site_setting, luôn chỉ có 1 dòng id=1)
async function loadContactInfo() {
  const { data, error } = await supabaseClient
    .from("site_setting")
    .select("phone, email, facebook")
    .eq("id", 1)
    .single();

  if (error || !data) return; // im lặng bỏ qua, không cản trở việc đăng nhập

  let html = "";
  if (data.phone) {
    html += `<a href="tel:${escapeAttr(data.phone)}">📞 ${escapeAttr(data.phone)}</a>`;
  }
  if (data.email) {
    html += `<a href="mailto:${escapeAttr(data.email)}">✉️ ${escapeAttr(data.email)}</a>`;
  }
  if (data.facebook) {
    html += `<a href="${escapeAttr(data.facebook)}" target="_blank" rel="noopener">💬 Facebook</a>`;
  }

  if (html) {
    elAuthContactList.innerHTML = html;
    elAuthContact.hidden = false;
  }
}

// ---------- 3. GẮN SỰ KIỆN ----------
elTabLoginBtn.addEventListener("click", () => switchTab("login"));
elTabRegisterBtn.addEventListener("click", () => switchTab("register"));
elLoginForm.addEventListener("submit", handleLogin);
elRegisterForm.addEventListener("submit", handleRegister);

// ---------- 4. CHUYỂN TAB ĐĂNG NHẬP / ĐĂNG KÝ ----------
function switchTab(tab) {
  const isLogin = tab === "login";

  elTabLoginBtn.classList.toggle("active", isLogin);
  elTabRegisterBtn.classList.toggle("active", !isLogin);
  elLoginForm.classList.toggle("active", isLogin);
  elRegisterForm.classList.toggle("active", !isLogin);

  hideMessage();
}

// ---------- 5. XỬ LÝ ĐĂNG NHẬP ----------
async function handleLogin(event) {
  event.preventDefault();
  hideMessage();
  setLoading(elLoginSubmitBtn, true, "Đang đăng nhập...");

  const rawInput = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    // Nếu người dùng gõ không có "@" -> hiểu là Username, cần tra ra email thật trước
    let email = rawInput;
    if (!rawInput.includes("@")) {
      const { data: foundEmail, error: lookupError } = await supabaseClient.rpc(
        "get_email_by_username",
        { input_username: rawInput }
      );

      if (lookupError || !foundEmail) {
        showMessage("Không tìm thấy tài khoản với tên đăng nhập này.", "error");
        return;
      }
      email = foundEmail;
    }

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) throw authError;

    // Kiểm tra hồ sơ trong bảng "user": status có được duyệt chưa, is_admin
    const { data: profile, error: profileError } = await supabaseClient
      .from("user")
      .select("status, is_admin")
      .eq("id", authData.user.id)
      .single();

    if (profileError) throw profileError;

    if (!profile.status) {
      // Tài khoản chưa được Admin duyệt -> không cho vào, đăng xuất lại luôn
      await supabaseClient.auth.signOut();
      showMessage("Tài khoản của bạn chưa được Admin duyệt. Vui lòng chờ hoặc liên hệ quản trị viên.", "error");
      return;
    }

    // Cập nhật thời gian đăng nhập gần nhất
    await supabaseClient
      .from("user")
      .update({ last_sign_in_at: new Date().toISOString() })
      .eq("id", authData.user.id);

    showMessage("Đăng nhập thành công, đang chuyển hướng...", "success");
    window.location.href = profile.is_admin ? "/html/admin.html" : "/html/user.html";
  } catch (error) {
    showMessage(translateAuthError(error), "error");
  } finally {
    setLoading(elLoginSubmitBtn, false, "Đăng nhập");
  }
}

// ---------- 6. XỬ LÝ ĐĂNG KÝ ----------
async function handleRegister(event) {
  event.preventDefault();
  hideMessage();
  setLoading(elRegisterSubmitBtn, true, "Đang tạo tài khoản...");

  const userName = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;

  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;

    // Trigger "on_auth_user_created" bên Supabase đã tự tạo dòng trong bảng "user".
    // Ở đây mình cập nhật thêm user_name mà lúc đăng ký người dùng nhập vào.
    if (data.user) {
      await supabaseClient
        .from("user")
        .update({ user_name: userName })
        .eq("id", data.user.id);
    }

    showMessage(
      "Tạo tài khoản thành công! Tài khoản cần Admin duyệt trước khi đăng nhập được.",
      "success"
    );
    elRegisterForm.reset();
    setTimeout(() => switchTab("login"), 1800);
  } catch (error) {
    showMessage(translateAuthError(error), "error");
  } finally {
    setLoading(elRegisterSubmitBtn, false, "Tạo tài khoản");
  }
}

// ---------- 7. ĐIỀU HƯỚNG THEO VAI TRÒ (dùng khi đã có sẵn phiên đăng nhập) ----------
async function redirectByRole(userId) {
  const { data: profile } = await supabaseClient
    .from("user")
    .select("status, is_admin")
    .eq("id", userId)
    .single();

  if (!profile || !profile.status) return; // chưa được duyệt -> ở lại trang login

  window.location.href = profile.is_admin ? "/html/admin.html" : "/html/user.html";
}

// ---------- 8. HÀM TIỆN ÍCH ----------
function showMessage(text, type) {
  elAuthMessage.textContent = text;
  elAuthMessage.className = `auth-message show ${type}`;
}

function hideMessage() {
  elAuthMessage.className = "auth-message";
}

function setLoading(button, isLoading, label) {
  button.disabled = isLoading;
  button.textContent = label;
}

// Thoát ký tự đặc biệt khi chèn dữ liệu từ DB vào thuộc tính HTML (tránh lỗi/injection)
function escapeAttr(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
  });
}

// Dịch một số lỗi phổ biến của Supabase Auth sang tiếng Việt cho dễ hiểu
function translateAuthError(error) {
  const msg = error?.message || "";

  if (msg.includes("Invalid login credentials")) return "Sai email hoặc mật khẩu.";
  if (msg.includes("User already registered")) return "Email này đã được đăng ký trước đó.";
  if (msg.includes("Password should be at least")) return "Mật khẩu cần tối thiểu 6 ký tự.";
  if (msg.includes("Unable to validate email address")) return "Email không hợp lệ.";

  return msg || "Có lỗi xảy ra, vui lòng thử lại.";
}