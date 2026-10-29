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

        for (let number of numbers) {
            let cleanNumber = number.toString().replace(/\D/g, ''); 
            if (!cleanNumber) continue;
            
            const chatId = `${cleanNumber}@c.us`;
            
            try {
                await client.sendMessage(chatId, text);
                socket.emit('log', `✅ გაიგზავნა: ${cleanNumber}`);
            } catch (error) {
                socket.emit('log', `❌ შეცდომა (${cleanNumber}): ${error.message}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        socket.emit('log', '🎉 დაგზავნის პროცესი დასრულებულია!');
    });
});

// პორტის და ჰოსტის დინამიური მინიჭება Render-ისთვის
const PORT = process.env.PORT || 80;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`სერვერი გაეშვა პორტზე: ${PORT}`);
});