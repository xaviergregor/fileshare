# 🚀 FileShare

<div align="center">

![FileShare Banner](https://img.shields.io/badge/XGR-FileShare-bd93f9?style=for-the-badge&logo=files&logoColor=white)

**Système de partage de fichiers sécurisé**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Theme](https://img.shields.io/badge/Theme-Dracula-bd93f9)](https://draculatheme.com/)

[Fonctionnalités](#-fonctionnalités) • [Installation](#-installation) • [Utilisation](#-utilisation) • [Configuration](#️-configuration) • [Déploiement](#-déploiement)

</div>

---

## 📋 Description

FileShare est une application web moderne de partage de fichiers inspirée de WeTransfer et Firefox Send. Elle permet de partager des fichiers volumineux de manière simple, sécurisée et élégante avec un magnifique thème Dracula.

### ✨ Points forts

- 🎨 **Interface élégante** avec le thème Dracula
- 🔒 **Sécurité renforcée** avec protection par mot de passe
- 📦 **Fichiers volumineux** jusqu'à 2 Go par fichier
- ⏱️ **Expiration automatique** des liens de partage
- 🐳 **Déploiement facile** avec Docker
- 📱 **Design responsive** pour mobile et desktop
- 🔐 **Chiffrement bcrypt** des mots de passe

---

## 🎯 Fonctionnalités

### Upload de fichiers
- ✅ Glisser-déposer intuitif
- ✅ Sélection multiple de fichiers
- ✅ Support de fichiers jusqu'à 2 Go
- ✅ Barre de progression en temps réel
- ✅ Affichage de la vitesse d'upload
- ✅ Temps restant estimé

### Sécurité
- 🔒 **Protection par mot de passe optionnelle**
- 🔐 Hachage bcrypt (10 rounds)
- 🔑 ID de partage cryptographiquement sécurisés
- ⏰ Expiration configurable (1h, 6h, 24h, 3j, 7j)
- 📊 Limite de téléchargements
- 🧹 Nettoyage automatique des fichiers expirés

### Interface
- 🎨 Thème Dracula complet
- 📱 Design responsive
- 🌍 Interface en français
- ⚡ Performances optimisées
- 🖱️ UX intuitive

---

## 🚀 Installation

### Méthode 1 : Docker (Recommandée)

#### Prérequis
- Docker 20.10+
- Docker Compose 2.0+

#### Installation rapide

```bash
# Cloner le repository
git clone https://github.com/xaviergregor/fileshare.git
cd fileshare

# Lancer avec Docker Compose
docker compose up -d --build

# Accéder à l'application
# http://localhost:3000
```

### Méthode 2 : Installation manuelle

#### Prérequis
- Node.js 18+
- npm 9+

#### Installation

```bash
# Cloner le repository
git clone https://github.com/votre-username/fileshare.git
cd fileshare

# Installer les dépendances
npm install

# Démarrer le serveur
npm start

# Ou en mode développement
npm run dev
```

L'application sera accessible sur `http://localhost:3000`

---

## 💻 Utilisation

### 1. Upload de fichiers

1. Glissez-déposez vos fichiers dans la zone prévue ou cliquez pour sélectionner
2. Configurez les options :
   - **Durée de conservation** : 1h à 7 jours
   - **Téléchargements max** : 1 à 50 ou illimité
   - **Mot de passe** (optionnel) : Protégez vos fichiers
3. Cliquez sur **"Envoyer les fichiers"**
4. Copiez le lien de partage généré

### 2. Partage de fichiers

Envoyez le lien de partage à vos destinataires. Si vous avez défini un mot de passe, communiquez-leur également de manière sécurisée.

### 3. Téléchargement

Les destinataires :
1. Cliquent sur le lien
2. Entrent le mot de passe (si nécessaire)
3. Téléchargent les fichiers

---

## ⚙️ Configuration

### Variables d'environnement

Créez un fichier `.env` à la racine du projet :

```env
PORT=3000
NODE_ENV=production
TZ=Europe/Paris
```

### Modifier la taille maximale des fichiers

**Dans `server.js` :**
```javascript
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024 // 2 GB - Modifiez cette valeur
    }
});
```

**Dans `public/app.js` :**
```javascript
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB - Modifiez cette valeur
```
**Allez dans l'onglet "Advanced" de Nginx Proxy Manager et ajoutez ce code :**
```
# Augmenter la limite de taille pour 5 Go
client_max_body_size 6G;

# Timeouts pour les gros fichiers (30 minutes)
client_body_timeout 1800s;
client_header_timeout 1800s;
proxy_connect_timeout 1800s;
proxy_send_timeout 1800s;
proxy_read_timeout 1800s;
send_timeout 1800s;

# Optimisations pour gros fichiers
proxy_request_buffering off;
proxy_buffering off;
client_body_buffer_size 512k;
```

### Changer le port

**Dans `docker-compose.yml` :**
```yaml
ports:
  - "8080:3000"  # Utilisez le port 8080 au lieu de 3000
```

### Configuration du nettoyage automatique

Par défaut, les fichiers expirés sont nettoyés toutes les heures. Pour modifier :

**Dans `server.js` :**
```javascript
// '0 * * * *' = toutes les heures
// '*/30 * * * *' = toutes les 30 minutes
// '0 0 * * *' = une fois par jour à minuit
schedule.scheduleJob('0 * * * *', async () => {
    // Code de nettoyage
});
```

---

# 📱 Configuration des notifications Telegram

Guide pour configurer les notifications Telegram pour FileShare.

## 📋 Prérequis

- Un compte Telegram
- L'application Telegram installée

## 🤖 Étape 1 : Créer un bot Telegram

### 1. Ouvrir BotFather

Dans Telegram, recherchez et ouvrez **@BotFather** (le bot officiel de Telegram pour créer des bots)

### 2. Créer un nouveau bot

Envoyez la commande :
```
/newbot
```

### 3. Choisir un nom

BotFather vous demandera :
- **Nom du bot** (ex: "FileShare Notifier")
- **Username du bot** (doit finir par "bot", ex: "fileshare_bot")

### 4. Récupérer le token

BotFather vous donnera un **token** qui ressemble à ça :
```
123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
```

⚠️ **Gardez ce token secret !** C'est la clé d'accès à votre bot.

## 💬 Étape 2 : Obtenir votre Chat ID

### Méthode 1 : Avec un bot helper

1. Dans Telegram, recherchez **@userinfobot**
2. Démarrez une conversation avec `/start`
3. Il vous donnera votre **Chat ID** (ex: `123456789`)

### Méthode 2 : Avec votre bot

1. Recherchez votre bot dans Telegram (ex: `@fileshare_bot`)
2. Démarrez une conversation avec `/start`
3. Ouvrez dans votre navigateur :
```
https://api.telegram.org/bot<VOTRE_BOT_TOKEN>/getUpdates
```
Remplacez `<VOTRE_BOT_TOKEN>` par votre token

4. Cherchez `"chat":{"id":123456789}` dans la réponse
5. Le nombre après `"id":` est votre Chat ID

## ⚙️ Étape 3 : Configurer FileShare

### Modifier docker-compose.yml

Ouvrez le fichier `docker-compose.yml` et modifiez ces lignes :

```yaml
environment:
  - PORT=3000
  - NODE_ENV=production
  - TZ=Europe/Paris
  - TELEGRAM_ENABLED=true                              # Activer les notifications
  - TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...         # Votre token
  - TELEGRAM_CHAT_ID=123456789                        # Votre chat ID
```

### Redémarrer le service

```bash
docker compose down
docker compose up -d --build
```

## 🔕 Désactiver les notifications

Pour désactiver temporairement les notifications sans supprimer la configuration :

```yaml
environment:
  - TELEGRAM_ENABLED=false    # Passer à false
  - TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
  - TELEGRAM_CHAT_ID=123456789
```

Puis redémarrez :
```bash
docker compose restart fileshare
```

## 📊 Exemple de notification

Voici à quoi ressemble une notification :

```
🚀 Nouveau partage FileShare

📁 Fichier(s): 2
📄 Document.pdf (2.5 MB)
📄 Présentation.pptx (15.3 MB)

💾 Taille totale: 17.8 MB
⏰ Expiration: 24h
📊 Téléchargements max: 10
🔐 Protégé par mot de passe: 🔒 Oui

🔗 ID de partage: a1b2c3d4e5f6...
📅 Date: 30/11/2024 14:35:22
```
---

## 🎨 Personnalisation

### Thème Dracula

Le thème utilise la palette officielle Dracula :

```css
:root {
    --background: #282a36;      /* Arrière-plan */
    --current-line: #44475a;    /* Ligne actuelle */
    --foreground: #f8f8f2;      /* Texte principal */
    --comment: #6272a4;         /* Commentaires */
    --cyan: #8be9fd;            /* Cyan */
    --green: #50fa7b;           /* Vert */
    --orange: #ffb86c;          /* Orange */
    --pink: #ff79c6;            /* Rose */
    --purple: #bd93f9;          /* Violet */
    --red: #ff5555;             /* Rouge */
    --yellow: #f1fa8c;          /* Jaune */
}
```

### Modifier le logo

Remplacez l'emoji dans `public/index.html` :

```html
<h1 class="header">
    FileShare  <!-- Changez ici -->
</h1>
```

---

## 📁 Structure du projet

```
fileshare/
├── public/                 # Fichiers statiques
│   ├── index.html         # Interface principale
│   └── app.js             # JavaScript client
├── uploads/               # Fichiers uploadés (créé automatiquement)
├── data/                  # Métadonnées JSON (créé automatiquement)
├── server.js              # Serveur Express
├── package.json           # Dépendances Node.js
├── Dockerfile             # Configuration Docker
├── docker-compose.yml     # Orchestration Docker
├── .dockerignore         # Fichiers exclus du build Docker
├── .gitignore            # Fichiers exclus de Git
└── README.md             # Ce fichier
```

---

## 🛠️ Technologies utilisées

### Backend
- **Node.js** 18+ - Runtime JavaScript
- **Express** 4.x - Framework web
- **Multer** - Gestion des uploads
- **bcrypt** - Hachage des mots de passe
- **node-schedule** - Tâches planifiées

### Frontend
- **HTML5** - Structure
- **CSS3** - Styles (Dracula theme)
- **JavaScript ES6+** - Logique client
- **XMLHttpRequest** - Upload avec progression

### DevOps
- **Docker** - Containerisation
- **Docker Compose** - Orchestration

---

## 🐛 Dépannage

### Le serveur ne démarre pas

```bash
# Vérifier les logs
docker compose logs -f

# Vérifier que le port n'est pas utilisé
sudo netstat -tlnp | grep 3000

# Redémarrer le conteneur
docker compose restart
```

### Erreur lors de l'upload

**Fichier trop volumineux** :
- Vérifiez la limite dans `server.js` et `app.js`
- Vérifiez la configuration Nginx si utilisé

**Timeout** :
- Augmentez les timeouts dans la configuration Nginx
- Vérifiez l'espace disque disponible

### Impossible d'accéder depuis le réseau

1. Vérifiez que Docker écoute sur `0.0.0.0` dans `docker-compose.yml`
2. Vérifiez le pare-feu
3. Testez : `curl http://VOTRE-IP:3000`

### Le mot de passe ne fonctionne pas

1. Vérifiez les logs : `docker compose logs -f`
2. Reconstruisez sans cache : `docker compose build --no-cache`
3. Vérifiez que bcrypt est installé : `npm list bcrypt`

---

## 🔐 Sécurité

### Bonnes pratiques

- ✅ Utilisez HTTPS en production (Let's Encrypt)
- ✅ Configurez un pare-feu approprié
- ✅ Limitez l'accès réseau au strict nécessaire
- ✅ Gardez Node.js et les dépendances à jour
- ✅ Utilisez des mots de passe forts pour les partages sensibles
- ✅ Surveillez l'espace disque
- ✅ Effectuez des sauvegardes régulières

### Limitations connues

- Taille maximale par fichier : 2 Go (configurable)
- Pas d'authentification utilisateur (intentionnel)
- Stockage local uniquement (pas de S3/cloud storage)

---

## 📊 Performances

### Optimisations

- Streaming des fichiers (pas de chargement en mémoire)
- Nettoyage automatique des fichiers expirés
- Compression gzip des assets statiques (via Nginx)
- Cache des fichiers statiques

### Recommandations serveur

**Minimum** :
- CPU : 1 cœur
- RAM : 512 MB
- Disque : 10 GB + espace pour les fichiers

**Recommandé** :
- CPU : 2+ cœurs
- RAM : 2 GB
- Disque : SSD avec 50+ GB

---

## 🤝 Contribution

Les contributions sont les bienvenues ! 

### Comment contribuer

1. Forkez le projet
2. Créez une branche (`git checkout -b feature/amelioration`)
3. Committez vos changements (`git commit -am 'Ajout de fonctionnalité'`)
4. Poussez vers la branche (`git push origin feature/amelioration`)
5. Créez une Pull Request

### Reporting de bugs

Ouvrez une issue sur GitHub avec :
- Description du problème
- Étapes pour reproduire
- Logs du serveur
- Version de Node.js et Docker

---

## 📝 Changelog

### Version 2.0.0 (Actuelle)
- ✨ Ajout de la protection par mot de passe
- 🔐 Hachage bcrypt des mots de passe
- 🎨 Amélioration de l'interface utilisateur
- 🐛 Corrections de bugs
- 📚 Documentation améliorée

### Version 1.0.0
- 🎉 Version initiale
- 📤 Upload de fichiers
- 🔗 Génération de liens de partage
- ⏰ Expiration automatique
- 🎨 Thème Dracula

---

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 👨‍💻 Auteur

**Xavier Gregor**  

Spécialiste en solutions IT et infrastructures

---

<div align="center">

**Made with ❤️ and the Dracula theme 🧛‍♂️**

⭐ Si ce projet vous plaît, n'hésitez pas à lui donner une étoile !

[⬆ Retour en haut](#-fileshare)

</div>
