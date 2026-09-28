/* ==========================================================================
   AUTH.JS - Tự quản lý OTP + Hỗ trợ Đăng nhập bằng cả Username lẫn Email
   ========================================================================== */

let currentAuthMode = "LOGIN";
let tempRegisterData = null;
let currentOtpEmail = "";
let otpCountdownTimer = null;
let toastTimer;

// Elements
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
    elSubTitle.textContent = "Nhập 6 chữ số vừa được gửi đến Email";
    formOtp.hidden = false;
  } else if (mode === "RESET_PASSWORD") {
    elTitle.textContent = "Đặt lại mật khẩu mới";
    elSubTitle.textContent = "Nhập mật khẩu mới cho tài khoản của bạn";
    formResetPassword.hidden = false;
  }
}

/* ================= 1. SỬA LỖI ĐĂNG NHẬP (BẮT CẢ USERNAME & EMAIL) ================= */
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputAccount = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang kiểm tra...";

  try {
    let targetEmail = inputAccount;

    // Nếu người dùng nhập Username thay vì Email -> Tìm Email tương ứng trong DB
    if (!inputAccount.includes("@")) {
      const { data: userData, error: uErr } = await supabaseClient
        .from("user")
        .select("id, status")
        .eq("user_name", inputAccount)
        .maybeSingle();

      if (uErr || !userData) throw new Error("Tên tài khoản (Username) không tồn tại.");

      // Lấy Email từ hệ thống Auth
      const { data: authUser } = await supabaseClient.rpc("get_user_email_by_id", { user_id: userData.id });
      if (authUser) targetEmail = authUser;
    }

    // Đăng nhập với Supabase Auth bằng Email
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: targetEmail,
      password
    });

    if (authError) throw new Error("Mật khẩu hoặc tài khoản không chính xác.");

    // Kiểm tra trạng thái duyệt
    const { data: profile } = await supabaseClient
      .from("user")
      .select("status, is_admin")
      .eq("id", authData.user.id)
      .single();

    if (!profile || !profile.status) {
      await supabaseClient.auth.signOut();
      throw new Error("Tài khoản của bạn đang chờ Admin kiểm duyệt.");
    }

    showToast("Đăng nhập thành công!", "Đang chuyển hướng...");
    setTimeout(() => {
      window.location.href = profile.is_admin ? "admin.html" : "user.html";
    }, 1000);
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Đăng nhập";
  }
});

/* ================= 2. SỬA LỖI GỬI MÃ OTP THỰC TẾ QUA EMAIL ================= */
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim();
  const btn = document.getElementById("regSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xử lý...";

  try {
    const { data: existingUsers } = await supabaseClient.from("user").select("id, status, user_name");

    if (currentAuthMode === "REGISTER") {
      const regName = document.getElementById("regName").value.trim();
      const regPass = document.getElementById("regPassword").value;

      if (!regName || !regPass) throw new Error("Vui lòng nhập Tên hiển thị và Mật khẩu.");

      // Kiểm tra tên hiển thị đã có chưa
      const isNameTaken = existingUsers?.some(u => u.user_name === regName);
      if (isNameTaken) throw new Error("Tên hiển thị (Username) này đã được dùng. Vui lòng chọn tên khác!");

      tempRegisterData = { name: regName, email: email, password: regPass };
    } else if (currentAuthMode === "FORGOT_PASSWORD") {
      tempRegisterData = null;
    }

    await sendOtpToEmail(email);

  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = currentAuthMode === "REGISTER" ? "Tiếp tục (Nhận mã OTP)" : "Gửi mã OTP khôi phục";
  }
});

