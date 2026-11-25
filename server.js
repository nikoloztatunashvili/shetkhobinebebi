const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const AUTH_DIR = path.resolve('./.wwebjs_auth');
const SESSION_DIR = path.join(AUTH_DIR, 'session');
const CACHE_DIR = path.resolve('./.wwebjs_cache');
const LOCK_NAMES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
const LOGOUT_REASONS = new Set(['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE']);

let client = null;
let isConnected = false;
let starting = false;
let sendGeneration = 0;
let operation = Promise.resolve();

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function runExclusive(task) {
    const run = operation.then(task, task);
    operation = run.then(() => {}, () => {});
    return run;
}

function existsOrLink(target) {
    try {
        fs.lstatSync(target);
        return true;
    } catch (_) {
        return false;
    }
}

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

function readLockPid(lockPath) {
    try {
        const target = fs.readlinkSync(lockPath);
        const match = String(target).match(/-(\d+)$/);
        if (match) return Number(match[1]);
    } catch (_) {}

    try {
        const text = fs.readFileSync(lockPath, 'utf8');
        const matches = String(text).match(/\d+/g);
        if (matches) return Number(matches[matches.length - 1]);
    } catch (_) {}

    return null;
}

function commandForPid(pid) {
    try {
        if (process.platform === 'win32') {
            try {
                return execFileSync(
                    'wmic',
                    ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine'],
                    { encoding: 'utf8' }
                );
            } catch (_) {
                return execFileSync(
                    'powershell',
                    ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
                    { encoding: 'utf8' }
                );
            }
        }
        return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    } catch (_) {
        return '';
    }
}

function sessionIsUsable(sessionDir) {
    const profileDir = path.join(sessionDir, 'Default');
    if (!existsOrLink(profileDir)) return false;
    return (
        existsOrLink(path.join(profileDir, 'IndexedDB')) ||
        existsOrLink(path.join(profileDir, 'Local Storage'))
    );
}

async function removeWithRetry(target) {
    if (!existsOrLink(target)) return;
    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5 });
            return;
        } catch (err) {
            if (attempt === 7) {
                console.error(`ვერ წაიშალა ${target}: ${err.message}`);
                return;
            }
            await sleep(300 * (attempt + 1));
        }
    }
}

async function clearStaleLocks() {
    if (!existsOrLink(SESSION_DIR)) return false;

    let profileBusy = false;
    for (const name of LOCK_NAMES) {
        const filePath = path.join(SESSION_DIR, name);
        if (!existsOrLink(filePath)) continue;

        const pid = readLockPid(filePath);
        if (pid && isPidAlive(pid)) {
            const command = commandForPid(pid);
            const ownsProfile = command.includes(SESSION_DIR) || command.includes('.wwebjs_auth');
            if (!ownsProfile) {
                profileBusy = true;
                continue;
            }

            try { process.kill(pid, 'SIGTERM'); } catch (_) {}
            await sleep(400);
            if (isPidAlive(pid)) {
                try { process.kill(pid, 'SIGKILL'); } catch (_) {}
                await sleep(200);
            }
        }

        await fs.promises.rm(filePath, { force: true }).catch(() => {});
    }

    if (!profileBusy) {
        const databaseLock = path.join(SESSION_DIR, 'Default', 'LOCK');
        if (existsOrLink(databaseLock)) {
            await fs.promises.rm(databaseLock, { force: true }).catch(() => {});
        }
    }

    return profileBusy;
}

async function wipeSessionDir() {
    await clearStaleLocks();
    await removeWithRetry(SESSION_DIR);
    await removeWithRetry(CACHE_DIR);
}

async function prepareSession() {
    await clearStaleLocks();
    if (existsOrLink(SESSION_DIR) && !sessionIsUsable(SESSION_DIR)) {
        console.log('სესიის საქაღალდეში მხოლოდ ზედმეტი ფაილები დარჩა, იშლება');
        await wipeSessionDir();
    }
}

async function shutdownClient({ wipe, expected }) {
    if (expected && client !== expected) return;

    const current = client;
    client = null;
    isConnected = false;
    sendGeneration++;

    if (current) {
        try {
            await current.destroy();
        } catch (err) {
            console.error('კლიენტის დახურვა:', err.message);
        }
    }

    if (wipe) await wipeSessionDir();
    else await clearStaleLocks();
}

function createClient() {
    const created = new Client({
        authStrategy: new LocalAuth({
            dataPath: AUTH_DIR,
            rmMaxRetries: 15
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions'
            ],
            timeout: 60000
        }
    });

    created.on('qr', async (qr) => {
        try {
            const qrImageBase64 = await qrcode.toDataURL(qr);
            io.emit('qr', qrImageBase64);
            io.emit('status', 'ელოდება დასკანერებას...');
        } catch (err) {
            console.error(err);
        }
    });

    created.on('ready', () => {
        isConnected = true;
        io.emit('ready', '✅ WhatsApp წარმატებით დაუკავშირდა!');
    });

    created.on('auth_failure', (message) => {
        if (client !== created) return;
        isConnected = false;
        sendGeneration++;
        console.error('auth_failure:', message);
        io.emit('status', '❌ ავტორიზაცია ჩავარდა. ძველი სესია იშლება, თავიდან დაასკანერეთ QR.');
        io.emit('logged_out');
        runExclusive(() => shutdownClient({ wipe: true, expected: created }));
    });

    created.on('disconnected', (reason) => {
        if (client !== created) return;
        isConnected = false;
        sendGeneration++;
        const loggedOut = LOGOUT_REASONS.has(reason);
        io.emit('status', loggedOut
            ? '❌ WhatsApp-იდან გახვედით. ძველი სესია იშლება, თავიდან დაასკანერეთ QR.'
            : '❌ WhatsApp გაითიშა. თავიდან გაიარეთ ავტორიზაცია.');
        if (loggedOut) io.emit('logged_out');
        runExclusive(() => shutdownClient({ wipe: loggedOut, expected: created }));
    });

    return created;
}

