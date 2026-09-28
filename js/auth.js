/* ==========================================================================
   AUTH.JS - Tương thích ngược, 1 Ô OTP, Định tuyến rõ ràng
   ========================================================================== */

let authIntent = "LOGIN"; // La bàn: 'REGISTER' hoặc 'FORGOT_PASSWORD'
let tempRegisterData = null;
let currentOtpEmail = "";
let otpCountdownTimer = null;
let toastTimer;

// DOM
const formLogin = document.getElementById("loginForm");
const formRegister = document.getElementById("registerForm");
const formOtp = document.getElementById("otpForm");
const formResetPassword = document.getElementById("resetPasswordForm");
const elTitle = document.getElementById("authTitle");
const elSubTitle = document.getElementById("authSubTitle");

// 1. TẢI CÀI ĐẶT WEBSITE TỪ DATABASE
async function loadSiteSettings() {
  try {
    const { data } = await supabaseClient.from('site_settings').select('*').eq('id', 1).single();
    if (data) {
      document.getElementById('siteName').textContent = data.site_name;
      document.getElementById('siteLogo').textContent = data.site_logo;
      document.title = `Đăng nhập - ${data.site_name}`;
    }
  } catch (err) { console.log("Chưa có setting"); }
}
document.addEventListener("DOMContentLoaded", loadSiteSettings);

// 2. CHUYỂN ĐỔI GIAO DIỆN
document.getElementById("btnShowRegister")?.addEventListener("click", () => switchAuthMode("REGISTER"));
document.getElementById("btnShowLoginFromReg")?.addEventListener("click", () => switchAuthMode("LOGIN"));
document.getElementById("btnShowForgot")?.addEventListener("click", () => switchAuthMode("FORGOT_PASSWORD"));

function switchAuthMode(mode) {
  authIntent = mode;
  [formLogin, formRegister, formOtp, formResetPassword].forEach(f => f.style.display = "none");

  if (mode === "LOGIN") {
    elTitle.textContent = "Đăng nhập";
    elSubTitle.textContent = "Chào mừng bạn quay trở lại";
    formLogin.style.display = "block";
  } else if (mode === "REGISTER") {
    elTitle.textContent = "Tạo tài khoản";
    elSubTitle.textContent = "Nhập thông tin để nhận mã xác thực";
    document.getElementById("fieldRegName").style.display = "block";
    document.getElementById("fieldRegPass").style.display = "block";
    document.getElementById("regSubmitBtn").textContent = "Tiếp tục (Nhận mã OTP)";
    formRegister.style.display = "block";
  } else if (mode === "FORGOT_PASSWORD") {
    elTitle.textContent = "Khôi phục mật khẩu";
    elSubTitle.textContent = "Nhập Email để nhận mã đặt lại mật khẩu";
    document.getElementById("fieldRegName").style.display = "none";
    document.getElementById("fieldRegPass").style.display = "none";
    document.getElementById("regSubmitBtn").textContent = "Gửi mã xác thực";
    formRegister.style.display = "block";
  } else if (mode === "OTP") {
    elTitle.textContent = "Nhập mã xác thực";
    elSubTitle.textContent = "Mã OTP có hiệu lực trong 3 phút";
    formOtp.style.display = "block";
  } else if (mode === "RESET_PASSWORD") {
    elTitle.textContent = "Tạo mật khẩu mới";
    elSubTitle.textContent = "Vui lòng nhập mật khẩu an toàn";
    formResetPassword.style.display = "block";
  }
}

// 3. ĐĂNG NHẬP (Username/Email)
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputAcc = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");
  btn.disabled = true; btn.textContent = "⏳ Đang kiểm tra...";

  try {
    let targetEmail = inputAcc;
    const { data: users } = await supabaseClient.from("user")
      .select("id, status, is_admin, email")
      .or(`user_name.ilike.${inputAcc},email.ilike.${inputAcc}`);

    if (!users || users.length === 0) throw new Error("Tài khoản không tồn tại.");
    if (!users[0].status) throw new Error("Tài khoản đang chờ Admin duyệt.");
    if (users[0].email) targetEmail = users[0].email;

    const { error } = await supabaseClient.auth.signInWithPassword({ email: targetEmail, password: pass });
    if (error) throw new Error("Mật khẩu không chính xác.");

    showToast("Thành công", "Đang đăng nhập...");
    setTimeout(() => window.location.href = users[0].is_admin ? "admin.html" : "user.html", 1000);
  } catch (err) {
    showToast("Lỗi", err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Đăng nhập";
  }
});

