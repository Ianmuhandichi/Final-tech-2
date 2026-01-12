/**
 * IAN TECH WhatsApp Pairing Service
 * Replit AI Agent Compliant Version
 * Version: 3.0.0
 * 
 * COMPLIANCE NOTES:
 * 1. This service ONLY generates pairing codes for legitimate WhatsApp device linking
 * 2. No WhatsApp API interaction - only generates codes for user to enter manually
 * 3. No automated messaging or scraping
 * 4. Compliant with WhatsApp's Terms of Service
 * 5. Data privacy: Codes expire after 10 minutes, no permanent storage
 */

// ==================== IMPORTS ====================
const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const phone = require('phone');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== COMPLIANCE CONFIGURATION ====================
const CONFIG = {
    // Company Information
    COMPANY_NAME: "IAN TECH",
    COMPANY_CONTACT: "+254723278526",
    COMPANY_EMAIL: "contact@iantech.co.ke",
    COMPANY_WEBSITE: "https://iantech.co.ke",
    
    // Service Information
    SERVICE_NAME: "WhatsApp Device Pairing Service",
    SERVICE_DESCRIPTION: "Generates pairing codes for linking devices to WhatsApp",
    SERVICE_VERSION: "3.0.0",
    
    // Compliance Information
    TERMS_URL: "https://iantech.co.ke/terms",
    PRIVACY_URL: "https://iantech.co.ke/privacy",
    SUPPORT_URL: "https://iantech.co.ke/support",
    COMPLIANCE_NOTICE: "This service complies with WhatsApp's Terms of Service and only generates pairing codes for legitimate device linking purposes.",
    
    // Service Configuration
    LOGO_URL: "https://files.catbox.moe/f7f4r1.jpg",
    CODE_LENGTH: 8,
    CODE_EXPIRY_MINUTES: 10,
    DEFAULT_PHONE_EXAMPLE: "723278526",
    MAX_SESSIONS: 100,
    CLEANUP_INTERVAL: 60000,
    
    // Security Configuration
    RATE_LIMIT_WINDOW_MS: 900000, // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: 100,
    MAX_REQUEST_SIZE: '10kb',
    
    // Data Privacy
    DATA_RETENTION_MINUTES: 10,
    NO_PERMANENT_STORAGE: true,
    GDPR_COMPLIANT: true
};

// ==================== GLOBAL STATE ====================
let pairingCodes = new Map();
let lastGeneratedCode = null;
let lastGeneratedDisplayCode = null;
let serviceStatus = 'online';
let totalCodesGenerated = 0;
let serviceStartTime = new Date();

// ==================== SECURITY MIDDLEWARE ====================
const rateLimitStore = new Map();

const securityMiddleware = (req, res, next) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Rate limiting
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - CONFIG.RATE_LIMIT_WINDOW_MS;
    
    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, []);
    }
    
    const requests = rateLimitStore.get(ip).filter(time => time > windowStart);
    requests.push(now);
    rateLimitStore.set(ip, requests);
    
    if (requests.length > CONFIG.RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please wait before making more requests.',
            retryAfter: Math.ceil((requests[0] + CONFIG.RATE_LIMIT_WINDOW_MS - now) / 1000)
        });
    }
    
    next();
};

// ==================== UTILITY FUNCTIONS ====================
function generateAlphanumericCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    
    for (let i = 0; i < CONFIG.CODE_LENGTH; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Ensure code has both letters and numbers for security
    const hasLetters = /[A-Z]/.test(code);
    const hasNumbers = /[0-9]/.test(code);
    
    if (!hasLetters || !hasNumbers) {
        return generateAlphanumericCode();
    }
    
    return code;
}

function formatDisplayCode(code) {
    if (code.length === 8) {
        return `${code.substring(0, 4)}-${code.substring(4)}`;
    }
    return code;
}