async function launchClient() {
    if (isConnected) return;
    await shutdownClient({ wipe: false });
    await prepareSession();

    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const created = createClient();
        client = created;
        try {
            await created.initialize();
            return;
        } catch (err) {
            lastError = err;
            console.error(`კლიენტის გაშვება (${attempt}):`, err.message);
            if (client === created) client = null;
            try { await created.destroy(); } catch (_) {}
            await clearStaleLocks();
            if (!sessionIsUsable(SESSION_DIR)) await wipeSessionDir();
        }
    }

    io.emit('status', `❌ კლიენტი ვერ გაეშვა: ${lastError ? lastError.message : 'უცნობი შეცდომა'}`);
    io.emit('logged_out');
}

io.on('connection', (socket) => {
    console.log('UI დაუკავშირდა სერვერს');
    socket.emit('status', isConnected ? '✅ უკვე დაკავშირებულია!' : 'არ არის დაკავშირებული');
    if (isConnected) socket.emit('ready', '✅ WhatsApp დაკავშირებულია');

    socket.on('start_auth', () => {
        if (isConnected) {
            socket.emit('status', '✅ უკვე დაკავშირებულია!');
            return;
        }
        if (starting) {
            socket.emit('status', 'WhatsApp კლიენტი ირთვება...');
            return;
        }

        starting = true;
        socket.emit('status', 'WhatsApp კლიენტი ირთვება...');
        runExclusive(async () => {
            try {
                await launchClient();
            } finally {
                starting = false;
            }
        }).catch((err) => {
            console.error(err);
            io.emit('status', `❌ კლიენტი ვერ გაეშვა: ${err.message}`);
        });
    });

    socket.on('logout', () => {
        socket.emit('status', 'გასვლა...');
        runExclusive(async () => {
            const current = client;
            client = null;
            isConnected = false;
            sendGeneration++;

            if (current) {
                try {
                    await current.logout();
                } catch (err) {
                    console.error('logout:', err.message);
                    try { await current.destroy(); } catch (_) {}
                }
            }

            await wipeSessionDir();
            io.emit('logged_out');
            io.emit('status', 'გამოსული ხართ. QR კოდით თავიდან შედით.');
        }).catch((err) => {
            console.error(err);
            io.emit('status', `❌ გასვლა ვერ დასრულდა: ${err.message}`);
        });
    });

    socket.on('send_messages', async (data) => {
        const { numbers, text } = data;
        const generation = sendGeneration;
        const activeClient = client;

        if (!isConnected || !activeClient) {
            socket.emit('log', '❌ ჯერ გაიარეთ ავტორიზაცია QR კოდით.');
            return;
        }

        socket.emit('log', '⏳ დაგზავნა იწყება...');
        const greetings = [
            'გამარჯობა',
            'მოგესალმებით',
            'სალამი',
            'დღე მშვიდობისა',
            'მშვიდობიანი დღე',
            'სასიამოვნო დღეს გისურვებთ',
            'წარმატებულ დღეს გისურვებთ',
            'მშვიდობიან დღეს გისურვებთ',
            'პოზიტიურ დღეს გისურვებთ',
            'ნაყოფიერ დღეს გისურვებთ',
            'კარგ დღეს გისურვებთ',
            'ბედნიერ დღეს გისურვებთ',
            'გულითადად მოგესალმებით',
            'პატივისცემით მოგესალმებით',
            'კეთილი სურვილებით მოგესალმებით',
            'დიდი სიამოვნებით მოგესალმებით',
            'თბილად მოგესალმებით',
            'გისურვებთ წარმატებულ დღეს',
            'გისურვებთ მშვიდობიან დღეს',
            'გისურვებთ სასიამოვნო დღეს'
        ];

        for (let number of numbers) {
            if (generation !== sendGeneration || !isConnected || client !== activeClient) {
                socket.emit('log', 'გაგზავნა გაჩერდა, რადგან სესია გაითიშა.');
                return;
            }

            let cleanNumber = number.toString().replace(/\D/g, '');
            if (!cleanNumber) continue;

            const chatId = `${cleanNumber}@c.us`;
            let recipientName = '';

            try {
                const contact = await activeClient.getContactById(chatId);
                const rawName = contact.pushname || contact.name || '';

                if (/^[a-zA-Zა-ჰ\s]{1,50}$/.test(rawName.trim())) {
                    recipientName = rawName.trim().split(/\s+/)[0];
                }
            } catch (e) {
                // კონტაქტის წამოღება ვერ მოხერხდა — სახელის გარეშე გრძელდება
            }

            const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
            const prefix = recipientName ? `${randomGreeting} ${recipientName},` : `${randomGreeting},`;
            const finalMessage = `${prefix}\n${text}`;

            try {
                await activeClient.sendMessage(chatId, finalMessage);
                socket.emit('log', `✅ გაიგზავნა: ${cleanNumber}`);
            } catch (error) {
                socket.emit('log', `❌ შეცდომა (${cleanNumber}): ${error.message}`);
                if (generation !== sendGeneration || !isConnected) return;
            }

            const randomDelay = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        }

        socket.emit('log', '🎉 დაგზავნის პროცესი დასრულებულია!');
    });
});

prepareSession().catch((err) => console.error(err));

const PORT = process.env.PORT || 80;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`სერვერი გაეშვა პორტზე: ${PORT}`);
});