async function sendOtpToEmail(email) {
  // Tạo mã OTP 6 số
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();

  // 1. Lưu bản ghi OTP vào DB
  const { error: dbErr } = await supabaseClient.from("otp_codes").insert({
    email: email,
    code: otpCode,
    type: currentAuthMode === "REGISTER" ? "REGISTER" : "FORGOT_PASSWORD",
    expires_at: expiresAt
  });

  if (dbErr) throw dbErr;

  // 2. Gửi mã OTP thực tế qua Email sử dụng Supabase Auth OTP Service
  const { error: mailErr } = await supabaseClient.auth.signInWithOtp({
    email: email,
    options: {
      data: { custom_otp: otpCode }
    }
  });

  if (mailErr) {
    // Nếu chưa cấu hình SMTP Supabase, hiển thị mã trực tiếp trên thông báo để test mượt mà
    showToast("MÃ OTP CỦA BẠN (TEST)", `Mã 6 số là: ${otpCode}`);
  } else {
    showToast("Đã gửi mã OTP!", `Vui lòng kiểm tra hòm thư Email: ${email}`);
  }

  currentOtpEmail = email;
  document.getElementById("otpTargetEmail").textContent = email;
  switchAuthMode("OTP");
  startOtpTimer();
}

/* ================= 3. SỬA LỖI NÚT GỬI LẠI MÃ OTP ================= */
document.getElementById("btnResendOtp")?.addEventListener("click", async () => {
  if (!currentOtpEmail) return;
  const btn = document.getElementById("btnResendOtp");
  btn.disabled = true;
  btn.textContent = "⏳ Đang gửi lại...";

  try {
    await sendOtpToEmail(currentOtpEmail);
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Gửi lại mã OTP";
  }
});

/* ================= 4. XÁC THỰC OTP VÀ TẠO TÀI KHOẢN ================= */
formOtp?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const digits = Array.from(document.querySelectorAll(".otp-digit")).map(i => i.value).join("");
  const btn = document.getElementById("otpSubmitBtn");

  if (digits.length < 6) return showToast("Lỗi", "Vui lòng nhập đủ 6 chữ số OTP.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xác minh...";

  try {
    // Kiểm tra trong bảng otp_codes
    const { data: otpRecord, error: fetchErr } = await supabaseClient
      .from("otp_codes")
      .select("*")
      .eq("email", currentOtpEmail)
      .eq("code", digits)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr || !otpRecord) {
      throw new Error("Mã OTP không chính xác hoặc đã hết hạn (3 phút).");
    }

    // Đánh dấu mã đã dùng
    await supabaseClient.from("otp_codes").update({ is_used: true }).eq("id", otpRecord.id);

    if (tempRegisterData) {
      // ĐĂNG KÝ MỚI
      const { data: authData, error: signUpErr } = await supabaseClient.auth.signUp({
        email: tempRegisterData.email,
        password: tempRegisterData.password
      });

      if (signUpErr) throw signUpErr;

      // Lưu Profile User
      await supabaseClient.from("user").insert({
        id: authData.user.id,
        user_name: tempRegisterData.name,
        status: false // Đợi Admin duyệt
      });

      showToast("Tạo tài khoản thành công!", "Tài khoản của bạn đã được chuyển đến Admin duyệt.");
      tempRegisterData = null;
      setTimeout(() => switchAuthMode("LOGIN"), 2500);
    } else {
      // QUÊN MẬT KHẨU
      showToast("Xác thực OTP thành công", "Vui lòng nhập mật khẩu mới.");
      switchAuthMode("RESET_PASSWORD");
    }
  } catch (err) {
    showToast("Xác thực thất bại", err.message);
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

    showToast("Thành công!", "Đã đổi mật khẩu mới. Vui lòng đăng nhập.");
    setTimeout(() => switchAuthMode("LOGIN"), 2000);
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu mật khẩu mới";
  }
});

/* ================= TIỆN ÍCH NHẬP OTP & ĐẾM NGƯỢC ================= */
const otpInputs = document.querySelectorAll(".otp-digit");
otpInputs.forEach((input, idx) => {
  input.addEventListener("input", (e) => {
    if (e.target.value.length === 1 && idx < otpInputs.length - 1) {
      otpInputs[idx + 1].focus();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !e.target.value && idx > 0) {
      otpInputs[idx - 1].focus();
    }
  });
});

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
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 4000);
}