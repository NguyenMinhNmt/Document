/* ==========================================================================
   AUTH.JS - XỬ LÝ ĐĂNG NHẬP, ĐĂNG KÝ VÀ QUÊN MẬT KHẨU TRỰC TIẾP (KHÔNG DÙNG OTP)
   ========================================================================== */

let authIntent = "LOGIN";
let currentResetEmail = "";
let toastTimer;

const formLogin = document.getElementById("loginForm");
const formRegister = document.getElementById("registerForm");
const formOtp = document.getElementById("otpForm");
const formResetPassword = document.getElementById("resetPasswordForm");
const elTitle = document.getElementById("authTitle");
const elSubTitle = document.getElementById("authSubTitle");

async function loadSiteSettings() {
  try {
    const { data } = await supabaseClient
      .from('site_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (data) {
      if (document.getElementById('siteName')) document.getElementById('siteName').textContent = data.site_name || 'Web Tài Liệu';

      const logoContainer = document.getElementById('siteLogoContainer');
      if (logoContainer && data.site_logo) {
        if (data.site_logo.startsWith('http://') || data.site_logo.startsWith('https://')) {
          logoContainer.innerHTML = `<img src="${data.site_logo}" alt="Logo">`;
        } else {
          document.getElementById('siteLogoText').textContent = data.site_logo;
        }
      }
      document.title = `Đăng nhập - ${data.site_name || 'Web Tài Liệu'}`;
    }
  } catch (err) {
    console.warn("Dùng cài đặt mặc định:", err);
  }
}
document.addEventListener("DOMContentLoaded", loadSiteSettings);

document.getElementById("btnShowRegister")?.addEventListener("click", () => switchAuthMode("REGISTER"));
document.getElementById("btnShowLoginFromReg")?.addEventListener("click", () => switchAuthMode("LOGIN"));
document.getElementById("btnShowForgot")?.addEventListener("click", () => switchAuthMode("FORGOT_PASSWORD"));

function switchAuthMode(mode) {
  authIntent = mode;

  [formLogin, formRegister, formOtp, formResetPassword].forEach(f => {
    if (f) f.classList.add("hidden-form");
  });

  // Ẩn form OTP vĩnh viễn nếu tồn tại trong HTML
  if (formOtp) formOtp.classList.add("hidden-form");

  if (mode === "LOGIN") {
    elTitle.textContent = "Đăng nhập";
    elSubTitle.textContent = "Chào mừng bạn quay trở lại";
    if (formLogin) formLogin.classList.remove("hidden-form");
  } else if (mode === "REGISTER") {
    elTitle.textContent = "Tạo tài khoản";
    elSubTitle.textContent = "Nhập thông tin để đăng ký tài khoản mới";
    document.getElementById("fieldRegName").classList.remove("hidden-form");
    document.getElementById("fieldRegPass").classList.remove("hidden-form");
    document.getElementById("lblRegName").textContent = "Tên hiển thị (Username)";
    document.getElementById("regSubmitBtn").textContent = "Đăng ký tài khoản";
    if (formRegister) formRegister.classList.remove("hidden-form");
  } else if (mode === "FORGOT_PASSWORD") {
    elTitle.textContent = "Khôi phục mật khẩu";
    elSubTitle.textContent = "Nhập chính xác Username và Email để đặt lại mật khẩu";
    document.getElementById("fieldRegName").classList.remove("hidden-form");
    document.getElementById("fieldRegPass").classList.add("hidden-form");
    document.getElementById("lblRegName").textContent = "Username tài khoản";
    document.getElementById("regSubmitBtn").textContent = "Tiếp tục (Kiểm tra tài khoản)";
    if (formRegister) formRegister.classList.remove("hidden-form");
  } else if (mode === "RESET_PASSWORD") {
    elTitle.textContent = "Tạo mật khẩu mới";
    elSubTitle.textContent = "Vui lòng nhập mật khẩu mới cho tài khoản của bạn";
    if (formResetPassword) formResetPassword.classList.remove("hidden-form");
  }
}

// 1. Xử lý Đăng nhập
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputAccount = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang kiểm tra...";

  try {
    let targetEmail = inputAccount;

    const { data: userRecords } = await supabaseClient
      .from("user")
      .select("id, user_name, status, is_admin, email")
      .or(`user_name.ilike.${inputAccount},email.ilike.${inputAccount}`);

    const userProfile = userRecords && userRecords[0];

    if (!userProfile) {
      throw new Error("Tài khoản (Username) hoặc Email không tồn tại trong hệ thống.");
    }

    if (!userProfile.status) {
      throw new Error("Tài khoản của bạn đang trong trạng thái CHỜ ADMIN DUYỆT.");
    }

    if (userProfile.email) {
      targetEmail = userProfile.email;
    }

    const { error: authError } = await supabaseClient.auth.signInWithPassword({
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
    btn.disabled = false;
    btn.textContent = "Đăng nhập";
  }
});

