/* ==========================================================================
   AUTH.JS - XỬ LÝ XÁC THỰC, ĐĂNG NHẬP KÉP & ĐỊNH HƯỚNG LUỒNG OTP
   ========================================================================== */

let authIntent = "LOGIN";
let tempRegisterData = null;
let currentOtpEmail = "";
let otpCountdownTimer = null;
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
  if (mode !== "OTP" && mode !== "RESET_PASSWORD") {
    authIntent = mode;
  }

  [formLogin, formRegister, formOtp, formResetPassword].forEach(f => {
    if (f) f.classList.add("hidden-form");
  });

  if (mode === "LOGIN") {
    elTitle.textContent = "Đăng nhập";
    elSubTitle.textContent = "Chào mừng bạn quay trở lại";
    if (formLogin) formLogin.classList.remove("hidden-form");
  } else if (mode === "REGISTER") {
    elTitle.textContent = "Tạo tài khoản";
    elSubTitle.textContent = "Nhập thông tin để nhận mã xác thực OTP";
    document.getElementById("fieldRegName").classList.remove("hidden-form");
    document.getElementById("fieldRegPass").classList.remove("hidden-form");
    document.getElementById("lblRegName").textContent = "Tên hiển thị (Username)";
    document.getElementById("regSubmitBtn").textContent = "Tiếp tục (Nhận mã OTP)";
    if (formRegister) formRegister.classList.remove("hidden-form");
  } else if (mode === "FORGOT_PASSWORD") {
    elTitle.textContent = "Khôi phục mật khẩu";
    elSubTitle.textContent = "Nhập chính xác Username và Email để nhận mã OTP";
    document.getElementById("fieldRegName").classList.remove("hidden-form");
    document.getElementById("fieldRegPass").classList.add("hidden-form");
    document.getElementById("lblRegName").textContent = "Username tài khoản";
    document.getElementById("regSubmitBtn").textContent = "Gửi mã xác thực";
    if (formRegister) formRegister.classList.remove("hidden-form");
  } else if (mode === "OTP") {
    elTitle.textContent = "Nhập mã xác thực";
    elSubTitle.textContent = "Mã OTP đã được gửi đến hòm thư Email của bạn";
    if (formOtp) formOtp.classList.remove("hidden-form");
  } else if (mode === "RESET_PASSWORD") {
    elTitle.textContent = "Tạo mật khẩu mới";
    elSubTitle.textContent = "Vui lòng nhập mật khẩu an toàn cho tài khoản";
    if (formResetPassword) formResetPassword.classList.remove("hidden-form");
  }
}

// 1. Đăng nhập
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

// 2. Yêu cầu gửi mã OTP
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const regName = document.getElementById("regName").value.trim();
  const btn = document.getElementById("regSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang kiểm tra...";

  try {
    const { data: existingUsers } = await supabaseClient.from("user").select("id, status, user_name, email");

    if (authIntent === "REGISTER") {
      const regPass = document.getElementById("regPassword").value;

      if (!regName || !email || !regPass) throw new Error("Vui lòng nhập đầy đủ Tên hiển thị, Email và Mật khẩu.");

      const isNameTaken = existingUsers?.some(u => u.user_name?.toLowerCase() === regName.toLowerCase());
      if (isNameTaken) throw new Error("Tên hiển thị (Username) này đã được dùng. Vui lòng chọn tên khác!");

      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email);
      if (existingUser) {
        if (existingUser.status) throw new Error("Email này đã được đăng ký. Vui lòng quay lại Đăng nhập.");
        else throw new Error("Email này đã đăng ký và ĐANG CHỜ ADMIN DUYỆT. Không thể đăng ký lại!");
      }

      tempRegisterData = { name: regName, email: email, password: regPass };

    } else if (authIntent === "FORGOT_PASSWORD") {
      if (!regName || !email) throw new Error("Vui lòng nhập cả Username và Email để khôi phục mật khẩu.");

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

      tempRegisterData = null;
    }

    await triggerSupabaseOTP(email);

  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = authIntent === "REGISTER" ? "Tiếp tục (Nhận mã OTP)" : "Gửi mã xác thực";
  }
});

