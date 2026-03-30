async function bootstrapSignupPage() {
    const auth = window.OrbitAuth;
    const route = (path) => (
        auth && typeof auth.resolvePath === 'function'
            ? auth.resolvePath(path)
            : path
    );
    const params = new URLSearchParams(window.location.search);
    const googleStatus = params.get('google');
    const googleMessage = params.get('message');
    if (auth) {
        const current = await auth.getCurrentUser();
        if (current) {
            window.location.href = route('/home/');
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

    if (googleError && googleStatus === 'error') {
        googleError.textContent = googleMessage || 'Google signup failed.';
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

    // Disable the button by default
    submitBtn.disabled = true;

    const validateEmail = () => {
        const email = emailInput.value.trim();
        const isEmailValid = auth ? auth.validateEmail(email) : false;

        if (isEmailValid) {
            emailError.textContent = '';
            emailInput.setAttribute('aria-invalid', 'false');
        } else if (email.length > 0) {
            emailError.textContent = 'Invalid email format.';
            emailInput.setAttribute('aria-invalid', 'true');
        } else {
            emailInput.setAttribute('aria-invalid', 'false');
        }

        return isEmailValid;
    };

    const validateForm = () => {
        const value = passwordInput.value;
        const isLengthValid = value.length >= 8;
        const hasUppercase = /[A-Z]/.test(value);
        const hasLowercase = /[a-z]/.test(value);
        const hasNumber = /[0-9]/.test(value);
        const doPasswordsMatch = passwordInput.value === confirmPasswordInput.value;
        const hasFirstName = !!(firstNameInput && firstNameInput.value.trim().length > 0);

        updatePolicyUI(policy.length, isLengthValid);
        updatePolicyUI(policy.uppercase, hasUppercase);
        updatePolicyUI(policy.lowercase, hasLowercase);
        updatePolicyUI(policy.number, hasNumber);

        const isPasswordValid = isLengthValid && hasUppercase && hasLowercase && hasNumber;
        const isEmailValid = validateEmail();

        if (doPasswordsMatch) {
            if (passwordError.textContent === 'Passwords do not match.') {
                passwordError.textContent = '';
            }
            confirmPasswordInput.setAttribute('aria-invalid', 'false');
        } else if (confirmPasswordInput.value.length > 0) {
            passwordError.textContent = 'Passwords do not match.';
            confirmPasswordInput.setAttribute('aria-invalid', 'true');
        }
        if (!hasFirstName && firstNameInput && firstNameInput.value.length > 0) {
            passwordError.textContent = 'First name is required.';
        } else if (hasFirstName && passwordError.textContent === 'First name is required.' && doPasswordsMatch) {
            passwordError.textContent = '';
        }

        // Enable or disable the button
        if (isPasswordValid && doPasswordsMatch && confirmPasswordInput.value.length > 0 && isEmailValid && hasFirstName) {
            submitBtn.disabled = false;
        } else {
            submitBtn.disabled = true;
        }

        return isPasswordValid && doPasswordsMatch && isEmailValid && hasFirstName;
    };

    const updatePolicyUI = (element, isValid) => {
        if (isValid) {
            element.classList.remove('invalid');
            element.classList.add('valid');
        } else {
            element.classList.remove('valid');
            element.classList.add('invalid');
        }
    };

    passwordInput.addEventListener('input', validateForm);
    confirmPasswordInput.addEventListener('input', validateForm);
    emailInput.addEventListener('input', validateForm);
    if (firstNameInput) {
        firstNameInput.addEventListener('input', validateForm);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!validateForm()) return;
        if (!auth) {
            passwordError.textContent = 'Authentication service is unavailable.';
            return;
        }

        submitBtn.disabled = true;
        const result = await auth.registerUser({
            email: emailInput.value.trim(),
            password: passwordInput.value,
            firstName: firstNameInput ? firstNameInput.value.trim() : '',
            lastName: lastNameInput ? lastNameInput.value.trim() : undefined
        });

        if (!result.ok) {
            if (result.error && result.error.toLowerCase().includes('email')) {
                emailError.textContent = result.error;
                emailInput.setAttribute('aria-invalid', 'true');
                emailInput.focus();
            } else {
                passwordError.textContent = result.error || 'Unable to create account.';
                passwordInput.setAttribute('aria-invalid', 'true');
                passwordInput.focus();
            }
            submitBtn.disabled = false;
            return;
        }

        emailError.textContent = '';
        passwordError.textContent = '';
        localStorage.setItem('signupEmail', emailInput.value.trim());
        window.location.href = route('/signin/');
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void bootstrapSignupPage();
    }, { once: true });
} else {
    void bootstrapSignupPage();
}
