document.addEventListener('DOMContentLoaded', () => {
    // State variables
    let updates = [];
    let filteredUpdates = [];
    let selectedUpdate = null;
    let filterType = 'all';
    let searchQuery = '';
    let sortOrder = 'desc';
    let dateRange = 'all';
    let currentTemplate = 'standard';
    let referenceTodayDate = new Date(); // Will be calibrated to the newest release date in the feed

    // DOM Elements
    const btnRefresh = document.getElementById('btn-refresh');
    const updatesList = document.getElementById('updates-list');
    const feedLoader = document.getElementById('feed-loader');
    const noResults = document.getElementById('no-results');
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const filterPills = document.querySelectorAll('.filter-pill');
    
    // Sort and Date Selectors
    const dateRangeSelect = document.getElementById('date-range-select');
    const sortOrderSelect = document.getElementById('sort-order-select');
    
    // Modal & Composer Elements
    const composerModal = document.getElementById('composer-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const contextBadge = document.getElementById('context-badge');
    const contextDate = document.getElementById('context-date');
    const contextSnippet = document.getElementById('context-snippet');
    const tweetTextarea = document.getElementById('tweet-textarea');
    const charCounter = document.getElementById('char-counter');
    const charWarning = document.getElementById('char-warning');
    const progressRingCircle = document.getElementById('progress-ring-circle');
    const btnCopyTweet = document.getElementById('btn-copy-tweet');
    const btnShareTweet = document.getElementById('btn-share-tweet');
    const tagHelpers = document.querySelectorAll('.tag-helper');
    const templateButtons = document.querySelectorAll('.template-opt-btn');
    
    // Stats Elements
    const statSyncTime = document.getElementById('stat-sync-time');
    const statTotalCount = document.getElementById('stat-total-count');
    const statFeaturesCount = document.getElementById('stat-features-count');
    const statIssuesCount = document.getElementById('stat-issues-count');
    
    // Progress Ring Constants
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    progressRingCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    progressRingCircle.style.strokeDashoffset = circumference;

    // Initialize the app
    init();

    function init() {
        fetchUpdates();
        setupEventListeners();
    }

    // --- EVENT LISTENERS ---
    function setupEventListeners() {
        // Refresh button
        btnRefresh.addEventListener('click', refreshUpdates);
        
        // Search Input
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            searchClear.style.display = searchQuery.length > 0 ? 'block' : 'none';
            filterAndSearch();
        });

        // Clear search
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchQuery = '';
            searchClear.style.display = 'none';
            searchInput.focus();
            filterAndSearch();
        });

        // Filter Pills
        filterPills.forEach(pill => {
            pill.addEventListener('click', () => {
                filterPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                filterType = pill.getAttribute('data-type');
                filterAndSearch();
            });
        });

        // Date Range Select
        dateRangeSelect.addEventListener('change', (e) => {
            dateRange = e.target.value;
            filterAndSearch();
        });

        // Sort Order Select
        sortOrderSelect.addEventListener('change', (e) => {
            sortOrder = e.target.value;
            filterAndSearch();
        });

        // Tweet textarea inputs
        tweetTextarea.addEventListener('input', () => {
            updateCharacterCounter();
        });

        // Hashtag helpers
        tagHelpers.forEach(helper => {
            helper.addEventListener('click', () => {
                const tag = helper.getAttribute('data-tag');
                insertTag(tag);
            });
        });

        // Template selector tabs
        templateButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                templateButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTemplate = btn.getAttribute('data-template');
                if (selectedUpdate) {
                    applyTemplate();
                }
            });
        });

        // Modal Action buttons
        btnCloseModal.addEventListener('click', closeModal);
        composerModal.addEventListener('click', (e) => {
            // Close if clicking outside the modal container
            if (e.target === composerModal) {
                closeModal();
            }
        });

        // Keyboard navigation (ESC key)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && composerModal.classList.contains('active')) {
                closeModal();
            }
        });

        // Composer Actions
        btnCopyTweet.addEventListener('click', copyTweetToClipboard);
        btnShareTweet.addEventListener('click', shareTweetOnTwitter);
    }

    // --- API CALLS ---
    async function fetchUpdates() {
        setLoadingState(true);
        try {
            const response = await fetch('/api/updates');
            if (!response.ok) throw new Error('Failed to load release notes.');
            
            const data = await response.json();
            updates = data.updates || [];
            statSyncTime.textContent = data.last_updated ? formatSyncTime(data.last_updated) : '--:--:--';
            
            calibrateReferenceDate();
            filterAndSearch();
            updateStats();
            showToast('Loaded BigQuery updates successfully', 'success');
        } catch (error) {
            console.error('Error fetching updates:', error);
            showToast(error.message || 'Error loading updates. Please refresh.', 'error');
            setLoadingState(false);
        }
    }

    async function refreshUpdates() {
        if (btnRefresh.classList.contains('loading')) return;
        
        btnRefresh.classList.add('loading');
        btnRefresh.disabled = true;
        setLoadingState(true);
        showToast('Syncing feed from Google Cloud...', 'info');

        try {
            const response = await fetch('/api/refresh', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to sync latest feed.');

            const data = await response.json();
            updates = data.updates || [];
            statSyncTime.textContent = data.last_updated ? formatSyncTime(data.last_updated) : '--:--:--';

            closeModal();
            calibrateReferenceDate();
            filterAndSearch();
            updateStats();
            showToast('Feed synced and parsed successfully', 'success');
        } catch (error) {
            console.error('Error refreshing updates:', error);
            showToast(error.message || 'Error syncing latest release notes.', 'error');
        } finally {
            btnRefresh.classList.remove('loading');
            btnRefresh.disabled = false;
        }
    }

    // --- RENDER & DISPLAY ---
    function setLoadingState(isLoading) {
        if (isLoading) {
            feedLoader.style.display = 'flex';
            updatesList.style.display = 'none';
            noResults.style.display = 'none';
        } else {
            feedLoader.style.display = 'none';
            updatesList.style.display = 'flex';
        }
    }

    function calibrateReferenceDate() {
        // Find the newest date in the feed updates list to use as reference "today" date
        if (updates.length > 0) {
            const dates = updates.map(u => new Date(u.date)).filter(d => !isNaN(d));
            if (dates.length > 0) {
                // Calibrate today to the max date parsed
                referenceTodayDate = new Date(Math.max(...dates));
            }
        }
    }

    function renderFeed() {
        updatesList.innerHTML = '';
        setLoadingState(false);

        if (filteredUpdates.length === 0) {
            noResults.style.display = 'flex';
            return;
        }

        noResults.style.display = 'none';

        filteredUpdates.forEach((update, idx) => {
            const card = document.createElement('div');
            card.className = 'update-card';
            card.id = `card-${idx}`;
            
            if (selectedUpdate && 
                selectedUpdate.date === update.date && 
                selectedUpdate.type === update.type && 
                selectedUpdate.content === update.content) {
                card.classList.add('selected');
            }

            const badgeClass = getBadgeClass(update.type);
            
            card.innerHTML = `
                <div class="card-meta">
                    <span class="badge ${badgeClass}">${update.type}</span>
                    <span class="card-date">${update.date}</span>
                </div>
                <div class="card-content">
                    ${update.content}
                </div>
                <div class="card-actions">
                    <button class="btn-card-action" aria-label="Compose tweet for this update">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                        Draft Post
                    </button>
                </div>
            `;

            // Card click behavior (opens modal)
            card.addEventListener('click', () => {
                selectCard(update, card);
            });

            updatesList.appendChild(card);
        });
    }

    function selectCard(update, cardElement) {
        selectedUpdate = update;
        
        // Remove previous selection styles and set on current card
        document.querySelectorAll('.update-card').forEach(c => c.classList.remove('selected'));
        cardElement.classList.add('selected');

        // Populate Modal Details
        const badgeClass = getBadgeClass(update.type);
        contextBadge.className = `badge ${badgeClass}`;
        contextBadge.textContent = update.type;
        contextDate.textContent = update.date;
        
        const plainText = stripHtml(update.content);
        contextSnippet.textContent = plainText;

        // Apply templates and populate text
        applyTemplate();
        
        // Open Modal overlay
        openModal();
    }

    function openModal() {
        composerModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Disable background scroll
    }

    function closeModal() {
        composerModal.classList.remove('active');
        document.body.style.overflow = 'auto'; // Enable scroll
        
        // Clear selection styles
        selectedUpdate = null;
        document.querySelectorAll('.update-card').forEach(c => c.classList.remove('selected'));
    }

    // --- TEMPLATE LOGIC ---
    function applyTemplate() {
        if (!selectedUpdate) return;
        
        const plainText = stripHtml(selectedUpdate.content);
        const compactDate = formatCompactDate(selectedUpdate.date);
        const type = selectedUpdate.type;
        const link = selectedUpdate.link;
        
        let draftText = '';
        let hashtags = '#BigQuery #GoogleCloud';
        
        // Twitter URL length is counted as exactly 23 characters
        const linkLen = 23;
        
        if (currentTemplate === 'minimal') {
            // Formula: BigQuery {Type}: {Snippet}\n\n{Link}
            const header = `BigQuery ${type}: `;
            const footer = `\n\n${link}`;
            const footerLen = 2 + linkLen; // '\n\n' is 2 chars + linkLen (23)
            
            const maxSnippetLen = 280 - header.length - footerLen - 4;
            let snippet = plainText;
            if (snippet.length > maxSnippetLen) {
                snippet = snippet.substring(0, maxSnippetLen).trim() + '...';
            }
            
            draftText = `${header}${snippet}${footer}`;
            
        } else if (currentTemplate === 'promo') {
            // Formula: 🔥 GCP BigQuery Update! ({date})\n⚡ {type}: {snippet}\n\n{hashtags}\n\n{link}
            const header = `🔥 GCP BigQuery Update! (${compactDate})\n⚡ ${type}: `;
            const footer = `\n\n${hashtags}\n\n${link}`;
            const footerLen = 4 + hashtags.length + linkLen; // '\n\n' + hashtags + '\n\n' + link(23)
            
            const maxSnippetLen = 280 - header.length - footerLen - 4;
            let snippet = plainText;
            if (snippet.length > maxSnippetLen) {
                snippet = snippet.substring(0, maxSnippetLen).trim() + '...';
            }
            
            draftText = `${header}${snippet}${footer}`;
            
        } else {
            // Standard: 📢 BigQuery {Type} ({Date}): {Snippet}\n\n{hashtags}\n{Link}
            const header = `📢 BigQuery ${type} (${compactDate}): `;
            const footer = `\n\n${hashtags}\n${link}`;
            const footerLen = 3 + hashtags.length + linkLen; // '\n\n' + hashtags + '\n' + link(23)
            
            const maxSnippetLen = 280 - header.length - footerLen - 4;
            let snippet = plainText;
            if (snippet.length > maxSnippetLen) {
                snippet = snippet.substring(0, maxSnippetLen).trim() + '...';
            }
            
            draftText = `${header}${snippet}${footer}`;
        }
        
        tweetTextarea.value = draftText;
        updateCharacterCounter();
    }

    // --- FILTER & SEARCH LOGIC ---
    function filterAndSearch() {
        filteredUpdates = updates.filter(update => {
            // 1. Filter by Type Pill
            const typeMatch = filterType === 'all' || 
                update.type.toLowerCase() === filterType.toLowerCase();
            
            // 2. Filter by Date range
            let dateMatch = true;
            if (dateRange !== 'all') {
                const filterDays = parseInt(dateRange);
                const updateDate = new Date(update.date);
                if (!isNaN(updateDate)) {
                    // Compare against calibrated referenceTodayDate
                    const diffTime = Math.abs(referenceTodayDate - updateDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays > filterDays) {
                        dateMatch = false;
                    }
                }
            }
            
            // 3. Filter by Search Query
            const textContent = stripHtml(update.content).toLowerCase();
            const typeText = update.type.toLowerCase();
            const dateText = update.date.toLowerCase();
            const searchMatch = !searchQuery || 
                textContent.includes(searchQuery) || 
                typeText.includes(searchQuery) || 
                dateText.includes(searchQuery);

            return typeMatch && dateMatch && searchMatch;
        });

        // 4. Apply sorting
        filteredUpdates.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (isNaN(dateA)) return 1;
            if (isNaN(dateB)) return -1;
            
            return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
        });

        renderFeed();
    }

    function updateStats() {
        statTotalCount.textContent = updates.length;
        
        const features = updates.filter(u => u.type.toLowerCase() === 'feature').length;
        statFeaturesCount.textContent = features;
        
        const issues = updates.filter(u => u.type.toLowerCase() === 'issue').length;
        statIssuesCount.textContent = issues;
    }

    // --- TWEET COMPOSER HELPERS ---
    function updateCharacterCounter() {
        const text = tweetTextarea.value;
        const charCount = calculateTwitterLength(text);
        
        charCounter.textContent = `${charCount} / 280`;

        // Update circular progress ring
        const progress = Math.min(charCount / 280, 1);
        const offset = circumference - progress * circumference;
        progressRingCircle.style.strokeDashoffset = offset;

        // Visual alerts depending on length
        if (charCount > 280) {
            progressRingCircle.style.stroke = 'var(--accent-rose)';
            charCounter.style.color = 'var(--accent-rose)';
            charWarning.classList.add('visible');
            btnShareTweet.disabled = true;
        } else if (charCount > 260) {
            progressRingCircle.style.stroke = 'var(--accent-amber)';
            charCounter.style.color = 'var(--accent-amber)';
            charWarning.classList.remove('visible');
            btnShareTweet.disabled = false;
        } else {
            progressRingCircle.style.stroke = 'var(--accent-cyan)';
            charCounter.style.color = 'var(--text-muted)';
            charWarning.classList.remove('visible');
            btnShareTweet.disabled = false;
        }
    }

    function calculateTwitterLength(text) {
        // Find all http/https links using regex
        const urlRegex = /https?:\/\/[^\s]+/g;
        const urls = text.match(urlRegex) || [];
        
        let lengthWithoutUrls = text.replace(urlRegex, '').length;
        
        // Add 23 characters for each URL (Standard Twitter/X intent formatting)
        return lengthWithoutUrls + (urls.length * 23);
    }

    function insertTag(tag) {
        const currentText = tweetTextarea.value;
        if (!currentText) return;
        
        const lines = currentText.split('\n');
        let hashtagLineIdx = -1;
        
        // Find line containing hashtags
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('#') || lines[i].includes(tag)) {
                hashtagLineIdx = i;
                break;
            }
        }

        if (hashtagLineIdx !== -1) {
            // Skip if hashtag already exists
            if (lines[hashtagLineIdx].includes(tag)) return;
            
            lines[hashtagLineIdx] = `${lines[hashtagLineIdx].trim()} ${tag}`;
        } else {
            // If hashtags don't exist yet, insert them right before the link
            const urlRegex = /https?:\/\/[^\s]+$/;
            if (urlRegex.test(currentText.trim())) {
                const parts = currentText.trim().split('\n');
                const lastLine = parts[parts.length - 1]; // URL link
                parts[parts.length - 1] = `${tag}`;
                parts.push(lastLine);
                tweetTextarea.value = parts.join('\n');
                updateCharacterCounter();
                return;
            } else {
                tweetTextarea.value = `${currentText.trim()}\n\n${tag}`;
            }
        }
        
        tweetTextarea.value = lines.join('\n');
        updateCharacterCounter();
    }

    function copyTweetToClipboard() {
        const text = tweetTextarea.value;
        if (!text) return;

        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied draft to clipboard!', 'success');
        }).catch(err => {
            console.error('Clipboard copy failed:', err);
            showToast('Failed to copy text. Copy manually.', 'error');
        });
    }

    function shareTweetOnTwitter() {
        const text = tweetTextarea.value;
        if (!text) return;
        
        if (calculateTwitterLength(text) > 280) {
            showToast('Cannot tweet: Draft exceeds 280 character limit!', 'error');
            return;
        }

        const encodedText = encodeURIComponent(text);
        const twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
        window.open(twitterUrl, '_blank');
        showToast('Opening Twitter/X compose window...', 'info');
    }

    // --- HELPERS ---
    function stripHtml(html) {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || "";
    }

    function getBadgeClass(type) {
        switch (type.toLowerCase()) {
            case 'feature': return 'badge-feature';
            case 'issue': return 'badge-issue';
            case 'changed': return 'badge-changed';
            case 'deprecated': return 'badge-deprecated';
            default: return 'badge-update';
        }
    }

    function formatSyncTime(timestampStr) {
        try {
            const parts = timestampStr.split(' ');
            return parts.length > 1 ? parts[1] : timestampStr;
        } catch (e) {
            return timestampStr;
        }
    }

    function formatCompactDate(dateStr) {
        try {
            const parts = dateStr.replace(',', '').split(' ');
            if (parts.length >= 2) {
                const month = parts[0].substring(0, 3);
                return `${month} ${parts[1]}`;
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let iconSvg = '';
        if (type === 'success') {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        } else if (type === 'error') {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        } else {
            iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
        }

        toast.innerHTML = `
            ${iconSvg}
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 4000);
    }
});