// 3. Trigger API OTP từ Supabase
async function triggerSupabaseOTP(email) {
  let errorObj = null;

  if (authIntent === "REGISTER") {
    const { error } = await supabaseClient.auth.signUp({
      email: email,
      password: tempRegisterData.password
    });

    if (error && error.message.toLowerCase().includes("already registered")) {
      const { error: resendErr } = await supabaseClient.auth.resend({ type: 'signup', email: email });
      if (resendErr) errorObj = new Error("Tài khoản bị kẹt xác thực. Vui lòng báo Admin hỗ trợ.");
    } else if (error) {
      errorObj = error;
    }
  } else if (authIntent === "FORGOT_PASSWORD") {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    errorObj = error;
  }

  if (errorObj) throw errorObj;

  currentOtpEmail = email;
  document.getElementById("otpTargetEmail").textContent = email;

  const otpInput = document.getElementById("otpSingleInput");
  if (otpInput) {
    otpInput.value = "";
    otpInput.focus();
  }

  switchAuthMode("OTP");
  startOtpTimer();
}

// 4. Xác nhận OTP
formOtp?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const otpCode = document.getElementById("otpSingleInput").value.trim();
  const btn = document.getElementById("otpSubmitBtn");

  if (!otpCode) return showToast("Lỗi", "Vui lòng nhập mã OTP.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xác minh...";

  try {
    const authType = authIntent === "REGISTER" ? "signup" : "recovery";

    const { data: verifyData, error: verifyErr } = await supabaseClient.auth.verifyOtp({
      email: currentOtpEmail,
      token: otpCode,
      type: authType
    });

    if (verifyErr) throw new Error("Mã OTP không chính xác hoặc đã hết hạn.");

    if (authIntent === "REGISTER") {
      await supabaseClient.from("user").upsert({
        id: verifyData.user.id,
        user_name: tempRegisterData.name,
        email: tempRegisterData.email,
        status: false
      });

      showToast("Tạo tài khoản thành công!", "Tài khoản của bạn đã được gửi tới Admin để chờ kiểm duyệt.");
      tempRegisterData = null;
      authIntent = "LOGIN";
      setTimeout(() => switchAuthMode("LOGIN"), 2000);

    } else if (authIntent === "FORGOT_PASSWORD") {
      showToast("Xác thực thành công", "Vui lòng nhập mật khẩu mới.");
      switchAuthMode("RESET_PASSWORD");
    }
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Xác thực & Hoàn tất";
  }
});

// 5. Cập nhật mật khẩu mới khi quên mật khẩu
formResetPassword?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = document.getElementById("newPassword").value;
  const confirmPass = document.getElementById("confirmNewPassword").value;
  const btn = document.getElementById("resetPassSubmitBtn");

  if (pass !== confirmPass) return showToast("Lỗi", "Mật khẩu xác nhận không khớp.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang cập nhật...";

  try {
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

// Nút gửi lại mã OTP
document.getElementById("btnResendOtp")?.addEventListener("click", async () => {
  if (!currentOtpEmail) return;
  const btn = document.getElementById("btnResendOtp");
  btn.disabled = true;
  btn.textContent = "⏳ Đang gửi...";

  try {
    if (authIntent === "REGISTER") {
      await supabaseClient.auth.resend({ type: 'signup', email: currentOtpEmail });
    } else {
      await supabaseClient.auth.resetPasswordForEmail(currentOtpEmail);
    }
    showToast("Thành công", "Mã OTP mới đã được gửi về Email.");
    startOtpTimer();
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Gửi lại mã OTP mới";
  }
});

function startOtpTimer() {
  let timer = 60;
  const label = document.getElementById("otpTimerLabel");
  const btnResend = document.getElementById("btnResendOtp");

  btnResend.classList.add("hidden-form");
  label.classList.remove("hidden-form");

  clearInterval(otpCountdownTimer);
  otpCountdownTimer = setInterval(() => {
    timer--;
    label.textContent = `Gửi lại mã sau ${timer}s`;
    if (timer <= 0) {
      clearInterval(otpCountdownTimer);
      label.classList.add("hidden-form");
      btnResend.classList.remove("hidden-form");
    }
  }, 1000);
}

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