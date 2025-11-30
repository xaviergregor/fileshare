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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --background: #282a36;
            --current-line: #44475a;
            --foreground: #f8f8f2;
            --comment: #6272a4;
            --green: #50fa7b;
            --purple: #bd93f9;
            --pink: #ff79c6;
            --red: #ff5555;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--background);
            color: var(--foreground);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }
        .password-box {
            background: var(--current-line);
            border-radius: 12px;
            padding: 3rem;
            text-align: center;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        h1 {
            color: var(--purple);
            font-size: 2rem;
            margin-bottom: 1rem;
        }
        p {
            color: var(--comment);
            margin-bottom: 2rem;
        }
        .input-group {
            margin-bottom: 1.5rem;
        }
        input[type="password"] {
            width: 100%;
            background: var(--background);
            border: 2px solid var(--purple);
            color: var(--foreground);
            padding: 1rem;
            border-radius: 6px;
            font-size: 1rem;
        }
        input[type="password"]:focus {
            outline: none;
            border-color: var(--pink);
        }
        .btn {
            background: var(--purple);
            color: var(--background);
            border: none;
            padding: 1rem 2rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            width: 100%;
            transition: all 0.3s ease;
        }
        .btn:hover {
            background: var(--pink);
            transform: translateY(-2px);
        }
        .error {
            background: rgba(255, 85, 85, 0.2);
            border: 1px solid var(--red);
            color: var(--red);
            padding: 1rem;
            border-radius: 6px;
            margin-bottom: 1rem;
            display: none;
        }
        .error.show {
            display: block;
        }
    </style>
</head>
<body>
    <div class="password-box">
        <h1>🔒 Fichiers protégés</h1>
        <p>Ce partage est protégé par un mot de passe. Veuillez entrer le mot de passe pour accéder aux fichiers.</p>
        
        <div class="error" id="error"></div>
        
        <form id="passwordForm">
            <div class="input-group">
                <input type="password" id="password" placeholder="Entrez le mot de passe" required autofocus>
            </div>
            <button type="submit" class="btn">Déverrouiller</button>
        </form>
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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --background: #282a36;
            --current-line: #44475a;
            --foreground: #f8f8f2;
            --comment: #6272a4;
            --cyan: #8be9fd;
            --green: #50fa7b;
            --purple: #bd93f9;
            --pink: #ff79c6;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--background);
            color: var(--foreground);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: var(--current-line);
            padding: 1.5rem 2rem;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        }
        .header h1 {
            color: var(--purple);
            font-size: 1.8rem;
        }
        .container {
            flex: 1;
            max-width: 800px;
            margin: 2rem auto;
            padding: 0 2rem;
            width: 100%;
        }
        .download-box {
            background: var(--current-line);
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .download-box h2 {
            color: var(--green);
            margin-bottom: 1.5rem;
            font-size: 1.5rem;
        }
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .info-card {
            background: var(--background);
            padding: 1rem;
            border-radius: 8px;
            border-left: 4px solid var(--cyan);
        }
        .info-label {
            color: var(--comment);
            font-size: 0.85rem;
            margin-bottom: 0.3rem;
        }
        .info-value {
            color: var(--foreground);
            font-size: 1.1rem;
            font-weight: 600;
        }
        .file-list {
            margin: 2rem 0;
        }
        .file-item {
            background: var(--background);
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 0.8rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-left: 4px solid var(--purple);
        }
        .file-name {
            color: var(--foreground);
            font-weight: 500;
        }
        .file-size {
            color: var(--comment);
            font-size: 0.85rem;
        }
        .btn {
            background: var(--purple);
            color: var(--background);
            border: none;
            padding: 0.8rem 1.5rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s ease;
        }
        .btn:hover {
            background: var(--pink);
            transform: translateY(-2px);
        }
        .btn-green {
            background: var(--green);
        }
        .btn-green:hover {
            background: var(--cyan);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📥 FileShare</h1>
    </div>
    <div class="container">
        <div class="download-box">
            <h2>Fichiers partagés</h2>
            <div class="info-grid">
                <div class="info-card">
                    <div class="info-label">Fichiers</div>
                    <div class="info-value">${metadata.files.length}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Taille totale</div>
                    <div class="info-value">${formatSize(totalSize)}</div>
                </div>
                <div class="info-card">
                    <div class="info-label">Expire le</div>
                    <div class="info-value">${new Date(metadata.expiryDate).toLocaleDateString('fr-FR')}</div>
                </div>
            </div>
            <div class="file-list">
                ${metadata.files.map((file, index) => `
                    <div class="file-item">
                        <div>
                            <div class="file-name">📄 ${file.originalName}</div>
                            <div class="file-size">${formatSize(file.size)}</div>
                        </div>
                        <a href="#" onclick="downloadFile('${metadata.shareId}', ${index}); return false;" class="btn btn-green">
                            ⬇️ Télécharger
                        </a>
                    </div>
                `).join('')}
            </div>
        </div>
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
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #282a36;
            color: #f8f8f2;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }
        .error-box {
            background: #44475a;
            border-radius: 12px;
            padding: 3rem;
            text-align: center;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        h1 {
            color: #ff5555;
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        p {
            color: #f8f8f2;
            font-size: 1.2rem;
            margin-bottom: 2rem;
        }
        a {
            background: #bd93f9;
            color: #282a36;
            padding: 0.8rem 1.5rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            display: inline-block;
        }
        a:hover {
            background: #ff79c6;
        }
    </style>
</head>
<body>
    <div class="error-box">
        <h1>⚠️</h1>
        <p>${message}</p>
        <a href="/">Retour à l'accueil</a>
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
