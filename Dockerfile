FROM node:18-alpine

# Installer les dépendances système pour bcrypt
RUN apk add --no-cache python3 make g++

# Créer le répertoire de l'application
WORKDIR /app

# Copier package.json et package-lock.json
COPY package*.json ./

# Installer les dépendances
RUN npm install --production

# Copier le serveur
COPY server.js ./

# Copier le dossier public
COPY public/ ./public/

# Créer les dossiers pour uploads et data
RUN mkdir -p uploads data

# Exposer le port
EXPOSE 3000

# Variables d'environnement
ENV PORT=3000
ENV NODE_ENV=production

# Démarrer l'application
CMD ["node", "server.js"]
