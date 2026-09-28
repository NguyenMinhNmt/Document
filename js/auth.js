/* ==========================================================================
   AUTH.JS - Xác thực OTP trực tiếp chuẩn Supabase Auth + Lưu Lịch sử
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

/* ================= 1. ĐĂNG NHẬP (HỖ TRỢ CẢ USERNAME VÀ EMAIL) ================= */
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

    if (userProfile) {
      if (!userProfile.status) {
        throw new Error("Tài khoản của bạn đang chờ Admin kiểm duyệt.");
      }
      if (userProfile.email) {
        targetEmail = userProfile.email;
      }
    }

    let { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: targetEmail,
      password
    });

    if (authError || !authData?.user) {
      throw new Error("Mật khẩu không chính xác hoặc tên tài khoản/email không tồn tại.");
    }

    const { data: finalProfile } = await supabaseClient
      .from("user")
      .select("is_admin")
      .eq("id", authData.user.id)
      .single();

    showToast("Đăng nhập thành công!", "Đang chuyển hướng...");
    setTimeout(() => {
      window.location.href = finalProfile?.is_admin ? "admin.html" : "user.html";
    }, 1000);

  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Đăng nhập";
  }
});

/* ================= 2. XỬ LÝ YÊU CẦU MÃ OTP (ĐĂNG KÝ / QUÊN MK) ================= */
formRegister?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("regEmail").value.trim();
  const btn = document.getElementById("regSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xử lý...";

  try {
    const { data: existingUsers } = await supabaseClient.from("user").select("id, status, user_name, email");

    if (currentAuthMode === "REGISTER") {
      const regName = document.getElementById("regName").value.trim();
      const regPass = document.getElementById("regPassword").value;

      if (!regName || !regPass) throw new Error("Vui lòng nhập Tên hiển thị và Mật khẩu.");

      const isNameTaken = existingUsers?.some(u => u.user_name?.toLowerCase() === regName.toLowerCase());
      if (isNameTaken) throw new Error("Tên hiển thị (Username) này đã có người dùng. Vui lòng chọn tên khác!");

      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        if (existingUser.status) throw new Error("Email này đã được sử dụng. Vui lòng đăng nhập!");
        else throw new Error("Tài khoản này ĐANG CHỜ ADMIN DUYỆT. Vui lòng kiên nhẫn!");
      }

      tempRegisterData = { name: regName, email: email, password: regPass };
    } else if (currentAuthMode === "FORGOT_PASSWORD") {
      const existingUser = existingUsers?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!existingUser) throw new Error("Email này chưa từng đăng ký tài khoản.");
      if (!existingUser.status) throw new Error("Tài khoản chưa được duyệt nên chưa thể khôi phục mật khẩu.");

      // GHI LỊCH SỬ THAO TÁC QUÊN MẬT KHẨU
      await supabaseClient.from("history_file").insert({
        change: `Yêu cầu mã OTP khôi phục mật khẩu (${email})`,
        id_user: existingUser.id
      });

      tempRegisterData = null;
    }

    await sendOtpCode(email);

  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = currentAuthMode === "REGISTER" ? "Tiếp tục (Nhận mã OTP)" : "Gửi mã OTP khôi phục";
  }
});

/* ================= 3. HÀM KÍCH HOẠT GỬI MÃ OTP TỪ SUPABASE ================= */
async function sendOtpCode(email) {
  let otpErr = null;

  if (currentAuthMode === "FORGOT_PASSWORD") {
    // Quên mật khẩu: Gửi OTP recovery
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    otpErr = error;
  } else {
    // Đăng ký: Gửi OTP signup
    const { error } = await supabaseClient.auth.signInWithOtp({ email });
    otpErr = error;
  }

  if (otpErr) throw otpErr;

  // Lưu lịch sử gửi OTP vào bảng otp_codes
  await supabaseClient.from("otp_codes").insert({
    email: email,
    code: "SUPABASE_AUTH",
    type: currentAuthMode === "REGISTER" ? "REGISTER" : "FORGOT_PASSWORD",
    expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString()
  });

  currentOtpEmail = email;
  document.getElementById("otpTargetEmail").textContent = email;

  // Xóa sạch ô nhập OTP
  document.querySelectorAll(".otp-digit").forEach(i => i.value = "");
  document.querySelectorAll(".otp-digit")[0]?.focus();

  switchAuthMode("OTP");
  startOtpTimer();
}

/* NÚT GỬI LẠI MÃ OTP */
document.getElementById("btnResendOtp")?.addEventListener("click", async () => {
  if (!currentOtpEmail) return;
  const btn = document.getElementById("btnResendOtp");
  btn.disabled = true;
  btn.textContent = "⏳ Đang gửi...";

  try {
    await sendOtpCode(currentOtpEmail);
    showToast("Thành công", "Đã gửi lại mã OTP mới về Email.");
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Gửi lại mã OTP";
  }
});

/* ================= 4. XÁC THỰC MÃ OTP CHUẨN TRỰC TIẾP QUA SUPABASE ================= */
formOtp?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const digits = Array.from(document.querySelectorAll(".otp-digit")).map(i => i.value).join("");
  const btn = document.getElementById("otpSubmitBtn");

  if (digits.length < 6) return showToast("Lỗi", "Vui lòng nhập đủ 6 chữ số OTP.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xác minh...";

  try {
    const otpType = currentAuthMode === "OTP" && !tempRegisterData ? "recovery" : "email";

    // Gửi mã xác thực trực tiếp lên Supabase Auth
    const { data: verifyData, error: verifyErr } = await supabaseClient.auth.verifyOtp({
      email: currentOtpEmail,
      token: digits,
      type: otpType
    });

    if (verifyErr) {
      // Thử lại loại token signup
      const retry = await supabaseClient.auth.verifyOtp({
        email: currentOtpEmail,
        token: digits,
        type: "signup"
      });
      if (retry.error) throw new Error("Mã OTP không chính xác hoặc đã hết hạn.");
    }

    if (tempRegisterData) {
      // ĐĂNG KÝ TÀI KHOẢN MỚI
      const { data: authData, error: signUpErr } = await supabaseClient.auth.signUp({
        email: tempRegisterData.email,
        password: tempRegisterData.password
      });

      if (signUpErr && !signUpErr.message.includes("already registered")) throw signUpErr;

      // Lưu Profile vào bảng user
      const userId = authData?.user?.id || (await supabaseClient.auth.getUser()).data.user?.id;

      if (userId) {
        await supabaseClient.from("user").upsert({
          id: userId,
          user_name: tempRegisterData.name,
          email: tempRegisterData.email,
          status: false // Chờ Admin duyệt
        });
      }

      showToast("Tạo tài khoản thành công!", "Tài khoản của bạn đã được gửi đến Admin duyệt.");
      tempRegisterData = null;
      setTimeout(() => switchAuthMode("LOGIN"), 2000);
    } else {
      // QUÊN MẬT KHẨU
      showToast("Xác thực OTP thành công", "Vui lòng nhập mật khẩu mới.");
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

    showToast("Thành công!", "Đã cập nhật mật khẩu mới. Vui lòng đăng nhập.");
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
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 4500);
}