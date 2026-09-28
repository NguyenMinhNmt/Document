/* ==========================================================================
   AUTH.JS - Tự tạo & Quản lý mã OTP gửi qua Email độc lập
   ========================================================================== */

let currentAuthMode = "LOGIN"; // LOGIN, REGISTER, FORGOT_PASSWORD
let tempRegisterData = null;
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

// Chuyển đổi qua lại giữa các Form
document.getElementById("btnShowRegister")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthMode("REGISTER");
});

document.getElementById("btnShowLoginFromReg")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthMode("LOGIN");
});

document.getElementById("btnShowForgot")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthMode("FORGOT_PASSWORD");
});

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
  } else if (mode === "FORGOT_PASSWORD") {
    elTitle.textContent = "Khôi phục mật khẩu";
    elSubTitle.textContent = "Nhập Email tài khoản để nhận mã OTP xác thực";
    formRegister.hidden = false;
    document.getElementById("regName").parentElement.style.display = "none";
    document.getElementById("regPassword").parentElement.style.display = "none";
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

/* ================= 1. XỬ LÝ ĐĂNG NHẬP ================= */
formLogin?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginSubmitBtn");

  btn.disabled = true;
  btn.textContent = "⏳ Đang kiểm tra...";

  try {
    const { data: user, error } = await supabaseClient
      .from("user")
      .select("*")
      .eq("user_name", email) // Nếu dùng email làm tên tài khoản
      .single();

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (authError) throw authError;

    // Kiểm tra trạng thái tài khoản
    const { data: profile } = await supabaseClient.from("user").select("status, is_admin").eq("id", authData.user.id).single();

    if (!profile || !profile.status) {
      await supabaseClient.auth.signOut();
      throw new Error("Tài khoản của bạn đang chờ Admin duyệt.");
    }

    showToast("Thành công", "Đang chuyển hướng...");
    window.location.href = profile.is_admin ? "admin.html" : "user.html";
  } catch (err) {
    showToast("Đăng nhập thất bại", err.message);
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
  btn.textContent = "⏳ Đang kiểm tra Email...";

  try {
    // KIỂM TRA EMAIL TRONG HỆ THỐNG
    const { data: existingUser } = await supabaseClient.from("user").select("id, status").eq("user_name", email).maybeSingle();

    if (currentAuthMode === "REGISTER") {
      // ĐĂNG KÝ: Nếu email đã tồn tại
      if (existingUser) {
        if (existingUser.status) {
          throw new Error("Email này đã được đăng ký và đang hoạt động. Vui lòng Đăng nhập.");
        } else {
          throw new Error("Tài khoản với Email này đã đăng ký và ĐANG CHỜ ADMIN DUYỆT. Vui lòng kiên nhẫn!");
        }
      }

      tempRegisterData = {
        name: document.getElementById("regName").value.trim(),
        email: email,
        password: document.getElementById("regPassword").value
      };
    } else if (currentAuthMode === "FORGOT_PASSWORD") {
      // QUÊN MẬT KHẨU: Email phải tồn tại trong DB
      if (!existingUser) {
        throw new Error("Email này chưa từng đăng ký tài khoản trong hệ thống.");
      }
      if (!existingUser.status) {
        throw new Error("Tài khoản này chưa được Admin duyệt nên chưa thể khôi phục mật khẩu.");
      }
    }

    // TẠO MÃ OTP 6 SỐ NGẪU NHIÊN
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString(); // Hạn 3 phút

    // LƯU MÃ OTP VÀO BẢNG otp_codes
    const { error: otpError } = await supabaseClient.from("otp_codes").insert({
      email: email,
      code: otpCode,
      type: currentAuthMode,
      expires_at: expiresAt
    });

    if (otpError) throw otpError;

    // GHI LỊCH SỬ NẾU LÀ HÀNH ĐỘNG QUÊN MẬT KHẨU
    if (currentAuthMode === "FORGOT_PASSWORD") {
      await supabaseClient.from("history_file").insert({
        change: `Yêu cầu mã OTP khôi phục mật khẩu`,
        id_user: existingUser.id
      });
    }

    // GIẢ LẬP GỬI MAIL OTP (HIỂN THỊ TOAST DỄ TEST)
    currentOtpEmail = email;
    document.getElementById("otpTargetEmail").textContent = email;
    showToast("Đã gửi mã OTP!", `Mã OTP của bạn là: ${otpCode}`);

    switchAuthMode("OTP");
    startOtpTimer();
  } catch (err) {
    showToast("Thất bại", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = currentAuthMode === "REGISTER" ? "Tiếp tục (Nhận mã OTP)" : "Gửi mã OTP khôi phục";
  }
});

/* ================= 3. XỬ LÝ XÁC THỰC MÃ OTP ================= */
formOtp?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const digits = Array.from(document.querySelectorAll(".otp-digit")).map(i => i.value).join("");
  const btn = document.getElementById("otpSubmitBtn");

  if (digits.length < 6) return showToast("Lỗi", "Vui lòng nhập đủ 6 chữ số OTP.");

  btn.disabled = true;
  btn.textContent = "⏳ Đang xác minh...";

  try {
    // KIỂM TRA MÃ OTP TRONG BẢNG otp_codes
    const { data: otpRecord, error: fetchErr } = await supabaseClient
      .from("otp_codes")
      .select("*")
      .eq("email", currentOtpEmail)
      .eq("code", digits)
      .eq("type", currentAuthMode === "OTP" ? (tempRegisterData ? "REGISTER" : "FORGOT_PASSWORD") : currentAuthMode)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr || !otpRecord) {
      throw new Error("Mã OTP không đúng hoặc đã hết hạn.");
    }

    // ĐÁNH DẤU MÃ OTP ĐÃ SỬ DỤNG
    await supabaseClient.from("otp_codes").update({ is_used: true }).eq("id", otpRecord.id);

    // XỬ LÝ THEO HOẠT ĐỘNG
    if (tempRegisterData) {
      // 3A. HOÀN TẤT ĐĂNG KÝ TÀI KHOẢN (Tạo Auth + Thêm User)
      const { data: authData, error: signUpErr } = await supabaseClient.auth.signUp({
        email: tempRegisterData.email,
        password: tempRegisterData.password
      });

      if (signUpErr) throw signUpErr;

      await supabaseClient.from("user").insert({
        id: authData.user.id,
        user_name: tempRegisterData.name,
        status: false // Đợi Admin duyệt
      });

      showToast("Đăng ký thành công!", "Tài khoản của bạn đang chờ Admin kiểm duyệt.");
      tempRegisterData = null;
      setTimeout(() => switchAuthMode("LOGIN"), 2000);
    } else {
      // 3B. XÁC THỰC QUÊN MK THÀNH CÔNG -> SANG BƯỚC ĐẶT LẠI MK
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

/* ================= 4. XỬ LÝ LƯU MẬT KHẨU MỚI (QUÊN MK) ================= */
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

/* ================= TIỆN ÍCH NHẬP SỐ OTP & ĐẾM NGƯỢC ================= */
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
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 3500);
}