const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const schedule = require('node-schedule');
const bcrypt = require('bcrypt');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration Telegram
const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Configuration des dossiers
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');

// Créer les dossiers nécessaires
async function initDirectories() {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('Erreur lors de la création des dossiers:', error);
    }
}

// Fonction pour envoyer une notification Telegram
async function sendTelegramNotification(message) {
    if (!TELEGRAM_ENABLED) {
        return;
    }
    
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error('❌ Telegram activé mais BOT_TOKEN ou CHAT_ID manquant');
        return;
    }
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
        chat_id: parseInt(TELEGRAM_CHAT_ID),
        text: message
    });
    
    const contentLength = Buffer.byteLength(data, 'utf8');
    
    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': contentLength
            }
        };
        
        const req = https.request(url, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('✅ Notification Telegram envoyée');
                    resolve(responseData);
                } else {
                    console.error('❌ Erreur Telegram:', res.statusCode, responseData);
                    reject(new Error(`Telegram API error: ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('❌ Erreur réseau Telegram:', error.message);
            reject(error);
        });
        
        req.write(data);
        req.end();
    });
}

// Fonction helper pour formater la taille des fichiers
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Fonction helper pour formater le temps d'expiration
function formatExpiryTime(date) {
    const now = new Date();
    const diff = date - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));
    
    if (minutes < 60) {
        return `${minutes} min`;
    } else if (hours < 24) {
        return `${hours}h`;
    } else {
        const days = Math.floor(hours / 24);
        return `${days} jour${days > 1 ? 's' : ''}`;
    }
}

// Configuration de multer pour l'upload
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const shareId = crypto.randomBytes(16).toString('hex');
        const uploadPath = path.join(UPLOAD_DIR, shareId);
        
        try {
            await fs.mkdir(uploadPath, { recursive: true });
            req.shareId = shareId;
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024 // 5 GB
    }
});

// Middleware
app.use(express.json({ limit: '6gb' }));
app.use(express.urlencoded({ limit: '6gb', extended: true }));
app.use(express.static('public'));

// Servir les fichiers statiques
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route d'upload
app.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
        console.log('Upload démarré');
        const shareId = req.shareId;
        const files = req.files;
        const expiryHours = parseInt(req.body.expiryHours) || 24;
        const maxDownloads = parseInt(req.body.maxDownloads) || 0;
        const password = req.body.password;
        
        console.log(`Fichiers reçus: ${files ? files.length : 0}`);
        
        if (!files || files.length === 0) {
            console.error('Aucun fichier envoyé');
            return res.status(400).json({ error: 'Aucun fichier envoyé' });
        }
        
        // Calculer la date d'expiration
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + expiryHours);
        
        // Hasher le mot de passe si fourni
        let hashedPassword = null;
        if (password && password.trim() !== '') {
            console.log('Hachage du mot de passe...');
            hashedPassword = await bcrypt.hash(password, 10);
        }
        
        // Créer les métadonnées
        const metadata = {
            shareId: shareId,
            files: files.map(f => ({
                originalName: f.originalname,
                filename: f.filename,
                size: f.size,
                mimetype: f.mimetype
            })),
            uploadDate: new Date().toISOString(),
            expiryDate: expiryDate.toISOString(),
            maxDownloads: maxDownloads,
            downloadCount: 0,
            password: hashedPassword
        };
        
        console.log('Sauvegarde des métadonnées...');
        
        // Sauvegarder les métadonnées
        await fs.writeFile(
            path.join(DATA_DIR, `${shareId}.json`),
            JSON.stringify(metadata, null, 2)
        );
        
        console.log('Upload terminé avec succès');
        
        // Envoyer notification Telegram
        if (TELEGRAM_ENABLED) {
            try {
                const totalSize = files.reduce((sum, f) => sum + f.size, 0);
                const filesList = files.map(f => `  - ${f.originalname} (${formatFileSize(f.size)})`).join('\n');
                const expiryInfo = formatExpiryTime(expiryDate);
                const downloadLimit = maxDownloads === 0 ? 'Illimite' : maxDownloads;
                const passwordProtected = hashedPassword ? 'Oui' : 'Non';
                
                const message = `🚀 Nouveau partage FileShare

📁 Fichier(s): ${files.length}
${filesList}

💾 Taille totale: ${formatFileSize(totalSize)}
⏰ Expiration: ${expiryInfo}
📊 Telechargements max: ${downloadLimit}
🔐 Mot de passe: ${passwordProtected}

🔗 ID: ${shareId}
📅 ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`;
                
                await sendTelegramNotification(message);
            } catch (err) {
                console.error('❌ Erreur notification Telegram:', err.message);
            }
        }
        
        // Formater la réponse
        const expiryInfo = formatExpiryTime(expiryDate);
        
        res.json({
            success: true,
            shareId: shareId,
            expiryTime: expiryInfo,
            maxDownloads: maxDownloads,
            fileCount: files.length
        });
        
    } catch (error) {
        console.error('Erreur upload détaillée:', error);
        res.status(500).json({ error: 'Erreur lors de l\'upload: ' + error.message });
    }
});

// Route pour afficher la page de téléchargement
app.get('/download/:shareId', async (req, res) => {
    try {
        const shareId = req.params.shareId;
        const metadataPath = path.join(DATA_DIR, `${shareId}.json`);
        
        // Vérifier si les métadonnées existent
        try {
            await fs.access(metadataPath);
        } catch {
            return res.status(404).send(generateErrorPage('Fichier non trouvé ou expiré'));
        }
        
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        // Vérifier l'expiration
        if (new Date() > new Date(metadata.expiryDate)) {
            await cleanupShare(shareId);
            return res.status(410).send(generateErrorPage('Ce lien a expiré'));
        }
        
        // Vérifier le nombre de téléchargements
        if (metadata.maxDownloads > 0 && metadata.downloadCount >= metadata.maxDownloads) {
            await cleanupShare(shareId);
            return res.status(410).send(generateErrorPage('Nombre maximum de téléchargements atteint'));
        }
        
        // Si un mot de passe est requis, afficher le formulaire
        if (metadata.password) {
            // Vérifier si le mot de passe a été fourni en query string (session côté client)
            const providedPassword = req.query.verified;
            if (providedPassword === 'true') {
                return res.send(generateDownloadPage(metadata));
            }
            return res.send(generatePasswordPage(shareId));
        }
        
        res.send(generateDownloadPage(metadata));
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).send(generateErrorPage('Erreur serveur'));
    }
});

// Route pour vérifier le mot de passe
app.post('/api/verify-password/:shareId', async (req, res) => {
    try {
        const shareId = req.params.shareId;
        const password = req.body.password;
        const metadataPath = path.join(DATA_DIR, `${shareId}.json`);
        
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        // Vérifier l'expiration
        if (new Date() > new Date(metadata.expiryDate)) {
            await cleanupShare(shareId);
            return res.status(410).json({ error: 'Expiré' });
        }
        
        // Vérifier le mot de passe
        if (metadata.password) {
            const match = await bcrypt.compare(password, metadata.password);
            if (!match) {
                return res.status(401).json({ error: 'Mot de passe incorrect' });
            }
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour télécharger un fichier
app.get('/api/download/:shareId/:fileIndex', async (req, res) => {
    try {
        const shareId = req.params.shareId;
        const fileIndex = parseInt(req.params.fileIndex);
        const password = req.query.password;
        const metadataPath = path.join(DATA_DIR, `${shareId}.json`);
        
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        
        // Vérifications
        if (new Date() > new Date(metadata.expiryDate)) {
            await cleanupShare(shareId);
            return res.status(410).json({ error: 'Expiré' });
        }
        
        if (metadata.maxDownloads > 0 && metadata.downloadCount >= metadata.maxDownloads) {
            await cleanupShare(shareId);
            return res.status(410).json({ error: 'Limite atteinte' });
        }
        
        // Vérifier le mot de passe si nécessaire
        if (metadata.password) {
            if (!password) {
                return res.status(401).json({ error: 'Mot de passe requis' });
            }
            const match = await bcrypt.compare(password, metadata.password);
            if (!match) {
                return res.status(401).json({ error: 'Mot de passe incorrect' });
            }
        }
        
        const file = metadata.files[fileIndex];
        if (!file) {
            return res.status(404).json({ error: 'Fichier non trouvé' });
        }
        
        const filePath = path.join(UPLOAD_DIR, shareId, file.filename);
        
        // Incrémenter le compteur de téléchargements
        metadata.downloadCount++;
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        
        // Envoyer le fichier
        res.download(filePath, file.originalName);
        
    } catch (error) {
        console.error('Erreur téléchargement:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Nettoyage d'un partage
async function cleanupShare(shareId) {
    try {
        const uploadPath = path.join(UPLOAD_DIR, shareId);
        const metadataPath = path.join(DATA_DIR, `${shareId}.json`);
        
        await fs.rm(uploadPath, { recursive: true, force: true });
        await fs.unlink(metadataPath).catch(() => {});
        
        console.log(`Nettoyage du partage ${shareId}`);
    } catch (error) {
        console.error('Erreur nettoyage:', error);
    }
}

// Tâche planifiée pour nettoyer les fichiers expirés (toutes les heures)
schedule.scheduleJob('0 * * * *', async () => {
    try {
        const files = await fs.readdir(DATA_DIR);
        
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            const metadataPath = path.join(DATA_DIR, file);
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            
            if (new Date() > new Date(metadata.expiryDate)) {
                await cleanupShare(metadata.shareId);
            }
        }
        
        console.log('Nettoyage automatique effectué');
    } catch (error) {
        console.error('Erreur nettoyage automatique:', error);
    }
});

// Générer la page de mot de passe
function generatePasswordPage(shareId) {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mot de passe requis - FileShare</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
            /* Backgrounds */
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #1c2128;

            /* Borders */
            --border: #30363d;

            /* Green phosphorescent */
            --green-bright: #3fb950;
            --green-default: #238636;
            --green-dim: #2ea043;
            --green-glow: rgba(63, 185, 80, 0.4);

            /* Accent colors */
            --cyan: #56d4dd;
            --red: #f85149;
            --yellow: #d29922;

            /* Text */
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --text-tertiary: #6e7681;

            /* Typography */
            --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
        }

        body {
            font-family: var(--font-mono);
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }

        /* Scanlines */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            background: repeating-linear-gradient(
                0deg,
                rgba(0, 0, 0, 0.15),
                rgba(0, 0, 0, 0.15) 1px,
                transparent 1px,
                transparent 2px
            );
            z-index: 1000;
            opacity: 0.4;
        }

        /* Terminal Window */
        .terminal-window {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 40px var(--green-glow);
        }

        .terminal-header {
            background: var(--bg-tertiary);
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            border-bottom: 1px solid var(--border);
        }

        .terminal-btn {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .terminal-btn.red { background: #ff5f56; }
        .terminal-btn.yellow { background: #ffbd2e; }
        .terminal-btn.green { background: #27ca40; }

        .terminal-title {
            flex: 1;
            text-align: center;
            color: var(--text-tertiary);
            font-size: 0.85rem;
            margin-right: 50px;
        }

        .terminal-body {
            padding: 2rem;
            text-align: center;
        }

        .lock-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
            display: block;
        }

        h1 {
            color: var(--yellow);
            font-size: 1.5rem;
            margin-bottom: 0.75rem;
        }

        .description {
            color: var(--text-secondary);
            margin-bottom: 2rem;
            font-size: 0.9rem;
            line-height: 1.6;
        }

        .cmd-line {
            background: var(--bg-primary);
            padding: 0.75rem 1rem;
            border-radius: 6px;
            border: 1px solid var(--border);
            margin-bottom: 1.5rem;
            text-align: left;
            font-size: 0.85rem;
        }

        .cmd-line .prompt {
            color: var(--green-bright);
        }

        .cmd-line .cmd {
            color: var(--text-primary);
        }

        .cmd-line .cursor {
            display: inline-block;
            width: 8px;
            height: 14px;
            background: var(--green-bright);
            margin-left: 2px;
            animation: blink 1s step-end infinite;
            vertical-align: middle;
        }

        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
        }

        .input-group {
            margin-bottom: 1.5rem;
        }

        input[type="password"] {
            width: 100%;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 0.875rem 1rem;
            border-radius: 6px;
            font-size: 1rem;
            font-family: var(--font-mono);
            transition: all 0.3s ease;
        }

        input[type="password"]:focus {
            outline: none;
            border-color: var(--green-dim);
            box-shadow: 0 0 15px var(--green-glow);
        }

        input[type="password"]::placeholder {
            color: var(--text-tertiary);
        }

        .btn {
            background: var(--green-default);
            color: var(--text-primary);
            border: 1px solid var(--green-bright);
            padding: 0.875rem 2rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            font-family: var(--font-mono);
            width: 100%;
            transition: all 0.3s ease;
            box-shadow: 0 0 10px var(--green-glow);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }

        .btn:hover {
            background: var(--green-bright);
            box-shadow: 0 0 20px var(--green-glow);
            transform: translateY(-2px);
        }

        .error {
            background: rgba(248, 81, 73, 0.1);
            border: 1px solid var(--red);
            color: var(--red);
            padding: 0.875rem 1rem;
            border-radius: 6px;
            margin-bottom: 1rem;
            display: none;
            font-size: 0.9rem;
            text-align: left;
        }

        .error::before {
            content: "❌ ";
        }

        .error.show {
            display: block;
            animation: shake 0.4s ease;
        }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }

        .back-link {
            margin-top: 1.5rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--border);
        }

        .back-link a {
            color: var(--text-tertiary);
            text-decoration: none;
            font-size: 0.85rem;
            transition: all 0.3s ease;
        }

        .back-link a:hover {
            color: var(--green-bright);
        }
    </style>
</head>
<body>
    <div class="terminal-window">
        <div class="terminal-header">
            <div class="terminal-btn red"></div>
            <div class="terminal-btn yellow"></div>
            <div class="terminal-btn green"></div>
            <div class="terminal-title">fileshare -- authenticate</div>
        </div>
        <div class="terminal-body">
            <span class="lock-icon">🔒</span>
            <h1>Fichiers protégés</h1>
            <p class="description">Ce partage est protégé par un mot de passe.<br>Veuillez entrer le mot de passe pour accéder aux fichiers.</p>
            
            <div class="cmd-line">
                <span class="prompt">auth@fileshare:~$</span>
                <span class="cmd"> unlock --password </span>
                <span class="cursor"></span>
            </div>
            
            <div class="error" id="error"></div>
            
            <form id="passwordForm">
                <div class="input-group">
                    <input type="password" id="password" placeholder="Entrez le mot de passe" required autofocus>
                </div>
                <button type="submit" class="btn">
                    <span>🔓</span> Déverrouiller
                </button>
            </form>

            <div class="back-link">
                <a href="/">← Retour à l'accueil</a>
            </div>
        </div>
    </div>
    
    <script>
        document.getElementById('passwordForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');
            
            try {
                const response = await fetch('/api/verify-password/${shareId}', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ password })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Stocker le mot de passe en session
                    sessionStorage.setItem('share_${shareId}_password', password);
                    // Rediriger avec paramètre verified
                    window.location.href = '/download/${shareId}?verified=true';
                } else {
                    errorDiv.textContent = data.error || 'Mot de passe incorrect';
                    errorDiv.classList.add('show');
                    document.getElementById('password').value = '';
                    document.getElementById('password').focus();
                }
            } catch (error) {
                errorDiv.textContent = 'Erreur de connexion';
                errorDiv.classList.add('show');
            }
        });
    </script>
</body>
</html>
    `;
}

// Générer la page de téléchargement
function generateDownloadPage(metadata) {
    const totalSize = metadata.files.reduce((sum, f) => sum + f.size, 0);
    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };
    
    const hasPassword = metadata.password ? 'true' : 'false';
    
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Télécharger les fichiers - FileShare</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
            /* Backgrounds */
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #1c2128;

            /* Borders */
            --border: #30363d;

            /* Green phosphorescent */
            --green-bright: #3fb950;
            --green-default: #238636;
            --green-dim: #2ea043;
            --green-glow: rgba(63, 185, 80, 0.4);

            /* Accent colors */
            --cyan: #56d4dd;
            --yellow: #d29922;
            --yellow-bright: #e3b341;

            /* Text */
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --text-tertiary: #6e7681;

            /* Typography */
            --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
        }

        body {
            font-family: var(--font-mono);
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* Scanlines */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            background: repeating-linear-gradient(
                0deg,
                rgba(0, 0, 0, 0.15),
                rgba(0, 0, 0, 0.15) 1px,
                transparent 1px,
                transparent 2px
            );
            z-index: 1000;
            opacity: 0.4;
        }

        .header {
            background: var(--bg-secondary);
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--border);
        }

        .header h1 {
            color: var(--green-bright);
            font-size: 1.6rem;
            text-shadow: 0 0 20px var(--green-glow);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .header h1::before {
            content: ">";
            color: var(--text-tertiary);
            animation: blink 1s step-end infinite;
        }

        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
        }

        .container {
            flex: 1;
            max-width: 800px;
            margin: 2rem auto;
            padding: 0 2rem;
            width: 100%;
        }

        /* Terminal Window */
        .terminal-window {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 40px var(--green-glow);
        }

        .terminal-header {
            background: var(--bg-tertiary);
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            border-bottom: 1px solid var(--border);
        }

        .terminal-btn {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .terminal-btn.red { background: #ff5f56; }
        .terminal-btn.yellow { background: #ffbd2e; }
        .terminal-btn.green { background: #27ca40; }

        .terminal-title {
            flex: 1;
            text-align: center;
            color: var(--text-tertiary);
            font-size: 0.85rem;
            margin-right: 50px;
        }

        .terminal-body {
            padding: 1.5rem;
        }

        .cmd-line {
            color: var(--text-tertiary);
            font-size: 0.85rem;
            margin-bottom: 1.5rem;
        }

        .cmd-line .prompt {
            color: var(--green-bright);
        }

        .cmd-line .cmd {
            color: var(--text-primary);
        }

        .download-box h2 {
            color: var(--green-bright);
            margin-bottom: 1.5rem;
            font-size: 1.25rem;
            text-shadow: 0 0 10px var(--green-glow);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
        }

        .info-card {
            background: var(--bg-primary);
            padding: 1rem;
            border-radius: 6px;
            border: 1px solid var(--border);
            border-left: 3px solid var(--cyan);
        }

        .info-card.expiry {
            border-left-color: var(--yellow);
        }

        .info-label {
            color: var(--text-tertiary);
            font-size: 0.8rem;
            margin-bottom: 0.25rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .info-value {
            color: var(--cyan);
            font-size: 1.1rem;
            font-weight: 600;
        }

        .info-card.expiry .info-value {
            color: var(--yellow-bright);
        }

        .file-list {
            margin: 1.5rem 0;
        }

        .file-item {
            background: var(--bg-primary);
            padding: 1rem 1.25rem;
            border-radius: 6px;
            margin-bottom: 0.75rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border: 1px solid var(--border);
            border-left: 3px solid var(--green-bright);
            transition: all 0.3s ease;
        }

        .file-item:hover {
            border-color: var(--green-dim);
            box-shadow: 0 0 15px var(--green-glow);
        }

        .file-name {
            color: var(--text-primary);
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .file-name::before {
            content: "📄";
        }

        .file-size {
            color: var(--text-tertiary);
            font-size: 0.8rem;
            margin-top: 0.25rem;
        }

        .btn {
            background: var(--green-default);
            color: var(--text-primary);
            border: 1px solid var(--green-bright);
            padding: 0.7rem 1.25rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            font-family: var(--font-mono);
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            transition: all 0.3s ease;
            box-shadow: 0 0 10px var(--green-glow);
        }

        .btn:hover {
            background: var(--green-bright);
            box-shadow: 0 0 20px var(--green-glow);
            transform: translateY(-2px);
        }

        .footer {
            background: var(--bg-secondary);
            padding: 1.25rem 2rem;
            text-align: center;
            color: var(--text-tertiary);
            border-top: 1px solid var(--border);
            font-size: 0.85rem;
        }

        .footer a {
            color: var(--green-bright);
            text-decoration: none;
        }

        .footer a:hover {
            text-shadow: 0 0 10px var(--green-glow);
        }

        @media (max-width: 768px) {
            .container {
                padding: 0 1rem;
                margin: 1rem auto;
            }

            .terminal-body {
                padding: 1rem;
            }

            .file-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 1rem;
            }

            .btn {
                width: 100%;
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>FileShare</h1>
    </div>

    <div class="container">
        <div class="terminal-window">
            <div class="terminal-header">
                <div class="terminal-btn red"></div>
                <div class="terminal-btn yellow"></div>
                <div class="terminal-btn green"></div>
                <div class="terminal-title">fileshare -- download</div>
            </div>
            <div class="terminal-body">
                <div class="cmd-line">
                    <span class="prompt">user@fileshare:~$</span>
                    <span class="cmd"> fetch --id ${metadata.shareId}</span>
                </div>

                <div class="download-box">
                    <h2>📥 Fichiers partagés</h2>
                    
                    <div class="info-grid">
                        <div class="info-card">
                            <div class="info-label">Fichiers</div>
                            <div class="info-value">${metadata.files.length}</div>
                        </div>
                        <div class="info-card">
                            <div class="info-label">Taille totale</div>
                            <div class="info-value">${formatSize(totalSize)}</div>
                        </div>
                        <div class="info-card expiry">
                            <div class="info-label">Expire le</div>
                            <div class="info-value">${new Date(metadata.expiryDate).toLocaleDateString('fr-FR')}</div>
                        </div>
                    </div>

                    <div class="file-list">
                        ${metadata.files.map((file, index) => `
                            <div class="file-item">
                                <div>
                                    <div class="file-name">${file.originalName}</div>
                                    <div class="file-size">${formatSize(file.size)}</div>
                                </div>
                                <a href="#" onclick="downloadFile('${metadata.shareId}', ${index}); return false;" class="btn">
                                    ⬇️ Télécharger
                                </a>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="footer">
        <p>FileShare — Partage de fichiers sécurisé | <a href="/">Envoyer des fichiers</a></p>
    </div>
    
    <script>
        const hasPassword = ${hasPassword};
        
        function downloadFile(shareId, fileIndex) {
            let url = '/api/download/' + shareId + '/' + fileIndex;
            
            if (hasPassword) {
                const password = sessionStorage.getItem('share_' + shareId + '_password');
                if (password) {
                    url += '?password=' + encodeURIComponent(password);
                }
            }
            
            window.location.href = url;
        }
    </script>
</body>
</html>
    `;
}

// Générer une page d'erreur
function generateErrorPage(message) {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Erreur - FileShare</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #1c2128;
            --border: #30363d;
            --green-bright: #3fb950;
            --green-default: #238636;
            --green-glow: rgba(63, 185, 80, 0.4);
            --red: #f85149;
            --red-glow: rgba(248, 81, 73, 0.4);
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --text-tertiary: #6e7681;
            --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
        }

        body {
            font-family: var(--font-mono);
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }

        /* Scanlines */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            background: repeating-linear-gradient(
                0deg,
                rgba(0, 0, 0, 0.15),
                rgba(0, 0, 0, 0.15) 1px,
                transparent 1px,
                transparent 2px
            );
            z-index: 1000;
            opacity: 0.4;
        }

        /* Terminal Window */
        .terminal-window {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 40px var(--red-glow);
        }

        .terminal-header {
            background: var(--bg-tertiary);
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            border-bottom: 1px solid var(--border);
        }

        .terminal-btn {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .terminal-btn.red { background: #ff5f56; }
        .terminal-btn.yellow { background: #ffbd2e; }
        .terminal-btn.green { background: #27ca40; }

        .terminal-title {
            flex: 1;
            text-align: center;
            color: var(--text-tertiary);
            font-size: 0.85rem;
            margin-right: 50px;
        }

        .terminal-body {
            padding: 2rem;
            text-align: center;
        }

        .error-icon {
            font-size: 3.5rem;
            margin-bottom: 1rem;
            display: block;
        }

        .error-code {
            color: var(--red);
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            text-shadow: 0 0 15px var(--red-glow);
        }

        .cmd-line {
            background: var(--bg-primary);
            padding: 0.75rem 1rem;
            border-radius: 6px;
            border: 1px solid var(--border);
            margin-bottom: 1.5rem;
            text-align: left;
            font-size: 0.85rem;
        }

        .cmd-line .prompt {
            color: var(--red);
        }

        .cmd-line .cmd {
            color: var(--text-primary);
        }

        .error-message {
            color: var(--text-secondary);
            font-size: 1rem;
            margin-bottom: 2rem;
            line-height: 1.6;
        }

        .btn {
            background: var(--green-default);
            color: var(--text-primary);
            border: 1px solid var(--green-bright);
            padding: 0.875rem 1.5rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            font-family: var(--font-mono);
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            transition: all 0.3s ease;
            box-shadow: 0 0 10px var(--green-glow);
        }

        .btn:hover {
            background: var(--green-bright);
            box-shadow: 0 0 20px var(--green-glow);
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="terminal-window">
        <div class="terminal-header">
            <div class="terminal-btn red"></div>
            <div class="terminal-btn yellow"></div>
            <div class="terminal-btn green"></div>
            <div class="terminal-title">fileshare -- error</div>
        </div>
        <div class="terminal-body">
            <span class="error-icon">⚠️</span>
            <div class="error-code">ERROR</div>
            
            <div class="cmd-line">
                <span class="prompt">error@fileshare:~$</span>
                <span class="cmd"> exit 1</span>
            </div>
            
            <p class="error-message">${message}</p>
            
            <a href="/" class="btn">
                <span>←</span> Retour à l'accueil
            </a>
        </div>
    </div>
</body>
</html>
    `;
}

// Initialiser et démarrer le serveur
initDirectories().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\x1b[35m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
        console.log(`\x1b[35m█\x1b[0m  FileShare - Serveur démarré          \x1b[35m█\x1b[0m`);
        console.log(`\x1b[35m█\x1b[0m  Port: \x1b[36m${PORT}\x1b[0m                                  \x1b[35m█\x1b[0m`);
        console.log(`\x1b[35m█\x1b[0m  URL: \x1b[36mhttp://0.0.0.0:${PORT}\x1b[0m                 \x1b[35m█\x1b[0m`);
        console.log(`\x1b[35m█\x1b[0m  Protection mot de passe: \x1b[32mActivée\x1b[0m          \x1b[35m█\x1b[0m`);
        if (TELEGRAM_ENABLED) {
            console.log(`\x1b[35m█\x1b[0m  Notifications Telegram: \x1b[32m✓ Activées\x1b[0m       \x1b[35m█\x1b[0m`);
        } else {
            console.log(`\x1b[35m█\x1b[0m  Notifications Telegram: \x1b[90m✗ Désactivées\x1b[0m    \x1b[35m█\x1b[0m`);
        }
        console.log(`\x1b[35m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
    });
});
