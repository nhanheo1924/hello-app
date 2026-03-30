async function bootstrapSigninPage() {
    const auth = window.OrbitAuth;
    const route = (path) => (
        auth && typeof auth.resolvePath === 'function'
            ? auth.resolvePath(path)
            : path
    );
    const params = new URLSearchParams(window.location.search);
    const googleToken = params.get('token');
    const googleStatus = params.get('google');
    const googleMessage = params.get('message');
    const state = {
        twoFactorMode: false,
        twoFactorToken: ''
    };

    // If OAuth callback appends a token, store it and continue to home.
    if (googleToken) {
        if (auth && typeof auth.storeToken === 'function') {
            auth.storeToken(googleToken);
        } else {
            localStorage.setItem('accessToken', googleToken);
        }
        if (auth && typeof auth.getCurrentUser === 'function') {
            await auth.getCurrentUser({ forceRefresh: true });
        }
        window.location.href = route('/home/');
        return;
    }

    if (auth) {
        const current = await auth.getCurrentUser();
        if (current) {
            window.location.href = route('/home/');
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
    if (submitBtn) {
        form.insertBefore(errorEl, submitBtn);
    } else {
        form.appendChild(errorEl);
    }

    const socialDivider = form.querySelector('.social-divider');
    const googleContainer = document.getElementById('google-signin-container');
    const googleError = document.getElementById('google-signin-error');
    const footer = document.querySelector('.auth-footer');
    const inputGroups = form.querySelectorAll('.input-group');
    const emailGroup = inputGroups[0] || null;
    const passwordGroup = inputGroups[1] || null;

    const twoFactorContainer = document.createElement('div');
    twoFactorContainer.id = 'two-factor-container';
    twoFactorContainer.className = 'two-factor-container hidden';
    twoFactorContainer.innerHTML = `
        <div class="input-group">
            <input type="text" id="two-factor-otp" placeholder="6-digit OTP code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="OTP code">
        </div>
        <div class="input-group">
            <input type="text" id="two-factor-backup" placeholder="Backup code (optional)" autocomplete="off" aria-label="Backup code">
        </div>
        <button type="button" id="two-factor-verify-btn" class="btn primary full-width">Verify 2FA</button>
        <button type="button" id="two-factor-cancel-btn" class="btn secondary full-width">Back to Password Login</button>
    `;
    form.appendChild(twoFactorContainer);

    const otpInput = twoFactorContainer.querySelector('#two-factor-otp');
    const backupInput = twoFactorContainer.querySelector('#two-factor-backup');
    const verifyTwoFactorBtn = twoFactorContainer.querySelector('#two-factor-verify-btn');
    const cancelTwoFactorBtn = twoFactorContainer.querySelector('#two-factor-cancel-btn');

    function setMainModeVisible(visible) {
        if (emailGroup) emailGroup.classList.toggle('hidden', !visible);
        if (passwordGroup) passwordGroup.classList.toggle('hidden', !visible);
        if (submitBtn) submitBtn.classList.toggle('hidden', !visible);
        if (socialDivider) socialDivider.classList.toggle('hidden', !visible);
        if (googleContainer) googleContainer.classList.toggle('hidden', !visible);
        if (googleError) googleError.classList.toggle('hidden', !visible);
        if (footer) footer.classList.toggle('hidden', !visible);
    }

    function enterTwoFactorMode(options = {}) {
        state.twoFactorMode = true;
        state.twoFactorToken = typeof options.twoFactorToken === 'string'
            ? options.twoFactorToken.trim()
            : '';

        setMainModeVisible(false);
        twoFactorContainer.classList.remove('hidden');
        if (cancelTwoFactorBtn) {
            cancelTwoFactorBtn.classList.toggle('hidden', options.allowCancel === false);
        }
        if (typeof options.message === 'string' && options.message.trim()) {
            errorEl.textContent = options.message.trim();
        } else {
            errorEl.textContent = 'Two-factor verification is required.';
        }

        if (otpInput) {
            otpInput.focus();
        }
    }

    function exitTwoFactorMode() {
        state.twoFactorMode = false;
        state.twoFactorToken = '';
        if (otpInput) otpInput.value = '';
        if (backupInput) backupInput.value = '';
        setMainModeVisible(true);
        twoFactorContainer.classList.add('hidden');
        errorEl.textContent = '';
    }

    async function finalizeLogin() {
        const currentUser = await auth.getCurrentUser({ forceRefresh: true });
        if (!currentUser) {
            errorEl.textContent = 'Signed in but failed to load profile.';
            return false;
        }

        window.location.href = route('/home/');
        return true;
    }

    async function verifyTwoFactorLogin() {
        if (!auth || typeof auth.verifyTwoFactorLogin !== 'function') {
            errorEl.textContent = '2FA verification is unavailable.';
            return;
        }

        const otp = otpInput ? otpInput.value.trim() : '';
        const backupCode = backupInput ? backupInput.value.trim() : '';
        if (!otp && !backupCode) {
            errorEl.textContent = 'Enter OTP or backup code.';
            if (otpInput) otpInput.focus();
            return;
        }

        if (verifyTwoFactorBtn) verifyTwoFactorBtn.disabled = true;
        if (cancelTwoFactorBtn) cancelTwoFactorBtn.disabled = true;

        const result = await auth.verifyTwoFactorLogin({
            otp,
            backupCode,
            twoFactorToken: state.twoFactorToken || undefined
        });

        if (verifyTwoFactorBtn) verifyTwoFactorBtn.disabled = false;
        if (cancelTwoFactorBtn) cancelTwoFactorBtn.disabled = false;

        if (!result.ok) {
            errorEl.textContent = result.error || '2FA verification failed.';
            return;
        }

        await finalizeLogin();
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

    if (googleStatus === 'error') {
        errorEl.textContent = googleMessage || 'Google login failed.';
    } else if (googleStatus === '2fa') {
        enterTwoFactorMode({
            allowCancel: false,
            message: googleMessage || 'Google account requires 2FA verification.'
        });
    }

    const signupEmail = localStorage.getItem('signupEmail');
    if (signupEmail) {
        emailInput.value = signupEmail;
        localStorage.removeItem('signupEmail');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.twoFactorMode) {
            await verifyTwoFactorLogin();
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

        const submit = form.querySelector('button[type="submit"]');
        if (submit) {
            submit.disabled = true;
        }

        const result = await auth.signIn({ email, password });
        if (!result.ok) {
            if (result.requiresTwoFactor) {
                enterTwoFactorMode({
                    twoFactorToken: result.twoFactorToken,
                    allowCancel: true,
                    message: result.error || 'Two-factor verification is required.'
                });
                if (submit) {
                    submit.disabled = false;
                }
                return;
            }

            errorEl.textContent = result.error || 'Invalid email or password.';
            emailInput.setAttribute('aria-invalid', 'true');
            passwordInput.setAttribute('aria-invalid', 'true');
            passwordInput.focus();
            if (submit) {
                submit.disabled = false;
            }
            return;
        }

        const done = await finalizeLogin();
        if (!done) {
            if (submit) {
                submit.disabled = false;
            }
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
