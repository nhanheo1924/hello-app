async function bootstrapSignupPage() {
    const auth = window.OrbitAuth;
    const route = (path) => (
        auth && typeof auth.resolvePath === 'function'
            ? auth.resolvePath(path)
            : path
    );
    const navigatePath = (path, replace = false) => {
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
    };
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get('google');
    const googleMessage = params.get('message');
    if (auth) {
        const current = await auth.getCurrentUser();
        if (current) {
            navigatePath('/home/', true);
            return;
        }
    }

    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const form = document.getElementById('auth-form');
    const submitBtn = document.getElementById('submit-btn');
    const emailInput = document.getElementById('email');
    const firstNameInput = document.getElementById('first-name');
    const lastNameInput = document.getElementById('last-name');
    const passwordError = document.getElementById('password-error');
    const emailError = document.getElementById('email-error');
    const googleContainer = document.getElementById('google-signup-container');
    const googleError = document.getElementById('google-signup-error');
    const policy = {
        length: document.getElementById('policy-length'),
        uppercase: document.getElementById('policy-uppercase'),
        lowercase: document.getElementById('policy-lowercase'),
        number: document.getElementById('policy-number')
    };

    if (
        !form ||
        !passwordInput ||
        !confirmPasswordInput ||
        !submitBtn ||
        !emailInput ||
        !firstNameInput ||
        !passwordError ||
        !emailError
    ) {
        return;
    }

    const otpState = {
        verificationToken: '',
        verifiedEmail: '',
        hasInteracted: false,
        isSending: false,
        isVerifying: false,
        cooldownUntil: 0,
        cooldownTimer: null
    };

    const otpSection = document.createElement('div');
    otpSection.className = 'otp-section';
    otpSection.classList.add('hidden');
    otpSection.innerHTML = `
        <div class="otp-header">Email verification</div>
        <p class="otp-description">Verify your email with a 6-digit code before creating your account.</p>
        <div class="otp-action-row">
            <button type="button" id="send-otp-btn" class="btn secondary">Send code</button>
        </div>
        <div class="input-group otp-code-group">
            <input
                type="text"
                id="email-otp-code"
                placeholder="6-digit code"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                aria-label="Email verification code"
            >
        </div>
        <div class="otp-action-row">
            <button type="button" id="verify-otp-btn" class="btn secondary">Verify code</button>
        </div>
        <div id="otp-status" class="auth-hint" aria-live="polite"></div>
        <div id="otp-error" class="error-message" aria-live="polite"></div>
    `;
    const passwordPolicyContainer = document.getElementById('password-policy');
    if (passwordPolicyContainer) {
        form.insertBefore(otpSection, passwordPolicyContainer);
    } else {
        form.insertBefore(otpSection, submitBtn);
    }

    const sendOtpBtn = otpSection.querySelector('#send-otp-btn');
    const verifyOtpBtn = otpSection.querySelector('#verify-otp-btn');
    const otpInput = otpSection.querySelector('#email-otp-code');
    const otpStatus = otpSection.querySelector('#otp-status');
    const otpError = otpSection.querySelector('#otp-error');

    if (!sendOtpBtn || !verifyOtpBtn || !otpInput || !otpStatus || !otpError) {
        return;
    }

    if (googleError && googleStatus === 'error') {
        googleError.textContent = googleMessage || 'Google sign-up failed.';
    }

    if (googleContainer) {
        const btn = document.createElement('button');
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
            if (auth && typeof auth.startGoogleFlow === 'function') {
                auth.startGoogleFlow();
            } else {
                const callback = `${window.location.origin}/auth/callback/`;
                window.location.href = `/api/v1/auth/google?callback=${encodeURIComponent(callback)}`;
            }
        });
        googleContainer.appendChild(btn);
    }

    function normalizedFormEmail() {
        return String(emailInput.value || '').trim().toLowerCase();
    }

    function clearOtpVerification() {
        otpState.verificationToken = '';
        otpState.verifiedEmail = '';
    }

    function setOtpStatus(message = '') {
        otpStatus.textContent = String(message || '');
    }

    function setOtpError(message = '') {
        otpError.textContent = String(message || '');
    }

    function setOtpVisibility(visible) {
        otpSection.classList.toggle('hidden', !visible);
    }

    function getCooldownSeconds() {
        const now = Date.now();
        if (otpState.cooldownUntil <= now) {
            return 0;
        }
        return Math.ceil((otpState.cooldownUntil - now) / 1000);
    }

    function updatePolicyUI(element, isValid) {
        if (!element) {
            return;
        }
        if (isValid) {
            element.classList.remove('invalid');
            element.classList.add('valid');
        } else {
            element.classList.remove('valid');
            element.classList.add('invalid');
        }
    }

    function updateOtpControls() {
        const isEmailValid = auth ? auth.validateEmail(normalizedFormEmail()) : false;
        const cooldownSeconds = getCooldownSeconds();
        const isSubmitBusy = submitBtn.disabled && submitBtn.dataset.busy === 'true';
        const otpValue = String(otpInput.value || '').trim();

        sendOtpBtn.disabled = !isEmailValid || cooldownSeconds > 0 || otpState.isSending || isSubmitBusy;
        verifyOtpBtn.disabled = !isEmailValid || otpValue.length !== 6 || otpState.isVerifying || isSubmitBusy;

        if (cooldownSeconds > 0) {
            sendOtpBtn.textContent = `Resend in ${cooldownSeconds}s`;
        } else {
            sendOtpBtn.textContent = otpState.verifiedEmail === normalizedFormEmail()
                ? 'Send new code'
                : 'Send code';
        }

        if (otpState.isSending) {
            sendOtpBtn.textContent = 'Sending...';
        }
        if (otpState.isVerifying) {
            verifyOtpBtn.textContent = 'Verifying...';
        } else {
            verifyOtpBtn.textContent = 'Verify code';
        }
    }

    function startCooldown(seconds) {
        otpState.cooldownUntil = Date.now() + Math.max(0, Number(seconds || 0)) * 1000;
        if (otpState.cooldownTimer !== null) {
            window.clearInterval(otpState.cooldownTimer);
        }
        otpState.cooldownTimer = window.setInterval(() => {
            if (getCooldownSeconds() <= 0) {
                window.clearInterval(otpState.cooldownTimer);
                otpState.cooldownTimer = null;
            }
            updateOtpControls();
        }, 1000);
        updateOtpControls();
    }

    function validateEmail() {
        const email = emailInput.value.trim();
        const isEmailValid = auth ? auth.validateEmail(email) : false;

        if (isEmailValid) {
            emailError.textContent = '';
            emailInput.setAttribute('aria-invalid', 'false');
        } else if (email.length > 0) {
            emailError.textContent = 'Enter a valid email address.';
            emailInput.setAttribute('aria-invalid', 'true');
        } else {
            emailInput.setAttribute('aria-invalid', 'false');
        }

        return isEmailValid;
    }

    function validateForm() {
        const value = passwordInput.value;
        const isLengthValid = value.length >= 8;
        const hasUppercase = /[A-Z]/.test(value);
        const hasLowercase = /[a-z]/.test(value);
        const hasNumber = /[0-9]/.test(value);
        const doPasswordsMatch = passwordInput.value === confirmPasswordInput.value;
        const hasFirstName = !!(firstNameInput && firstNameInput.value.trim().length > 0);
        const activeEmail = normalizedFormEmail();
        const isOtpVerified =
            otpState.verificationToken.length > 0 &&
            otpState.verifiedEmail === activeEmail;

        updatePolicyUI(policy.length, isLengthValid);
        updatePolicyUI(policy.uppercase, hasUppercase);
        updatePolicyUI(policy.lowercase, hasLowercase);
        updatePolicyUI(policy.number, hasNumber);

        const isPasswordValid = isLengthValid && hasUppercase && hasLowercase && hasNumber;
        const isEmailValid = validateEmail();
        const isPrimaryReady = isPasswordValid && doPasswordsMatch && isEmailValid && hasFirstName;

        if (doPasswordsMatch) {
            if (passwordError.textContent === 'Passwords do not match.') {
                passwordError.textContent = '';
            }
            confirmPasswordInput.setAttribute('aria-invalid', 'false');
        } else if (confirmPasswordInput.value.length > 0) {
            passwordError.textContent = 'Passwords do not match.';
            confirmPasswordInput.setAttribute('aria-invalid', 'true');
        }

        if (!hasFirstName && firstNameInput.value.length > 0) {
            passwordError.textContent = 'First name is required.';
        } else if (
            hasFirstName &&
            passwordError.textContent === 'First name is required.' &&
            doPasswordsMatch
        ) {
            passwordError.textContent = '';
        }

        setOtpVisibility(isPrimaryReady || otpState.hasInteracted);

        if (isPrimaryReady && confirmPasswordInput.value.length > 0 && isOtpVerified) {
            submitBtn.disabled = false;
            submitBtn.dataset.busy = 'false';
        } else {
            submitBtn.disabled = true;
            if (submitBtn.dataset.busy !== 'true') {
                submitBtn.dataset.busy = 'false';
            }
        }

        updateOtpControls();
        return isPrimaryReady && isOtpVerified;
    }

    async function handleSendOtp() {
        if (!auth || typeof auth.sendEmailOtp !== 'function') {
            setOtpError('Email verification is currently unavailable.');
            return;
        }

        const email = normalizedFormEmail();
        if (!auth.validateEmail(email)) {
            setOtpError('Enter a valid email address before requesting a code.');
            emailInput.focus();
            return;
        }

        otpState.isSending = true;
        otpState.hasInteracted = true;
        setOtpVisibility(true);
        setOtpError('');
        setOtpStatus('');
        updateOtpControls();

        const result = await auth.sendEmailOtp({
            email,
            type: 'REGISTER'
        });

        otpState.isSending = false;
        if (!result.ok) {
            clearOtpVerification();
            if (typeof result.retryAfterSeconds === 'number' && result.retryAfterSeconds > 0) {
                startCooldown(result.retryAfterSeconds);
            }
            setOtpError(result.error || 'Unable to send verification code.');
            updateOtpControls();
            validateForm();
            return;
        }

        clearOtpVerification();
        startCooldown(result.cooldownSeconds || 60);
        setOtpStatus(`Verification code sent to ${email}.`);
        setOtpError('');
        otpInput.focus();
        updateOtpControls();
        validateForm();
    }

    async function handleVerifyOtp() {
        if (!auth || typeof auth.verifyEmailOtp !== 'function') {
            setOtpError('Email verification is currently unavailable.');
            return;
        }

        const email = normalizedFormEmail();
        if (!auth.validateEmail(email)) {
            setOtpError('Enter a valid email address before verifying.');
            emailInput.focus();
            return;
        }

        const code = String(otpInput.value || '').replace(/[^\d]/g, '').slice(0, 6);
        otpInput.value = code;
        if (code.length !== 6) {
            setOtpError('Enter the 6-digit code from your email.');
            otpInput.focus();
            return;
        }

        otpState.isVerifying = true;
        otpState.hasInteracted = true;
        setOtpVisibility(true);
        clearOtpVerification();
        setOtpError('');
        setOtpStatus('');
        updateOtpControls();

        const result = await auth.verifyEmailOtp({
            email,
            code,
            type: 'REGISTER'
        });

        otpState.isVerifying = false;
        if (!result.ok) {
            setOtpError(result.error || 'Unable to verify code.');
            updateOtpControls();
            validateForm();
            return;
        }

        otpState.verificationToken = result.verificationToken;
        otpState.verifiedEmail = email;
        setOtpStatus('Email verified. You can now create your account.');
        setOtpError('');
        updateOtpControls();
        validateForm();
    }

    emailInput.addEventListener('input', () => {
        const email = normalizedFormEmail();
        if (otpState.verifiedEmail && otpState.verifiedEmail !== email) {
            clearOtpVerification();
            setOtpStatus('Email changed. Please verify the new email.');
        }
        validateForm();
    });
    passwordInput.addEventListener('input', validateForm);
    confirmPasswordInput.addEventListener('input', validateForm);
    firstNameInput.addEventListener('input', validateForm);
    if (lastNameInput) {
        lastNameInput.addEventListener('input', validateForm);
    }
    otpInput.addEventListener('input', () => {
        otpState.hasInteracted = true;
        otpInput.value = String(otpInput.value || '').replace(/[^\d]/g, '').slice(0, 6);
        if (otpState.verificationToken) {
            clearOtpVerification();
            setOtpStatus('Code updated. Verify again to continue.');
        }
        setOtpError('');
        validateForm();
    });

    sendOtpBtn.addEventListener('click', () => {
        void handleSendOtp();
    });
    verifyOtpBtn.addEventListener('click', () => {
        void handleVerifyOtp();
    });

    submitBtn.dataset.busy = 'false';
    submitBtn.disabled = true;
    updateOtpControls();
    validateForm();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validateForm()) {
            if (!otpState.verificationToken || otpState.verifiedEmail !== normalizedFormEmail()) {
                otpState.hasInteracted = true;
                setOtpVisibility(true);
                setOtpError('Verify your email code before creating your account.');
            }
            return;
        }
        if (!auth) {
            passwordError.textContent = 'Authentication service is unavailable.';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.dataset.busy = 'true';
        updateOtpControls();

        const result = await auth.registerUser({
            email: emailInput.value.trim(),
            password: passwordInput.value,
            otpVerificationToken: otpState.verificationToken,
            firstName: firstNameInput ? firstNameInput.value.trim() : '',
            lastName: lastNameInput ? lastNameInput.value.trim() : undefined
        });

        if (!result.ok) {
            if (result.error && result.error.toLowerCase().includes('email')) {
                emailError.textContent = result.error;
                emailInput.setAttribute('aria-invalid', 'true');
                emailInput.focus();
            } else if (result.error && result.error.toLowerCase().includes('verify')) {
                clearOtpVerification();
                setOtpError(result.error);
                otpInput.focus();
            } else {
                passwordError.textContent = result.error || 'Unable to create account.';
                passwordInput.setAttribute('aria-invalid', 'true');
                passwordInput.focus();
            }
            submitBtn.disabled = false;
            submitBtn.dataset.busy = 'false';
            updateOtpControls();
            validateForm();
            return;
        }

        emailError.textContent = '';
        passwordError.textContent = '';
        setOtpError('');
        setOtpStatus('');

        const activeUser = result.user || await auth.getCurrentUser();
        if (!activeUser) {
            passwordError.textContent = 'Your account was created, but the session could not be started.';
            submitBtn.disabled = false;
            submitBtn.dataset.busy = 'false';
            updateOtpControls();
            validateForm();
            return;
        }

        navigatePath('/home/', true);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrapSignupPage();
    }, { once: true });
} else {
    void bootstrapSignupPage();
}
