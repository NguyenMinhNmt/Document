/* ==========================================================================
   AUTH.JS - Đăng nhập bằng Username/Email & Đăng ký Chờ Admin duyệt
   ========================================================================== */

let currentAuthMode = "LOGIN";
let toastTimer;

// DOM Elements
const elTitle = document.getElementById("authTitle");
const elSubTitle = document.getElementById("authSubTitle");
const formLogin = document.getElementById("loginForm");
const formRegister = document.getElementById("registerForm");

// Chuyển đổi giao diện giữa Đăng nhập và Đăng ký
document.getElementById("btnShowRegister")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthMode("REGISTER");
});

document.getElementById("btnShowLoginFromReg")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthMode("LOGIN");
});

function switchAuthMode(mode) {
  currentAuthMode = mode;
  if (formLogin) formLogin.hidden = true;
  if (formRegister) formRegister.hidden = true;

  if (mode === "LOGIN") {
    if (elTitle) elTitle.textContent = "Đăng nhập tài khoản";
    if (elSubTitle) elSubTitle.textContent = "Hệ thống chia sẻ tài liệu trực tuyến";
    if (formLogin) formLogin.hidden = false;
  } else if (mode === "REGISTER") {
    if (elTitle) elTitle.textContent = "Tạo tài khoản mới";
    if (elSubTitle) elSubTitle.textContent = "Điền đầy đủ thông tin để đăng ký";
    if (formRegister) formRegister.hidden = false;
  }
}

/* ================= 1. ĐĂNG NHẬP (HỖ TRỢ CẢ USERNAME VÀ EMAIL) ================= */
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputAccount = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Đang kiểm tra...";
  }

  try {
    let targetEmail = inputAccount;

    // 1. Tìm thông tin trong bảng public.user theo Username hoặc Email
    const { data: userRecords, error: dbErr } = await supabaseClient
      .from("user")
      .select("id, user_name, status, is_admin, email")
      .or(`user_name.ilike.${inputAccount},email.ilike.${inputAccount}`);

    const userProfile = userRecords && userRecords[0];

    if (!userProfile) {
      throw new Error("Tên tài khoản (Username) hoặc Email không tồn tại trong hệ thống.");
    }

    // 2. Kiểm tra trạng thái duyệt tài khoản
    if (!userProfile.status) {
      throw new Error("Tài khoản của bạn đang trong trạng thái CHỜ ADMIN DUYỆT.");
    }

    // 3. Nếu người dùng nhập Username -> Lấy Email tương ứng đã lưu trong bảng user
    if (userProfile.email) {
      targetEmail = userProfile.email;
    }

    // 4. Đăng nhập thực tế vào Supabase Auth bằng Email
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: targetEmail,
      password
    });

    if (authError) {
      throw new Error("Mật khẩu không chính xác.");
    }

    showToast("Thành công!", "Đăng nhập thành công, đang chuyển hướng...");
    setTimeout(() => {
      window.location.href = userProfile.is_admin ? "admin.html" : "user.html";
    }, 1000);

  } catch (err) {
    showToast("Đăng nhập thất bại", err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Đăng nhập";
    }
  }
});

/* ================= 2. XỬ LÝ ĐĂNG KÝ TÀI KHOẢN MỚI ================= */
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const regName = document.getElementById("regName")?.value.trim();
  const regEmail = document.getElementById("regEmail")?.value.trim();
  const regPass = document.getElementById("regPassword")?.value;
  const btn = document.getElementById("regSubmitBtn");

  if (!regName || !regEmail || !regPass) {
    return showToast("Lỗi", "Vui lòng nhập đầy đủ thông tin.");
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Đang tạo tài khoản...";
  }

  try {
    // 1. Kiểm tra sự tồn tại trong cơ sở dữ liệu trước khi cho phép đăng ký
    const { data: existingUsers } = await supabaseClient
      .from("user")
      .select("id, status, user_name, email");

    // Kiểm tra trùng Username
    const isNameTaken = existingUsers?.some(u => u.user_name?.toLowerCase() === regName.toLowerCase());
    if (isNameTaken) {
      throw new Error("Tên hiển thị (Username) này đã được sử dụng. Vui lòng chọn tên khác.");
    }

    // Kiểm tra trùng Email
    const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === regEmail.toLowerCase());
    if (existingUser) {
      if (existingUser.status) {
        throw new Error("Email này đã được đăng ký và đang hoạt động. Vui lòng Đăng nhập.");
      } else {
        throw new Error("Email này đã đăng ký và ĐANG CHỜ ADMIN DUYỆT. Không thể đăng ký lại!");
      }
    }

    // 2. Tạo tài khoản trong Supabase Auth
    const { data: authData, error: signUpErr } = await supabaseClient.auth.signUp({
      email: regEmail,
      password: regPass
    });

    if (signUpErr) throw signUpErr;

    // 3. Lưu hồ sơ thông tin vào bảng public.user với trạng thái chưa duyệt (status = false)
    if (authData?.user) {
      const { error: insertErr } = await supabaseClient.from("user").insert({
        id: authData.user.id,
        user_name: regName,
        email: regEmail,
        status: false // Đợi Admin duyệt
      });

      if (insertErr) throw insertErr;
    }

    showToast("Đăng ký thành công!", "Tài khoản của bạn đã được gửi đến Admin để chờ kiểm duyệt.");
    setTimeout(() => switchAuthMode("LOGIN"), 2000);

  } catch (err) {
    showToast("Đăng ký thất bại", err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Đăng ký tài khoản";
    }
  }
});

/* ================= TIỆN ÍCH THÔNG BÁO (TOAST) ================= */
function showToast(t, m) {
  clearTimeout(toastTimer);
  const elToast = document.getElementById("toast");
  const elTitle = document.getElementById("toastTitle");
  const elMsg = document.getElementById("toastMessage");

  if (elToast && elTitle && elMsg) {
    elTitle.textContent = t;
    elMsg.textContent = m;
    elToast.classList.add("show");
    toastTimer = setTimeout(() => elToast.classList.remove("show"), 4000);
  } else {
    alert(`${t}: ${m}`);
  }
}