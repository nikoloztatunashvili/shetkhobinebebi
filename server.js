const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let client;
let isConnected = false;

io.on('connection', (socket) => {
    console.log('UI დაუკავშირდა სერვერს');

    socket.on('start_auth', () => {
        if (isConnected) {
            socket.emit('status', '✅ უკვე დაკავშირებულია!');
            return;
        }

        if (client) client.destroy();

        // Render-ისთვის აუცილებელი Puppeteer პარამეტრები
        client = new Client({
            authStrategy: new LocalAuth(),
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
                // დაამატეთ ეს ხაზი, რათა თავიდან ავიცილოთ timeout ერორები ნელი ჩატვირთვისას
                timeout: 60000 
            }
        });

        client.on('qr', async (qr) => {
            try {
                const qrImageBase64 = await qrcode.toDataURL(qr);
                socket.emit('qr', qrImageBase64);
                socket.emit('status', 'ელოდება დასკანერებას...');
            } catch (err) {
                console.error(err);
            }
        });

        client.on('ready', () => {
            isConnected = true;
            socket.emit('ready', '✅ WhatsApp წარმატებით დაუკავშირდა!');
        });

        client.on('disconnected', () => {
            isConnected = false;
            socket.emit('status', '❌ WhatsApp გაითიშა. თავიდან გაიარეთ ავტორიზაცია.');
        });

        client.initialize();
        socket.emit('status', 'WhatsApp კლიენტი ირთვება...');
    });

    socket.on('send_messages', async (data) => {
        const { numbers, text } = data;
        
        if (!isConnected) {
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
            let cleanNumber = number.toString().replace(/\D/g, ''); 
            if (!cleanNumber) continue;
            
            const chatId = `${cleanNumber}@c.us`;
            let recipientName = '';

            try {
                const contact = await client.getContactById(chatId);
                const rawName = contact.pushname || contact.name || '';
                
                // ვამოწმებთ, რომ სახელი შეიცავს მინიმუმ 1 ქართულ ან ლათინურ ასოს და არ არის სიმბოლოები
                if (/^[a-zA-Zა-ჰ\s]{1,50}$/.test(rawName.trim())) {
                    recipientName = rawName.trim().split(/\s+/)[0];
                }
            } catch (e) {
                // თუ კონტაქტის წამოღება ვერ მოხერხდა, ვაგრძელებთ სახელის გარეშე
            }

            const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
            const prefix = recipientName ? `${randomGreeting} ${recipientName},` : `${randomGreeting},`;
            const finalMessage = `${prefix}\n${text}`;

            try {
                await client.sendMessage(chatId, finalMessage);
                socket.emit('log', `✅ გაიგზავნა: ${cleanNumber}`);
            } catch (error) {
                socket.emit('log', `❌ შეცდომა (${cleanNumber}): ${error.message}`);
            }
            
            const randomDelay = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        }
        
        socket.emit('log', '🎉 დაგზავნის პროცესი დასრულებულია!');
    });
});

// პორტის და ჰოსტის დინამიური მინიჭება Render-ისთვის
const PORT = process.env.PORT || 80;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`სერვერი გაეშვა პორტზე: ${PORT}`);
});