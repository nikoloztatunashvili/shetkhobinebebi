FROM node:20

# საჭირო სისტემური ბიბლიოთეკების და Chrome-ის ინსტალაცია
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# სამუშაო დირექტორიის შექმნა
WORKDIR /usr/src/app

# დამოკიდებულებების კოპირება და ინსტალაცია
COPY package*.json ./
RUN npm install

# პროექტის ფაილების კოპირება
COPY . .

# სერვერის პორტის გახსნა
EXPOSE 3000

# აპლიკაციის გაშვება
CMD [ "node", "server.js" ]