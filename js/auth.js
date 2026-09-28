/* ==========================================================================
   AUTH.JS - Phân luồng Định hướng Rõ Ràng & Chống Trôi Luồng OTP
   ========================================================================== */

let currentAuthMode = "LOGIN";
let authIntent = ""; // Biến la bàn phân luồng: 'REGISTER' hoặc 'FORGOT_PASSWORD'
let tempRegisterData = null; // Lưu giữ liệu tên, mật khẩu khi Đăng ký
let currentOtpEmail = "";
let otpCountdownTimer = null;
let toastTimer;

// DOM Elements
const elTitle = document.getElementById("authTitle");
const elSubTitle = document.getElementById("authSubTitle");
const formLogin = document.getElementById("loginForm");
const formRegister = document.getElementById("registerForm");
const formOtp = document.getElementById("otpForm");
const formResetPassword = document.getElementById("resetPasswordForm");

// Chuyển chế độ giao diện
document.getElementById("btnShowRegister")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthMode("REGISTER"); });
document.getElementById("btnShowLoginFromReg")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthMode("LOGIN"); });
document.getElementById("btnShowForgot")?.addEventListener("click", (e) => { e.preventDefault(); switchAuthMode("FORGOT_PASSWORD"); });

function switchAuthMode(mode) {
  currentAuthMode = mode;
  formLogin.hidden = true;
  formRegister.hidden = true;
  formOtp.hidden = true;
  formResetPassword.hidden = true;

  if (mode === "LOGIN") {
    elTitle.textContent = "Đăng nhập tài khoản";
    elSubTitle.textContent = "Hệ thống chia sẻ tài liệu trực tuyến";
    formLogin.hidden = false;
  } else if (mode === "REGISTER") {
    elTitle.textContent = "Tạo tài khoản mới";
    elSubTitle.textContent = "Nhập thông tin để nhận mã OTP qua Email";
    formRegister.hidden = false;
    document.getElementById("fieldRegName").style.display = "block";
    document.getElementById("fieldRegPass").style.display = "block";
    document.getElementById("regSubmitBtn").textContent = "Tiếp tục (Nhận mã OTP)";
  } else if (mode === "FORGOT_PASSWORD") {
    elTitle.textContent = "Khôi phục mật khẩu";
    elSubTitle.textContent = "Nhập Email tài khoản để nhận mã OTP xác thực";
    formRegister.hidden = false;
    document.getElementById("fieldRegName").style.display = "none";
    document.getElementById("fieldRegPass").style.display = "none";
    document.getElementById("regSubmitBtn").textContent = "Gửi mã OTP khôi phục";
  } else if (mode === "OTP") {
    elTitle.textContent = "Xác thực mã OTP";
    elSubTitle.textContent = "Nhập mã xác thực vừa được gửi đến Email của bạn";
    formOtp.hidden = false;
  } else if (mode === "RESET_PASSWORD") {
    elTitle.textContent = "Đặt lại mật khẩu mới";
    elSubTitle.textContent = "Nhập mật khẩu mới cho tài khoản của bạn";
    formResetPassword.hidden = false;
  }
}

/* ================= 1. ĐĂNG NHẬP ================= */
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
    if (!userProfile) throw new Error("Tài khoản hoặc Email không tồn tại.");
    if (!userProfile.status) throw new Error("Tài khoản đang CHỜ ADMIN DUYỆT.");
    if (userProfile.email) targetEmail = userProfile.email;

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: targetEmail,
      password
    });

    if (authError) throw new Error("Mật khẩu không chính xác.");

    showToast("Thành công!", "Đăng nhập thành công...");
    setTimeout(() => {
      window.location.href = userProfile.is_admin ? "admin.html" : "user.html";
    }, 1000);
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Đăng nhập";
  }
});

/* ================= 2. KIỂM TRA TRƯỚC KHI GỬI OTP ================= */
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim();
  const btn = document.getElementById("regSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xử lý...";

  try {
    const { data: existingUsers } = await supabaseClient.from("user").select("id, status, user_name, email");

    // ĐẶT LA BÀN LUỒNG: REGISTER HAY FORGOT_PASSWORD
    authIntent = currentAuthMode;

    if (authIntent === "REGISTER") {
      const regName = document.getElementById("regName").value.trim();
      const regPass = document.getElementById("regPassword").value;
      if (!regName || !regPass) throw new Error("Vui lòng nhập đủ thông tin.");

      const isNameTaken = existingUsers?.some(u => u.user_name?.toLowerCase() === regName.toLowerCase());
      if (isNameTaken) throw new Error("Username này đã được dùng!");

      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        if (existingUser.status) throw new Error("Email đã được đăng ký. Vui lòng đăng nhập.");
        else throw new Error("Email này đang chờ duyệt. Không thể đăng ký lại!");
      }
      tempRegisterData = { name: regName, email: email, password: regPass };
    } else if (authIntent === "FORGOT_PASSWORD") {
      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!existingUser) throw new Error("Email chưa từng đăng ký tài khoản.");
      if (!existingUser.status) throw new Error("Tài khoản chưa duyệt, không thể khôi phục mật khẩu.");
    }

    await sendOtpCode(email);

  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = currentAuthMode === "REGISTER" ? "Tiếp tục (Nhận mã OTP)" : "Gửi mã OTP khôi phục";
  }
});