// 2. Xử lý Đăng ký hoặc Xác thực Quên mật khẩu trực tiếp
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const regName = document.getElementById("regName").value.trim();
  const btn = document.getElementById("regSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xử lý...";

  try {
    const { data: existingUsers } = await supabaseClient.from("user").select("id, status, user_name, email");

    if (authIntent === "REGISTER") {
      const regPass = document.getElementById("regPassword").value;

      if (!regName || !email || !regPass) throw new Error("Vui lòng nhập đầy đủ Tên hiển thị, Email và Mật khẩu.");

      // Kiểm tra trùng Username
      const isNameTaken = existingUsers?.some(u => u.user_name?.toLowerCase() === regName.toLowerCase());
      if (isNameTaken) throw new Error("Tên hiển thị (Username) này đã được dùng. Vui lòng chọn tên khác!");

      // Kiểm tra trùng Email
      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email);
      if (existingUser) {
        if (existingUser.status) throw new Error("Email này đã được đăng ký. Vui lòng quay lại Đăng nhập.");
        else throw new Error("Email này đã đăng ký và ĐANG CHỜ ADMIN DUYỆT.");
      }

      // Đăng ký trực tiếp lên Supabase Auth
      const { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({
        email: email,
        password: regPass
      });

      if (signUpErr) throw signUpErr;

      // Lưu thông tin vào bảng public.user với status = false (chờ duyệt)
      if (signUpData.user) {
        await supabaseClient.from("user").upsert({
          id: signUpData.user.id,
          user_name: regName,
          email: email,
          status: false
        });
      }

      showToast("Đăng ký thành công!", "Tài khoản đã được tạo và đang chờ Admin duyệt.");
      setTimeout(() => switchAuthMode("LOGIN"), 2000);

    } else if (authIntent === "FORGOT_PASSWORD") {
      if (!regName || !email) throw new Error("Vui lòng nhập cả Username và Email để khôi phục mật khẩu.");

      // Kiểm tra khớp Username và Email
      const matchedUser = existingUsers?.find(u =>
        u.email?.toLowerCase() === email &&
        u.user_name?.toLowerCase() === regName.toLowerCase()
      );

      if (!matchedUser) {
        throw new Error("Thông tin Username và Email không trùng khớp với dữ liệu trên hệ thống.");
      }

      if (!matchedUser.status) {
        throw new Error("Tài khoản này chưa được Admin duyệt nên chưa thể khôi phục mật khẩu.");
      }

      currentResetEmail = email;
      showToast("Xác thực thành công", "Vui lòng nhập mật khẩu mới.");
      switchAuthMode("RESET_PASSWORD");
    }

  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = authIntent === "REGISTER" ? "Đăng ký tài khoản" : "Tiếp tục (Kiểm tra tài khoản)";
  }
});

// 3. Cập nhật mật khẩu mới khi quên mật khẩu (Dùng hàm admin/session hoặc phương thức cập nhật trực tiếp nếu đã xác minh)
formResetPassword?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = document.getElementById("newPassword").value;
  const confirmPass = document.getElementById("confirmNewPassword").value;
  const btn = document.getElementById("resetPassSubmitBtn");

  if (pass !== confirmPass) return showToast("Lỗi", "Mật khẩu xác nhận không khớp.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang cập nhật...";

  try {
    // Trường hợp cập nhật mật khẩu khi quên trực tiếp dựa trên thông tin đã khớp
    // Lưu ý: Để đổi mật khẩu trực tiếp qua code client mà không cần link email, 
    // ta có thể gọi hàm cập nhật qua bảng user hoặc sử dụng RPC nếu cần, 
    // hoặc dùng lệnh update user auth nếu đang có session phục hồi.
    const { error } = await supabaseClient.auth.updateUser({ password: pass });
    if (error) throw error;

    showToast("Thành công!", "Cập nhật mật khẩu mới thành công. Vui lòng đăng nhập.");
    setTimeout(() => switchAuthMode("LOGIN"), 2000);
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu mật khẩu mới";
  }
});

function showToast(title, message) {
  clearTimeout(toastTimer);
  const elToast = document.getElementById("toast");
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastMessage").textContent = message;

  if (elToast) {
    elToast.classList.add("show");
    toastTimer = setTimeout(() => elToast.classList.remove("show"), 4000);
  } else {
    alert(`${title}: ${message}`);
  }
}

// HÀM ẨN/HIỆN MẬT KHẨU
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;

  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁️";
  }
}