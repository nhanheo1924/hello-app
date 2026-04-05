async function bootstrapSigninPage() {
    const auth = window.OrbitAuth;
    const route = (path) => (
        auth && typeof auth.resolvePath === 'function'
            ? auth.resolvePath(path)
            : path
    );
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get('google');
    const googleMessage = params.get('message');
    const state = {
        mode: 'signin',
        twoFactorToken: '',
        isSubmitting: false,
        reset: {
            step: 'request',
            verificationToken: '',
            verifiedEmail: '',
            isSendingOtp: false,
            isVerifyingOtp: false,
            isResetting: false,
            cooldownUntil: 0,
            cooldownTimer: null
        }
    };

    function navigatePath(path, replace = false) {
        const target = route(path);
        const resolved = new URL(target, window.location.origin);
        const routePath = `${resolved.pathname}${resolved.search}${resolved.hash}`;

        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'orbit-shell-navigate',
                path: routePath,
                replace
            }, window.location.origin);
            return;
        }

        if (replace) {
            window.location.replace(resolved.toString());
            return;
        }

        window.location.href = resolved.toString();
    }

    if (auth) {
        const current = await auth.getCurrentUser();
        if (current) {
            navigatePath('/home/', true);
            return;
        }
    }

    const form = document.getElementById('auth-form');
    if (!form) return;

    const emailInput = form.querySelector('input[type="email"]');
    const passwordInput = form.querySelector('input[type="password"]');
    if (!emailInput || !passwordInput) return;

    const errorEl = document.createElement('div');
    errorEl.id = 'signin-error';
    errorEl.className = 'error-message';
    errorEl.setAttribute('aria-live', 'polite');
    const submitBtn = form.querySelector('button[type="submit"]');
    const defaultSubmitLabel = submitBtn ? String(submitBtn.textContent || 'Sign In').trim() || 'Sign In' : 'Sign In';
    if (submitBtn) {
        form.insertBefore(errorEl, submitBtn);
    } else {
        form.appendChild(errorEl);
    }
    const progressEl = document.createElement('div');
    progressEl.id = 'signin-progress';
    progressEl.className = 'signin-progress';
    progressEl.setAttribute('aria-live', 'polite');
    if (submitBtn) {
        form.insertBefore(progressEl, submitBtn);
    } else {
        form.appendChild(progressEl);
    }

    const socialDivider = form.querySelector('.social-divider');
    const googleContainer = document.getElementById('google-signin-container');
    const googleError = document.getElementById('google-signin-error');
    const footer = document.querySelector('.auth-footer');
    const inputGroups = form.querySelectorAll('.input-group');
    const emailGroup = inputGroups[0] || null;
    const passwordGroup = inputGroups[1] || null;

    const forgotToggleBtn = document.createElement('button');
    forgotToggleBtn.type = 'button';
    forgotToggleBtn.className = 'auth-link-btn';
    forgotToggleBtn.textContent = 'Forgot password?';
    forgotToggleBtn.addEventListener('click', () => {
        enterResetMode();
    });
    if (submitBtn) {
        form.insertBefore(forgotToggleBtn, submitBtn);
    } else {
        form.appendChild(forgotToggleBtn);
    }

    const twoFactorContainer = document.createElement('div');
    twoFactorContainer.id = 'two-factor-container';
    twoFactorContainer.className = 'two-factor-container hidden';
    twoFactorContainer.innerHTML = `
        <div class="input-group">
            <input type="text" id="two-factor-otp" placeholder="6-digit one-time code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="One-time code">
        </div>
        <div class="input-group">
            <input type="text" id="two-factor-backup" placeholder="Backup code (optional)" autocomplete="off" aria-label="Backup code">
        </div>
        <button type="button" id="two-factor-verify-btn" class="btn primary full-width">Verify code</button>
        <button type="button" id="two-factor-cancel-btn" class="btn secondary full-width">Back to Password Sign-In</button>
    `;
    form.appendChild(twoFactorContainer);

    const resetContainer = document.createElement('div');
    resetContainer.id = 'reset-password-container';
    resetContainer.className = 'reset-password-container hidden';
    resetContainer.innerHTML = `
        <div class="reset-copy">
            <strong>Reset your password</strong>
            <span>Request a code, verify it, then set a new password.</span>
        </div>
        <div class="input-group">
            <input type="email" id="reset-email" placeholder="Email address" aria-label="Reset email">
        </div>
        <div class="reset-action-row">
            <button type="button" id="reset-send-code-btn" class="btn secondary">Send code</button>
        </div>
        <div id="reset-verify-step" class="hidden">
            <div class="input-group">
                <input type="text" id="reset-otp" placeholder="6-digit code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Reset verification code">
            </div>
            <div class="reset-action-row">
                <button type="button" id="reset-verify-code-btn" class="btn secondary">Verify code</button>
            </div>
            <div id="reset-status" class="auth-hint" aria-live="polite"></div>
        </div>
        <div id="reset-password-step" class="hidden">
            <div class="input-group">
                <input type="password" id="reset-new-password" placeholder="New password" aria-label="New password">
            </div>
            <div class="input-group">
                <input type="password" id="reset-confirm-password" placeholder="Confirm new password" aria-label="Confirm new password">
            </div>
            <button type="button" id="reset-submit-btn" class="btn primary full-width">Reset password</button>
        </div>
        <button type="button" id="reset-cancel-btn" class="btn secondary full-width">Back to sign in</button>
    `;
    form.appendChild(resetContainer);

    const otpInput = twoFactorContainer.querySelector('#two-factor-otp');
    const backupInput = twoFactorContainer.querySelector('#two-factor-backup');
    const verifyTwoFactorBtn = twoFactorContainer.querySelector('#two-factor-verify-btn');
    const cancelTwoFactorBtn = twoFactorContainer.querySelector('#two-factor-cancel-btn');
    const resetEmailInput = resetContainer.querySelector('#reset-email');
    const resetOtpInput = resetContainer.querySelector('#reset-otp');
    const resetSendCodeBtn = resetContainer.querySelector('#reset-send-code-btn');
    const resetVerifyCodeBtn = resetContainer.querySelector('#reset-verify-code-btn');
    const resetVerifyStep = resetContainer.querySelector('#reset-verify-step');
    const resetPasswordStep = resetContainer.querySelector('#reset-password-step');
    const resetNewPasswordInput = resetContainer.querySelector('#reset-new-password');
    const resetConfirmPasswordInput = resetContainer.querySelector('#reset-confirm-password');
    const resetSubmitBtn = resetContainer.querySelector('#reset-submit-btn');
    const resetCancelBtn = resetContainer.querySelector('#reset-cancel-btn');
    const resetStatus = resetContainer.querySelector('#reset-status');

    let googleSignInBtn = null;

    function setProgress(message = '') {
        progressEl.textContent = String(message || '');
        progressEl.classList.toggle('visible', Boolean(message));
    }

    function setMainModeVisible(visible) {
        if (emailGroup) emailGroup.classList.toggle('hidden', !visible);
        if (passwordGroup) passwordGroup.classList.toggle('hidden', !visible);
        if (submitBtn) submitBtn.classList.toggle('hidden', !visible);
        if (forgotToggleBtn) forgotToggleBtn.classList.toggle('hidden', !visible);
        if (socialDivider) socialDivider.classList.toggle('hidden', !visible);
        if (googleContainer) googleContainer.classList.toggle('hidden', !visible);
        if (googleError) googleError.classList.toggle('hidden', !visible);
        if (footer) footer.classList.toggle('hidden', !visible);
    }

    function setSubmitting(isSubmitting, message = '') {
        state.isSubmitting = Boolean(isSubmitting);

        if (emailInput) emailInput.disabled = state.isSubmitting;
        if (passwordInput) passwordInput.disabled = state.isSubmitting;
        if (submitBtn) {
            submitBtn.disabled = state.isSubmitting;
            submitBtn.textContent = state.isSubmitting ? 'Signing in...' : defaultSubmitLabel;
        }
        if (forgotToggleBtn) forgotToggleBtn.disabled = state.isSubmitting;
        if (verifyTwoFactorBtn) verifyTwoFactorBtn.disabled = state.isSubmitting;
        if (cancelTwoFactorBtn) cancelTwoFactorBtn.disabled = state.isSubmitting;
        if (googleSignInBtn) googleSignInBtn.disabled = state.isSubmitting;
        if (resetEmailInput) resetEmailInput.disabled = state.isSubmitting;
        if (resetOtpInput) resetOtpInput.disabled = state.isSubmitting;
        if (resetNewPasswordInput) resetNewPasswordInput.disabled = state.isSubmitting;
        if (resetConfirmPasswordInput) resetConfirmPasswordInput.disabled = state.isSubmitting;
        if (resetSendCodeBtn) resetSendCodeBtn.disabled = state.isSubmitting;
        if (resetVerifyCodeBtn) resetVerifyCodeBtn.disabled = state.isSubmitting;
        if (resetSubmitBtn) resetSubmitBtn.disabled = state.isSubmitting;
        if (resetCancelBtn) resetCancelBtn.disabled = state.isSubmitting;

        setProgress(message);
        updateResetControls();
    }

    function navigateToHome() {
        navigatePath('/home/');
    }

    function clearResetVerification() {
        state.reset.verificationToken = '';
        state.reset.verifiedEmail = '';
    }

    function normalizedResetEmail() {
        return String(resetEmailInput ? resetEmailInput.value : '').trim().toLowerCase();
    }

    function setResetStatus(message = '') {
        if (!resetStatus) return;
        resetStatus.textContent = String(message || '');
    }

    function resetCooldownSeconds() {
        const now = Date.now();
        if (state.reset.cooldownUntil <= now) {
            return 0;
        }
        return Math.ceil((state.reset.cooldownUntil - now) / 1000);
    }

    function startResetCooldown(seconds) {
        state.reset.cooldownUntil = Date.now() + Math.max(0, Number(seconds || 0)) * 1000;
        if (state.reset.cooldownTimer !== null) {
            window.clearInterval(state.reset.cooldownTimer);
        }
        state.reset.cooldownTimer = window.setInterval(() => {
            if (resetCooldownSeconds() <= 0) {
                window.clearInterval(state.reset.cooldownTimer);
                state.reset.cooldownTimer = null;
            }
            updateResetControls();
        }, 1000);
        updateResetControls();
    }

    function setResetStep(step) {
        state.reset.step = step;
        if (resetVerifyStep) {
            resetVerifyStep.classList.toggle('hidden', step === 'request');
        }
        if (resetPasswordStep) {
            resetPasswordStep.classList.toggle('hidden', step !== 'reset');
        }
    }

    function updateResetControls() {
        if (!resetSendCodeBtn || !resetVerifyCodeBtn || !resetSubmitBtn || !resetOtpInput || !resetEmailInput || !resetNewPasswordInput || !resetConfirmPasswordInput) {
            return;
        }

        const email = normalizedResetEmail();
        const isEmailValid = auth ? auth.validateEmail(email) : false;
        const code = String(resetOtpInput.value || '').trim();
        const cooldownSeconds = resetCooldownSeconds();
        const hasToken = state.reset.verificationToken.length > 0 && state.reset.verifiedEmail === email;
        const newPassword = String(resetNewPasswordInput.value || '');
        const confirmPassword = String(resetConfirmPasswordInput.value || '');
        const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
        const passwordCheck = auth && typeof auth.validatePassword === 'function'
            ? auth.validatePassword(newPassword)
            : { valid: newPassword.length >= 8 };
        const canSubmitReset = hasToken && passwordCheck.valid === true && passwordsMatch;

        resetSendCodeBtn.disabled =
            !isEmailValid ||
            cooldownSeconds > 0 ||
            state.reset.isSendingOtp ||
            state.isSubmitting ||
            state.mode !== 'reset';
        resetVerifyCodeBtn.disabled =
            state.reset.step === 'request' ||
            !isEmailValid ||
            code.length !== 6 ||
            state.reset.isVerifyingOtp ||
            state.isSubmitting ||
            state.mode !== 'reset';
        resetSubmitBtn.disabled =
            state.reset.step !== 'reset' ||
            !canSubmitReset ||
            state.reset.isResetting ||
            state.isSubmitting ||
            state.mode !== 'reset';

        if (state.reset.isSendingOtp) {
            resetSendCodeBtn.textContent = 'Sending...';
        } else if (cooldownSeconds > 0) {
            resetSendCodeBtn.textContent = `Resend in ${cooldownSeconds}s`;
        } else {
            resetSendCodeBtn.textContent = hasToken ? 'Send new code' : 'Send code';
        }

        if (state.reset.isVerifyingOtp) {
            resetVerifyCodeBtn.textContent = 'Verifying...';
        } else {
            resetVerifyCodeBtn.textContent = 'Verify code';
        }

        if (state.reset.isResetting) {
            resetSubmitBtn.textContent = 'Resetting...';
        } else {
            resetSubmitBtn.textContent = 'Reset password';
        }
    }

    function enterTwoFactorMode(options = {}) {
        state.mode = '2fa';
        state.twoFactorToken = typeof options.twoFactorToken === 'string'
            ? options.twoFactorToken.trim()
            : '';

        setMainModeVisible(false);
        resetContainer.classList.add('hidden');
        twoFactorContainer.classList.remove('hidden');
        if (cancelTwoFactorBtn) {
            cancelTwoFactorBtn.classList.toggle('hidden', options.allowCancel === false);
        }
        if (typeof options.message === 'string' && options.message.trim()) {
            errorEl.textContent = options.message.trim();
        } else {
            errorEl.textContent = 'Two-factor verification is required.';
        }
        setProgress('');

        if (otpInput) {
            otpInput.focus();
        }
    }

    function exitTwoFactorMode() {
        state.mode = 'signin';
        state.twoFactorToken = '';
        if (otpInput) otpInput.value = '';
        if (backupInput) backupInput.value = '';
        setMainModeVisible(true);
        twoFactorContainer.classList.add('hidden');
        resetContainer.classList.add('hidden');
        errorEl.textContent = '';
        setSubmitting(false);
    }

    function enterResetMode() {
        state.mode = 'reset';
        setMainModeVisible(false);
        twoFactorContainer.classList.add('hidden');
        resetContainer.classList.remove('hidden');
        errorEl.textContent = '';
        setProgress('');
        setResetStatus('');

        if (resetEmailInput) {
            resetEmailInput.value = String(emailInput.value || '').trim().toLowerCase();
            resetEmailInput.focus();
        }
        if (resetOtpInput) {
            resetOtpInput.value = '';
        }
        if (resetNewPasswordInput) {
            resetNewPasswordInput.value = '';
        }
        if (resetConfirmPasswordInput) {
            resetConfirmPasswordInput.value = '';
        }
        clearResetVerification();
        setResetStep('request');
        updateResetControls();
    }

    function exitResetMode(message = '') {
        state.mode = 'signin';
        setMainModeVisible(true);
        twoFactorContainer.classList.add('hidden');
        resetContainer.classList.add('hidden');
        if (message) {
            errorEl.textContent = message;
        } else {
            errorEl.textContent = '';
        }
        setProgress('');
        setResetStatus('');
        setSubmitting(false);
    }

    async function finalizeLogin(userFromAuthResult) {
        if (userFromAuthResult) {
            navigateToHome();
            return true;
        }
        const currentUser = await auth.getCurrentUser();
        if (!currentUser) {
            errorEl.textContent = 'Signed in, but the profile could not be loaded.';
            return false;
        }
        navigateToHome();
        return true;
    }

    async function verifyTwoFactorLogin() {
        if (!auth || typeof auth.verifyTwoFactorLogin !== 'function') {
            errorEl.textContent = 'Two-factor verification is unavailable.';
            return;
        }

        const otp = otpInput ? otpInput.value.trim() : '';
        const backupCode = backupInput ? backupInput.value.trim() : '';
        if (!otp && !backupCode) {
            errorEl.textContent = 'Enter a one-time code or backup code.';
            if (otpInput) otpInput.focus();
            return;
        }

        setSubmitting(true, 'Verifying code...');

        const result = await auth.verifyTwoFactorLogin({
            otp,
            backupCode,
            twoFactorToken: state.twoFactorToken || undefined
        });
        setSubmitting(false);

        if (!result.ok) {
            errorEl.textContent = result.error || 'Two-factor verification failed.';
            return;
        }

        await finalizeLogin(result.user);
    }

    async function sendResetOtp() {
        if (!auth || typeof auth.sendEmailOtp !== 'function') {
            errorEl.textContent = 'Password reset is unavailable.';
            return;
        }
        const email = normalizedResetEmail();
        if (!auth.validateEmail(email)) {
            errorEl.textContent = 'Enter a valid email address.';
            if (resetEmailInput) resetEmailInput.focus();
            return;
        }

        state.reset.isSendingOtp = true;
        clearResetVerification();
        errorEl.textContent = '';
        setResetStatus('');
        updateResetControls();

        const result = await auth.sendEmailOtp({
            email,
            type: 'RESET_PASSWORD'
        });

        state.reset.isSendingOtp = false;
        if (!result.ok) {
            if (typeof result.retryAfterSeconds === 'number' && result.retryAfterSeconds > 0) {
                startResetCooldown(result.retryAfterSeconds);
            }
            errorEl.textContent = result.error || 'Unable to send reset code.';
            updateResetControls();
            return;
        }

        startResetCooldown(result.cooldownSeconds || 60);
        setResetStep('verify');
        setResetStatus(`Verification code sent to ${email}.`);
        errorEl.textContent = '';
        if (resetOtpInput) resetOtpInput.focus();
        updateResetControls();
    }

    async function verifyResetOtp() {
        if (!auth || typeof auth.verifyEmailOtp !== 'function') {
            errorEl.textContent = 'Password reset is unavailable.';
            return;
        }

        const email = normalizedResetEmail();
        if (!auth.validateEmail(email)) {
            errorEl.textContent = 'Enter a valid email address.';
            if (resetEmailInput) resetEmailInput.focus();
            return;
        }

        const code = String(resetOtpInput ? resetOtpInput.value : '').replace(/[^\d]/g, '').slice(0, 6);
        if (resetOtpInput) resetOtpInput.value = code;
        if (code.length !== 6) {
            errorEl.textContent = 'Enter the 6-digit verification code.';
            if (resetOtpInput) resetOtpInput.focus();
            return;
        }

        state.reset.isVerifyingOtp = true;
        clearResetVerification();
        setResetStatus('');
        errorEl.textContent = '';
        updateResetControls();

        const result = await auth.verifyEmailOtp({
            email,
            code,
            type: 'RESET_PASSWORD'
        });

        state.reset.isVerifyingOtp = false;
        if (!result.ok) {
            errorEl.textContent = result.error || 'Unable to verify code.';
            updateResetControls();
            return;
        }

        state.reset.verificationToken = result.verificationToken;
        state.reset.verifiedEmail = email;
        setResetStep('reset');
        setResetStatus('Code verified. You can now set a new password.');
        errorEl.textContent = '';
        updateResetControls();
    }

    async function submitResetPassword() {
        if (!auth || typeof auth.resetPasswordByOtp !== 'function') {
            errorEl.textContent = 'Password reset is unavailable.';
            return;
        }

        const email = normalizedResetEmail();
        const newPassword = String(resetNewPasswordInput ? resetNewPasswordInput.value : '');
        const confirmPassword = String(resetConfirmPasswordInput ? resetConfirmPasswordInput.value : '');
        const passwordCheck = auth && typeof auth.validatePassword === 'function'
            ? auth.validatePassword(newPassword)
            : { valid: newPassword.length >= 8 };

        if (!auth.validateEmail(email)) {
            errorEl.textContent = 'Enter a valid email address.';
            if (resetEmailInput) resetEmailInput.focus();
            return;
        }
        if (!passwordCheck.valid) {
            errorEl.textContent = 'Password must be at least 8 characters and include upper, lower, and number.';
            if (resetNewPasswordInput) resetNewPasswordInput.focus();
            return;
        }
        if (!confirmPassword || confirmPassword !== newPassword) {
            errorEl.textContent = 'Passwords do not match.';
            if (resetConfirmPasswordInput) resetConfirmPasswordInput.focus();
            return;
        }
        if (!state.reset.verificationToken || state.reset.verifiedEmail !== email) {
            errorEl.textContent = 'Verify your email code before resetting your password.';
            return;
        }

        state.reset.isResetting = true;
        setProgress('Resetting password...');
        errorEl.textContent = '';
        updateResetControls();

        const result = await auth.resetPasswordByOtp({
            email,
            newPassword,
            otpVerificationToken: state.reset.verificationToken
        });

        state.reset.isResetting = false;
        setProgress('');
        if (!result.ok) {
            errorEl.textContent = result.error || 'Unable to reset password.';
            updateResetControls();
            return;
        }

        if (emailInput) {
            emailInput.value = email;
        }
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }

        clearResetVerification();
        if (state.reset.cooldownTimer !== null) {
            window.clearInterval(state.reset.cooldownTimer);
            state.reset.cooldownTimer = null;
        }
        state.reset.cooldownUntil = 0;
        updateResetControls();
        exitResetMode('Password reset successful. Sign in with your new password.');
    }

    if (googleContainer) {
        const btn = document.createElement('button');
        googleSignInBtn = btn;
        btn.type = 'button';
        btn.className = 'btn full-width google-fallback-btn';
        btn.innerHTML = `
            <img
                class="google-logo-icon"
                src="https://www.gstatic.com/images/branding/product/1x/googleg_32dp.png"
                alt=""
                aria-hidden="true"
            />
            <span>Continue with Google</span>
        `;
        btn.addEventListener('click', () => {
            setSubmitting(true, 'Redirecting to Google...');
            if (auth && typeof auth.startGoogleFlow === 'function') {
                auth.startGoogleFlow();
            } else {
                const callback = `${window.location.origin}/auth/callback/`;
                window.location.href = `/api/v1/auth/google?callback=${encodeURIComponent(callback)}`;
            }
        });
        googleContainer.appendChild(btn);
    }

    if (verifyTwoFactorBtn) {
        verifyTwoFactorBtn.addEventListener('click', () => {
            void verifyTwoFactorLogin();
        });
    }

    if (cancelTwoFactorBtn) {
        cancelTwoFactorBtn.addEventListener('click', () => {
            exitTwoFactorMode();
            if (passwordInput) passwordInput.focus();
        });
    }

    if (otpInput) {
        otpInput.addEventListener('input', () => {
            otpInput.value = otpInput.value.replace(/[^\d]/g, '').slice(0, 6);
        });
    }

    if (resetOtpInput) {
        resetOtpInput.addEventListener('input', () => {
            resetOtpInput.value = String(resetOtpInput.value || '').replace(/[^\d]/g, '').slice(0, 6);
            if (state.reset.verificationToken) {
                clearResetVerification();
                setResetStep('verify');
                setResetStatus('Code changed. Verify again to continue.');
            }
            updateResetControls();
        });
    }

    if (resetEmailInput) {
        resetEmailInput.addEventListener('input', () => {
            const email = normalizedResetEmail();
            if (state.reset.verifiedEmail && state.reset.verifiedEmail !== email) {
                clearResetVerification();
                setResetStep('request');
                setResetStatus('Email changed. Verify this email before resetting.');
            }
            updateResetControls();
        });
    }

    if (resetNewPasswordInput) {
        resetNewPasswordInput.addEventListener('input', updateResetControls);
    }
    if (resetConfirmPasswordInput) {
        resetConfirmPasswordInput.addEventListener('input', updateResetControls);
    }
    if (resetSendCodeBtn) {
        resetSendCodeBtn.addEventListener('click', () => {
            void sendResetOtp();
        });
    }
    if (resetVerifyCodeBtn) {
        resetVerifyCodeBtn.addEventListener('click', () => {
            void verifyResetOtp();
        });
    }
    if (resetSubmitBtn) {
        resetSubmitBtn.addEventListener('click', () => {
            void submitResetPassword();
        });
    }
    if (resetCancelBtn) {
        resetCancelBtn.addEventListener('click', () => {
            exitResetMode();
            if (passwordInput) passwordInput.focus();
        });
    }

    if (googleStatus === 'error') {
        errorEl.textContent = googleMessage || 'Google sign-in failed.';
    } else if (googleStatus === '2fa') {
        enterTwoFactorMode({
            allowCancel: false,
            message: googleMessage || 'This Google account requires two-factor verification.'
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.mode === '2fa') {
            await verifyTwoFactorLogin();
            return;
        }
        if (state.mode === 'reset') {
            await submitResetPassword();
            return;
        }

        errorEl.textContent = '';
        emailInput.setAttribute('aria-invalid', 'false');
        passwordInput.setAttribute('aria-invalid', 'false');

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!auth || !auth.validateEmail(email)) {
            errorEl.textContent = 'Please enter a valid email address.';
            emailInput.setAttribute('aria-invalid', 'true');
            emailInput.focus();
            return;
        }

        setSubmitting(true, 'Signing in...');

        const result = await auth.signIn({ email, password });
        if (!result.ok) {
            setSubmitting(false);
            if (result.requiresTwoFactor) {
                enterTwoFactorMode({
                    twoFactorToken: result.twoFactorToken,
                    allowCancel: true,
                    message: result.error || 'Two-factor verification is required.'
                });
                return;
            }

            errorEl.textContent = result.error || 'Incorrect email or password.';
            emailInput.setAttribute('aria-invalid', 'true');
            passwordInput.setAttribute('aria-invalid', 'true');
            passwordInput.focus();
            return;
        }

        const done = await finalizeLogin(result.user);
        if (!done) {
            setSubmitting(false);
            return;
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrapSigninPage();
    }, { once: true });
} else {
    void bootstrapSigninPage();
}
