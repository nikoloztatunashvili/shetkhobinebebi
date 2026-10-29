const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ვეუბნებით, რომ ვებგვერდის ფაილები 'public' ფოლდერიდან წაიკითხოს
app.use(express.static('public'));

let client;
let isConnected = false;

io.on('connection', (socket) => {
    console.log('UI დაუკავშირდა სერვერს');

    // ავტორიზაციის დაწყება
    socket.on('start_auth', () => {
        if (isConnected) {
            socket.emit('status', '✅ უკვე დაკავშირებულია!');
            return;
        }

        if (client) client.destroy();

        client = new Client({
            authStrategy: new LocalAuth()
        });

        client.on('qr', async (qr) => {
            try {
                // ვქმნით QR კოდის Base64 სურათს, რომ პირდაპირ HTML-ში ვაჩვენოთ
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

    // შეტყობინებების გაგზავნა
    socket.on('send_messages', async (data) => {
        const { numbers, text } = data;
        
        if (!isConnected) {
            socket.emit('log', '❌ ჯერ გაიარეთ ავტორიზაცია QR კოდით.');
            return;
        }

        socket.emit('log', '⏳ დაგზავნა იწყება...');

        for (let number of numbers) {
            let cleanNumber = number.toString().replace(/\D/g, ''); // მხოლოდ ციფრები
            if (!cleanNumber) continue;
            
            const chatId = `${cleanNumber}@c.us`;
            
            try {
                await client.sendMessage(chatId, text);
                socket.emit('log', `✅ გაიგზავნა: ${cleanNumber}`);
            } catch (error) {
                socket.emit('log', `❌ შეცდომა (${cleanNumber}): ${error.message}`);
            }
            
            // 3-წამიანი დაყოვნება ბლოკისგან თავის ასარიდებლად
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        socket.emit('log', '🎉 დაგზავნის პროცესი დასრულებულია!');
    });
});

server.listen(3000, () => {
    console.log('სერვერი გაეშვა მისამართზე: http://localhost:3000');
});