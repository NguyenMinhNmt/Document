/* ==========================================================================
   AUTH.JS - XỬ LÝ XÁC THỰC, ĐĂNG NHẬP KÉP & ĐỊNH HƯỚNG LUỒNG OTP
   ========================================================================== */

// BIẾN TOÀN CỤC BẢO TRÌ TRẠNG THÁI
let authIntent = "LOGIN"; // 'LOGIN', 'REGISTER', 'FORGOT_PASSWORD', 'OTP', 'RESET_PASSWORD'
let tempRegisterData = null; // Lưu tạm dữ liệu Đăng ký (Tên, Email, Mật khẩu)
let currentOtpEmail = ""; // Lưu Email đang nhận OTP
let otpCountdownTimer = null; // Bộ đếm thời gian gửi lại mã
let toastTimer; // Bộ đếm thời gian ẩn thông báo Toast

// DOM ELEMENTS (CÁC THÀNH PHẦN GIAO DIỆN)
const formLogin = document.getElementById("loginForm");
const formRegister = document.getElementById("registerForm");
const formOtp = document.getElementById("otpForm");
const formResetPassword = document.getElementById("resetPasswordForm");
const elTitle = document.getElementById("authTitle");
const elSubTitle = document.getElementById("authSubTitle");

/**
 * HÀM 1: Tải Cài Đặt Website (Tên web & Logo) Từ Database Supabase (Bảng site_settings)
 * Chức năng: Giúp hiển thị Tên trang web và Logo động theo cài đặt của Admin.
 */
async function loadSiteSettings() {
  try {
    const { data, error } = await supabaseClient
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
    console.warn("Chưa cấu hình bảng site_settings hoặc dùng mặc định:", err);
  }
}
document.addEventListener("DOMContentLoaded", loadSiteSettings);

/**
 * HÀM 2: Chuyển Đổi Giao Diện Giữa Các Form (Đăng nhập / Đăng ký / Quên MK / OTP / Reset MK)
 * Tham số `mode`: 'LOGIN', 'REGISTER', 'FORGOT_PASSWORD', 'OTP', 'RESET_PASSWORD'
 */
document.getElementById("btnShowRegister")?.addEventListener("click", () => switchAuthMode("REGISTER"));
document.getElementById("btnShowLoginFromReg")?.addEventListener("click", () => switchAuthMode("LOGIN"));
document.getElementById("btnShowForgot")?.addEventListener("click", () => switchAuthMode("FORGOT_PASSWORD"));

function switchAuthMode(mode) {
  if (mode !== "OTP" && mode !== "RESET_PASSWORD") {
    authIntent = mode; // Cập nhật định hướng luồng
  }

  // Ẩn tất cả các form
  [formLogin, formRegister, formOtp, formResetPassword].forEach(f => {
    if (f) f.style.display = "none";
  });

  // Hiển thị form tương ứng với tiêu đề phù hợp
  if (mode === "LOGIN") {
    elTitle.textContent = "Đăng nhập";
    elSubTitle.textContent = "Chào mừng bạn quay trở lại";
    if (formLogin) formLogin.style.display = "block";
  } else if (mode === "REGISTER") {
    elTitle.textContent = "Tạo tài khoản";
    elSubTitle.textContent = "Nhập thông tin để nhận mã xác thực OTP";
    document.getElementById("fieldRegName").style.display = "block";
    document.getElementById("fieldRegPass").style.display = "block";
    document.getElementById("regSubmitBtn").textContent = "Tiếp tục (Nhận mã OTP)";
    if (formRegister) formRegister.style.display = "block";
  } else if (mode === "FORGOT_PASSWORD") {
    elTitle.textContent = "Khôi phục mật khẩu";
    elSubTitle.textContent = "Nhập Email để nhận mã xác thực đặt lại mật khẩu";
    document.getElementById("fieldRegName").style.display = "none";
    document.getElementById("fieldRegPass").style.display = "none";
    document.getElementById("regSubmitBtn").textContent = "Gửi mã xác thực";
    if (formRegister) formRegister.style.display = "block";
  } else if (mode === "OTP") {
    elTitle.textContent = "Nhập mã xác thực";
    elSubTitle.textContent = "Mã OTP đã được gửi đến hòm thư Email của bạn";
    if (formOtp) formOtp.style.display = "block";
  } else if (mode === "RESET_PASSWORD") {
    elTitle.textContent = "Tạo mật khẩu mới";
    elSubTitle.textContent = "Vui lòng nhập mật khẩu an toàn cho tài khoản";
    if (formResetPassword) formResetPassword.style.display = "block";
  }
}

