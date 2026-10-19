// ========================================
// STOCK MANAGER
// DNMADE Daunot - Audiovisuel
// VERSION CORRIGÉE - STABLE
// ========================================

// ========================================
// CONFIGURATION GOOGLE SHEETS
// ========================================
window.GOOGLE_SHEETS_CONFIG = {
    // 👉 Collez ici l'adresse du déploiement Apps Script (elle finit par /exec)
    scriptUrl: 'https://script.google.com/macros/s/AKfycbyBerH68xJozGgiFAxfyV9gLRo3LAH1wKUUUfkEhJ9Srk26C_XA0D8CskOnjf3vACaU/exec',
    // Ce jeton doit être IDENTIQUE à celui de Code.gs (ligne "const TOKEN")
    token: '1d64286613ac7f2f27a38b85',
    enabled: true,
    auto: true,         // true = envoi automatique après chaque modification
    delayMs: 3000,      // attente (ms) après la dernière modification avant l'envoi
    pollMs: 120000,     // vérification des changements des autres appareils (ms)
    syncUsers: true,    // true = les comptes (avec mot de passe chiffré) sont partagés
    debug: false
};

// ---------- Petits outils pour la synchronisation ----------

// Empreinte courte d'un texte (sert à repérer ce qui a changé)
function hash53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// SHA-256 (chiffrement à sens unique des mots de passe, marche partout, même sans https)
function sha256Hex(str) {
    const utf8 = unescape(encodeURIComponent(str));
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
               (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    // Constantes calculées à partir des nombres premiers
    const primes = [];
    for (let n = 2; primes.length < 64; n++) {
        if (primes.every(p => n % p !== 0)) primes.push(n);
    }
    const frac = x => Math.floor((x - Math.floor(x)) * 4294967296);
    const K = primes.map(p => frac(Math.cbrt(p)));
    let H = primes.slice(0, 8).map(p => frac(Math.sqrt(p)));
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < bytes.length; off += 64) {
        const w = new Array(64);
        for (let i = 0; i < 16; i++) {
            w[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) |
                   (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const mj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + mj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0,
             (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

class StockApp {
    constructor() {
        this.currentUser = null;
        this.articles = [];
        this.movements = [];
        this.history = [];
        this.users = [];
        this.requests = [];
        this.notifications = [];
        this.inventory = null;
        this.selectedArticlesForRequest = {}; // { articleId: quantity }
        
        console.log('StockApp Constructor - Initialisation...');
        this.init();
    }

    // ====== INITIALISATION ======
    init() {
        console.log('Init - Étape 1: Chargement du stockage');
        this.loadFromStorage();
        
        console.log('Init - Étape 2: Setup event listeners');
        this.setupEventListeners();
        
        console.log('Init - Étape 3: Vérification authentification');
        this.checkAuthentication();
        
        console.log('Init - Étape 4: Initialiser données démo si vide');
        if (this.users.length === 0) {
            this.initializeDemoData();
        }
        
        // Google Sheets : base partagée
        this.startSheetsSync();

        console.log('Init - COMPLÈTE');
    }

    initializeDemoData() {
        console.log('Initializing demo data...');
        
        // Utilisateurs de démonstration
        this.users = [
            { id: 1, fullName: 'Admin', username: 'admin', password: 'admin123', role: 'Admin', createdAt: new Date() },
            { id: 2, fullName: 'Gestionnaire Stock', username: 'gestionnaire', password: 'gestionnaire123', role: 'Gestionnaire', createdAt: new Date() },
            { id: 3, fullName: 'Utilisateur', username: 'user', password: 'user123', role: 'Utilisateur', createdAt: new Date() }
        ];

        // Articles de démonstration
        this.articles = [
            { id: 1, name: 'Microphone Shure SM58', category: 'Son', location: 'Magasin', quantity: 5, minStock: 2, price: 99, description: 'Microphone professionnel' },
            { id: 2, name: 'Câble XLR 10m', category: 'Son', location: 'Magasin', quantity: 12, minStock: 5, price: 15, description: 'Câble audio professionnel' },
            { id: 3, name: 'Table de Mixage Yamaha', category: 'Son', location: 'Salle A', quantity: 2, minStock: 1, price: 350, description: 'Console de mixage 8 canaux' },
            { id: 4, name: 'Projecteur LED RGB', category: 'Lumière', location: 'Salle B', quantity: 8, minStock: 4, price: 200, description: 'Projecteur intelligent RGB' },
            { id: 5, name: 'Camera Sony A6700', category: 'Vidéo', location: 'Salle C', quantity: 3, minStock: 1, price: 1200, description: 'Caméra sans miroir profesionnelle' },
            { id: 6, name: 'Trépied Manfrotto', category: 'Vidéo', location: 'Magasin', quantity: 6, minStock: 2, price: 85, description: 'Trépied professionnel' },
            { id: 7, name: 'Ampoule LED 5600K', category: 'Lumière', location: 'Magasin', quantity: 20, minStock: 10, price: 25, description: 'Ampoule LED studio' },
            { id: 8, name: 'Batterie Externe USB', category: 'Accessoires', location: 'Magasin', quantity: 0, minStock: 5, price: 45, description: 'Batterie pour équipement mobile' }
        ];

        this.saveToStorage();
        this.logActivity('INIT', 'Données de démonstration chargées', 'success');
        console.log('Demo data initialized - Users:', this.users.length, 'Articles:', this.articles.length);
    }

    // ====== AUTHENTIFICATION ======
    setupEventListeners() {
        console.log('setupEventListeners - START');
        
        // Formulaire de connexion - PRIORITÉ
        const loginForm = document.getElementById('loginForm');
        console.log('loginForm element:', loginForm);
        
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                console.log('Login form submitted');
                this.handleLogin(e);
            });
            console.log('✓ Login form listener attaché');
        } else {
            console.error('✗ ERREUR: loginForm NOT FOUND');
        }

        // Déconnexion
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => this.handleNavigation(e));
        });

        // Articles
        const addArticleBtn = document.getElementById('addArticleBtn');
        if (addArticleBtn) {
            addArticleBtn.addEventListener('click', () => this.openArticleModal());
        }

        const articleForm = document.getElementById('articleForm');
        if (articleForm) {
            articleForm.addEventListener('submit', (e) => this.handleSaveArticle(e));
        }

        // Mouvements
        const newMovementBtn = document.getElementById('newMovementBtn');
        if (newMovementBtn) {
            newMovementBtn.addEventListener('click', () => this.openMovementModal());
        }

        const movementForm = document.getElementById('movementForm');
        if (movementForm) {
            movementForm.addEventListener('submit', (e) => this.handleSaveMovement(e));
        }

        // Inventaire
        const startInventoryBtn = document.getElementById('startInventoryBtn');
        if (startInventoryBtn) {
            startInventoryBtn.addEventListener('click', () => this.openInventoryModal());
        }

        const completeInventoryBtn = document.getElementById('completeInventoryBtn');
        if (completeInventoryBtn) {
            completeInventoryBtn.addEventListener('click', (e) => this.handleCompleteInventory(e));
        }

        // Utilisateurs (Admin)
        const addUserBtn = document.getElementById('addUserBtn');
        if (addUserBtn) {
            addUserBtn.addEventListener('click', () => this.openUserModal());
        }

        const addGestManagerBtn = document.getElementById('addGestManagerBtn');
        if (addGestManagerBtn) {
            addGestManagerBtn.addEventListener('click', () => this.openGestManagerModal());
        }

        const userForm = document.getElementById('userForm');
        if (userForm) {
            userForm.addEventListener('submit', (e) => this.handleSaveUser(e));
        }

        // Demandes de matériel
        const newRequestBtn = document.getElementById('newRequestBtn');
        if (newRequestBtn) {
            newRequestBtn.addEventListener('click', () => this.openRequestModal());
        }

        const requestForm = document.getElementById('requestForm');
        if (requestForm) {
            requestForm.addEventListener('submit', (e) => this.handleSaveRequest(e));
        }

        document.getElementById('filterRequestStatus')?.addEventListener('change', () => this.renderRequests());
        document.getElementById('filterRequestDate')?.addEventListener('change', () => this.renderRequests());

        // Filtres
        document.getElementById('searchArticles')?.addEventListener('input', () => this.renderArticles());
        document.getElementById('filterCategory')?.addEventListener('change', () => this.renderArticles());
        document.getElementById('filterLocation')?.addEventListener('change', () => this.renderArticles());
        document.getElementById('filterMovementType')?.addEventListener('change', () => this.renderMovements());
        document.getElementById('filterDate')?.addEventListener('change', () => this.renderMovements());
        document.getElementById('searchHistory')?.addEventListener('input', () => this.renderHistory());
        document.getElementById('filterHistoryDate')?.addEventListener('change', () => this.renderHistory());

        // Modales
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', () => this.closeModal(btn.closest('.modal')));
        });

        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeModal(btn.closest('.modal')));
        });
        
        console.log('setupEventListeners - END');
    }

    handleLogin(e) {
        e.preventDefault();
        console.log('=== HANDLE LOGIN ===');
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        console.log('Tentative de connexion:');
        console.log('  Username saisi:', username);

        const user = this.users.find(u => u.username === username && this.verifyPassword(u, password));
        
        if (user) {
            console.log('✓ Utilisateur TROUVÉ:', user.username);
            this.currentUser = user;
            localStorage.setItem('currentUser', JSON.stringify(user));
            this.showLogin(false);
            this.renderApp();
            this.logActivity('LOGIN', `Connexion de ${user.fullName}`, 'success');
            this.showToast('Bienvenue ' + user.fullName + '!', 'success');
            console.log('✓ Login SUCCÈS');
        } else {
            console.log('✗ Utilisateur NON TROUVÉ');
            this.showToast('Identifiants incorrects', 'error');
            this.logActivity('LOGIN', 'Tentative de connexion échouée', 'error');
        }
    }

    handleLogout() {
        this.logActivity('LOGOUT', `Déconnexion de ${this.currentUser.fullName}`, 'success');
        this.currentUser = null;
        localStorage.removeItem('currentUser');
        this.showLogin(true);
        document.getElementById('loginForm').reset();
    }

    checkAuthentication() {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            this.currentUser = JSON.parse(storedUser);
            this.showLogin(false);
            this.renderApp();
        } else {
            this.showLogin(true);
        }
    }

    // ====== UI ======
    showLogin(show) {
        document.getElementById('loginScreen').style.display = show ? 'flex' : 'none';
        document.getElementById('appScreen').style.display = show ? 'none' : 'flex';
    }

    renderApp() {
        // Informations utilisateur
        document.getElementById('userInfo').textContent = `${this.currentUser.fullName}\n(${this.currentUser.role})`;

        // Filtrer les onglets selon le rôle
        this.filterNavByRole();

        // Affichage/masquage des éléments admin
        const adminElements = document.querySelectorAll('.admin-only');
        adminElements.forEach(el => {
            if (this.currentUser.role === 'Admin') {
                el.classList.add('visible');
                el.style.display = el.className.includes('visible') ? 'flex' : 'block';
            } else {
                el.classList.remove('visible');
                el.style.display = 'none';
            }
        });

        // Affichage/masquage des éléments admin + gestionnaire
        const adminGestElements = document.querySelectorAll('[data-admin="true"]');
        adminGestElements.forEach(el => {
            if (this.currentUser.role === 'Admin' || this.currentUser.role === 'Gestionnaire') {
                el.style.display = 'flex';
            } else {
                el.style.display = 'none';
            }
        });

        // Champs articles
        this.populateArticleSelects();

        // Charger les notifications
        this.loadNotifications();

        // Afficher le tableau de bord (ou la première page accessible)
        this.navigateTo('dashboard');
    }

    handleNavigation(e) {
        e.preventDefault();
        const page = e.target.getAttribute('data-page');
        this.navigateTo(page);
    }

    navigateTo(page) {
        // Vérifier que l'utilisateur a accès à cette page
        const roleMap = {
            'Admin': ['dashboard', 'articles', 'movements', 'inventory', 'requests', 'checklist', 'notifications', 'exports', 'history', 'users'],
            'Gestionnaire': ['dashboard', 'articles', 'movements', 'inventory', 'requests', 'checklist', 'notifications', 'exports', 'history', 'users'],
            'Utilisateur': ['requests', 'notifications']
        };

        const allowedPages = roleMap[this.currentUser.role] || [];

        if (!allowedPages.includes(page)) {
            this.showToast('Accès refusé', 'error');
            // Rediriger vers la première page accessible
            page = allowedPages[0] || 'requests';
        }

        // Masquer toutes les pages
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

        // Mettre à jour la navigation active
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

        // Afficher la page
        const pageEl = document.getElementById(page);
        if (pageEl) {
            pageEl.style.display = 'block';

            // Rendre le contenu
            switch (page) {
                case 'dashboard':
                    this.renderDashboard();
                    break;
                case 'articles':
                    this.renderArticles();
                    break;
                case 'movements':
                    this.renderMovements();
                    break;
                case 'requests':
                    this.renderRequests();
                    break;
                case 'checklist':
                    this.renderChecklist();
                    break;
                case 'notifications':
                    this.renderNotifications();
                    break;
                case 'exports':
                    // Page statique, pas besoin de rendu
                    break;
                case 'inventory':
                    this.renderInventoryPage();
                    break;
                case 'history':
                    this.renderHistory();
                    break;
                case 'users':
                    this.renderUsers();
                    break;
            }
        }
    }

    // ====== TABLEAU DE BORD ======
    renderDashboard() {
        // Articles en stock
        const totalArticles = this.articles.length;
        document.getElementById('totalArticles').textContent = totalArticles;

        // Mouvements aujourd'hui
        const today = new Date().toDateString();
        const todayMovements = this.movements.filter(m => new Date(m.date).toDateString() === today).length;
        document.getElementById('todayMovements').textContent = todayMovements;

        // Stock critique
        const criticalStock = this.articles.filter(a => a.quantity < a.minStock).length;
        document.getElementById('criticalStock').textContent = criticalStock;

        // Valeur du stock
        const stockValue = this.articles.reduce((sum, a) => sum + (a.quantity * a.price), 0);
        document.getElementById('stockValue').textContent = stockValue.toFixed(2) + '€';

        // Top catégories
        this.renderTopCategories();

        // Graphique mouvements
        this.renderMovementsChart();
    }

    renderTopCategories() {
        const categories = {};
        this.articles.forEach(a => {
            if (!categories[a.category]) {
                categories[a.category] = 0;
            }
            categories[a.category] += a.quantity;
        });

        const sorted = Object.entries(categories)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const container = document.getElementById('topCategories');
        container.innerHTML = sorted.map(([cat, qty]) => `
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>${cat}</span>
                    <strong>${qty}</strong>
                </div>
                <div style="background: #e1e4e8; height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="background: #0052CC; height: 100%; width: ${(qty / (Math.max(...sorted.map(s => s[1])) || 1)) * 100}%; transition: width 0.3s;"></div>
                </div>
            </div>
        `).join('');
    }

    renderMovementsChart() {
        const last7Days = Array(7).fill(0).map((_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - i);
            return date.toDateString();
        }).reverse();

        const data = last7Days.map(day => {
            return this.movements.filter(m => new Date(m.date).toDateString() === day).length;
        });

        const container = document.getElementById('movementsChart');
        container.innerHTML = data.map((count, i) => `
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span style="font-size: 0.85rem;">${last7Days[i].substring(0, 3)}</span>
                    <strong>${count}</strong>
                </div>
                <div style="background: #e1e4e8; height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="background: #FF7A45; height: 100%; width: ${(count / (Math.max(...data) || 1)) * 100}%; transition: width 0.3s;"></div>
                </div>
            </div>
        `).join('');
    }

    // ====== ARTICLES ======
    renderArticles() {
        const search = document.getElementById('searchArticles')?.value || '';
        const category = document.getElementById('filterCategory')?.value || '';
        const location = document.getElementById('filterLocation')?.value || '';

        let filtered = this.articles.filter(a => {
            const matchSearch = a.name.toLowerCase().includes(search.toLowerCase());
            const matchCategory = !category || a.category === category;
            const matchLocation = !location || a.location === location;
            return matchSearch && matchCategory && matchLocation;
        });

        // Mettre à jour les options de catégories et emplacements
        this.updateFilterOptions();

        const container = document.getElementById('articlesContainer');
        if (filtered.length === 0) {
            container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px;">Aucun article trouvé</p>';
            return;
        }

        container.innerHTML = filtered.map(article => {
            const isLow = article.quantity < article.minStock;
            const isCritical = article.quantity === 0;

            return `
                <div class="article-card">
                    <div class="article-header">
                        <h3 class="article-title">${article.name}</h3>
                        <span class="article-badge">${article.category}</span>
                    </div>
                    <div class="article-meta">
                        <div>📍 <strong>${article.location}</strong></div>
                        <div>💰 <strong>${article.price}€</strong></div>
                        ${article.description ? `<div style="font-size: 0.9rem; margin-top: 5px;">${article.description}</div>` : ''}
                    </div>
                    <div class="article-quantity">
                        <span>Quantité:</span>
                        <span class="quantity-badge ${isCritical ? 'critical' : isLow ? 'low' : ''}">${article.quantity}</span>
                    </div>
                    ${isLow ? `<div style="background: rgba(255, 193, 7, 0.1); padding: 8px; border-radius: 4px; font-size: 0.9rem; color: #856404; margin: 8px 0;">⚠️ Stock faible (min: ${article.minStock})</div>` : ''}
                    <div class="article-actions">
                        ${this.currentUser.role === 'Admin' ? `<button class="btn btn-secondary" onclick="app.editArticle(${article.id})">Éditer</button>` : ''}
                        <button class="btn btn-primary" onclick="app.openMovementModal(${article.id})">+ Mouvement</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateFilterOptions() {
        const categories = [...new Set(this.articles.map(a => a.category))];
        const locations = [...new Set(this.articles.map(a => a.location))];

        const categorySelect = document.getElementById('filterCategory');
        if (categorySelect) {
            const current = categorySelect.value;
            categorySelect.innerHTML = '<option value="">Toutes les catégories</option>' + 
                categories.map(c => `<option value="${c}">${c}</option>`).join('');
            categorySelect.value = current;
        }

        const locationSelect = document.getElementById('filterLocation');
        if (locationSelect) {
            const current = locationSelect.value;
            locationSelect.innerHTML = '<option value="">Tous les emplacements</option>' + 
                locations.map(l => `<option value="${l}">${l}</option>`).join('');
            locationSelect.value = current;
        }
    }

    openArticleModal(articleId = null) {
        const modal = document.getElementById('articleModal');
        const form = document.getElementById('articleForm');
        form.reset();

        if (articleId) {
            const article = this.articles.find(a => a.id === articleId);
            if (article) {
                document.getElementById('articleModalTitle').textContent = 'Éditer l\'Article';
                document.getElementById('articleName').value = article.name;
                document.getElementById('articleCategory').value = article.category;
                document.getElementById('articleLocation').value = article.location;
                document.getElementById('articleQuantity').value = article.quantity;
                document.getElementById('articleMinStock').value = article.minStock;
                document.getElementById('articlePrice').value = article.price;
                document.getElementById('articleDescription').value = article.description;
                form.dataset.editId = articleId;
            }
        } else {
            document.getElementById('articleModalTitle').textContent = 'Ajouter un Article';
            delete form.dataset.editId;
        }

        modal.style.display = 'flex';
    }

    handleSaveArticle(e) {
        e.preventDefault();
        const form = document.getElementById('articleForm');

        const articleData = {
            name: document.getElementById('articleName').value,
            category: document.getElementById('articleCategory').value,
            location: document.getElementById('articleLocation').value,
            quantity: parseInt(document.getElementById('articleQuantity').value),
            minStock: parseInt(document.getElementById('articleMinStock').value),
            price: parseFloat(document.getElementById('articlePrice').value),
            description: document.getElementById('articleDescription').value
        };

        if (form.dataset.editId) {
            const id = parseInt(form.dataset.editId);
            const article = this.articles.find(a => a.id === id);
            Object.assign(article, articleData);
            this.logActivity('EDIT_ARTICLE', `Édition: ${articleData.name}`, 'success');
            this.showToast('Article modifié', 'success');
        } else {
            const newArticle = {
                id: Math.max(...this.articles.map(a => a.id), 0) + 1,
                ...articleData,
                createdAt: new Date()
            };
            this.articles.push(newArticle);
            this.logActivity('CREATE_ARTICLE', `Création: ${articleData.name}`, 'success');
            this.showToast('Article créé', 'success');
        }

        this.saveToStorage();
        this.closeModal(document.getElementById('articleModal'));
        this.renderArticles();
    }

    editArticle(articleId) {
        this.openArticleModal(articleId);
    }

    deleteArticle(articleId) {
        if (confirm('Confirmer la suppression ?')) {
            const article = this.articles.find(a => a.id === articleId);
            this.articles = this.articles.filter(a => a.id !== articleId);
            this.logActivity('DELETE_ARTICLE', `Suppression: ${article.name}`, 'warning');
            this.saveToStorage();
            this.renderArticles();
            this.showToast('Article supprimé', 'success');
        }
    }

    populateArticleSelects() {
        const select = document.getElementById('movementArticle');
        if (select) {
            select.innerHTML = '<option value="">Sélectionner un article...</option>' +
                this.articles.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        }
    }

    // ====== MOUVEMENTS ======
    renderMovements() {
        const typeFilter = document.getElementById('filterMovementType')?.value || '';
        const dateFilter = document.getElementById('filterDate')?.value || '';

        let filtered = this.movements.filter(m => {
            const matchType = !typeFilter || m.type === typeFilter;
            const matchDate = !dateFilter || m.date === dateFilter;
            return matchType && matchDate;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('movementsTableBody');
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;">Aucun mouvement enregistré</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(movement => {
            const article = this.articles.find(a => a.id === movement.articleId);
            return `
                <tr>
                    <td>${new Date(movement.date).toLocaleDateString('fr-FR')}</td>
                    <td><span class="status-badge status-${movement.type === 'Entrée' ? 'success' : 'warning'}">${movement.type}</span></td>
                    <td>${article?.name || 'Article supprimé'}</td>
                    <td><strong>${movement.quantity}</strong></td>
                    <td>${movement.reason}</td>
                    <td>${movement.username}</td>
                    <td>
                        ${this.currentUser.role === 'Admin' ? `<button class="btn btn-secondary" style="font-size: 0.8rem; padding: 4px 8px;" onclick="app.deleteMovement(${movement.id})">Supprimer</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    openMovementModal(articleId = null) {
        const modal = document.getElementById('movementModal');
        const form = document.getElementById('movementForm');
        form.reset();

        if (articleId) {
            document.getElementById('movementArticle').value = articleId;
        }

        document.getElementById('movementDate').valueAsDate = new Date();
        modal.style.display = 'flex';
    }

    handleSaveMovement(e) {
        e.preventDefault();

        const movement = {
            id: Math.max(...this.movements.map(m => m.id), 0) + 1,
            type: document.getElementById('movementType').value,
            articleId: parseInt(document.getElementById('movementArticle').value),
            quantity: parseInt(document.getElementById('movementQuantity').value),
            date: document.getElementById('movementDate').value,
            reason: document.getElementById('movementReason').value,
            notes: document.getElementById('movementNotes').value,
            username: this.currentUser.fullName,
            createdAt: new Date()
        };

        const article = this.articles.find(a => a.id === movement.articleId);
        if (!article) {
            this.showToast('Article non trouvé', 'error');
            return;
        }

        switch (movement.type) {
            case 'Entrée':
                article.quantity += movement.quantity;
                break;
            case 'Sortie':
            case 'Retour':
                article.quantity -= movement.quantity;
                if (article.quantity < 0) {
                    this.showToast('Stock insuffisant', 'error');
                    return;
                }
                break;
            case 'Ajustement':
                article.quantity = movement.quantity;
                break;
        }

        this.movements.push(movement);
        this.saveToStorage();
        this.logActivity('MOVEMENT', `Mouvement ${movement.type}: ${article.name} (${movement.quantity})`, 'success');
        this.showToast('Mouvement enregistré', 'success');
        this.closeModal(document.getElementById('movementModal'));
        this.renderMovements();
        this.renderDashboard();
    }

    deleteMovement(movementId) {
        if (confirm('Confirmer la suppression du mouvement ?')) {
            const movement = this.movements.find(m => m.id === movementId);
            if (movement) {
                const article = this.articles.find(a => a.id === movement.articleId);
                if (article) {
                    switch (movement.type) {
                        case 'Entrée':
                            article.quantity -= movement.quantity;
                            break;
                        case 'Sortie':
                        case 'Retour':
                            article.quantity += movement.quantity;
                            break;
                        case 'Ajustement':
                            break;
                    }
                }
            }
            this.movements = this.movements.filter(m => m.id !== movementId);
            this.saveToStorage();
            this.logActivity('DELETE_MOVEMENT', 'Suppression de mouvement', 'warning');
            this.renderMovements();
            this.showToast('Mouvement supprimé', 'success');
        }
    }

    // ====== INVENTAIRE ======
    renderInventoryPage() {
        const container = document.getElementById('inventoryContainer');
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                <p style="font-size: 1.1rem; margin-bottom: 20px;">Cliquez sur "Débuter Inventaire" pour procéder à l'inventaire physique.</p>
                <p style="color: #6a737d;">L'inventaire permettra de corriger les écarts entre le stock système et le stock physique.</p>
            </div>
        `;
    }

    openInventoryModal() {
        const modal = document.getElementById('inventoryModal');
        const container = document.getElementById('inventoryItems');

        this.inventory = {};
        this.articles.forEach(a => {
            this.inventory[a.id] = { ...a, countedQuantity: 0, difference: 0 };
        });

        container.innerHTML = this.articles.map(article => `
            <div class="inventory-item">
                <h4>${article.name}</h4>
                <div style="color: #6a737d; font-size: 0.9rem; margin-bottom: 10px;">
                    Système: <strong>${article.quantity}</strong>
                </div>
                <div class="inventory-input-group">
                    <label style="flex: 0 0 100px;">Compté:</label>
                    <input type="number" min="0" value="${article.quantity}" 
                        data-article-id="${article.id}"
                        class="inventory-count"
                        style="flex: 1;">
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.inventory-count').forEach(input => {
            input.addEventListener('input', (e) => {
                const articleId = parseInt(e.target.getAttribute('data-article-id'));
                const counted = parseInt(e.target.value) || 0;
                const article = this.articles.find(a => a.id === articleId);
                if (article) {
                    const item = this.inventory[articleId];
                    item.countedQuantity = counted;
                    item.difference = counted - article.quantity;
                }
            });
        });

        modal.style.display = 'flex';
    }

    handleCompleteInventory(e) {
        if (e && e.preventDefault) {
            e.preventDefault();
        }

        let hasChanges = false;
        for (let articleId in this.inventory) {
            const item = this.inventory[articleId];
            if (item.difference !== 0) {
                hasChanges = true;
                const article = this.articles.find(a => a.id === parseInt(articleId));
                if (article) {
                    const movement = {
                        id: Math.max(...this.movements.map(m => m.id), 0) + 1,
                        type: 'Ajustement',
                        articleId: parseInt(articleId),
                        quantity: item.countedQuantity,
                        date: new Date().toISOString().split('T')[0],
                        reason: 'Ajustement inventaire',
                        notes: `Inventaire: système ${article.quantity} → compté ${item.countedQuantity}`,
                        username: this.currentUser.fullName,
                        createdAt: new Date()
                    };
                    this.movements.push(movement);
                    article.quantity = item.countedQuantity;
                }
            }
        }

        if (hasChanges) {
            this.saveToStorage();
            this.logActivity('INVENTORY', 'Inventaire complété avec ajustements', 'success');
            this.showToast('Inventaire validé et ajustements enregistrés', 'success');
        } else {
            this.showToast('Pas d\'écarts détectés', 'info');
        }

        this.closeModal(document.getElementById('inventoryModal'));
    }

    // ====== HISTORIQUE ======
    renderHistory() {
        const search = document.getElementById('searchHistory')?.value || '';
        const dateFilter = document.getElementById('filterHistoryDate')?.value || '';

        let filtered = this.history.filter(h => {
            const matchSearch = h.action.toLowerCase().includes(search.toLowerCase()) ||
                               h.details.toLowerCase().includes(search.toLowerCase());
            const matchDate = !dateFilter || new Date(h.timestamp).toISOString().split('T')[0] === dateFilter;
            return matchSearch && matchDate;
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const tbody = document.getElementById('historyTableBody');
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px;">Pas d\'activité</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(entry => {
            const date = new Date(entry.timestamp);
            const formattedDate = date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR');

            return `
                <tr>
                    <td>${formattedDate}</td>
                    <td>${entry.username}</td>
                    <td><strong>${entry.action}</strong></td>
                    <td>${entry.details}</td>
                    <td><span class="status-badge status-${entry.status}">${entry.status}</span></td>
                </tr>
            `;
        }).join('');
    }

    // Admin et Gestionnaire gèrent les demandes ; l'Utilisateur ne fait que suivre les siennes
    isStaff() {
        return this.currentUser && (this.currentUser.role === 'Admin' || this.currentUser.role === 'Gestionnaire');
    }

    // Une demande est visible par le personnel, ou par la personne qui l'a créée
    canSeeRequest(request) {
        if (!this.currentUser) return false;
        if (this.isStaff()) return true;
        if (request.userId !== undefined && request.userId !== null) {
            return request.userId === this.currentUser.id;
        }
        return request.username === this.currentUser.fullName; // anciennes demandes sans userId
    }

    // Bloque les actions de gestion pour les Utilisateurs
    requireStaff() {
        if (this.isStaff()) return true;
        this.showToast('❌ Action réservée à l\'équipe de gestion', 'error');
        return false;
    }

    // Protège le texte avant de l'afficher dans la page (anti-XSS)
    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    logActivity(action, details, status = 'success') {
        const entry = {
            id: Math.max(...this.history.map(h => h.id), 0) + 1,
            timestamp: new Date().toISOString(),
            username: this.currentUser?.fullName || 'Système',
            action: action,
            details: details,
            status: status
        };
        this.history.push(entry);
        this.saveToStorage();
    }

    // ====== CHECK-LIST RETOUR ======
    renderChecklist() {
        // Récupérer les demandes approuvées avec date de retour aujourd'hui ou dépassée
        const today = new Date().toISOString().split('T')[0];
        const returnDue = this.requests.filter(r => 
            r.status === 'Approuvée' && r.returnDate <= today
        ).sort((a, b) => new Date(a.returnDate) - new Date(b.returnDate));

        const container = document.getElementById('checklistContainer');

        if (returnDue.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px;">
                    <p style="font-size: 1.1rem; margin-bottom: 20px;">✅ Aucun retour prévu aujourd'hui</p>
                    <p style="color: #6a737d;">Les articles à retour apparaîtront ici.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = returnDue.map(request => {
            const article = this.articles.find(a => a.id === request.articleId);
            const startDate = new Date(request.startDate).toLocaleDateString('fr-FR');
            const returnDate = new Date(request.returnDate).toLocaleDateString('fr-FR');
            const isOverdue = new Date(request.returnDate) < new Date(today);

            return `
                <div class="checklist-item" id="checklist-${request.id}">
                    <h4>📦 ${article?.name || 'Article supprimé'}</h4>
                    
                    <div class="checklist-dates" style="${isOverdue ? 'background: rgba(220, 53, 69, 0.1); border-left: 3px solid #DC3545;' : ''}">
                        <strong>Période d'emprunt :</strong><br>
                        Du ${startDate} au ${returnDate}
                        ${isOverdue ? '<br><span style="color: #DC3545; font-weight: bold;">⚠️ En retard !</span>' : ''}
                    </div>

                    <div class="checklist-meta">
                        <div>👤 Emprunté par : <strong>${request.username}</strong></div>
                        <div>📊 Quantité : <strong>${request.quantity}</strong></div>
                        <div>💬 Motif : <strong>${request.reason}</strong></div>
                    </div>

                    <div class="checklist-checkbox">
                        <input type="checkbox" id="check-${request.id}" class="checklist-check" data-request-id="${request.id}">
                        <label for="check-${request.id}" style="cursor: pointer; flex: 1; margin: 0;">
                            Article reçu ✓
                        </label>
                    </div>

                    <div class="checklist-note">
                        <label for="note-${request.id}"><strong>📝 Note de retour</strong></label>
                        <textarea id="note-${request.id}" class="checklist-note-text" data-request-id="${request.id}" placeholder="Ex: Bon état, Rayé, Fonctionne normalement, Batterie faible..."></textarea>
                    </div>

                    <div class="checklist-actions">
                        <button class="btn btn-primary" onclick="app.confirmReturn(${request.id})" style="flex: 1;">
                            ✓ Valider Retour
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Ajouter un bouton global de validation
        const globalContainer = document.createElement('div');
        globalContainer.style.cssText = 'grid-column: 1/-1; padding: 20px; background: #f6f8fa; border-radius: 6px; margin-top: 20px;';
        globalContainer.innerHTML = `
            <button class="btn btn-success" onclick="app.confirmAllReturns()" style="width: 100%;">
                ✓ Valider Tous les Retours Cochés
            </button>
        `;
        container.appendChild(globalContainer);
    }

    confirmReturn(requestId) {
        const checkbox = document.getElementById(`check-${requestId}`);
        const noteText = document.getElementById(`note-${requestId}`).value;

        if (!checkbox.checked) {
            this.showToast('Veuillez cocher "Article reçu" d\'abord', 'warning');
            return;
        }

        const request = this.requests.find(r => r.id === requestId);
        if (!request) {
            this.showToast('Demande non trouvée', 'error');
            return;
        }

        const article = this.articles.find(a => a.id === request.articleId);
        if (!article) {
            this.showToast('Article non trouvé', 'error');
            return;
        }

        // Augmenter le stock
        article.quantity += request.quantity;

        // Créer un mouvement de retour
        const movement = {
            id: Math.max(...this.movements.map(m => m.id), 0) + 1,
            type: 'Retour',
            articleId: request.articleId,
            quantity: request.quantity,
            date: new Date().toISOString().split('T')[0],
            reason: 'Retour matériel emprunté',
            notes: noteText || 'Retour sans notes',
            username: this.currentUser.fullName,
            createdAt: new Date()
        };
        this.movements.push(movement);

        // Mettre à jour le statut de la demande
        request.status = 'Retourné';

        this.saveToStorage();
        this.logActivity('RETURN', `Retour: ${article.name} x${request.quantity} de ${request.username}. Note: ${noteText}`, 'success');
        this.showToast('Retour enregistré avec succès', 'success');

        // Actualiser la check-list
        this.renderChecklist();
    }

    confirmAllReturns() {
        const checkboxes = document.querySelectorAll('.checklist-check:checked');
        
        if (checkboxes.length === 0) {
            this.showToast('Aucun article coché', 'warning');
            return;
        }

        let success = 0;
        checkboxes.forEach(checkbox => {
            const requestId = parseInt(checkbox.getAttribute('data-request-id'));
            this.confirmReturn(requestId);
            success++;
        });

        this.showToast(`${success} retour(s) enregistré(s)`, 'success');
    }

    // ====== DEMANDES DE MATÉRIEL ======
    renderRequests() {
        const statusFilter = document.getElementById('filterRequestStatus')?.value || '';
        const dateFilter = document.getElementById('filterRequestDate')?.value || '';

        let filtered = this.requests.filter(r => {
            if (!this.canSeeRequest(r)) return false;
            const matchStatus = !statusFilter || r.status === statusFilter;
            const matchDate = !dateFilter || r.startDate === dateFilter;
            return matchStatus && matchDate;
        }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const staff = this.isStaff();

        // Titre de la colonne selon le rôle
        const headerCell = document.querySelector('#requestsTable thead th');
        if (headerCell) {
            headerCell.textContent = staff ? '📁 Dossiers Demandes (Utilisateur - Projet)' : '📌 Suivi de mes demandes';
        }

        const tbody = document.getElementById('requestsTableBody');
        if (filtered.length === 0) {
            const emptyMsg = staff ? 'Aucune demande' : 'Vous n\'avez aucune demande pour le moment';
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 40px;">${emptyMsg}</td></tr>`;
            this.loadNotifications();
            return;
        }

        // Utilisateur : uniquement le suivi de l'état de SES demandes, une par une
        if (!staff) {
            tbody.innerHTML = filtered.map(request => this.renderRequestTracker(request)).join('');
            this.loadNotifications();
            return;
        }

        // Afficher comme des DOSSIERS
        tbody.innerHTML = filtered.map(request => {
            const statusColor = request.status === 'Approuvée' ? 'success' : 
                               request.status === 'Refusée' ? 'danger' : 
                               request.status === 'Livrée' ? 'info' :
                               request.status === 'Retournée' ? 'success' : 'warning';

            const startDate = new Date(request.startDate).toLocaleDateString('fr-FR');
            const returnDate = new Date(request.returnDate).toLocaleDateString('fr-FR');
            const folderName = this.escapeHtml(`${request.username} - ${request.projectName}`);
            const totalItemsInRequest = request.articles.reduce((sum, a) => sum + a.quantity, 0);
            
            // Afficher le dossier avec les articles dedans
            const articlesHtml = request.articles.map(a => `
                <div style="margin-left: 30px; padding: 8px 0; border-bottom: 1px solid #e1e4e8;">
                    <span style="color: #666;">📄 ${this.escapeHtml(a.name)}</span>
                    <span style="margin-left: 10px; color: #999;">Qté: <strong>${a.quantity}</strong></span>
                    ${a.returned > 0 ? `<span style="margin-left: 10px; color: #28a745;">✓ Retourné: ${a.returned}/${a.quantity}</span>` : ''}
                </div>
            `).join('');

            return `
                <tr>
                    <td colspan="8" style="padding: 0; border: none;">
                        <div style="border: 1px solid #ddd; border-radius: 6px; margin: 10px 0; background: #f9f9f9;">
                            <!-- En-tête du dossier -->
                            <div style="display: flex; align-items: center; gap: 10px; padding: 12px; background: #f0f0f0; border-radius: 6px 6px 0 0; border-bottom: 1px solid #ddd;">
                                <span style="font-size: 1.2rem;">📁</span>
                                <div style="flex: 1;">
                                    <div style="font-weight: bold; font-size: 1rem;">${folderName}</div>
                                    <div style="font-size: 0.85rem; color: #666;">Du ${startDate} au ${returnDate} • ${request.articles.length} type(s) • ${totalItemsInRequest} article(s)</div>
                                </div>
                                <span class="status-badge status-${statusColor}" style="margin-right: 10px;">${request.status}</span>
                            </div>
                            
                            <!-- Articles du dossier -->
                            <div style="padding: 10px 15px;">
                                ${articlesHtml}
                            </div>
                            
                            <!-- Actions -->
                            <div style="padding: 10px 15px; border-top: 1px solid #e1e4e8; background: #fafafa; border-radius: 0 0 6px 6px; display: flex; gap: 8px; flex-wrap: wrap;">
                                ${request.status === 'En attente' ? `
                                    <button class="btn btn-success" style="font-size: 0.85rem; padding: 6px 10px;" onclick="app.updateRequestStatus(${request.id}, 'Approuvée')">✓ Approuver</button>
                                    <button class="btn btn-danger" style="font-size: 0.85rem; padding: 6px 10px;" onclick="app.updateRequestStatus(${request.id}, 'Refusée')">✗ Refuser</button>
                                ` : ''}
                                ${request.status === 'Approuvée' ? `
                                    <button class="btn btn-primary" style="font-size: 0.85rem; padding: 6px 10px;" onclick="app.updateRequestStatus(${request.id}, 'Livrée')">📦 Livrer</button>
                                ` : ''}
                                ${request.status === 'Livrée' ? `
                                    <button class="btn btn-warning" style="font-size: 0.85rem; padding: 6px 10px;" onclick="app.updateRequestStatus(${request.id}, 'En retour')">⏳ En retour</button>
                                ` : ''}
                                <button class="btn btn-info" style="font-size: 0.85rem; padding: 6px 10px;" onclick="app.showRequestDetails(${request.id})">👁 Détails complets</button>
                                ${request.status === 'En retour' ? `
                                    <button class="btn btn-success" style="font-size: 0.85rem; padding: 6px 10px;" onclick="app.showReturnChecklist(${request.id})">📋 Check-list retour</button>
                                ` : ''}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        this.loadNotifications();
    }
    
    // Vue "suivi" d'une demande pour l'Utilisateur (aucune action, aucun nom d'autre personne)
    renderRequestTracker(request) {
        const steps = ['En attente', 'Approuvée', 'Livrée', 'En retour', 'Retournée'];
        const messages = {
            'En attente': 'Votre demande est en attente de validation.',
            'Approuvée': 'Votre demande est approuvée. Le matériel va vous être remis.',
            'Livrée': 'Le matériel vous a été remis. Pensez à le rapporter avant la date de retour.',
            'En retour': 'Le retour du matériel est en cours de vérification.',
            'Retournée': 'Le retour est terminé. Merci !',
            'Refusée': 'Votre demande a été refusée. Contactez l\'équipe pour plus d\'informations.'
        };
        const startDate = new Date(request.startDate).toLocaleDateString('fr-FR');
        const returnDate = new Date(request.returnDate).toLocaleDateString('fr-FR');
        const refused = request.status === 'Refusée';
        const currentIndex = steps.indexOf(request.status);

        const stepsHtml = refused
            ? `<div style="padding: 10px 12px; background: #ffeef0; color: #d73a49; border-radius: 6px; font-weight: 600;">✗ Demande refusée</div>`
            : `<div style="display: flex; gap: 6px; flex-wrap: wrap;">${steps.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                const bg = active ? '#0066cc' : done ? '#28a745' : '#e1e4e8';
                const color = (active || done) ? '#fff' : '#6a737d';
                return `<div style="flex: 1; min-width: 90px; text-align: center; padding: 8px 6px; border-radius: 6px; font-size: 0.8rem; font-weight: ${active ? '700' : '500'}; background: ${bg}; color: ${color};">${done ? '✓ ' : ''}${step}</div>`;
            }).join('')}</div>`;

        return `
            <tr>
                <td colspan="8" style="padding: 0; border: none;">
                    <div style="border: 1px solid #ddd; border-radius: 6px; margin: 10px 0; background: #f9f9f9; padding: 15px;">
                        <div style="font-weight: bold; font-size: 1rem;">🎬 ${this.escapeHtml(request.projectName)}</div>
                        <div style="font-size: 0.85rem; color: #666; margin: 4px 0 12px;">Du ${startDate} au ${returnDate}</div>
                        ${stepsHtml}
                        <div style="margin-top: 10px; font-size: 0.9rem; color: #444;">${this.escapeHtml(messages[request.status] || request.status)}</div>
                    </div>
                </td>
            </tr>
        `;
    }

    showRequestDetails(requestId) {
        if (!this.requireStaff()) return;
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return this.showToast('❌ Demande non trouvée', 'error');
        
        const articlesHtml = request.articles.map(a => `
            📄 ${a.name} : ${a.quantity} (Retourné: ${a.returned}/${a.quantity})
        `).join('\n');
        
        alert(`
📁 DOSSIER: ${request.username} - ${request.projectName}

📋 Informations:
👤 Utilisateur: ${request.username}
📅 Dates: ${new Date(request.startDate).toLocaleDateString('fr-FR')} → ${new Date(request.returnDate).toLocaleDateString('fr-FR')}
📝 Motif: ${request.reason}
✅ Statut: ${request.status}
📄 Description: ${request.description || '(aucune)'}

📦 Articles contenus:
${articlesHtml}

🔔 Notes: ${request.notes || '(aucune)'}
        `);
    }
    
    showReturnChecklist(requestId) {
        if (!this.requireStaff()) return;
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return this.showToast('❌ Demande non trouvée', 'error');
        
        if (request.status !== 'En retour') {
            return this.showToast('❌ Cette demande n\'est pas en retour', 'error');
        }
        
        // Créer une modale check-list avec cases à cocher
        window.currentReturnRequest = request;
        
        const modal = document.createElement('div');
        modal.id = 'returnChecklistModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        `;
        
        let checklistHtml = `
            <div style="background: white; border-radius: 8px; padding: 30px; max-width: 600px; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h2 style="margin-top: 0; color: #333;">📋 Check-list Retour</h2>
                
                <div style="background: #f0f8ff; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                    <p style="margin: 5px 0;"><strong>🎬 Projet:</strong> ${this.escapeHtml(request.projectName)}</p>
                    <p style="margin: 5px 0;"><strong>👤 Utilisateur:</strong> ${this.escapeHtml(request.username)}</p>
                    <p style="margin: 5px 0;"><strong>📅 À retourner avant:</strong> ${new Date(request.returnDate).toLocaleDateString('fr-FR')}</p>
                </div>
        `;
        
        // Calculer le nombre total d'articles à retourner
        let totalItems = 0;
        request.articles.forEach(art => {
            totalItems += art.quantity;
        });
        
        let returnedItems = 0;
        request.articles.forEach(art => {
            returnedItems += (art.returned || 0);
        });
        
        // Afficher les articles avec cases à cocher
        request.articles.forEach((article, articleIndex) => {
            checklistHtml += `
                <div style="border: 1px solid #ddd; border-radius: 6px; padding: 15px; margin-bottom: 12px; background: #fafafa;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                        <input type="checkbox" 
                               id="article_check_${article.articleId}" 
                               ${article.returned === article.quantity ? 'checked' : ''}
                               style="width: 20px; height: 20px; cursor: pointer;">
                        <label for="article_check_${article.articleId}" style="flex: 1; cursor: pointer; font-weight: bold; margin: 0;">
                            📦 ${this.escapeHtml(article.name)}
                        </label>
                        <span style="color: #666; font-size: 0.9rem;">Total: <strong>${article.quantity}</strong></span>
                    </div>
                    
                    <div style="margin-left: 30px;">
            `;
            
            // Cases pour chaque article individuel
            for (let i = 1; i <= article.quantity; i++) {
                const isChecked = (article.returned || 0) >= i;
                checklistHtml += `
                    <label style="display: inline-block; margin-right: 15px; margin-bottom: 8px; cursor: pointer;">
                        <input type="checkbox" 
                               id="item_${article.articleId}_${i}" 
                               data-article-id="${article.articleId}"
                               data-item-num="${i}"
                               ${isChecked ? 'checked' : ''}
                               onchange="app.updateReturnProgress(${requestId});"
                               style="cursor: pointer; margin-right: 5px;">
                        <span style="color: #666;">Article ${i}</span>
                    </label>
                `;
            }
            
            checklistHtml += `
                    </div>
                </div>
            `;
        });
        
        // Barre de progression
        const progressPercent = totalItems > 0 ? Math.round((returnedItems / totalItems) * 100) : 0;
        checklistHtml += `
            <div style="margin: 20px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: bold;">Avancement du retour:</span>
                    <span style="font-weight: bold; color: #28a745;">${returnedItems}/${totalItems} articles (${progressPercent}%)</span>
                </div>
                <div style="width: 100%; height: 20px; background: #e0e0e0; border-radius: 10px; overflow: hidden;">
                    <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;
        
        checklistHtml += `
            <div style="margin-top: 25px; display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn btn-secondary" onclick="document.getElementById('returnChecklistModal').remove();" style="padding: 8px 20px;">Annuler</button>
                <button class="btn btn-success" onclick="app.validateReturnChecklist(${requestId});" style="padding: 8px 20px;">✓ Valider le retour complet</button>
            </div>
        `;
        
        checklistHtml += `</div>`;
        modal.innerHTML = checklistHtml;
        document.body.appendChild(modal);
    }
    
    updateReturnProgress(requestId) {
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return;
        
        // Recalculer pour chaque article
        request.articles.forEach(article => {
            let returnedCount = 0;
            for (let i = 1; i <= article.quantity; i++) {
                const checkbox = document.getElementById(`item_${article.articleId}_${i}`);
                if (checkbox && checkbox.checked) {
                    returnedCount++;
                }
            }
            article.returned = returnedCount;
            
            // Mettre à jour la case principale de l'article
            const mainCheckbox = document.getElementById(`article_check_${article.articleId}`);
            if (mainCheckbox) {
                mainCheckbox.checked = (returnedCount === article.quantity);
            }
        });
        
        // Mettre à jour la barre de progression
        let totalItems = 0;
        let returnedItems = 0;
        request.articles.forEach(art => {
            totalItems += art.quantity;
            returnedItems += (art.returned || 0);
        });
        
        const progressPercent = totalItems > 0 ? Math.round((returnedItems / totalItems) * 100) : 0;
        
        // Mettre à jour l'affichage
        const progressBar = document.querySelector('div[style*="width: 100%; height: 20px"]');
        if (progressBar) {
            const fill = progressBar.querySelector('div');
            if (fill) {
                fill.style.width = progressPercent + '%';
            }
        }
        
        // Mettre à jour le texte de progression
        const progressText = document.querySelector('span[style*="color: #28a745;"]');
        if (progressText) {
            progressText.textContent = `${returnedItems}/${totalItems} articles (${progressPercent}%)`;
        }
    }
    
    validateReturnChecklist(requestId) {
        if (!this.requireStaff()) return;
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return;
        
        // Vérifier que tous les articles sont retournés
        const allReturned = request.articles.every(a => a.returned === a.quantity);
        
        if (!allReturned) {
            this.showToast('❌ Tous les articles doivent être retournés', 'error');
            return;
        }
        
        // Fermer la modale
        const modal = document.getElementById('returnChecklistModal');
        if (modal) modal.remove();
        
        // Valider le retour
        this.validateReturnComplete(requestId);
    }

    openRequestModal() {
        const modal = document.getElementById('requestModal');
        const form = document.getElementById('requestForm');
        form.reset();
        // Validation faite par handleSaveRequest (avec messages visibles) :
        // on évite que le navigateur bloque l'envoi sans rien afficher
        form.noValidate = true;

        // Dates minimales = aujourd'hui
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('requestStartDate').value = today;
        document.getElementById('requestStartDate').min = today;
        
        // Date de retour = demain (au minimum le lendemain du départ)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        document.getElementById('requestReturnDate').value = tomorrowStr;
        document.getElementById('requestReturnDate').min = tomorrowStr;

        // Quand la date de départ change, la date de retour doit rester après
        document.getElementById('requestStartDate').onchange = () => {
            const startInput = document.getElementById('requestStartDate');
            const returnInput = document.getElementById('requestReturnDate');
            if (!startInput.value) return;
            const minReturn = new Date(startInput.value);
            minReturn.setDate(minReturn.getDate() + 1);
            const minReturnStr = minReturn.toISOString().split('T')[0];
            returnInput.min = minReturnStr;
            if (!returnInput.value || returnInput.value < minReturnStr) {
                returnInput.value = minReturnStr;
            }
        };

        // Initialiser la sélection multi-domaines
        this.initializeRequestModal();
        
        // Afficher la modale
        if (modal) {
            modal.style.display = 'flex';
        }
    }



    // ===== SYSTÈME OPTIMISÉ : DEMANDES PAR PROJET =====
    initializeRequestModal() {
        // Réinitialiser la sélection
        this.selectedArticlesForRequest = {};
        
        // Récupérer les catégories uniques
        const categories = [...new Set(this.articles.map(a => a.category))].sort();
        
        // Afficher les catégories
        const categoriesContainer = document.getElementById('categoriesSelectionContainer');
        if (!categoriesContainer) return;
        
        let categoriesHtml = `
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px;">
                <label style="font-weight: bold; display: block; width: 100%; margin-bottom: 5px;">📂 Choisir un domaine:</label>
        `;
        
        categories.forEach((category, index) => {
            const isFirst = index === 0;
            categoriesHtml += `
                <button type="button" 
                        class="category-btn" 
                        data-category="${this.escapeHtml(category)}"
                        style="padding: 8px 16px; border: 2px solid #ddd; background: ${isFirst ? '#0066cc' : '#fff'}; color: ${isFirst ? '#fff' : '#333'}; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.3s ease;"
                        onclick="app.switchCategory(this.dataset.category); return false;">
                    ${this.escapeHtml(category)}
                </button>
            `;
        });
        
        categoriesHtml += `</div>`;
        categoriesContainer.innerHTML = categoriesHtml;
        
        // Afficher les articles de la première catégorie
        if (categories.length > 0) {
            this.switchCategory(categories[0]);
        }
        
        // Afficher le récapitulatif initial
        this.updateRequestSummary();
    }
    
    switchCategory(category) {
        // Mettre à jour le style des boutons
        document.querySelectorAll('.category-btn').forEach(btn => {
            if (btn.dataset.category === category) {
                btn.style.background = '#0066cc';
                btn.style.color = '#fff';
                btn.style.borderColor = '#0066cc';
            } else {
                btn.style.background = '#fff';
                btn.style.color = '#333';
                btn.style.borderColor = '#ddd';
            }
        });
        
        // Afficher les articles de cette catégorie
        const articlesOfCategory = this.articles.filter(a => a.category === category);
        
        const articlesContainer = document.getElementById('articlesSelectionContainer');
        if (!articlesContainer) return;
        
        let articlesHtml = `
            <div>
                <label style="font-weight: bold; display: block; margin-bottom: 10px;">📦 Articles disponibles - ${this.escapeHtml(category)}:</label>
                <div style="background: #f9f9f9; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0;">
        `;
        
        articlesOfCategory.forEach(article => {
            const isSelected = this.selectedArticlesForRequest[article.id] > 0;
            const quantity = this.selectedArticlesForRequest[article.id] || 0;
            const outOfStock = article.quantity <= 0;
            
            articlesHtml += `
                <div style="display: flex; align-items: center; padding: 10px; border-bottom: 1px solid #e0e0e0; gap: 10px;">
                    <input type="checkbox" 
                           id="article_${article.id}"
                           ${isSelected ? 'checked' : ''}
                           ${outOfStock ? 'disabled' : ''}
                           onchange="app.toggleArticleSelection(${article.id})"
                           style="width: 20px; height: 20px; cursor: ${outOfStock ? 'not-allowed' : 'pointer'};">
                    
                    <div style="flex: 1;">
                        <label for="article_${article.id}" style="cursor: pointer; display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: 500;${outOfStock ? ' color: #999;' : ''}">${this.escapeHtml(article.name)}</span>
                            <span style="color: ${outOfStock ? '#d73a49' : '#666'}; font-size: 0.85rem;">${outOfStock ? '(Rupture de stock)' : `(Stock: ${article.quantity})`}</span>
                        </label>
                    </div>
                    
                    <input type="number" 
                           id="qty_${article.id}"
                           value="${quantity}"
                           min="0"
                           max="${article.quantity}"
                           style="width: 60px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; ${isSelected ? '' : 'display: none;'}"
                           onchange="app.updateArticleQuantity(${article.id}, this.value)">
                </div>
            `;
        });
        
        articlesHtml += `
                </div>
            </div>
        `;
        
        articlesContainer.innerHTML = articlesHtml;
        
        // Mettre à jour le résumé
        this.updateRequestSummary();
    }
    
    toggleArticleSelection(articleId) {
        const checkbox = document.getElementById(`article_${articleId}`);
        const qtyInput = document.getElementById(`qty_${articleId}`);
        const article = this.articles.find(a => a.id === articleId);
        
        if (checkbox.checked) {
            // Sélectionner avec quantité 1 par défaut
            if (!article || article.quantity <= 0) {
                checkbox.checked = false;
                this.showToast('❌ Article en rupture de stock', 'error');
                return;
            }
            this.selectedArticlesForRequest[articleId] = 1;
            if (qtyInput) {
                qtyInput.value = 1;
                qtyInput.style.display = 'block';
            }
        } else {
            // Désélectionner
            delete this.selectedArticlesForRequest[articleId];
            if (qtyInput) {
                qtyInput.style.display = 'none';
                qtyInput.value = 0;
            }
        }
        
        this.updateRequestSummary();
    }
    
    updateArticleQuantity(articleId, value) {
        let quantity = parseInt(value, 10);
        const article = this.articles.find(a => a.id === articleId);
        const checkbox = document.getElementById(`article_${articleId}`);
        const qtyInput = document.getElementById(`qty_${articleId}`);
        if (!article) return;

        if (isNaN(quantity) || quantity <= 0) {
            // Quantité vide ou 0 : on retire l'article de la sélection
            delete this.selectedArticlesForRequest[articleId];
            if (checkbox) checkbox.checked = false;
            if (qtyInput) {
                qtyInput.value = 0;
                qtyInput.style.display = 'none';
            }
        } else {
            if (quantity > article.quantity) {
                // Quantité trop grande : on garde le maximum possible et on prévient
                quantity = article.quantity;
                this.showToast(`⚠️ Stock disponible pour ${article.name} : ${article.quantity}`, 'warning');
            }
            this.selectedArticlesForRequest[articleId] = quantity;
            if (qtyInput) qtyInput.value = quantity;
        }

        this.updateRequestSummary();
    }
    
    updateRequestSummary() {
        const summaryDiv = document.getElementById('requestSummary');
        if (!summaryDiv) return;
        
        const selectedArticles = Object.keys(this.selectedArticlesForRequest)
            .map(articleId => {
                const article = this.articles.find(a => a.id == articleId);
                const quantity = this.selectedArticlesForRequest[articleId];
                return { article, quantity };
            })
            .filter(item => item.article);
        
        if (selectedArticles.length === 0) {
            summaryDiv.innerHTML = '<p style="color: #999;">Aucun article sélectionné</p>';
            return;
        }
        
        let summaryHtml = `<div style="background: white; padding: 10px; border-radius: 4px; border-left: 4px solid #0066cc;">`;
        
        selectedArticles.forEach(item => {
            summaryHtml += `
                <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
                    <span>📦 ${this.escapeHtml(item.article.name)}</span>
                    <span style="font-weight: bold; color: #0066cc;">${item.quantity} ${item.quantity > 1 ? 'articles' : 'article'}</span>
                </div>
            `;
        });
        
        const totalItems = selectedArticles.reduce((sum, item) => sum + item.quantity, 0);
        summaryHtml += `
                <div style="padding-top: 10px; padding-bottom: 5px; border-top: 2px solid #0066cc; margin-top: 10px; font-weight: bold; color: #0066cc;">
                    Total: ${selectedArticles.length} type(s) d'article(s) | ${totalItems} article(s)
                </div>
            </div>
        `;
        
        summaryDiv.innerHTML = summaryHtml;
    }

    handleSaveRequest(e) {
        e.preventDefault();
        
        console.log('=== handleSaveRequest START ===');
        
        // Récupérer les valeurs des champs
        const projectName = document.getElementById('projectName')?.value?.trim();
        const projectDescription = document.getElementById('projectDescription')?.value?.trim();
        const startDate = document.getElementById('requestStartDate')?.value?.trim();
        const returnDate = document.getElementById('requestReturnDate')?.value?.trim();
        const reason = document.getElementById('requestReason')?.value?.trim();
        
        console.log('Champs:', { projectName, startDate, returnDate, reason });
        
        // Validation 1: Tous les champs requis
        if (!projectName) {
            this.showToast('❌ Le nom du projet est requis', 'error');
            return;
        }
        if (!startDate) {
            this.showToast('❌ La date de départ est requise', 'error');
            return;
        }
        if (!returnDate) {
            this.showToast('❌ La date de retour est requise', 'error');
            return;
        }
        if (!reason) {
            this.showToast('❌ Le motif est requis', 'error');
            return;
        }
        
        // Validation 2: Dates valides
        const startDateObj = new Date(startDate);
        const returnDateObj = new Date(returnDate);
        
        if (returnDateObj <= startDateObj) {
            this.showToast('❌ La date de retour doit être après la date de départ', 'error');
            return;
        }
        
        // Validation 3: Articles sélectionnés
        const selectedCount = Object.keys(this.selectedArticlesForRequest).length;
        console.log('Articles sélectionnés:', selectedCount);
        
        if (selectedCount === 0) {
            this.showToast('❌ Sélectionner au moins un article', 'error');
            return;
        }
        
        // Construire le tableau d'articles
        const articles = [];
        let totalItems = 0;
        
        for (const articleId of Object.keys(this.selectedArticlesForRequest)) {
            const article = this.articles.find(a => a.id == articleId);
            const quantity = this.selectedArticlesForRequest[articleId];
            
            if (!article || !(quantity > 0)) continue;
            
            if (quantity > article.quantity) {
                this.showToast(`❌ Quantité invalide pour ${article.name} (stock : ${article.quantity})`, 'error');
                return; // on arrête vraiment : aucune demande n'est créée
            }
            
            articles.push({
                articleId: parseInt(articleId, 10),
                name: article.name,
                quantity: quantity,
                returned: 0
            });
            totalItems += quantity;
        }
        
        if (articles.length === 0) {
            this.showToast('❌ Aucun article valide sélectionné', 'error');
            return;
        }
        
        // Créer la demande
        const requestId = this.requests.length > 0 ? Math.max(...this.requests.map(r => r.id)) + 1 : 1;
        
        const request = {
            id: requestId,
            projectName: projectName,
            description: projectDescription || '',
            userId: this.currentUser.id,
            username: this.currentUser.fullName,
            startDate: startDate,
            returnDate: returnDate,
            reason: reason,
            status: 'En attente',
            articles: articles,
            createdAt: new Date().toISOString(),
            approvedAt: null,
            deliveredAt: null,
            notes: '',
            returnNotes: ''
        };
        
        try {
            this.requests.push(request);
            this.saveToStorage();
            this.logActivity('CREATE_REQUEST', `Demande créée: ${projectName} (${articles.length} types, ${totalItems} articles)`, 'success');
            
            // Message de succès détaillé
            const successMsg = `✅ Demande "${projectName}" créée avec succès!\n${articles.length} type(s) d'article(s) | ${totalItems} article(s)`;
            this.showToast(successMsg, 'success');
            
            console.log('✅ Demande créée:', request);
            
            // Fermer la modale et rafraîchir
            const requestModal = document.getElementById('requestModal');
            if (requestModal) {
                requestModal.style.display = 'none';
            }
            
            // Réinitialiser le formulaire
            const form = document.getElementById('requestForm');
            if (form) {
                form.reset();
            }
            
            // Réinitialiser la sélection
            this.selectedArticlesForRequest = {};
            
            // Rafraîchir l'affichage
            this.renderRequests();
            this.navigateTo('requests');
            
        } catch (error) {
            console.error('❌ Erreur lors de la création:', error);
            this.showToast('❌ Erreur lors de la création de la demande', 'error');
        }
        
        console.log('=== handleSaveRequest END ===');
    }
    
    updateArticleReturn(requestId, articleId, quantityReturned) {
        if (!this.isStaff()) return false;
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return false;
        
        const articleInRequest = request.articles.find(a => a.articleId === articleId);
        if (!articleInRequest) return false;
        
        articleInRequest.returned = Math.min(quantityReturned, articleInRequest.quantity);
        this.saveToStorage();
        return true;
    }
    
    validateReturnComplete(requestId) {
        if (!this.requireStaff()) return;
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return this.showToast('❌ Demande non trouvée', 'error');
        
        if (request.status === 'Retournée') {
            return this.showToast('ℹ️ Ce retour est déjà validé', 'info');
        }
        
        const allReturned = request.articles.every(a => a.returned === a.quantity);
        if (!allReturned) {
            return this.showToast('❌ Tous les articles doivent être retournés', 'error');
        }
        
        request.status = 'Retournée';
        
        // Remettre en stock et créer un mouvement d'entrée par article
        const today = new Date().toISOString().split('T')[0];
        let nextMovementId = Math.max(...this.movements.map(m => m.id), 0) + 1;
        request.articles.forEach(reqArticle => {
            const article = this.articles.find(a => a.id === reqArticle.articleId);
            if (article) {
                article.quantity += reqArticle.quantity;
                this.movements.push({
                    id: nextMovementId++,
                    type: 'Entrée',
                    articleId: reqArticle.articleId,
                    quantity: reqArticle.quantity,
                    date: today,
                    reason: 'Retour demande matériel',
                    notes: `Projet "${request.projectName}" - ${request.username}`,
                    username: this.currentUser.fullName,
                    createdAt: new Date()
                });
            }
        });
        
        this.saveToStorage();
        this.logActivity('REQUEST_RETURNED', `Retour complété: ${request.projectName}`, 'success');
        this.showToast('✅ Retour validé', 'success');
        this.renderRequests();
    }

    updateRequestStatus(requestId, newStatus) {
        if (!this.requireStaff()) return;
        const request = this.requests.find(r => r.id === requestId);
        if (!request) return this.showToast('❌ Demande non trouvée', 'error');
        
        const oldStatus = request.status;
        if (oldStatus === newStatus) return;
        
        // Livraison : on vérifie le stock de TOUS les articles avant de changer quoi que ce soit
        if (newStatus === 'Livrée' && oldStatus === 'Approuvée') {
            const missing = [];
            request.articles.forEach(line => {
                const article = this.articles.find(a => a.id === line.articleId);
                if (!article) {
                    missing.push(`${line.name} (article supprimé)`);
                } else if (article.quantity < line.quantity) {
                    missing.push(`${line.name} (demandé ${line.quantity}, stock ${article.quantity})`);
                }
            });
            if (missing.length > 0) {
                return this.showToast(`❌ Stock insuffisant : ${missing.join(', ')}`, 'error');
            }
            
            // Retirer du stock et créer un mouvement de sortie par article
            const today = new Date().toISOString().split('T')[0];
            let nextMovementId = Math.max(...this.movements.map(m => m.id), 0) + 1;
            request.articles.forEach(line => {
                const article = this.articles.find(a => a.id === line.articleId);
                article.quantity -= line.quantity;
                this.movements.push({
                    id: nextMovementId++,
                    type: 'Sortie',
                    articleId: line.articleId,
                    quantity: line.quantity,
                    date: today,
                    reason: 'Livraison demande matériel',
                    notes: `Projet "${request.projectName}" - ${request.username} (${request.reason})`,
                    username: this.currentUser.fullName,
                    createdAt: new Date()
                });
            });
        }
        
        request.status = newStatus;
        if (newStatus === 'Approuvée' && !request.approvedAt) {
            request.approvedAt = new Date().toISOString();
        }
        if (newStatus === 'Livrée' && !request.deliveredAt) {
            request.deliveredAt = new Date().toISOString();
        }
        
        this.saveToStorage();
        this.logActivity('REQUEST_STATUS', `Projet "${request.projectName}": ${oldStatus} → ${newStatus}`, 'success');
        this.showToast(`✅ Statut: ${newStatus}`, 'success');
        this.renderRequests();
    }

    // ====== UTILISATEURS (ADMIN) ======
    renderUsers() {
        const container = document.getElementById('usersContainer');
        container.innerHTML = this.users.map(user => `
            <div style="background: white; padding: 15px; border-radius: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #e1e4e8;">
                <div>
                    <h4 style="margin-bottom: 5px;">${user.fullName}</h4>
                    <p style="color: #6a737d; font-size: 0.9rem; margin: 0;">@${user.username} • <span class="status-badge status-success">${user.role}</span></p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="app.editUser(${user.id})" style="font-size: 0.8rem;">Éditer</button>
                    <button class="btn btn-danger" onclick="app.deleteUser(${user.id})" style="font-size: 0.8rem;">Supprimer</button>
                </div>
            </div>
        `).join('');
    }

    openUserModal(userId = null) {
        const modal = document.getElementById('userModal');
        const form = document.getElementById('userForm');
        form.reset();

        if (userId) {
            const user = this.users.find(u => u.id === userId);
            if (user) {
                document.getElementById('userModalTitle').textContent = 'Éditer Utilisateur';
                document.getElementById('userName').value = user.fullName;
                document.getElementById('userUsername').value = user.username;
                document.getElementById('userPassword').value = user.password || '';
                document.getElementById('userRole').value = user.role;
                form.dataset.editId = userId;
            }
        } else {
            document.getElementById('userModalTitle').textContent = 'Ajouter Utilisateur';
            delete form.dataset.editId;
        }

        // En modification, on peut laisser le mot de passe vide pour ne pas le changer
        const pwdField = document.getElementById('userPassword');
        pwdField.required = !userId;
        pwdField.placeholder = userId ? 'Laisser vide pour ne pas changer' : '';

        modal.style.display = 'flex';
    }

    handleSaveUser(e) {
        e.preventDefault();

        const userData = {
            fullName: document.getElementById('userName').value,
            username: document.getElementById('userUsername').value,
            password: document.getElementById('userPassword').value,
            role: document.getElementById('userRole').value
        };

        if (document.getElementById('userForm').dataset.editId) {
            const id = parseInt(document.getElementById('userForm').dataset.editId);
            const user = this.users.find(u => u.id === id);
            if (!userData.password) {
                delete userData.password;          // mot de passe laissé vide : on garde l'ancien
            } else {
                delete user.passwordHash;          // nouveau mot de passe : l'empreinte sera recalculée
            }
            Object.assign(user, userData);
            this.logActivity('EDIT_USER', `Édition: ${userData.fullName} (${userData.role})`, 'success');
            this.showToast('Utilisateur modifié', 'success');
        } else {
            const newUser = {
                id: Math.max(...this.users.map(u => u.id), 0) + 1,
                ...userData,
                createdAt: new Date()
            };
            this.users.push(newUser);
            
            const messageType = userData.role === 'Gestionnaire' ? 'Gestionnaire Stock créé' : 'Utilisateur créé';
            this.logActivity('CREATE_USER', `Création: ${userData.fullName} (${userData.role})`, 'success');
            this.showToast(messageType, 'success');
        }

        this.saveToStorage();
        this.closeModal(document.getElementById('userModal'));
        this.renderUsers();
    }

    editUser(userId) {
        this.openUserModal(userId);
    }

    openGestManagerModal() {
        // Pré-remplir avec le rôle Gestionnaire
        document.getElementById('userName').value = '';
        document.getElementById('userUsername').value = '';
        document.getElementById('userPassword').value = '';
        document.getElementById('userRole').value = 'Gestionnaire';
        document.getElementById('userPassword').required = true;
        document.getElementById('userPassword').placeholder = '';
        document.getElementById('userForm').dataset.editId = '';
        document.getElementById('userModalTitle').textContent = 'Ajouter un Gestionnaire Stock';

        const modal = document.getElementById('userModal');
        modal.style.display = 'flex';
    }

    deleteUser(userId) {
        if (confirm('Confirmer la suppression ?')) {
            const user = this.users.find(u => u.id === userId);
            this.users = this.users.filter(u => u.id !== userId);
            this.logActivity('DELETE_USER', `Suppression: ${user.fullName}`, 'warning');
            this.saveToStorage();
            this.renderUsers();
            this.showToast('Utilisateur supprimé', 'success');
        }
    }

    // ====== MODALES ======
    closeModal(modal) {
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // ====== FILTRER LES ONGLETS PAR RÔLE ======
    filterNavByRole() {
        const roleMap = {
            'Admin': ['dashboard', 'articles', 'movements', 'inventory', 'requests', 'checklist', 'notifications', 'exports', 'history', 'users', 'logoutBtn'],
            'Gestionnaire': ['dashboard', 'articles', 'movements', 'inventory', 'requests', 'checklist', 'notifications', 'exports', 'history', 'users', 'logoutBtn'],
            'Utilisateur': ['requests', 'notifications', 'logoutBtn']
        };

        const allowedPages = roleMap[this.currentUser.role] || [];

        // Masquer/afficher les onglets selon le rôle
        document.querySelectorAll('.nav-link').forEach(link => {
            const page = link.getAttribute('data-page');
            const id = link.getAttribute('id');
            const identifier = page || id;

            if (allowedPages.includes(identifier)) {
                link.style.display = 'flex';
            } else {
                link.style.display = 'none';
            }
        });
    }

    // ====== NOTIFICATIONS ======
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        
        // Créer aussi une notification dans le centre
        const titles = {
            'success': '✅ Succès',
            'error': '❌ Erreur',
            'warning': '⚠️ Avertissement',
            'info': 'ℹ️ Information'
        };
        
        this.addNotification(type, titles[type] || 'Notification', message);
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // ====== EXPORTS PDF & EXCEL ======

    // Export Catalogue - PDF
    exportArticlesPDF() {
        const doc = document.createElement('div');
        doc.innerHTML = `
            <h1 style="text-align: center; margin-bottom: 20px;">📋 Catalogue d'Articles - Stock Manager</h1>
            <p style="text-align: center; color: #666; margin-bottom: 30px;">Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <thead>
                    <tr style="background: #0052CC; color: white;">
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Article</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Catégorie</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Emplacement</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Quantité</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Min</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Prix Unit.</th>
                        <th style="padding: 10px; border: 1px solid #ddd; text-align: right;">Valeur</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.articles.map(a => `
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 10px; border: 1px solid #ddd;">${a.name}</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${a.category}</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${a.location}</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${a.quantity}</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${a.minStock}</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-align: right;">${a.price}€</td>
                            <td style="padding: 10px; border: 1px solid #ddd; text-align: right; font-weight: bold;">${(a.quantity * a.price).toFixed(2)}€</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <p style="margin-top: 30px; text-align: right; font-weight: bold;">
                Valeur totale du stock : ${this.articles.reduce((sum, a) => sum + (a.quantity * a.price), 0).toFixed(2)}€
            </p>
        `;
        
        const opt = { margin: 10, filename: 'Catalogue_Articles.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { orientation: 'landscape' } };
        html2pdf().set(opt).from(doc).save();
        this.showToast('PDF Catalogue exporté', 'success');
    }

    // Export Catalogue - Excel
    exportArticlesExcel() {
        const data = this.articles.map(a => ({
            'Article': a.name,
            'Catégorie': a.category,
            'Emplacement': a.location,
            'Quantité': a.quantity,
            'Stock Min': a.minStock,
            'Prix Unit.': a.price,
            'Valeur': a.quantity * a.price,
            'Description': a.description
        }));
        
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');
        XLSX.writeFile(wb, 'Catalogue_Articles.xlsx');
        this.showToast('Excel Catalogue exporté', 'success');
    }

    // Export Mouvements - PDF
    exportMovementsPDF() {
        const doc = document.createElement('div');
        doc.innerHTML = `
            <h1 style="text-align: center; margin-bottom: 20px;">🔄 Mouvements de Stock - Stock Manager</h1>
            <p style="text-align: center; color: #666; margin-bottom: 30px;">Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px;">
                <thead>
                    <tr style="background: #0052CC; color: white;">
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Type</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Article</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Quantité</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Raison</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Utilisateur</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.movements.map(m => {
                        const article = this.articles.find(a => a.id === m.articleId);
                        return `
                            <tr style="border-bottom: 1px solid #ddd;">
                                <td style="padding: 8px; border: 1px solid #ddd;">${new Date(m.date).toLocaleDateString('fr-FR')}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${m.type}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${article?.name || 'N/A'}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${m.quantity}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${m.reason}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${m.username}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            <p style="margin-top: 20px; color: #666;">Total mouvements : ${this.movements.length}</p>
        `;
        
        const opt = { margin: 10, filename: 'Mouvements_Stock.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { orientation: 'landscape' } };
        html2pdf().set(opt).from(doc).save();
        this.showToast('PDF Mouvements exporté', 'success');
    }

    // Export Mouvements - Excel
    exportMovementsExcel() {
        const data = this.movements.map(m => {
            const article = this.articles.find(a => a.id === m.articleId);
            return {
                'Date': new Date(m.date).toLocaleDateString('fr-FR'),
                'Type': m.type,
                'Article': article?.name || 'N/A',
                'Quantité': m.quantity,
                'Raison': m.reason,
                'Notes': m.notes,
                'Utilisateur': m.username
            };
        });
        
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Mouvements');
        XLSX.writeFile(wb, 'Mouvements_Stock.xlsx');
        this.showToast('Excel Mouvements exporté', 'success');
    }

    // Export Demandes - PDF
    exportRequestsPDF() {
        const doc = document.createElement('div');
        doc.innerHTML = `
            <h1 style="text-align: center; margin-bottom: 20px;">📝 Demandes de Matériel - Stock Manager</h1>
            <p style="text-align: center; color: #666; margin-bottom: 30px;">Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px;">
                <thead>
                    <tr style="background: #0052CC; color: white;">
                        <th style="padding: 8px; border: 1px solid #ddd;">Départ</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Retour</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Article</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Qty</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Demandeur</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Raison</th>
                        <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Statut</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.requests.map(r => {
                        const article = this.articles.find(a => a.id === r.articleId);
                        return `
                            <tr style="border-bottom: 1px solid #ddd;">
                                <td style="padding: 8px; border: 1px solid #ddd;">${new Date(r.startDate).toLocaleDateString('fr-FR')}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${new Date(r.returnDate).toLocaleDateString('fr-FR')}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${article?.name || 'N/A'}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${r.quantity}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${r.username}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${r.reason}</td>
                                <td style="padding: 8px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${r.status}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
        
        const opt = { margin: 10, filename: 'Demandes_Materiel.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { orientation: 'landscape' } };
        html2pdf().set(opt).from(doc).save();
        this.showToast('PDF Demandes exporté', 'success');
    }

    // Export Demandes - Excel
    exportRequestsExcel() {
        const data = this.requests.map(r => {
            const article = this.articles.find(a => a.id === r.articleId);
            return {
                'Départ': new Date(r.startDate).toLocaleDateString('fr-FR'),
                'Retour': new Date(r.returnDate).toLocaleDateString('fr-FR'),
                'Article': article?.name || 'N/A',
                'Quantité': r.quantity,
                'Demandeur': r.username,
                'Raison': r.reason,
                'Statut': r.status,
                'Notes': r.notes
            };
        });
        
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Demandes');
        XLSX.writeFile(wb, 'Demandes_Materiel.xlsx');
        this.showToast('Excel Demandes exporté', 'success');
    }

    // Export Historique - PDF
    exportHistoryPDF() {
        const doc = document.createElement('div');
        doc.innerHTML = `
            <h1 style="text-align: center; margin-bottom: 20px;">📜 Historique d'Activité - Stock Manager</h1>
            <p style="text-align: center; color: #666; margin-bottom: 30px;">Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 11px;">
                <thead>
                    <tr style="background: #0052CC; color: white;">
                        <th style="padding: 8px; border: 1px solid #ddd;">Date & Heure</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Utilisateur</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Action</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Détails</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Statut</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.history.map(h => `
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px; border: 1px solid #ddd;">${new Date(h.timestamp).toLocaleDateString('fr-FR')} ${new Date(h.timestamp).toLocaleTimeString('fr-FR')}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${h.username}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${h.action}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${h.details}</td>
                            <td style="padding: 8px; border: 1px solid #ddd;">${h.status}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        const opt = { margin: 10, filename: 'Historique_Activite.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { orientation: 'landscape' } };
        html2pdf().set(opt).from(doc).save();
        this.showToast('PDF Historique exporté', 'success');
    }

    // Export Historique - Excel
    exportHistoryExcel() {
        const data = this.history.map(h => ({
            'Date': new Date(h.timestamp).toLocaleDateString('fr-FR'),
            'Heure': new Date(h.timestamp).toLocaleTimeString('fr-FR'),
            'Utilisateur': h.username,
            'Action': h.action,
            'Détails': h.details,
            'Statut': h.status
        }));
        
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Historique');
        XLSX.writeFile(wb, 'Historique_Activite.xlsx');
        this.showToast('Excel Historique exporté', 'success');
    }

    // Export Complet - PDF
    exportAllPDF() {
        const doc = document.createElement('div');
        doc.innerHTML = `
            <h1 style="text-align: center; margin-bottom: 10px;">📦 Stock Manager - Rapport Complet</h1>
            <p style="text-align: center; color: #666; margin-bottom: 30px;">Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}</p>
            
            <h2 style="margin-top: 40px; border-bottom: 2px solid #0052CC; padding-bottom: 10px;">📋 Catalogue</h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px;">
                <thead>
                    <tr style="background: #f0f0f0;">
                        <th style="padding: 8px; border: 1px solid #ddd;">Article</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Cat.</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Qty</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Min</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Prix</th>
                        <th style="padding: 8px; border: 1px solid #ddd;">Valeur</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.articles.map(a => `
                        <tr><td style="padding: 6px; border: 1px solid #ddd;">${a.name}</td>
                        <td style="padding: 6px; border: 1px solid #ddd;">${a.category}</td>
                        <td style="padding: 6px; border: 1px solid #ddd;">${a.quantity}</td>
                        <td style="padding: 6px; border: 1px solid #ddd;">${a.minStock}</td>
                        <td style="padding: 6px; border: 1px solid #ddd;">${a.price}€</td>
                        <td style="padding: 6px; border: 1px solid #ddd;">${(a.quantity * a.price).toFixed(2)}€</td></tr>
                    `).join('')}
                </tbody>
            </table>
            
            <h2 style="margin-top: 40px; border-bottom: 2px solid #0052CC; padding-bottom: 10px;">🔄 Mouvements Récents (10 derniers)</h2>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10px;">
                <tbody>
                    ${this.movements.slice(-10).map(m => {
                        const article = this.articles.find(a => a.id === m.articleId);
                        return `<tr><td style="padding: 4px; border: 1px solid #ddd;">${new Date(m.date).toLocaleDateString('fr-FR')} | ${m.type} | ${article?.name || 'N/A'} | Qty: ${m.quantity} | ${m.username}</td></tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
        
        const opt = { margin: 10, filename: 'Rapport_Complet.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { orientation: 'landscape' } };
        html2pdf().set(opt).from(doc).save();
        this.showToast('PDF Complet exporté', 'success');
    }

    // Export Complet - Excel
    exportAllExcel() {
        const wb = XLSX.utils.book_new();
        
        // Feuille 1: Catalogue
        const articlesData = this.articles.map(a => ({
            'Article': a.name,
            'Catégorie': a.category,
            'Emplacement': a.location,
            'Quantité': a.quantity,
            'Stock Min': a.minStock,
            'Prix Unit.': a.price,
            'Valeur': a.quantity * a.price
        }));
        const ws1 = XLSX.utils.json_to_sheet(articlesData);
        XLSX.utils.book_append_sheet(wb, ws1, 'Catalogue');
        
        // Feuille 2: Mouvements
        const movementsData = this.movements.map(m => {
            const article = this.articles.find(a => a.id === m.articleId);
            return {
                'Date': new Date(m.date).toLocaleDateString('fr-FR'),
                'Type': m.type,
                'Article': article?.name || 'N/A',
                'Quantité': m.quantity,
                'Raison': m.reason,
                'Utilisateur': m.username
            };
        });
        const ws2 = XLSX.utils.json_to_sheet(movementsData);
        XLSX.utils.book_append_sheet(wb, ws2, 'Mouvements');
        
        // Feuille 3: Demandes
        const requestsData = this.requests.map(r => {
            const article = this.articles.find(a => a.id === r.articleId);
            return {
                'Départ': new Date(r.startDate).toLocaleDateString('fr-FR'),
                'Retour': new Date(r.returnDate).toLocaleDateString('fr-FR'),
                'Article': article?.name || 'N/A',
                'Quantité': r.quantity,
                'Demandeur': r.username,
                'Statut': r.status
            };
        });
        const ws3 = XLSX.utils.json_to_sheet(requestsData);
        XLSX.utils.book_append_sheet(wb, ws3, 'Demandes');
        
        // Feuille 4: Historique
        const historyData = this.history.map(h => ({
            'Date': new Date(h.timestamp).toLocaleDateString('fr-FR'),
            'Heure': new Date(h.timestamp).toLocaleTimeString('fr-FR'),
            'Utilisateur': h.username,
            'Action': h.action,
            'Détails': h.details
        }));
        const ws4 = XLSX.utils.json_to_sheet(historyData);
        XLSX.utils.book_append_sheet(wb, ws4, 'Historique');
        
        XLSX.writeFile(wb, 'Rapport_Complet.xlsx');
        this.showToast('Excel Complet exporté', 'success');
    }

    // ====== NOTIFICATIONS ======
    addNotification(type, title, message) {
        const notification = {
            id: Math.max(...this.notifications.map(n => n.id), 0) + 1,
            type: type, // 'success', 'error', 'warning', 'info'
            title: title,
            message: message,
            timestamp: new Date(),
            read: false
        };

        this.notifications.unshift(notification); // Ajouter en début de liste

        // Garder seulement les 100 dernières notifications
        if (this.notifications.length > 100) {
            this.notifications.pop();
        }

        this.updateNotificationBadge();
        this.saveToStorage();

        return notification;
    }

    updateNotificationBadge() {
        const unreadCount = this.notifications.filter(n => !n.read).length;
        const badge = document.getElementById('notificationBadge');

        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    renderNotifications() {
        const container = document.getElementById('notificationsCenter');

        if (this.notifications.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #6a737d;"><p>Aucune notification</p></div>';
            return;
        }

        container.innerHTML = this.notifications.map(notification => {
            const time = new Date(notification.timestamp);
            const timeStr = time.toLocaleDateString('fr-FR') + ' ' + time.toLocaleTimeString('fr-FR');

            return `
                <div class="notification-item ${notification.type}" ${notification.read ? 'style="opacity: 0.6;"' : ''}>
                    <div class="notification-header">
                        <div>
                            <span class="notification-title">${notification.title}</span>
                            <span class="notification-type" style="margin-left: 10px;">${notification.type.toUpperCase()}</span>
                        </div>
                        <span class="notification-time">${timeStr}</span>
                    </div>
                    <div class="notification-message">${notification.message}</div>
                    <div class="notification-actions">
                        ${!notification.read ? `<button class="btn btn-secondary" onclick="app.markNotificationAsRead(${notification.id})">Marquer comme lu</button>` : ''}
                        <button class="btn btn-secondary" onclick="app.deleteNotification(${notification.id})">Supprimer</button>
                    </div>
                </div>
            `;
        }).join('');

        // Marquer toutes comme lues
        this.notifications.forEach(n => n.read = true);
        this.updateNotificationBadge();
        this.saveToStorage();
    }

    markNotificationAsRead(notificationId) {
        const notification = this.notifications.find(n => n.id === notificationId);
        if (notification) {
            notification.read = true;
            this.updateNotificationBadge();
            this.saveToStorage();
            this.renderNotifications();
        }
    }

    deleteNotification(notificationId) {
        this.notifications = this.notifications.filter(n => n.id !== notificationId);
        this.updateNotificationBadge();
        this.saveToStorage();
        this.renderNotifications();
    }

    clearAllNotifications() {
        if (confirm('Supprimer toutes les notifications ?')) {
            this.notifications = [];
            this.updateNotificationBadge();
            this.saveToStorage();
            this.renderNotifications();
            this.showToast('Toutes les notifications ont été supprimées', 'success');
        }
    }

    // ====== NOTIFICATIONS ======
    loadNotifications() {
        const notificationsBar = document.getElementById('notificationsBar');
        notificationsBar.innerHTML = '';

        const notifications = [];

        // 1. Notifications de retour d'articles (dates dépassées)
        const today = new Date().toISOString().split('T')[0];
        const overduReturns = this.requests.filter(r => 
            r.status === 'Approuvée' && r.returnDate < today && this.canSeeRequest(r)
        );

        overduReturns.forEach(request => {
            const daysOverdue = Math.floor((new Date(today) - new Date(request.returnDate)) / (1000 * 60 * 60 * 24));
            const project = this.escapeHtml(request.projectName);
            
            notifications.push({
                type: 'return',
                icon: '📦',
                title: `Retour en Retard`,
                message: this.isStaff()
                    ? `Projet "${project}" (${this.escapeHtml(request.username)}) : retour en retard de ${daysOverdue} jour(s)`
                    : `Votre demande "${project}" devait être retournée il y a ${daysOverdue} jour(s)`,
                critical: daysOverdue > 3,
                action: this.isStaff() ? { label: 'Check-list', page: 'checklist' } : { label: 'Voir', page: 'requests' },
                id: `return-${request.id}`
            });
        });

        // 2. Notifications de demandes en attente (Admin uniquement)
        if (this.currentUser.role === 'Admin') {
            const pendingRequests = this.requests.filter(r => r.status === 'En attente');
            
            if (pendingRequests.length > 0) {
                notifications.push({
                    type: 'pending',
                    icon: '⏳',
                    title: `Demandes en Attente`,
                    message: `${pendingRequests.length} demande(s) à traiter`,
                    critical: pendingRequests.length > 5,
                    action: { label: 'Voir', page: 'requests' },
                    id: 'pending-requests'
                });
            }
        }

        // Afficher les notifications
        if (notifications.length === 0) {
            notificationsBar.classList.add('hidden');
            return;
        }

        notificationsBar.classList.remove('hidden');

        notifications.forEach(notif => {
            const notifEl = document.createElement('div');
            notifEl.className = `notification-item ${notif.critical ? 'critical' : ''}`;
            notifEl.id = notif.id;
            notifEl.innerHTML = `
                <div class="notification-icon">${notif.icon}</div>
                <div class="notification-content">
                    <div class="notification-title">${notif.title}</div>
                    <div class="notification-message">${notif.message}</div>
                </div>
                ${notif.action ? `<div class="notification-action">
                    <button class="btn btn-primary" onclick="app.navigateTo('${notif.action.page}')">${notif.action.label}</button>
                </div>` : ''}
                <button class="notification-close" onclick="document.getElementById('${notif.id}').remove()">✕</button>
            `;
            notificationsBar.appendChild(notifEl);
        });
    }

    // ====== TOGGLE MOT DE PASSE ======
    togglePasswordVisibility(fieldId) {
        const field = document.getElementById(fieldId);
        const button = event.target.closest('.password-toggle-btn');
        
        if (field.type === 'password') {
            field.type = 'text';
            button.textContent = '🙈';
        } else {
            field.type = 'password';
            button.textContent = '👁️';
        }
    }

    // ====== STOCKAGE ======
    // ===== EXPORTS CSV (REMPLACE PDF/EXCEL) =====
    arrayToCSV(data) {
        if (!data || data.length === 0) return '';
        const headers = Object.keys(data[0]);
        const rows = data.map(obj => headers.map(h => {
            const v = obj[h];
            if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
                return `"${v.replace(/"/g, '""')}"`;
            }
            return v || '';
        }).join(','));
        return [headers.join(','), ...rows].join('\n');
    }

    downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    exportArticlesPDF() {
        try {
            const data = this.articles.map(a => ({
                'Article': a.name, 'Catégorie': a.category, 'Lieu': a.location,
                'Quantité': a.quantity, 'Min': a.minStock, 'Prix': a.price
            }));
            this.downloadFile(this.arrayToCSV(data), `Catalogue_${new Date().toISOString().split('T')[0]}.csv`);
            this.showToast('✅ Catalogue exporté', 'success');
        } catch(e) { this.showToast('❌ Erreur export', 'error'); }
    }

    exportArticlesExcel() { this.exportArticlesPDF(); }

    exportMovementsPDF() {
        try {
            const data = this.movements.map(m => ({
                'Date': m.date ? new Date(m.date).toLocaleDateString('fr-FR') : '',
                'Type': m.type, 'Quantité': m.quantity, 'Raison': m.reason, 'User': m.username
            }));
            this.downloadFile(this.arrayToCSV(data), `Mouvements_${new Date().toISOString().split('T')[0]}.csv`);
            this.showToast('✅ Mouvements exportés', 'success');
        } catch(e) { this.showToast('❌ Erreur export', 'error'); }
    }

    exportMovementsExcel() { this.exportMovementsPDF(); }

    exportRequestsPDF() {
        try {
            const data = this.requests.map(r => ({
                'Du': r.startDate, 'Au': r.returnDate, 'Motif': r.reason, 'Statut': r.status, 'User': r.username
            }));
            this.downloadFile(this.arrayToCSV(data), `Demandes_${new Date().toISOString().split('T')[0]}.csv`);
            this.showToast('✅ Demandes exportées', 'success');
        } catch(e) { this.showToast('❌ Erreur export', 'error'); }
    }

    exportRequestsExcel() { this.exportRequestsPDF(); }

    exportHistoryPDF() {
        try {
            const data = this.history.slice(-100).map(h => ({
                'Date': h.timestamp ? new Date(h.timestamp).toLocaleString('fr-FR') : '',
                'Action': h.action, 'User': h.username, 'Détails': h.details
            }));
            this.downloadFile(this.arrayToCSV(data), `Historique_${new Date().toISOString().split('T')[0]}.csv`);
            this.showToast('✅ Historique exporté', 'success');
        } catch(e) { this.showToast('❌ Erreur export', 'error'); }
    }

    exportHistoryExcel() { this.exportHistoryPDF(); }

    exportAllPDF() {
        try {
            let csv = '=== EXPORT COMPLET ===\nDate: ' + new Date().toLocaleString('fr-FR') + '\n\n';
            csv += '--- ARTICLES ---\n' + this.arrayToCSV(this.articles.map(a => ({
                'Article': a.name, 'Catégorie': a.category, 'Qté': a.quantity
            }))) + '\n\n';
            csv += '--- MOUVEMENTS ---\n' + this.arrayToCSV(this.movements.map(m => ({
                'Type': m.type, 'Qté': m.quantity, 'Date': m.date ? new Date(m.date).toLocaleDateString('fr-FR') : ''
            }))) + '\n\n';
            csv += '--- DEMANDES ---\n' + this.arrayToCSV(this.requests.map(r => ({
                'Motif': r.reason, 'Statut': r.status, 'User': r.username
            }))) + '\n';
            this.downloadFile(csv, `Export_Complet_${new Date().toISOString().split('T')[0]}.csv`);
            this.showToast('✅ Export complet', 'success');
        } catch(e) { this.showToast('❌ Erreur export', 'error'); }
    }

    exportAllExcel() { this.exportAllPDF(); }

    // ====== MOTS DE PASSE ======
    verifyPassword(user, pwd) {
        if (user.password !== undefined && user.password !== '') return user.password === pwd;
        return !!user.passwordHash && user.passwordHash === sha256Hex('stockmgr|' + pwd);
    }

    // ====== GOOGLE SHEETS : BASE PARTAGÉE ======
    isSheetsConfigured() {
        const c = window.GOOGLE_SHEETS_CONFIG;
        return !!(c && c.enabled && c.token &&
            /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(c.scriptUrl || ''));
    }

    // Tables partagées entre les appareils (les notifications restent propres à chaque appareil)
    sheetsTables() {
        const t = ['articles', 'movements', 'requests', 'history'];
        if (window.GOOGLE_SHEETS_CONFIG.syncUsers !== false) t.unshift('users');
        return t;
    }

    // Affiche un message sans déclencher de nouvelle synchronisation
    toastNoSync(message, type) {
        this._ignoreSaves = true;
        try { this.showToast(message, type); } finally { this._ignoreSaves = false; }
    }

    // Sauvegarde locale sans programmer d'envoi
    persistQuiet() {
        this._ignoreSaves = true;
        try { this.saveToStorage(); } finally { this._ignoreSaves = false; }
    }

    updateSyncStatus(state, detail) {
        const el = document.getElementById('syncStatus');
        if (!el) return;
        const last = localStorage.getItem('lastSheetsSync');
        const lastTxt = last ? ' (dernière synchro : ' + new Date(last).toLocaleString('fr-FR') + ')' : '';
        const textes = {
            notconfigured: '📊 État : Non configuré (adresse du script manquante dans app.js)',
            idle: '📊 État : Prêt' + lastTxt,
            pending: '⏳ État : Modifications à envoyer...',
            sending: '🔄 État : Synchronisation en cours...',
            ok: '✅ État : Synchronisé' + lastTxt,
            offline: '📴 État : Hors connexion — synchro dès que le réseau revient',
            conflict: '⚠️ Le Google Sheet contient déjà des données ET cet appareil aussi. Choisissez ci-dessous : remplacer cet appareil par le Sheet, ou écraser le Sheet avec cet appareil.',
            error: '❌ État : Erreur — ' + (detail || 'synchro impossible') + ' (nouvel essai automatique)'
        };
        el.textContent = textes[state] || '';
    }

    // ----- État mémorisé (ce qui a déjà été synchronisé) -----
    sheetsLoad() {
        try {
            const s = JSON.parse(localStorage.getItem('sheetsState') || 'null');
            if (s && s.shadow) return s;
        } catch (e) { /* on repart de zéro */ }
        return { linked: false, rev: 0, shadow: {} };
    }

    sheetsSave(st) {
        localStorage.setItem('sheetsState', JSON.stringify(st));
    }

    // ====== IMPORT D'ARTICLES DEPUIS EXCEL (.xlsx) OU CSV ======
    // Aucune bibliothèque externe : l'appli lit le fichier toute seule.
    // Colonnes attendues (dans cet ordre ou non) :
    //   Article | Catégorie | Emplacement | Quantité | Stock Min | Prix Unit. | Description

    importAliases() {
        return {
            name: ['article', 'nom', 'nomarticle', 'nomdelarticle', 'designation', 'name', 'libelle'],
            category: ['categorie', 'category', 'domaine'],
            location: ['emplacement', 'lieu', 'localisation', 'location', 'salle'],
            quantity: ['quantite', 'qte', 'qt', 'quantity', 'stock', 'nombre'],
            minStock: ['stockmin', 'stockminimum', 'minstock', 'seuil', 'stockminimal', 'min'],
            price: ['prixunit', 'prixunitaire', 'prix', 'price', 'pu', 'prixunitaireeur'],
            description: ['description', 'desc', 'commentaire', 'remarque', 'notes']
        };
    }

    importNorm(v) {
        return String(v === null || v === undefined ? '' : v)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    importClean(v, max) {
        return String(v === null || v === undefined ? '' : v)
            .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
    }

    importNumber(v) {
        if (typeof v === 'number') return isFinite(v) ? v : null;
        let s = String(v === null || v === undefined ? '' : v).replace(/[\s\u00a0€$]/g, '').replace(',', '.');
        if (s === '') return undefined;       // case vide
        const n = Number(s);
        return isFinite(n) ? n : null;        // null = pas un nombre
    }

    // Bouton « Importer » : ouvre le choix du fichier
    openImportArticles() {
        const role = this.currentUser && this.currentUser.role;
        if (role !== 'Admin' && role !== 'Gestionnaire') {
            this.showToast('❌ Réservé aux administrateurs et gestionnaires', 'error');
            return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.csv,.txt';
        input.onchange = () => { if (input.files && input.files[0]) this.handleImportFile(input.files[0]); };
        input.click();
    }

    // Modèle à remplir (CSV, s'ouvre directement dans Excel)
    downloadImportTemplate() {
        const lignes = [
            ['Article', 'Catégorie', 'Emplacement', 'Quantité', 'Stock Min', 'Prix Unit.', 'Description'],
            ['Micro Shure SM58', 'Son', 'Magasin', 5, 2, 99, 'Micro dynamique'],
            ['Projecteur PAR LED', 'Lumière', 'Salle B', 8, 4, 120, ''],
            ['Trépied vidéo', 'Vidéo', 'Salle C', 3, 1, 85, 'Rotule fluide']
        ];
        const csv = '\ufeff' + lignes.map(l => l.join(';')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Modele_import_articles.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async handleImportFile(file) {
        try {
            const nom = file.name.toLowerCase();
            if (nom.endsWith('.xls')) {
                this.showToast('❌ Ancien format .xls : ouvrez le fichier dans Excel et enregistrez-le en .xlsx', 'error');
                return;
            }
            let lignes;
            if (nom.endsWith('.xlsx')) {
                lignes = await this.readXlsxRows(await file.arrayBuffer());
            } else {
                lignes = this.readCsvRows(await file.text());
            }
            const resultat = this.analyseImport(lignes);
            if (resultat.fatal) {
                this.showToast('❌ ' + resultat.fatal, 'error');
                return;
            }
            this.showImportPreview(resultat, file.name);
        } catch (e) {
            console.error('Import error:', e);
            this.showToast('❌ Lecture impossible : ' + e.message, 'error');
        }
    }

    // ----- Lecture CSV -----
    readCsvRows(texte) {
        texte = texte.replace(/^\ufeff/, '');
        const premiere = texte.split(/\r?\n/)[0] || '';
        const compte = c => premiere.split(c).length - 1;
        let sep = ';';
        if (compte('\t') > compte(sep)) sep = '\t';
        if (compte(',') > compte(sep)) sep = ',';

        const lignes = [];
        let cell = '', ligne = [], guillemets = false, n = 1;
        const finLigne = () => {
            ligne.push(cell); cell = '';
            lignes.push({ n: n, cells: ligne });
            ligne = []; n++;
        };
        for (let i = 0; i < texte.length; i++) {
            const ch = texte[i];
            if (guillemets) {
                if (ch === '"') {
                    if (texte[i + 1] === '"') { cell += '"'; i++; } else guillemets = false;
                } else cell += ch;
            } else if (ch === '"') guillemets = true;
            else if (ch === sep) { ligne.push(cell); cell = ''; }
            else if (ch === '\n') finLigne();
            else if (ch === '\r') { /* ignoré */ }
            else cell += ch;
        }
        if (cell !== '' || ligne.length) finLigne();
        return lignes;
    }

    // ----- Lecture Excel (.xlsx = fichier zip contenant du XML) -----
    async readXlsxRows(buffer) {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('ce navigateur est trop ancien pour lire .xlsx : utilisez un fichier .csv');
        }
        const u8 = new Uint8Array(buffer);
        if (u8[0] !== 0x50 || u8[1] !== 0x4B) throw new Error("ce fichier n'est pas un vrai .xlsx");
        const fichiers = this.zipEntries(buffer);
        const lire = async (nom) => {
            const f = fichiers[nom];
            if (!f) return null;
            return new TextDecoder('utf-8').decode(await this.zipRead(buffer, f));
        };
        const xml = (txt) => new DOMParser().parseFromString(txt, 'application/xml');

        // Chaînes partagées (les textes des cellules)
        const partagees = [];
        const sstTxt = await lire('xl/sharedStrings.xml');
        if (sstTxt) {
            Array.from(xml(sstTxt).getElementsByTagName('si')).forEach(si => {
                let s = '';
                Array.from(si.getElementsByTagName('t')).forEach(t => {
                    if (!t.parentNode || t.parentNode.nodeName !== 'rPh') s += t.textContent;
                });
                partagees.push(s);
            });
        }

        // Première feuille du classeur
        let chemin = 'xl/worksheets/sheet1.xml';
        const wbTxt = await lire('xl/workbook.xml');
        const relTxt = await lire('xl/_rels/workbook.xml.rels');
        if (wbTxt && relTxt) {
            const feuille = xml(wbTxt).getElementsByTagName('sheet')[0];
            const rid = feuille && (feuille.getAttribute('r:id') || feuille.getAttribute('id'));
            const rel = Array.from(xml(relTxt).getElementsByTagName('Relationship'))
                .find(r => r.getAttribute('Id') === rid);
            if (rel) {
                let cible = rel.getAttribute('Target') || '';
                cible = cible.replace(/^\//, '');
                chemin = cible.startsWith('xl/') ? cible : 'xl/' + cible;
            }
        }
        const feuilleTxt = await lire(chemin);
        if (!feuilleTxt) throw new Error('feuille Excel introuvable');

        const colNum = (ref) => {
            const m = /^([A-Z]+)/.exec(ref || '');
            if (!m) return 0;
            let n = 0;
            for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
            return n - 1;
        };

        const lignes = [];
        Array.from(xml(feuilleTxt).getElementsByTagName('row')).forEach(row => {
            const cells = [];
            Array.from(row.getElementsByTagName('c')).forEach(c => {
                const type = c.getAttribute('t');
                const vNode = c.getElementsByTagName('v')[0];
                let val = '';
                if (type === 's') val = partagees[parseInt(vNode ? vNode.textContent : '-1', 10)] || '';
                else if (type === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map(t => t.textContent).join('');
                else if (vNode) val = vNode.textContent;
                cells[colNum(c.getAttribute('r'))] = val;
            });
            lignes.push({ n: parseInt(row.getAttribute('r'), 10) || (lignes.length + 1), cells: Array.from(cells, v => v === undefined ? '' : v) });
        });
        return lignes;
    }

    // Lit la liste des fichiers d'un zip
    zipEntries(buffer) {
        const dv = new DataView(buffer);
        let eocd = -1;
        for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 70000); i--) {
            if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('fichier .xlsx abîmé');
        const total = dv.getUint16(eocd + 10, true);
        let p = dv.getUint32(eocd + 16, true);
        const out = {};
        for (let k = 0; k < total; k++) {
            if (dv.getUint32(p, true) !== 0x02014b50) break;
            const methode = dv.getUint16(p + 10, true);
            const taille = dv.getUint32(p + 20, true);
            const nomLen = dv.getUint16(p + 28, true);
            const extraLen = dv.getUint16(p + 30, true);
            const comLen = dv.getUint16(p + 32, true);
            const local = dv.getUint32(p + 42, true);
            const nom = new TextDecoder('utf-8').decode(new Uint8Array(buffer, p + 46, nomLen));
            out[nom] = { methode: methode, taille: taille, local: local };
            p += 46 + nomLen + extraLen + comLen;
        }
        return out;
    }

    async zipRead(buffer, f) {
        const dv = new DataView(buffer);
        const nomLen = dv.getUint16(f.local + 26, true);
        const extraLen = dv.getUint16(f.local + 28, true);
        const debut = f.local + 30 + nomLen + extraLen;
        const donnees = new Uint8Array(buffer, debut, f.taille);
        if (f.methode === 0) return donnees;
        if (f.methode !== 8) throw new Error('compression non gérée');
        const flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(flux).arrayBuffer());
    }

    // ----- Vérification des lignes -----
    analyseImport(lignes) {
        const vides = l => !l.cells.some(c => String(c === undefined ? '' : c).trim() !== '');
        const utiles = lignes.filter(l => !vides(l));
        if (!utiles.length) return { fatal: 'le fichier est vide' };
        if (utiles.length > 2001) return { fatal: 'trop de lignes (maximum 2000 articles par import)' };

        // Quelle colonne est quoi ?
        const entete = utiles[0];
        const alias = this.importAliases();
        const col = {};
        entete.cells.forEach((titre, i) => {
            const t = this.importNorm(titre);
            Object.keys(alias).forEach(champ => {
                if (col[champ] === undefined && alias[champ].includes(t)) col[champ] = i;
            });
        });
        const manque = [];
        if (col.name === undefined) manque.push('Article');
        if (col.category === undefined) manque.push('Catégorie');
        if (col.quantity === undefined) manque.push('Quantité');
        if (manque.length) {
            return { fatal: 'colonne(s) introuvable(s) sur la première ligne : ' + manque.join(', ') +
                '. Téléchargez le modèle pour voir les bons titres.' };
        }

        const categories = { son: 'Son', lumiere: 'Lumière', video: 'Vidéo', accessoire: 'Accessoires', accessoires: 'Accessoires' };
        const lieux = { sallea: 'Salle A', salleb: 'Salle B', sallec: 'Salle C', magasin: 'Magasin' };
        const get = (l, champ) => col[champ] === undefined ? '' : l.cells[col[champ]];

        const existants = {};
        this.articles.forEach(a => { existants[this.importNorm(a.name) + '|' + this.importNorm(a.location)] = a; });

        const nouveaux = [], doublons = [], erreurs = [], vus = {};
        utiles.slice(1).forEach(l => {
            const err = [];
            const name = this.importClean(get(l, 'name'), 120);
            if (!name) err.push('nom manquant');

            const catBrute = this.importClean(get(l, 'category'), 60);
            const category = categories[this.importNorm(catBrute)];
            if (!catBrute) err.push('catégorie manquante');
            else if (!category) err.push('catégorie inconnue « ' + catBrute + ' » (Son, Lumière, Vidéo ou Accessoires)');

            const lieuBrut = this.importClean(get(l, 'location'), 60);
            let location = 'Magasin';
            if (lieuBrut) {
                location = lieux[this.importNorm(lieuBrut)];
                if (!location) err.push('emplacement inconnu « ' + lieuBrut + ' » (Salle A, Salle B, Salle C ou Magasin)');
            }

            const quantity = this.importNumber(get(l, 'quantity'));
            if (quantity === undefined) err.push('quantité manquante');
            else if (quantity === null || quantity < 0 || !Number.isInteger(quantity)) err.push('quantité invalide');

            let minStock = this.importNumber(get(l, 'minStock'));
            if (minStock === undefined) minStock = 0;
            else if (minStock === null || minStock < 0 || !Number.isInteger(minStock)) err.push('stock min invalide');

            let price = this.importNumber(get(l, 'price'));
            if (price === undefined) price = 0;
            else if (price === null || price < 0) err.push('prix invalide');

            if (err.length) { erreurs.push({ n: l.n, texte: err.join(' ; ') }); return; }

            const cle = this.importNorm(name) + '|' + this.importNorm(location);
            if (vus[cle]) { erreurs.push({ n: l.n, texte: 'doublon dans le fichier (déjà ligne ' + vus[cle] + ')' }); return; }
            vus[cle] = l.n;

            const art = {
                name: name, category: category, location: location,
                quantity: quantity, minStock: minStock, price: Math.round(price * 100) / 100,
                description: this.importClean(get(l, 'description'), 500)
            };
            if (existants[cle]) doublons.push({ n: l.n, article: art, existant: existants[cle] });
            else nouveaux.push({ n: l.n, article: art });
        });

        return { nouveaux: nouveaux, doublons: doublons, erreurs: erreurs };
    }

    // ----- Fenêtre de vérification avant d'importer -----
    showImportPreview(res, nomFichier) {
        const old = document.getElementById('importModal');
        if (old) old.remove();
        const e = v => this.escapeHtml(String(v));

        const exemples = res.nouveaux.slice(0, 6).map(x =>
            `<li>${e(x.article.name)} — ${e(x.article.category)}, ${e(x.article.location)}, qté ${x.article.quantity}</li>`).join('');
        const listeErr = res.erreurs.slice(0, 12).map(x =>
            `<li>Ligne ${x.n} : ${e(x.texte)}</li>`).join('');

        const modal = document.createElement('div');
        modal.id = 'importModal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 640px; max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2>📥 Import : ${e(nomFichier)}</h2>
                    <button class="close-btn" type="button" id="importCloseBtn">&times;</button>
                </div>
                <div style="padding: 20px; font-size: 14px;">
                    <p>✅ <strong>${res.nouveaux.length}</strong> nouvel(s) article(s) prêt(s) à être ajouté(s)</p>
                    <p>🔁 <strong>${res.doublons.length}</strong> article(s) existe(nt) déjà (même nom et même emplacement)</p>
                    <p>⚠️ <strong>${res.erreurs.length}</strong> ligne(s) avec un problème (elles ne seront pas importées)</p>
                    ${exemples ? `<p style="margin-top:12px;"><strong>Aperçu :</strong></p><ul style="margin-left:18px;">${exemples}${res.nouveaux.length > 6 ? '<li>…</li>' : ''}</ul>` : ''}
                    ${listeErr ? `<p style="margin-top:12px; color:#b71c1c;"><strong>Problèmes :</strong></p><ul style="margin-left:18px; color:#b71c1c;">${listeErr}${res.erreurs.length > 12 ? '<li>… et ' + (res.erreurs.length - 12) + ' autre(s)</li>' : ''}</ul>` : ''}
                    ${res.doublons.length ? `
                        <p style="margin-top:12px;"><strong>Pour les articles qui existent déjà :</strong></p>
                        <label style="display:block; margin:4px 0;"><input type="radio" name="importDup" value="skip" checked> Les laisser tels quels</label>
                        <label style="display:block; margin:4px 0;"><input type="radio" name="importDup" value="update"> Les mettre à jour avec les valeurs du fichier</label>` : ''}
                    <div style="display:flex; gap:10px; margin-top:20px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary" id="importCancelBtn" style="flex:1;">Annuler</button>
                        <button type="button" class="btn btn-primary" id="importOkBtn" style="flex:1;">Importer</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const fermer = () => modal.remove();
        modal.querySelector('#importCloseBtn').onclick = fermer;
        modal.querySelector('#importCancelBtn').onclick = fermer;
        const ok = modal.querySelector('#importOkBtn');
        if (!res.nouveaux.length && !res.doublons.length) { ok.disabled = true; ok.textContent = 'Rien à importer'; }
        ok.onclick = () => {
            const mode = (modal.querySelector('input[name="importDup"]:checked') || {}).value || 'skip';
            fermer();
            this.applyImport(res, mode);
        };
    }

    applyImport(res, mode) {
        let creations = 0, majs = 0;
        let prochainId = Math.max(...this.articles.map(a => a.id), 0) + 1;

        res.nouveaux.forEach(x => {
            this.articles.push(Object.assign({
                id: prochainId++,
                uid: this.newUid(),
                createdAt: new Date()
            }, x.article));
            creations++;
        });

        if (mode === 'update') {
            res.doublons.forEach(x => {
                Object.assign(x.existant, x.article);
                majs++;
            });
        }

        // logActivity enregistre aussi les données et lance la synchro Google Sheets
        this.logActivity('IMPORT_ARTICLES', `Import Excel : ${creations} créé(s), ${majs} mis à jour, ${res.erreurs.length} ligne(s) ignorée(s)`, 'success');
        this.saveToStorage();
        this.populateArticleSelects();
        this.renderArticles();
        this.showToast(`✅ Import terminé : ${creations} ajouté(s)` + (majs ? `, ${majs} mis à jour` : ''), 'success');
    }

    newUid() {
        return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // Chaque enregistrement reçoit un identifiant unique (uid) pour être reconnu entre appareils
    ensureUids() {
        let added = false;
        this.sheetsTables().forEach(t => {
            this[t].forEach(r => { if (!r.uid) { r.uid = this.newUid(); added = true; } });
        });
        if (added) this.persistQuiet();
    }

    stableStringify(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(x => this.stableStringify(x)).join(',') + ']';
        return '{' + Object.keys(v).sort()
            .filter(k => v[k] !== undefined)
            .map(k => JSON.stringify(k) + ':' + this.stableStringify(v[k])).join(',') + '}';
    }

    // Forme envoyée au Sheet : le mot de passe en clair ne part jamais, seulement son empreinte
    toSyncRecord(table, rec) {
        const copy = JSON.parse(JSON.stringify(rec));
        if (table === 'users') {
            if (rec.password) copy.passwordHash = sha256Hex('stockmgr|' + rec.password);
            delete copy.password;
        }
        return copy;
    }

    sheetsHash(table, rec) {
        return hash53(this.stableStringify(this.toSyncRecord(table, rec)));
    }

    // Cet appareil ne contient que les données de démonstration ?
    isPristineDemo() {
        const demoUsers = ['admin', 'gestionnaire', 'user'];
        const demoNames = ['Microphone Shure SM58', 'Câble XLR 10m', 'Table de Mixage Yamaha', 'Projecteur LED RGB',
            'Camera Sony A6700', 'Trépied Manfrotto', 'Ampoule LED 5600K', 'Batterie Externe USB'];
        return this.movements.length === 0 && this.requests.length === 0 &&
            this.users.every(u => demoUsers.includes(u.username)) &&
            this.articles.every(a => demoNames.includes(a.name));
    }

    // Si un article change de numéro, on met à jour les mouvements et demandes qui le citent
    sheetsPatchRefs(table, data, remap) {
        if (!remap || !Object.keys(remap).length) return;
        if (table === 'movements' && remap[data.articleId] !== undefined) {
            data.articleId = remap[data.articleId];
        }
        if (table === 'requests' && Array.isArray(data.articles)) {
            data.articles.forEach(l => { if (remap[l.articleId] !== undefined) l.articleId = remap[l.articleId]; });
        }
    }

    // ----- Appel du serveur Google -----
    async sheetsCall(payload) {
        const c = window.GOOGLE_SHEETS_CONFIG;
        const response = await fetch(c.scriptUrl, {
            method: 'POST',
            // text/plain : évite le contrôle CORS préalable que Google Apps Script refuse
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            redirect: 'follow',
            body: JSON.stringify(Object.assign({
                action: 'SYNC',
                token: c.token,
                device: /Android/i.test(navigator.userAgent) ? 'Android' : 'Ordinateur',
                user: this.currentUser?.fullName || 'Système'
            }, payload))
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const texte = await response.text();
        let res;
        try {
            res = JSON.parse(texte);
        } catch (e) {
            throw new Error('Réponse inattendue : le déploiement doit être ouvert à « Tout le monde »');
        }
        if (!res.success) throw new Error(res.error || 'Erreur');
        return res;
    }

    // Remplace les données de cet appareil par celles du Sheet
    sheetsApplyFull(res, st) {
        const shadow = {};
        this.sheetsTables().forEach(t => {
            const list = (res.records && res.records[t]) || [];
            this[t] = list.map(r => JSON.parse(JSON.stringify(r)));
            shadow[t] = {};
            list.forEach(r => { shadow[t][r.uid] = hash53(this.stableStringify(r)); });
        });
        st.shadow = shadow;
        st.rev = res.rev;
        st.linked = true;
    }

    sheetsServerHasData(res) {
        return res.rev > 0 && Object.keys(res.records || {}).some(t => (res.records[t] || []).length > 0);
    }

    // ----- Démarrage : première synchro, puis vérifications régulières -----
    startSheetsSync() {
        this.updateSyncStatus(this.isSheetsConfigured() ? 'idle' : 'notconfigured');
        if (!this.isSheetsConfigured()) return;
        const c = window.GOOGLE_SHEETS_CONFIG;

        window.addEventListener('online', () => this.syncToGoogleSheets({ silent: true }));
        document.addEventListener('visibilitychange', () => {
            // On quitte l'appli : on envoie. On revient : on récupère les nouveautés.
            this.syncToGoogleSheets({ silent: true });
        });
        this._pollTimer = setInterval(() => {
            if (document.visibilityState === 'visible' && navigator.onLine) {
                this.syncToGoogleSheets({ silent: true });
            }
        }, c.pollMs || 120000);
        setTimeout(() => this.syncToGoogleSheets({ silent: true }), 800);
    }

    // Programme un envoi après une modification (attend que l'utilisateur ait fini)
    scheduleSheetsSync() {
        const c = window.GOOGLE_SHEETS_CONFIG;
        if (!c || !c.auto || !this.isSheetsConfigured()) return;
        this._syncDirty = true;
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this.syncToGoogleSheets({ silent: true }), c.delayMs || 3000);
        this.updateSyncStatus('pending');
    }

    // Met à jour l'écran avec les données reçues (sans déranger quelqu'un qui écrit)
    refreshAfterSync() {
        if (!this.currentUser) return;
        const modalOpen = Array.from(document.querySelectorAll('.modal'))
            .some(m => m.style.display && m.style.display !== 'none');
        const el = document.activeElement;
        const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
        const page = document.querySelector('.nav-link.active')?.getAttribute('data-page');
        if (modalOpen || typing || !page || page === 'inventory' || page === 'checklist') {
            this._viewDirty = true;   // on réessaiera à la prochaine synchro
            return;
        }
        this._viewDirty = false;
        this.populateArticleSelects();
        this.navigateTo(page);
    }

    sheetsReplaceFromServer() {
        if (!confirm('Remplacer TOUTES les données de cet appareil par celles du Google Sheet ?')) return;
        this.syncToGoogleSheets({ mode: 'replace' });
    }

    sheetsOverwriteServer() {
        if (!confirm('ÉCRASER le Google Sheet avec les données de cet appareil ?\nLes données des autres appareils non synchronisées seront perdues.')) return;
        this.syncToGoogleSheets({ mode: 'reset' });
    }

    // ----- Synchronisation complète : envoi des changements puis réception des nouveautés -----
    async syncToGoogleSheets(options = {}) {
        const silent = !!options.silent;
        const mode = options.mode || 'normal';   // normal | replace | reset

        if (!this.isSheetsConfigured()) {
            this.updateSyncStatus('notconfigured');
            if (!silent) this.toastNoSync('❌ Google Sheets non configuré : collez l\'adresse /exec dans app.js', 'error');
            return false;
        }
        if (!navigator.onLine) {
            this._syncDirty = true;
            this.updateSyncStatus('offline');
            if (!silent) this.toastNoSync('📴 Pas de réseau : synchro dès que la connexion revient', 'warning');
            return false;
        }
        if (this._syncing) {
            this._syncAgain = true;
            return false;
        }

        this._syncing = true;
        clearTimeout(this._syncTimer);
        this.updateSyncStatus('sending');
        if (!silent) this.toastNoSync('⏳ Synchronisation...', 'info');

        let changed = false;
        try {
            const st = this.sheetsLoad();
            const tables = this.sheetsTables();
            this.ensureUids();

            let done = false;

            if (mode === 'replace') {
                // Remplacer cet appareil par le Sheet
                const full = await this.sheetsCall({ since: 0, changes: {}, deletions: {} });
                this.sheetsApplyFull(full, st);
                this.sheetsSave(st);
                this.persistQuiet();
                changed = true;
                done = true;
            } else if (!st.linked && mode === 'normal') {
                // Première liaison : que contient le Sheet ?
                const probe = await this.sheetsCall({ since: 0, changes: {}, deletions: {} });
                if (this.sheetsServerHasData(probe)) {
                    if (this.isPristineDemo()) {
                        this.sheetsApplyFull(probe, st);
                        this.sheetsSave(st);
                        this.persistQuiet();
                        changed = true;
                        done = true;
                    } else {
                        this.updateSyncStatus('conflict');
                        if (!silent) this.toastNoSync('⚠️ Choisissez : remplacer cet appareil par le Sheet, ou écraser le Sheet (page Exports)', 'warning');
                        return false;
                    }
                }
            }

            if (!done) {
                const incremental = st.linked && mode === 'normal';
                const shadow = incremental ? st.shadow : {};

                // 1) Ce qui a changé ici depuis la dernière synchro
                const changes = {}, deletions = {};
                let nWrites = 0;
                tables.forEach(t => {
                    changes[t] = [];
                    deletions[t] = [];
                    const old = shadow[t] || {};
                    const seen = {};
                    this[t].forEach(r => {
                        seen[r.uid] = true;
                        if (old[r.uid] !== this.sheetsHash(t, r)) {
                            const sync = this.toSyncRecord(t, r);
                            changes[t].push({ uid: r.uid, id: sync.id, data: sync });
                        }
                    });
                    Object.keys(old).forEach(uid => { if (!seen[uid]) deletions[t].push(uid); });
                    nWrites += changes[t].length + deletions[t].length;
                });

                // 2) Échange avec le serveur
                const res = await this.sheetsCall({
                    since: incremental ? st.rev : 0,
                    changes: changes,
                    deletions: deletions,
                    reset: mode === 'reset'
                });

                // 3) Numéros modifiés par le serveur (deux appareils avaient pris le même numéro)
                const idMap = res.idMap || {};
                const remapArticles = {};
                (changes.articles || []).forEach(ch => {
                    const nid = idMap.articles && idMap.articles[ch.uid];
                    if (nid !== undefined) remapArticles[ch.id] = nid;
                });
                let needPersist = false;
                const pushed = {};
                tables.forEach(t => {
                    shadow[t] = shadow[t] || {};
                    pushed[t] = {};
                    const byUid = {};
                    this[t].forEach(r => { byUid[r.uid] = r; });
                    changes[t].forEach(ch => {
                        pushed[t][ch.uid] = true;
                        const rec = byUid[ch.uid];
                        const nid = idMap[t] && idMap[t][ch.uid];
                        if (nid !== undefined) {
                            ch.data.id = nid;
                            if (rec) rec.id = nid;
                            needPersist = true;
                        }
                        if (t === 'movements' || t === 'requests') {
                            const before = JSON.stringify(ch.data);
                            this.sheetsPatchRefs(t, ch.data, remapArticles);
                            if (rec) this.sheetsPatchRefs(t, rec, remapArticles);
                            if (before !== JSON.stringify(ch.data)) needPersist = true;
                        }
                        shadow[t][ch.uid] = hash53(this.stableStringify(ch.data));
                    });
                    deletions[t].forEach(uid => { delete shadow[t][uid]; });
                });

                // 4) Nouveautés des autres appareils
                tables.forEach(t => {
                    const index = {};
                    this[t].forEach((r, i) => { index[r.uid] = i; });

                    ((res.records && res.records[t]) || []).forEach(inc => {
                        if (pushed[t][inc.uid]) return;
                        const incHash = hash53(this.stableStringify(inc));
                        const i = index[inc.uid];
                        if (i === undefined) {
                            this[t].push(JSON.parse(JSON.stringify(inc)));
                            index[inc.uid] = this[t].length - 1;
                            changed = true;
                        } else {
                            const localHash = this.sheetsHash(t, this[t][i]);
                            if (localHash !== incHash && localHash === shadow[t][inc.uid]) {
                                this[t][i] = JSON.parse(JSON.stringify(inc));
                                changed = true;
                            }
                            // sinon : modifié ici pendant l'échange → on garde la version locale, elle partira au prochain tour
                        }
                        shadow[t][inc.uid] = incHash;
                    });

                    const toRemove = {};
                    ((res.deleted && res.deleted[t]) || []).forEach(uid => {
                        const i = index[uid];
                        if (i !== undefined && this.sheetsHash(t, this[t][i]) === shadow[t][uid]) {
                            toRemove[uid] = true;
                            changed = true;
                        }
                        delete shadow[t][uid];
                    });
                    if (Object.keys(toRemove).length) this[t] = this[t].filter(r => !toRemove[r.uid]);
                });

                st.rev = res.rev;
                st.linked = true;
                st.shadow = shadow;
                this.sheetsSave(st);
                if (changed || needPersist) this.persistQuiet();
            }

            this._syncDirty = false;
            localStorage.setItem('lastSheetsSync', new Date().toISOString());
            this.updateSyncStatus('ok');
            if (!silent) this.toastNoSync('✅ Synchronisé avec Google Sheets', 'success');
            if (changed || this._viewDirty) this.refreshAfterSync();
            return true;
        } catch (e) {
            console.error('Sync error:', e);
            this._syncDirty = true;
            this.updateSyncStatus('error', e.message);
            if (!silent) this.toastNoSync('❌ Erreur sync : ' + e.message, 'error');
            return false;
        } finally {
            this._syncing = false;
            if (this._syncAgain) {
                this._syncAgain = false;
                this.scheduleSheetsSync();
            }
        }
    }

    saveToStorage() {
        localStorage.setItem('articles', JSON.stringify(this.articles));
        localStorage.setItem('movements', JSON.stringify(this.movements));
        localStorage.setItem('history', JSON.stringify(this.history));
        localStorage.setItem('users', JSON.stringify(this.users));
        localStorage.setItem('requests', JSON.stringify(this.requests));
        localStorage.setItem('notifications', JSON.stringify(this.notifications));
        if (!this._ignoreSaves) this.scheduleSheetsSync();
    }

    loadFromStorage() {
        const articles = localStorage.getItem('articles');
        const movements = localStorage.getItem('movements');
        const history = localStorage.getItem('history');
        const users = localStorage.getItem('users');
        const requests = localStorage.getItem('requests');
        const notifications = localStorage.getItem('notifications');

        if (articles) this.articles = JSON.parse(articles);
        if (movements) this.movements = JSON.parse(movements);
        if (history) this.history = JSON.parse(history);
        if (users) this.users = JSON.parse(users);
        if (requests) this.requests = JSON.parse(requests);
        if (notifications) this.notifications = JSON.parse(notifications);
    }
}

// Initialiser l'application
let app;
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded - Création de app');
    app = new StockApp();
});
