# Security Policy

## Overview

The **knoww** project takes security seriously.  
We appreciate the efforts of security researchers and community members who help us maintain a secure ecosystem.

If you discover a potential security vulnerability, please follow the responsible disclosure guidelines outlined below. This helps ensure that issues are investigated and fixed without putting users at risk.

---

## Supported Versions

Security updates are provided **only** for actively maintained versions.

| Version                   | Supported |
| ------------------------- | --------- |
| `main` / latest           | ✅ Yes    |
| Older tagged releases     | ❌ No     |
| Forks / downstream builds | ❌ No     |

> ⚠️ Security fixes are applied only to the latest version on the `main` branch.  
> Users are strongly encouraged to stay up to date.

---

## Reporting a Vulnerability

### ✅ Preferred Reporting Method (Private)

If you believe you have found a **security vulnerability**, please **DO NOT open a public GitHub issue**.

Instead, report it privately using one of the following methods:

- **GitHub Security Advisories**
  - Go to the repository’s **Security** tab
  - Click **“Report a vulnerability”**
- **Email**
  - Send details to: **security@[your-domain].com**  
    _(replace with your actual security contact email)_

Private reporting helps prevent exploitation before a fix is released.

---

### ❌ What NOT to Do

Please **do not**:

- Disclose the vulnerability publicly before it is fixed
- Open a public GitHub issue for security-sensitive bugs
- Share exploit details on social media or public forums

---

## What to Include in a Report

To help us respond efficiently, please include as much of the following as possible:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Affected endpoints, APIs, or components
- Proof-of-concept (PoC) code or screenshots (if applicable)
- Impact assessment (what an attacker could achieve)
- Environment details (Cloudflare Workers, browser, Node version, etc.)

Incomplete reports may delay triage.

---

## Response & Disclosure Process

We aim to follow a responsible disclosure process:

1. **Acknowledgement**
   - We will acknowledge receipt within **72 hours**
2. **Triage & Investigation**
   - The issue is reviewed for validity and severity
3. **Fix & Mitigation**
   - A patch or mitigation is developed
4. **Disclosure**
   - A security advisory may be published after a fix is released

Timelines may vary depending on complexity and severity.

---

## Severity Classification

We generally follow **CVSS-based severity guidelines**:

- **Critical** – Remote code execution, credential compromise, chain takeover
- **High** – SSRF, authentication bypass, sensitive data leakage
- **Medium** – DoS, rate-limit bypass, improper input validation
- **Low** – Non-exploitable bugs, theoretical risks, misconfigurations

Not all reported issues will be classified as security vulnerabilities.

---

## Dependency Vulnerabilities

This project uses automated tooling such as **Dependabot** to monitor dependencies.

Please note:

- Vulnerabilities in **unused or non-runtime dependencies** (e.g. development-only packages) may be dismissed
- Some alerts may be **non-exploitable** due to Cloudflare Workers, sandboxing, or architectural constraints
- We assess issues based on **real-world impact**, not scanner output alone

---

## Safe Harbor

We consider security research conducted in good faith and in accordance with this policy to be authorized.  
We will not pursue legal action against researchers who:

- Follow responsible disclosure
- Avoid privacy violations
- Do not intentionally degrade service availability
- Do not exploit issues beyond proof of concept

---

## Security Best Practices (For Contributors)

Contributors are expected to:

- Avoid introducing new dependencies unnecessarily
- Follow secure coding practices
- Never commit secrets, private keys, or credentials
- Use environment variables for sensitive configuration

Pull requests that weaken security may be rejected.

---

## Contact

For security-related questions or reports:

- **GitHub:** Use the repository’s **Security Advisory** feature

Thank you for helping keep **knoww** secure 🙏