// 4. KIỂM TRA & GỬI OTP (1 HÀM CHUNG)
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim();
  const btn = document.getElementById("regSubmitBtn");
  btn.disabled = true; btn.textContent = "⏳ Đang xử lý...";

  try {
    const { data: users } = await supabaseClient.from("user").select("id, status, user_name, email");

    if (authIntent === "REGISTER") {
      const name = document.getElementById("regName").value.trim();
      const pass = document.getElementById("regPassword").value;
      if (!name || !pass) throw new Error("Nhập đủ thông tin!");
      if (users?.some(u => u.user_name?.toLowerCase() === name.toLowerCase())) throw new Error("Username đã trùng!");
      const exUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (exUser) throw new Error(exUser.status ? "Email đã được dùng!" : "Email đang chờ duyệt, không thể đăng ký lại!");
      tempRegisterData = { name, email, password: pass };
    } else {
      const exUser = users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!exUser) throw new Error("Email chưa đăng ký.");
      if (!exUser.status) throw new Error("Tài khoản chưa được duyệt.");
    }
    await triggerSupabaseOTP(email);
  } catch (err) {
    showToast("Lỗi", err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Tiếp tục";
  }
});

async function triggerSupabaseOTP(email) {
  let err = null;
  if (authIntent === "REGISTER") {
    const { error } = await supabaseClient.auth.signUp({ email, password: tempRegisterData.password });
    if (error && error.message.includes("already registered")) {
      const r = await supabaseClient.auth.resend({ type: 'signup', email });
      if (r.error) err = new Error("Kẹt tài khoản. Báo Admin xóa email trong bảng Auth.");
    } else err = error;
  } else {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    err = error;
  }
  if (err) throw err;

  currentOtpEmail = email;
  document.getElementById("otpTargetEmail").textContent = email;
  document.getElementById("otpSingleInput").value = "";
  switchAuthMode("OTP");
  startOtpTimer();
}

// 5. XÁC MINH OTP
formOtp?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const otp = document.getElementById("otpSingleInput").value.trim();
  const btn = document.getElementById("otpSubmitBtn");
  if (!otp) return showToast("Lỗi", "Vui lòng nhập mã.");
  btn.disabled = true; btn.textContent = "⏳ Đang xác minh...";

  try {
    const type = authIntent === "REGISTER" ? "signup" : "recovery";
    const { data, error } = await supabaseClient.auth.verifyOtp({ email: currentOtpEmail, token: otp, type });
    if (error) throw new Error("Mã không đúng hoặc hết hạn!");

    if (authIntent === "REGISTER") {
      await supabaseClient.from("user").upsert({ id: data.user.id, user_name: tempRegisterData.name, email: tempRegisterData.email, status: false });
      showToast("Thành công", "Tài khoản đang chờ Admin duyệt.");
      tempRegisterData = null; authIntent = "LOGIN";
      setTimeout(() => switchAuthMode("LOGIN"), 2000);
    } else {
      showToast("Thành công", "Nhập mật khẩu mới.");
      switchAuthMode("RESET_PASSWORD");
    }
  } catch (err) {
    showToast("Lỗi", err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Xác thực & Hoàn tất";
  }
});

// LƯU MẬT KHẨU MỚI
formResetPassword?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = document.getElementById("newPassword").value, p2 = document.getElementById("confirmNewPassword").value;
  if (p1 !== p2) return showToast("Lỗi", "Mật khẩu không khớp.");
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: p1 });
    if (error) throw error;
    showToast("Thành công", "Đã cập nhật!");
    setTimeout(() => switchAuthMode("LOGIN"), 1500);
  } catch (err) { showToast("Lỗi", err.message); }
});

// UI TOOLS
document.getElementById("btnResendOtp")?.addEventListener("click", async () => {
  try {
    if (authIntent === "REGISTER") await supabaseClient.auth.resend({ type: 'signup', email: currentOtpEmail });
    else await supabaseClient.auth.resetPasswordForEmail(currentOtpEmail);
    showToast("Thành công", "Đã gửi lại mã.");
  } catch (e) { showToast("Lỗi", e.message); }
});

function startOtpTimer() {
  let t = 60; const lbl = document.getElementById("otpTimerLabel"), btn = document.getElementById("btnResendOtp");
  btn.style.display = "none"; lbl.style.display = "inline";
  clearInterval(otpCountdownTimer);
  otpCountdownTimer = setInterval(() => {
    lbl.textContent = `Gửi lại mã sau ${--t}s`;
    if (t <= 0) { clearInterval(otpCountdownTimer); lbl.style.display = "none"; btn.style.display = "inline"; }
  }, 1000);
}
function showToast(title, msg) {
  clearTimeout(toastTimer);
  const t = document.getElementById("toast");
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastMessage").textContent = msg;
  t.classList.add("show");
  toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
}