/**
 * HÀM 3: Xử Lý Đăng Nhập Tài Khoản (Hỗ Trợ Cả Username Hoặc Email)
 * Luồng: Tìm username/email trong bảng `user` -> Lấy email chính xác -> Kiểm tra status duyệt -> Đăng nhập Supabase Auth
 */
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputAccount = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang kiểm tra...";

  try {
    let targetEmail = inputAccount;

    // 1. Tìm thông tin trong bảng public.user theo Username hoặc Email
    const { data: userRecords, error: dbErr } = await supabaseClient
      .from("user")
      .select("id, user_name, status, is_admin, email")
      .or(`user_name.ilike.${inputAccount},email.ilike.${inputAccount}`);

    const userProfile = userRecords && userRecords[0];

    if (!userProfile) {
      throw new Error("Tài khoản (Username) hoặc Email không tồn tại trong hệ thống.");
    }

    // 2. Kiểm tra trạng thái đã được Admin duyệt chưa (status = true)
    if (!userProfile.status) {
      throw new Error("Tài khoản của bạn đang trong trạng thái CHỜ ADMIN DUYỆT.");
    }

    // 3. Nếu người dùng nhập Username -> Lấy Email tương ứng đã lưu
    if (userProfile.email) {
      targetEmail = userProfile.email;
    }

    // 4. Đăng nhập thực tế vào Supabase Auth
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
    btn.disabled = false;
    btn.textContent = "Đăng nhập";
  }
});

/**
 * HÀM 4: Kiểm Tra Điều Kiện & Phát Yêu Cầu Gửi Mã OTP (Đăng Ký / Quên Mật Khẩu)
 */
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim();
  const btn = document.getElementById("regSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang gửi mã OTP...";

  try {
    const { data: existingUsers } = await supabaseClient.from("user").select("id, status, user_name, email");

    if (authIntent === "REGISTER") {
      const regName = document.getElementById("regName").value.trim();
      const regPass = document.getElementById("regPassword").value;

      if (!regName || !regPass) throw new Error("Vui lòng nhập đầy đủ Tên hiển thị và Mật khẩu.");

      const isNameTaken = existingUsers?.some(u => u.user_name?.toLowerCase() === regName.toLowerCase());
      if (isNameTaken) throw new Error("Tên hiển thị (Username) này đã được dùng. Vui lòng chọn tên khác!");

      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        if (existingUser.status) throw new Error("Email này đã được sử dụng. Vui lòng quay lại Đăng nhập.");
        else throw new Error("Email này đã đăng ký và ĐANG CHỜ ADMIN DUYỆT. Không thể đăng ký lại!");
      }

      // Lưu trữ thông tin đăng ký tạm thời
      tempRegisterData = { name: regName, email: email, password: regPass };
    } else if (authIntent === "FORGOT_PASSWORD") {
      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!existingUser) throw new Error("Email này chưa từng đăng ký tài khoản.");
      if (!existingUser.status) throw new Error("Tài khoản này chưa được Admin duyệt nên chưa thể khôi phục mật khẩu.");

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

/**
 * HÀM 5: Gọi API Gửi Mã OTP Chuẩn Của Supabase Auth
 * Tham số `email`: Địa chỉ email nhận mã
 */
async function triggerSupabaseOTP(email) {
  let errorObj = null;

  if (authIntent === "REGISTER") {
    const { error } = await supabaseClient.auth.signUp({
      email: email,
      password: tempRegisterData.password
    });

    if (error && error.message.toLowerCase().includes("already registered")) {
      const { error: resendErr } = await supabaseClient.auth.resend({ type: 'signup', email: email });
      if (resendErr) errorObj = new Error("Tài khoản bị kẹt. Vui lòng báo Admin xóa Email này trong Supabase Auth Users.");
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

/**
 * HÀM 6: Xác Thực Mã OTP Nhập Vào & Hoàn Tất Luồng Tương Ứng
 */
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
      // HOÀN TẤT ĐĂNG KÝ -> Lưu thông tin vào bảng public.user với status = false (Chờ duyệt)
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
      // HOÀN TẤT QUÊN MẬT KHẨU -> Chuyển sang form nhập mật khẩu mới
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

/**
 * HÀM 7: Đặt Lại Mật Khẩu Mới Nút Bấm
 */
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

/**
 * HÀM 8: Nút Bấm Gửi Lại Mã OTP
 */
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

/**
 * HÀM TIỆN ÍCH: Đếm Ngược 60 Giây Cho Nút Gửi Lại Mã OTP
 */
function startOtpTimer() {
  let timer = 60;
  const label = document.getElementById("otpTimerLabel");
  const btnResend = document.getElementById("btnResendOtp");

  btnResend.style.display = "none";
  label.style.display = "inline";

  clearInterval(otpCountdownTimer);
  otpCountdownTimer = setInterval(() => {
    timer--;
    label.textContent = `Gửi lại mã sau ${timer}s`;
    if (timer <= 0) {
      clearInterval(otpCountdownTimer);
      label.style.display = "none";
      btnResend.style.display = "inline";
    }
  }, 1000);
}

/**
 * HÀM TIỆN ÍCH: Hiển Thị Hộp Thông Báo Toast
 */
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