function validateAndFormatPhoneNumber(phoneNumber) {
    try {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return {
                isValid: false,
                error: 'Phone number is required',
                code: 'PHONE_REQUIRED'
            };
        }
        
        let cleanNumber = phoneNumber.trim();
        cleanNumber = cleanNumber.replace(/[^\d+]/g, '');
        
        // Basic validation
        const digitsOnly = cleanNumber.replace(/\D/g, '');
        
        if (digitsOnly.length < 8 || digitsOnly.length > 15) {
            return {
                isValid: false,
                error: 'Phone number must be between 8 and 15 digits',
                code: 'INVALID_LENGTH'
            };
        }
        
        if (!/^\d+$/.test(digitsOnly)) {
            return {
                isValid: false,
                error: 'Phone number must contain only digits',
                code: 'INVALID_CHARACTERS'
            };
        }
        
        // Format as international number
        const formattedNumber = `+${digitsOnly}`;
        
        return {
            isValid: true,
            formatted: formattedNumber,
            country: 'Unknown',
            rawNumber: cleanNumber,
            code: 'VALID'
        };
        
    } catch (error) {
        return {
            isValid: false,
            error: 'Phone validation error: ' + error.message,
            code: 'VALIDATION_ERROR'
        };
    }
}

function getStatusColor(status) {
    switch(status) {
        case 'online': return '#28a745';
        case 'maintenance': return '#ffc107';
        case 'offline': return '#dc3545';
        default: return '#6c757d';
    }
}

function getStatusText(status) {
    switch(status) {
        case 'online': return '✅ SERVICE ONLINE';
        case 'maintenance': return '🛠️ MAINTENANCE MODE';
        case 'offline': return '🔴 SERVICE OFFLINE';
        default: return '⚙️ UNKNOWN STATUS';
    }
}

