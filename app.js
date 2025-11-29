// Configuration
const API_URL = '/api';
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

// État de l'application
let selectedFiles = [];

// Éléments DOM
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const uploadBtn = document.getElementById('uploadBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const shareSection = document.getElementById('shareSection');
const shareLink = document.getElementById('shareLink');
const copyBtn = document.getElementById('copyBtn');
const uploadSpeed = document.getElementById('uploadSpeed');
const timeRemaining = document.getElementById('timeRemaining');

// Event Listeners
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
fileInput.addEventListener('change', handleFileSelect);
uploadBtn.addEventListener('click', uploadFiles);
copyBtn.addEventListener('click', copyToClipboard);

// Gestion du drag & drop
function handleDragOver(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    addFiles(files);
}

// Ajouter des fichiers
function addFiles(files) {
    files.forEach(file => {
        if (file.size > MAX_FILE_SIZE) {
            alert(`Le fichier "${file.name}" est trop volumineux. Taille maximale : 2 Go`);
            return;
        }
        
        if (!selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
            selectedFiles.push(file);
        }
    });
    
    renderFileList();
    updateUploadButton();
}

// Afficher la liste des fichiers
function renderFileList() {
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '';
        return;
    }
    
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    
    fileList.innerHTML = `
        <h4 style="color: var(--cyan); margin-bottom: 1rem;">
            ${selectedFiles.length} fichier(s) sélectionné(s) - ${formatFileSize(totalSize)}
        </h4>
        ${selectedFiles.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <div class="file-name">📄 ${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
                <div class="file-actions">
                    <button class="btn btn-small btn-remove" onclick="removeFile(${index})">
                        ✕ Retirer
                    </button>
                </div>
            </div>
        `).join('')}
    `;
}

// Retirer un fichier
function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
    updateUploadButton();
}

// Mettre à jour le bouton d'upload
function updateUploadButton() {
    uploadBtn.disabled = selectedFiles.length === 0;
}

// Formater la taille des fichiers
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Upload des fichiers
async function uploadFiles() {
    if (selectedFiles.length === 0) return;
    
    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });
    
    const expiryTime = document.getElementById('expiryTime').value;
    const maxDownloads = document.getElementById('maxDownloads').value;
    const password = document.getElementById('password').value;
    
    formData.append('expiryHours', expiryTime);
    formData.append('maxDownloads', maxDownloads);
    if (password) {
        formData.append('password', password);
    }
    
    // Afficher la barre de progression
    progressSection.classList.add('active');
    uploadBtn.disabled = true;
    
    const startTime = Date.now();
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    
    try {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                progressBar.style.width = percentComplete + '%';
                progressBar.textContent = Math.round(percentComplete) + '%';
                
                // Calculer la vitesse
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = e.loaded / elapsed;
                uploadSpeed.textContent = formatFileSize(speed) + '/s';
                
                // Calculer le temps restant
                const remaining = (e.total - e.loaded) / speed;
                timeRemaining.textContent = formatTime(remaining);
            }
        });
        
        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                showShareSection(response);
            } else {
                alert('Erreur lors de l\'upload : ' + xhr.statusText);
                progressSection.classList.remove('active');
                uploadBtn.disabled = false;
            }
        });
        
        xhr.addEventListener('error', () => {
            alert('Erreur réseau lors de l\'upload');
            progressSection.classList.remove('active');
            uploadBtn.disabled = false;
        });
        
        xhr.open('POST', API_URL + '/upload');
        xhr.send(formData);
        
    } catch (error) {
        console.error('Erreur:', error);
        alert('Erreur lors de l\'upload');
        progressSection.classList.remove('active');
        uploadBtn.disabled = false;
    }
}

// Afficher la section de partage
function showShareSection(data) {
    progressSection.classList.remove('active');
    shareSection.classList.add('active');
    
    const shareUrl = window.location.origin + '/download/' + data.shareId;
    shareLink.value = shareUrl;
    
    document.getElementById('expiryInfo').textContent = data.expiryTime;
    document.getElementById('downloadsInfo').textContent = 
        data.maxDownloads === 0 ? 'Illimité' : data.maxDownloads;
}

// Copier le lien
function copyToClipboard() {
    shareLink.select();
    document.execCommand('copy');
    
    const originalText = copyBtn.innerHTML;
    copyBtn.innerHTML = '<span>✓</span> Copié !';
    copyBtn.style.background = 'var(--green)';
    
    setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.style.background = '';
    }, 2000);
}

// Formater le temps
function formatTime(seconds) {
    if (seconds < 60) {
        return Math.round(seconds) + 's';
    } else if (seconds < 3600) {
        return Math.round(seconds / 60) + 'min';
    } else {
        return Math.round(seconds / 3600) + 'h';
    }
}