/* ================= 3. GỬI OTP DỰA THEO LA BÀN LUỒNG ================= */
async function sendOtpCode(email) {
  let errorObj = null;

  if (authIntent === "REGISTER") {
    const { error } = await supabaseClient.auth.signUp({
      email: email,
      password: tempRegisterData.password
    });

    // Nếu bị kẹt vì OTP signup trước đó chưa xác minh
    if (error && error.message.toLowerCase().includes("already registered")) {
      const { error: resendErr } = await supabaseClient.auth.resend({ type: 'signup', email: email });
      if (resendErr) errorObj = new Error("Tài khoản bị kẹt. Vui lòng vào Supabase -> Auth -> Users xóa Email này đi và thử đăng ký lại!");
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

/* GỬI LẠI MÃ CHÍNH XÁC LUỒNG */
document.getElementById("btnResendOtp")?.addEventListener("click", async () => {
  if (!currentOtpEmail) return;
  const btn = document.getElementById("btnResendOtp");
  btn.disabled = true;
  btn.textContent = "⏳ Đang gửi...";
  try {
    if (authIntent === "REGISTER") {
      await supabaseClient.auth.resend({ type: 'signup', email: currentOtpEmail });
    } else if (authIntent === "FORGOT_PASSWORD") {
      await supabaseClient.auth.resetPasswordForEmail(currentOtpEmail);
    }
    showToast("Thành công", "Mã OTP mới đã được gửi!");
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Gửi lại mã OTP";
  }
});

/* ================= 4. XÁC THỰC MÃ VÀ KẾT THÚC ĐÚNG MỤC TIÊU ================= */
formOtp?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const digits = document.getElementById("otpSingleInput").value.trim();
  const btn = document.getElementById("otpSubmitBtn");

  if (!digits) return showToast("Lỗi", "Vui lòng nhập mã OTP.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xác minh...";

  try {
    // Ép đúng loại Token theo Luồng
    const authType = authIntent === "REGISTER" ? "signup" : "recovery";

    const { data: verifyData, error: verifyErr } = await supabaseClient.auth.verifyOtp({
      email: currentOtpEmail,
      token: digits,
      type: authType
    });

    if (verifyErr) throw new Error("Mã OTP không chính xác hoặc đã hết hạn!");

    if (authIntent === "REGISTER") {
      // ĐĂNG KÝ XONG -> ĐIỀN VÀO BẢNG USER VÀ QUAY VỀ ĐĂNG NHẬP
      await supabaseClient.from("user").upsert({
        id: verifyData.user.id,
        user_name: tempRegisterData.name,
        email: tempRegisterData.email,
        status: false
      });
      showToast("Tạo tài khoản thành công!", "Tài khoản của bạn đã được gửi đến Admin duyệt.");

      // Xóa Cache La bàn
      tempRegisterData = null;
      authIntent = "LOGIN";

      setTimeout(() => switchAuthMode("LOGIN"), 2000);

    } else if (authIntent === "FORGOT_PASSWORD") {
      // QUÊN MẬT KHẨU XONG -> CHUYỂN SANG ĐẶT MK MỚI
      showToast("Thành công", "Vui lòng nhập mật khẩu mới.");
      switchAuthMode("RESET_PASSWORD");
    }
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Xác thực & Hoàn tất";
  }
});

/* ================= 5. LƯU MẬT KHẨU MỚI ================= */
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
    showToast("Thành công!", "Đã cập nhật mật khẩu mới.");
    setTimeout(() => switchAuthMode("LOGIN"), 2000);
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu mật khẩu mới";
  }
});

/* ================= TIỆN ÍCH UI ================= */
function startOtpTimer() {
  let timer = 60;
  const label = document.getElementById("otpTimerLabel");
  const btnResend = document.getElementById("btnResendOtp");
  btnResend.hidden = true;
  label.hidden = false;
  clearInterval(otpCountdownTimer);
  otpCountdownTimer = setInterval(() => {
    timer--;
    label.textContent = `Gửi lại mã sau ${timer}s`;
    if (timer <= 0) {
      clearInterval(otpCountdownTimer);
      label.hidden = true;
      btnResend.hidden = false;
    }
  }, 1000);
}

function showToast(t, m) {
  clearTimeout(toastTimer);
  document.getElementById("toastTitle").textContent = t;
  document.getElementById("toastMessage").textContent = m;
  document.getElementById("toast").classList.add("show");
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 4500);
}