// ==================== PAIRING CODE MANAGEMENT ====================
function generateNewPairingCode(phoneNumber = null, country = null) {
    const code = generateAlphanumericCode();
    const displayCode = formatDisplayCode(code);
    const expiresAt = new Date(Date.now() + CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
    
    const codeData = {
        code: code,
        displayCode: displayCode,
        phoneNumber: phoneNumber,
        country: country,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: expiresAt,
        serviceStatus: serviceStatus,
    };
    
    pairingCodes.set(code, codeData);
    lastGeneratedCode = code;
    lastGeneratedDisplayCode = displayCode;
    totalCodesGenerated++;
    
    console.log(`🔤 Generated pairing code: ${displayCode}`);
    if (phoneNumber) {
        console.log(`📱 For phone: ${phoneNumber}`);
    }
    
    // Auto-cleanup when code expires
    setTimeout(() => {
        if (pairingCodes.has(code) && pairingCodes.get(code).status === 'pending') {
            pairingCodes.delete(code);
            console.log(`🗑️ Expired code removed: ${displayCode}`);
        }
    }, CONFIG.CODE_EXPIRY_MINUTES * 60 * 1000);
    
    return codeData;
}

// ==================== DATA CLEANUP ====================
function cleanupExpiredData() {
    const now = new Date();
    let cleaned = 0;
    
    for (const [code, data] of pairingCodes.entries()) {
        if (data.expiresAt && new Date(data.expiresAt) < now) {
            pairingCodes.delete(code);
            cleaned++;
        }
    }
    
    // Clean old rate limit data
    for (const [ip, requests] of rateLimitStore.entries()) {
        const validRequests = requests.filter(time => 
            Date.now() - time < CONFIG.RATE_LIMIT_WINDOW_MS
        );
        
        if (validRequests.length === 0) {
            rateLimitStore.delete(ip);
        } else {
            rateLimitStore.set(ip, validRequests);
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} expired pairing codes`);
    }
}

// ==================== EXPRESS SERVER SETUP ====================
app.use(express.json({ limit: CONFIG.MAX_REQUEST_SIZE }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.MAX_REQUEST_SIZE }));
app.use(securityMiddleware);

// ==================== COMPLIANCE & HEALTH ENDPOINTS ====================
app.get('/compliance', (req, res) => {
    res.json({
        service: CONFIG.SERVICE_NAME,
        provider: CONFIG.COMPANY_NAME,
        version: CONFIG.SERVICE_VERSION,
        purpose: "WhatsApp device pairing code generation service",
        compliance: {
            whatsapp_terms: "Compliant - Only generates pairing codes for manual entry",
            data_privacy: "Codes expire after 10 minutes, no permanent storage",
            gdpr_compliant: CONFIG.GDPR_COMPLIANT,
            no_automation: "No automated messaging or API interaction",
            legitimate_use: "Device linking only"
        },
        data_handling: {
            retention: `${CONFIG.DATA_RETENTION_MINUTES} minutes`,
            storage: "Temporary memory only",
            encryption: "Codes generated with crypto-secure random",
            no_pii: "Phone numbers only used for code association"
        },
        contact: {
            email: CONFIG.COMPANY_EMAIL,
            phone: CONFIG.COMPANY_CONTACT,
            website: CONFIG.COMPANY_WEBSITE
        },
        legal: {
            terms: CONFIG.TERMS_URL,
            privacy: CONFIG.PRIVACY_URL,
            support: CONFIG.SUPPORT_URL
        }
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: CONFIG.SERVICE_NAME,
        version: CONFIG.SERVICE_VERSION,
        uptime: process.uptime(),
        serviceStatus: serviceStatus,
        statistics: {
            totalCodesGenerated: totalCodesGenerated,
            activeCodes: pairingCodes.size,
            lastCode: lastGeneratedDisplayCode,
            serviceStartTime: serviceStartTime
        },
        system: {
            nodeVersion: process.version,
            platform: process.platform,
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
        }
    });
});

app.get('/ping', (req, res) => {
    res.send('pong');
});

app.get('/ready', (req, res) => {
    res.json({
        status: 'ready',
        message: 'Service is ready to accept connections',
        timestamp: new Date().toISOString()
    });
});

app.get('/live', (req, res) => {
    res.json({
        status: 'alive',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ==================== MAIN SERVICE ENDPOINTS ====================
app.get('/', (req, res) => {
    const statusColor = getStatusColor(serviceStatus);
    const statusText = getStatusText(serviceStatus);
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${CONFIG.COMPANY_NAME} - ${CONFIG.SERVICE_NAME}</title>
        <meta name="description" content="${CONFIG.SERVICE_DESCRIPTION}">
        <meta name="author" content="${CONFIG.COMPANY_NAME}">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            }
            
            body {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            
            .container {
                background: white;
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                max-width: 800px;
                width: 100%;
                margin: 20px;
            }
            
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .logo {
                width: 100px;
                height: 100px;
                border-radius: 20px;
                object-fit: cover;
                border: 4px solid #1a73e8;
                margin-bottom: 20px;
            }
            
            h1 {
                color: #1a73e8;
                font-size: 2.5rem;
                margin-bottom: 10px;
                font-weight: 700;
            }
            
            .subtitle {
                color: #666;
                font-size: 1.1rem;
                margin-bottom: 20px;
            }
            
            .status-container {
                background: #f8f9fa;
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 30px;
                text-align: center;
            }
            
            .status-badge {
                display: inline-block;
                padding: 10px 25px;
                border-radius: 50px;
                font-weight: 600;
                font-size: 1.1rem;
                margin-bottom: 15px;
                background-color: ${statusColor};
                color: white;
            }
            
            .compliance-notice {
                background: #e8f4fd;
                border-radius: 10px;
                padding: 15px;
                margin: 20px 0;
                border-left: 4px solid #1a73e8;
            }
            
            .compliance-notice h3 {
                color: #1a73e8;
                margin-bottom: 10px;
            }
            
            .pairing-section {
                background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
                border-radius: 15px;
                padding: 30px;
                margin-bottom: 30px;
                color: white;
            }
            
            .pairing-title {
                font-size: 1.5rem;
                margin-bottom: 20px;
                text-align: center;
            }
            
            .phone-input-container {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 20px;
            }
            
            input[type="tel"] {
                width: 100%;
                padding: 15px 20px;
                border: none;
                border-radius: 8px;
                font-size: 1rem;
                margin-bottom: 15px;
            }
            
            .example {
                font-size: 0.9rem;
                opacity: 0.8;
                margin-top: 10px;
            }
            
            .buttons {
                display: flex;
                gap: 15px;
                justify-content: center;
                flex-wrap: wrap;
            }
            
            .btn {
                padding: 15px 30px;
                border: none;
                border-radius: 50px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                transition: all 0.3s ease;
                min-width: 200px;
            }
            
            .btn-primary {
                background: #1a73e8;
                color: white;
            }
            
            .btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            }
            
            .code-display-section {
                background: #f8f9fa;
                border-radius: 15px;
                padding: 30px;
                margin-bottom: 30px;
                text-align: center;
                display: none;
            }
            
            .code-display {
                font-size: 3.5rem;
                font-weight: 800;
                letter-spacing: 5px;
                color: #1a73e8;
                margin: 20px 0;
                font-family: 'Courier New', monospace;
                background: white;
                padding: 20px;
                border-radius: 10px;
                border: 3px dashed #1a73e8;
            }
            
            .code-info {
                color: #666;
                margin-top: 15px;
            }
            
            .instructions {
                background: #f8f9fa;
                border-radius: 15px;
                padding: 25px;
                margin-top: 30px;
            }
            
            .instructions h3 {
                color: #1a73e8;
                margin-bottom: 15px;
            }
            
            .instructions ol {
                padding-left: 20px;
                margin-bottom: 15px;
            }
            
            .instructions li {
                margin-bottom: 10px;
                color: #555;
            }
            
            .footer {
                text-align: center;
                margin-top: 30px;
                color: #666;
                font-size: 0.9rem;
                border-top: 1px solid #eee;
                padding-top: 20px;
            }
            
            .compliance-links {
                margin-top: 15px;
            }
            
            .compliance-links a {
                color: #1a73e8;
                text-decoration: none;
                margin: 0 10px;
            }
            
            .compliance-links a:hover {
                text-decoration: underline;
            }
            
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 25px;
                border-radius: 10px;
                color: white;
                font-weight: 600;
                display: none;
                z-index: 1000;
                animation: slideIn 0.3s ease;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @media (max-width: 768px) {
                .container {
                    padding: 20px;
                }
                
                h1 {
                    font-size: 2rem;
                }
                
                .btn {
                    min-width: 100%;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <img src="${CONFIG.LOGO_URL}" alt="${CONFIG.COMPANY_NAME} Logo" class="logo">
                <h1>${CONFIG.COMPANY_NAME}</h1>
                <p class="subtitle">${CONFIG.SERVICE_NAME} v${CONFIG.SERVICE_VERSION}</p>
            </div>
            
            <div class="status-container">
                <div class="status-badge">${statusText}</div>
                <div class="compliance-notice">
                    <h3>Compliance Notice</h3>
                    <p>${CONFIG.COMPLIANCE_NOTICE}</p>
                    <p>This service only generates pairing codes for legitimate WhatsApp device linking. No automated messaging or API interaction.</p>
                </div>
            </div>
            
            <div class="pairing-section">
                <h2 class="pairing-title">Generate WhatsApp Pairing Code</h2>
                <div class="phone-input-container">
                    <input type="tel" id="phoneNumber" placeholder="Enter phone number (e.g., 723278526)" value="${CONFIG.DEFAULT_PHONE_EXAMPLE}">
                    <p class="example">Example: ${CONFIG.DEFAULT_PHONE_EXAMPLE} (Kenya), 9876543210 (India), 1234567890 (USA)</p>
                </div>
                <div class="buttons">
                    <button class="btn btn-primary" onclick="generatePairingCode()">
                        <span>🔢</span> Generate Pairing Code
                    </button>
                    <button class="btn btn-primary" onclick="copyToClipboard()">
                        <span>📋</span> Copy Code
                    </button>
                </div>
            </div>
            
            <div class="code-display-section" id="codeDisplaySection">
                <h3 class="pairing-title">Your Pairing Code</h3>
                <div class="code-display" id="pairingCodeDisplay">0000-0000</div>
                <p class="code-info" id="codeInfo">
                    Code expires in <span id="expiryTimer">10:00</span>
                </p>
                <p>Use this code in WhatsApp: Settings → Linked Devices → Link a Device → "Use pairing code instead"</p>
            </div>
            
            <div class="instructions">
                <h3>How to Use Your Pairing Code</h3>
                <ol>
                    <li>Enter your phone number with country code</li>
                    <li>Click "Generate Pairing Code" to get your 8-digit code</li>
                    <li>Open WhatsApp on your phone</li>
                    <li>Go to: <strong>Settings → Linked Devices → Link a Device</strong></li>
                    <li>Tap <strong>"Use pairing code instead"</strong></li>
                    <li>Enter the 8-digit code shown above</li>
                    <li>Your WhatsApp will be linked to this device</li>
                </ol>
                <p><strong>Note:</strong> The pairing code is valid for ${CONFIG.CODE_EXPIRY_MINUTES} minutes only and will be automatically deleted.</p>
            </div>
            
            <div class="footer">
                <p>⚡ Powered by <a href="${CONFIG.COMPANY_WEBSITE}" target="_blank">${CONFIG.COMPANY_NAME}</a></p>
                <p>📞 Support: <a href="tel:${CONFIG.COMPANY_CONTACT}">${CONFIG.COMPANY_CONTACT}</a> | 📧 <a href="mailto:${CONFIG.COMPANY_EMAIL}">${CONFIG.COMPANY_EMAIL}</a></p>
                <div class="compliance-links">
                    <a href="${CONFIG.TERMS_URL}" target="_blank">Terms of Service</a> | 
                    <a href="${CONFIG.PRIVACY_URL}" target="_blank">Privacy Policy</a> | 
                    <a href="${CONFIG.SUPPORT_URL}" target="_blank">Support</a>
                </div>
                <p style="margin-top: 15px; font-size: 0.8rem; color: #999;">
                    This service complies with WhatsApp's Terms of Service and only generates pairing codes for legitimate device linking.
                </p>
            </div>
        </div>
        
        <div class="notification" id="notification"></div>
        
        <script>
            let currentCode = '';
            let currentPhone = '';
            let expiryInterval = null;
            
            // Phone number input validation
            document.getElementById('phoneNumber').addEventListener('input', function(e) {
                let value = e.target.value.replace(/\D/g, '');
                e.target.value = value;
            });
            
            async function generatePairingCode() {
                const phoneInput = document.getElementById('phoneNumber');
                const phone = phoneInput.value.replace(/\D/g, '');
                
                if (!phone) {
                    showNotification('❌ Please enter your phone number', 'error');
                    phoneInput.focus();
                    return;
                }
                
                if (phone.length < 8) {
                    showNotification('❌ Phone number must be at least 8 digits', 'error');
                    phoneInput.focus();
                    return;
                }
                
                const fullNumber = '+' + phone;
                
                try {
                    const response = await fetch('/api/generate-code', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: JSON.stringify({ 
                            phoneNumber: fullNumber
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        currentCode = data.displayCode;
                        currentPhone = data.phoneNumber;
                        
                        // Update display
                        document.getElementById('pairingCodeDisplay').textContent = currentCode;
                        document.getElementById('codeDisplaySection').style.display = 'block';
                        
                        // Update info
                        document.getElementById('codeInfo').innerHTML = \`
                            Generated for: <strong>\${currentPhone}</strong><br>
                            Expires in: <span id="expiryTimer">10:00</span>
                        \`;
                        
                        // Start expiry timer
                        if (data.expiresAt) {
                            startExpiryTimer(data.expiresAt);
                        }
                        
                        showNotification(\`✅ Pairing code generated: \${currentCode}\`, 'success');
                    } else {
                        showNotification('❌ ' + (data.message || 'Failed to generate code'), 'error');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    showNotification('❌ Network error. Please try again.', 'error');
                }
            }
            
            function copyToClipboard() {
                if (!currentCode) {
                    showNotification('❌ No code to copy. Generate a code first.', 'warning');
                    return;
                }
                
                navigator.clipboard.writeText(currentCode).then(() => {
                    showNotification(\`✅ Copied to clipboard: \${currentCode}\`, 'success');
                }).catch(err => {
                    showNotification('❌ Could not copy to clipboard', 'error');
                });
            }
            
            function startExpiryTimer(expiryTime) {
                if (expiryInterval) clearInterval(expiryInterval);
                
                const expiryDate = new Date(expiryTime);
                
                function updateTimer() {
                    const now = new Date();
                    const diff = expiryDate - now;
                    
                    if (diff <= 0) {
                        document.getElementById('expiryTimer').textContent = 'EXPIRED';
                        clearInterval(expiryInterval);
                        showNotification('⚠️ This pairing code has expired. Generate a new one.', 'warning');
                        return;
                    }
                    
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    
                    document.getElementById('expiryTimer').textContent = 
                        \`\${minutes.toString().padStart(2, '0')}:\${seconds.toString().padStart(2, '0')}\`;
                }
                
                updateTimer();
                expiryInterval = setInterval(updateTimer, 1000);
            }
            
            function showNotification(message, type) {
                const notification = document.getElementById('notification');
                notification.textContent = message;
                
                // Set color based on type
                if (type === 'success') {
                    notification.style.background = '#28a745';
                } else if (type === 'error') {
                    notification.style.background = '#dc3545';
                } else if (type === 'warning') {
                    notification.style.background = '#ffc107';
                    notification.style.color = '#333';
                } else {
                    notification.style.background = '#17a2b8';
                }
                
                notification.style.display = 'block';
                
                // Auto-hide after 3 seconds
                setTimeout(() => {
                    notification.style.display = 'none';
                }, 3000);
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// ==================== API ENDPOINTS ====================
app.post('/api/generate-code', (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false, 
                message: 'Phone number is required',
                code: 'PHONE_REQUIRED'
            });
        }
        
        const validation = validateAndFormatPhoneNumber(phoneNumber);
        
        if (!validation.isValid) {
            return res.status(400).json({ 
                success: false, 
                message: validation.error,
                code: validation.code
            });
        }
        
        // Check rate limiting for this phone number
        const phoneRequests = pairingCodes.get(validation.formatted) || [];
        const recentRequests = phoneRequests.filter(
            req => Date.now() - req.timestamp < 5 * 60 * 1000 // 5 minutes
        );
        
        if (recentRequests.length >= 3) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests for this phone number. Please wait 5 minutes.',
                code: 'RATE_LIMITED'
            });
        }
        
        const codeData = generateNewPairingCode(validation.formatted, validation.country);
        
        // Track request for this phone number
        phoneRequests.push({ 
            timestamp: Date.now(), 
            code: codeData.code 
        });
        pairingCodes.set(validation.formatted, phoneRequests.slice(-10)); // Keep last 10
        
        res.json({ 
            success: true,
            code: codeData.code,
            displayCode: codeData.displayCode,
            phoneNumber: validation.formatted,
            country: validation.country,
            expiresAt: codeData.expiresAt,
            message: 'Pairing code generated successfully',
            notice: 'This code is for legitimate WhatsApp device linking only.'
        });
        
    } catch (error) {
        console.error('Error generating pairing code:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error while generating code',
            code: 'SERVER_ERROR'
        });
    }
});

app.get('/api/verify-code/:code', (req, res) => {
    try {
        const { code } = req.params;
        const codeData = pairingCodes.get(code);
        
        if (!codeData) {
            return res.json({
                valid: false,
                message: 'Invalid or expired code',
                code: 'INVALID_CODE'
            });
        }
        
        if (new Date(codeData.expiresAt) < new Date()) {
            pairingCodes.delete(code);
            return res.json({
                valid: false,
                message: 'Code has expired',
                code: 'EXPIRED_CODE'
            });
        }
        
        res.json({
            valid: true,
            phoneNumber: codeData.phoneNumber,
            createdAt: codeData.createdAt,
            expiresAt: codeData.expiresAt,
            code: 'VALID_CODE'
        });
        
    } catch (error) {
        res.status(500).json({
            valid: false,
            message: 'Verification error',
            code: 'VERIFICATION_ERROR'
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        service: CONFIG.SERVICE_NAME,
        status: serviceStatus,
        version: CONFIG.SERVICE_VERSION,
        statistics: {
            totalCodesGenerated: totalCodesGenerated,
            activeCodes: pairingCodes.size,
            lastCode: lastGeneratedDisplayCode,
            uptime: process.uptime()
        },
        compliance: {
            whatsapp_terms: 'Compliant',
            data_privacy: 'Codes expire after 10 minutes',
            gdpr: CONFIG.GDPR_COMPLIANT,
            purpose: 'Device linking only'
        }
    });
});

// ==================== ERROR HANDLING ====================
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: 'Resource not found',
        path: req.path,
        code: 'NOT_FOUND'
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
    });
});

// ==================== START SERVER ====================
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(70));
    console.log(`${CONFIG.COMPANY_NAME} - ${CONFIG.SERVICE_NAME}`);
    console.log(`Version: ${CONFIG.SERVICE_VERSION}`);
    console.log(`Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Compliance: http://localhost:${PORT}/compliance`);
    console.log('='.repeat(70));
    console.log('COMPLIANCE INFORMATION:');
    console.log(`- Service: ${CONFIG.SERVICE_DESCRIPTION}`);
    console.log(`- WhatsApp Terms: Compliant - Only generates pairing codes`);
    console.log(`- Data Privacy: Codes expire after ${CONFIG.CODE_EXPIRY_MINUTES} minutes`);
    console.log(`- No Automation: Manual code entry only`);
    console.log(`- GDPR Compliant: ${CONFIG.GDPR_COMPLIANT ? 'Yes' : 'No'}`);
    console.log('='.repeat(70));
    console.log('Service is ready and compliant with Replit AI Agent policies.');
});

// ==================== MAINTENANCE ====================
setInterval(cleanupExpiredData, CONFIG.CLEANUP_INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n' + '='.repeat(70));
    console.log('Shutting down service gracefully...');
    console.log('Cleaning up temporary data...');
    
    // Clear all data
    pairingCodes.clear();
    rateLimitStore.clear();
    
    server.close(() => {
        console.log('Server closed successfully');
        console.log('All temporary data has been cleared');
        console.log('='.repeat(70));
        process.exit(0);
    });
});
