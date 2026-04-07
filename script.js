const SUPABASE_URL = 'your project url';
const SUPABASE_ANON_KEY = 'your anon key';

let currentBoard = 'b';
let currentThreadId = null;
let currentReplyTarget = null; 

const STORAGE_KEY = '37ch_data';
const OP_TOKENS_KEY = '37ch_op_tokens';

let localData = {
    boards: ['b', 'k', 'pol', 'prog', 'game', 'hist', 'str', 'dev'],
    threads: {},
    posts: {}
};

let opTokens = {}; 
let activeOpThreads = new Set(); 

const boardNameMap = { b: 'Random', k: 'Weapons', pol: 'Politics', prog: 'Programming', game: 'GameDev', hist: 'History', str: 'Strategy', dev: 'Development' };

let supabaseClient = null;

function initSupabase() {
    if (typeof window.supabase !== 'undefined' && SUPABASE_URL && SUPABASE_URL !== 'https://your-project.supabase.co' && SUPABASE_ANON_KEY !== 'your-anon-key') {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            return true;
        } catch (e) {
            console.warn('Supabase init failed:', e);
            return false;
        }
    }
    return false;
}

const isSupabaseActive = initSupabase();

function loadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const d = JSON.parse(raw);
            localData.boards = d.boards || ['b', 'k', 'pol', 'prog', 'game', 'hist', 'str', 'dev'];
            localData.threads = d.threads || {};
            localData.posts = d.posts || {};
        } catch (e) { }
    }
    ['b', 'k', 'pol', 'prog', 'game', 'hist', 'str', 'dev'].forEach(b => {
        if (!localData.threads[b]) localData.threads[b] = [];
    });


    const tokensRaw = localStorage.getItem(OP_TOKENS_KEY);
    if (tokensRaw) {
        try {
            opTokens = JSON.parse(tokensRaw);
            activeOpThreads.clear();
            Object.keys(opTokens).forEach(tid => activeOpThreads.add(tid));
        } catch (e) { }
    }
}

function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        boards: localData.boards,
        threads: localData.threads,
        posts: localData.posts
    }));
}

function saveOpTokens() {
    localStorage.setItem(OP_TOKENS_KEY, JSON.stringify(opTokens));
}

function genId() { return Date.now() + '-' + Math.random().toString(36).substring(2, 8); }


async function tripcodeEncode(name) {
    if (!name || !name.includes('#')) return name || 'Anonymous';
    const parts = name.split('#');
    const key = parts.pop();
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const trip = hashArray.slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
    const displayName = parts.join('#') || 'Anonymous';
    return `${displayName} !${trip}`;
}


function generateOpToken(threadId) {
    const salt = localStorage.getItem('op_salt') || (() => {
        const s = Math.random().toString(36).substring(2, 15);
        localStorage.setItem('op_salt', s);
        return s;
    })();
    const raw = threadId + salt + Date.now();
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    return 'op_' + Math.abs(hash).toString(36);
}


function isUserOp(threadId) {
    return activeOpThreads.has(threadId);
}


function registerOpToken(threadId) {
    const token = generateOpToken(threadId);
    opTokens[threadId] = token;
    activeOpThreads.add(threadId);
    saveOpTokens();
    return token;
}


async function loadImages(files, maxCount = 4) {
    const imageUrls = [];
    const fileList = Array.from(files).slice(0, maxCount);
    for (const file of fileList) {
        if (file && file.size) {
            const reader = await new Promise((res) => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.readAsDataURL(file);
            });
            imageUrls.push(reader);
        }
    }
    return imageUrls;
}

async function createPost(board, threadId, subject, comment, nameRaw, imageFiles, sage, isOp) {
    const postId = genId();
    const tripDisplay = await tripcodeEncode(nameRaw);
    const images = imageFiles && imageFiles.length ? await loadImages(imageFiles, 4) : [];

    const post = {
        id: postId,
        board: board,
        threadId: threadId,
        isOp: isOp,
        subject: subject || (isOp ? 'Untitled' : ''),
        comment: comment,
        name: tripDisplay,
        sage: sage || false,
        timestamp: Date.now(),
        images: images,
        replies: [],
        locked: false,
        sticky: false
    };

    if (isOp) {
        registerOpToken(threadId);
    }

    if (isSupabaseActive && supabaseClient) {
        try {
            const { data, error } = await supabaseClient.from('posts').insert([post]).select();
            if (error) throw error;
            if (data && data[0]) return data[0];
            return post;
        } catch (e) {
            console.warn('Supabase insert failed, using local:', e);
            fallbackSave(post);
            return post;
        }
    } else {
        fallbackSave(post);
        return post;
    }

    function fallbackSave(p) {
        localData.posts[p.id] = p;
        if (isOp) {
            if (!localData.threads[board]) localData.threads[board] = [];
            if (!localData.threads[board].includes(p.id)) {
                localData.threads[board].unshift(p.id);
            }
        } else {
            if (localData.posts[threadId]) {
                if (!localData.posts[threadId].replies) localData.posts[threadId].replies = [];
                if (!localData.posts[threadId].replies.includes(p.id)) {
                    localData.posts[threadId].replies.push(p.id);
                }
                if (!sage) {
                    const threadArr = localData.threads[board];
                    const idx = threadArr.indexOf(threadId);
                    if (idx !== -1) {
                        threadArr.splice(idx, 1);
                        threadArr.unshift(threadId);
                    }
                }
            }
        }
        saveLocal();
    }
}


async function deletePost(postId, threadId) {
    if (!isUserOp(threadId)) return false;
    if (isSupabaseActive && supabaseClient) {
        await supabaseClient.from('posts').delete().eq('id', postId);
    } else {
        delete localData.posts[postId];
        const op = localData.posts[threadId];
        if (op && op.replies) {
            op.replies = op.replies.filter(rid => rid !== postId);
        }
        saveLocal();
    }
    return true;
}

async function toggleLockThread(threadId) {
    if (!isUserOp(threadId)) return false;
    const thread = await getThread(threadId);
    if (thread) {
        const newLocked = !thread.locked;
        if (isSupabaseActive && supabaseClient) {
            await supabaseClient.from('posts').update({ locked: newLocked }).eq('id', threadId);
        } else {
            localData.posts[threadId].locked = newLocked;
            saveLocal();
        }
    }
    return true;
}

async function toggleStickyThread(threadId) {
    if (!isUserOp(threadId)) return false;
    const thread = await getThread(threadId);
    if (thread) {
        const newSticky = !thread.sticky;
        if (isSupabaseActive && supabaseClient) {
            await supabaseClient.from('posts').update({ sticky: newSticky }).eq('id', threadId);
        } else {
            localData.posts[threadId].sticky = newSticky;
            saveLocal();
        }
    }
    return true;
}

async function getThread(threadId) {
    if (isSupabaseActive && supabaseClient) {
        const { data } = await supabaseClient.from('posts').select('*').eq('id', threadId).single();
        return data;
    } else {
        return localData.posts[threadId];
    }
}

async function getThreadsForBoard(board) {
    if (isSupabaseActive && supabaseClient) {
        try {
            let { data, error } = await supabaseClient.from('posts').select('*').eq('board', board).eq('isOp', true).order('timestamp', { ascending: false });
            if (error) throw error;
            let threads = data || [];
            for (let t of threads) {
                let { data: replies } = await supabaseClient.from('posts').select('*').eq('threadId', t.id).order('timestamp', { ascending: true });
                t.repliesList = replies || [];
            }

            threads.sort((a, b) => (b.sticky ? 1 : 0) - (a.sticky ? 1 : 0));
            return threads;
        } catch (e) {
            console.warn(e);
            return fallbackGetThreads(board);
        }
    } else {
        return fallbackGetThreads(board);
    }

    function fallbackGetThreads(b) {
        let threadIds = localData.threads[b] || [];
        let threads = [];
        for (let tid of threadIds) {
            let op = localData.posts[tid];
            if (op) {
                let replies = [];
                if (op.replies) {
                    for (let rid of op.replies) {
                        if (localData.posts[rid]) replies.push(localData.posts[rid]);
                    }
                }
                threads.push({ ...op, repliesList: replies });
            }
        }
        threads.sort((a, b) => (b.sticky ? 1 : 0) - (a.sticky ? 1 : 0));
        return threads;
    }
}

async function getRepliesForThread(threadId) {
    if (isSupabaseActive && supabaseClient) {
        try {
            let { data } = await supabaseClient.from('posts').select('*').eq('threadId', threadId).order('timestamp', { ascending: true });
            return data || [];
        } catch (e) {
            return fallbackGetReplies(threadId);
        }
    } else {
        return fallbackGetReplies(threadId);
    }

    function fallbackGetReplies(tid) {
        let op = localData.posts[tid];
        if (!op) return [];
        let replies = [];
        if (op.replies) {
            for (let rid of op.replies) {
                if (localData.posts[rid]) replies.push(localData.posts[rid]);
            }
        }
        return replies;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function parseQuotes(html) {
    let regex = />>(\d+)/g;
    return html.replace(regex, (match, p1) => {
        return `<a href="#" class="quote-link" data-ref="${p1}">&gt;&gt;${p1}</a>`;
    });
}

function renderPost(post, isOp, showReplyLink = true, threadRootId = null, isThreadLocked = false) {
    const isOpUser = threadRootId && isUserOp(threadRootId);
    const postNumber = String(post.id).slice(-6);
    
    let opBadge = '';
    if (isOp) opBadge = '<span class="op-badge">OP</span>';
    
    let lockBadge = '';
    if (post.locked) lockBadge = '<span class="lock-badge">[LOCKED]</span>';
    if (post.sticky) lockBadge += '<span class="sticky-badge">[STICKY]</span>';
    
    let header = `<div class="post-header">
        <span class="post-number">No.${postNumber}</span>
        <span>${escapeHtml(post.name || 'Anonymous')}</span>
        ${opBadge}
        ${lockBadge}
        ${post.sage ? '<span class="sage-badge">[Sage]</span>' : ''}
        <span>${new Date(post.timestamp).toLocaleString()}</span>
        ${post.subject ? `<span>📌 ${escapeHtml(post.subject)}</span>` : ''}
    </div>`;
    
    let content = parseQuotes(escapeHtml(post.comment || ''));
    
    let imagesHtml = '';
    if (post.images && post.images.length) {
        imagesHtml = `<div class="attachments">${post.images.map(img => 
            `<img src="${img}" class="thumb-img" data-fullimg="${img}" onclick="window.showFullImage(this)">`
        ).join('')}</div>`;
    }
    
    let replyHtml = '';
    if (showReplyLink && !isOp && threadRootId && !isThreadLocked) {
        replyHtml = `<div class="reply-link" data-thread="${threadRootId}" data-post="${post.id}" data-postnum="${postNumber}">🔗 Reply to this post</div>`;
    }
    
    let opControlsHtml = '';
    if (isOpUser && isOp && threadRootId) {
        opControlsHtml = `<div class="op-controls">
            <button class="op-btn" data-action="lock" data-thread="${threadRootId}">${post.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
            <button class="op-btn" data-action="sticky" data-thread="${threadRootId}">${post.sticky ? '📌 Unstick' : '📌 Sticky'}</button>
            <button class="op-btn danger" data-action="delete" data-thread="${threadRootId}" data-post="${post.id}">🗑 Delete</button>
        </div>`;
    } else if (isOpUser && !isOp && threadRootId) {
        opControlsHtml = `<div class="op-controls">
            <button class="op-btn danger" data-action="delete" data-thread="${threadRootId}" data-post="${post.id}">🗑 Delete</button>
        </div>`;
    }
    
    return `<div class="${isOp ? 'op-post' : 'reply-post'}" id="post-${post.id}" data-postid="${post.id}">
        ${header}
        <div class="post-content">${content || '<em>...</em>'}</div>
        ${imagesHtml}
        ${replyHtml}
        ${opControlsHtml}
    </div>`;
}

window.showFullImage = (imgElem) => {
    let fullSrc = imgElem.getAttribute('data-fullimg');
    let modal = document.createElement('div');
    modal.className = 'full-img-modal';
    modal.innerHTML = `<img src="${fullSrc}">`;
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
};

function showReplyModal(threadId, postId = null, postNum = null) {
    currentReplyTarget = { threadId, postId };
    const modal = document.getElementById('replyModal');
    const title = document.getElementById('replyModalTitle');
    
    if (postId && postNum) {
        title.textContent = `Reply to No.${postNum}`;
    } else {
        title.textContent = `Reply to thread`;
    }
    

    document.getElementById('replyName').value = '';
    document.getElementById('replyComment').value = '';
    document.getElementById('replyImages').value = '';
    document.getElementById('replySage').checked = false;
    
    if (postId && postNum) {
        document.getElementById('replyComment').value = `>>${postNum}\n`;
    }
    
    modal.style.display = 'flex';
}

function hideReplyModal() {
    document.getElementById('replyModal').style.display = 'none';
    currentReplyTarget = null;
}

async function submitReplyFromModal() {
    if (!currentReplyTarget) return;
    
    const name = document.getElementById('replyName').value;
    let comment = document.getElementById('replyComment').value;
    const images = document.getElementById('replyImages').files;
    const sage = document.getElementById('replySage').checked;
    const threadId = currentReplyTarget.threadId;
    
    if (!comment.trim()) {
        alert('Comment cannot be empty');
        return;
    }
    

    const thread = await getThread(threadId);
    if (thread && thread.locked) {
        alert('This thread is locked. Cannot reply.');
        hideReplyModal();
        return;
    }
    
    await createPost(currentBoard, threadId, '', comment, name, images, sage, false);
    
    hideReplyModal();
    
    if (currentThreadId === threadId) {
        await renderThreadView(threadId);
    } else {
        await renderBoardView();
    }
}

async function renderBoardView() {
    currentThreadId = null;
    document.getElementById('boardTitle').innerHTML = `/${currentBoard}/ - ${boardNameMap[currentBoard] || currentBoard.toUpperCase()}`;
    let threads = await getThreadsForBoard(currentBoard);
    let container = document.getElementById('threadsContainer');
    if (!threads || !threads.length) {
        container.innerHTML = `<div style="padding: 32px; text-align:center; border:1px solid #2a4a3a;">✨ No threads yet. Create the first one.</div>`;
        return;
    }
    let html = '';
    for (let thread of threads) {
        const isLocked = thread.locked;
        const threadClass = `thread ${thread.sticky ? 'sticky' : ''} ${isLocked ? 'locked' : ''}`;
        let opHtml = renderPost(thread, true, false, thread.id, isLocked);
        let repliesHtml = '';
        let repliesList = thread.repliesList || [];
        for (let reply of repliesList.slice(0, 5)) {
            repliesHtml += renderPost(reply, false, true, thread.id, isLocked);
        }
        let moreLink = '';
        if (repliesList.length > 5) {
            moreLink = `<div style="padding: 6px 18px;"><a href="#" class="quote-link" data-threadid="${thread.id}" data-viewthread="1">View all ${repliesList.length} replies →</a></div>`;
        }
        
        let replyButtonHtml = '';
        if (!isLocked) {
            replyButtonHtml = `<div style="padding: 8px 18px 12px 18px;">
                <button class="toggle-reply-btn" data-thread="${thread.id}">💬 Reply to thread</button>
            </div>`;
        } else {
            replyButtonHtml = `<div style="padding: 8px 18px 12px 18px; color: #6f8f6f;">
                ⛔ This thread is locked
            </div>`;
        }
        
        html += `<div class="${threadClass}" data-thread="${thread.id}">
            ${opHtml}
            <div id="repliesContainer-${thread.id}">${repliesHtml}</div>
            ${moreLink}
            ${replyButtonHtml}
        </div>`;
    }
    container.innerHTML = html;
    attachThreadEvents();
}

async function renderThreadView(threadId) {
    currentThreadId = threadId;
    let threads = await getThreadsForBoard(currentBoard);
    let opPost = threads.find(t => t.id === threadId);
    if (!opPost) {
        renderBoardView();
        return;
    }
    let allReplies = await getRepliesForThread(threadId);
    let container = document.getElementById('threadsContainer');
    const isLocked = opPost.locked;
    let opHtml = renderPost(opPost, true, false, threadId, isLocked);
    let repliesHtml = '';
    for (let r of allReplies) {
        if (!r.isOp) repliesHtml += renderPost(r, false, true, threadId, isLocked);
    }
    let backBtn = `<div style="margin-bottom: 16px;"><button id="backToBoardBtn">← Back to /${currentBoard}/</button></div>`;
    
    let replyFormHtml = '';
    if (!isLocked) {
        replyFormHtml = `<div style="margin-top: 20px; text-align: center;">
            <button id="showReplyModalBtn" data-thread="${threadId}">💬 Post reply</button>
        </div>`;
    } else {
        replyFormHtml = `<div style="margin-top: 20px; text-align: center; color: #6f8f6f;">⛔ This thread is locked</div>`;
    }
    
    container.innerHTML = backBtn + `<div class="thread" data-thread="${threadId}">${opHtml}<div id="repliesContainer">${repliesHtml}</div>${replyFormHtml}</div>`;
    
    document.getElementById('backToBoardBtn').onclick = () => { currentThreadId = null; renderBoardView(); };
    document.getElementById('showReplyModalBtn')?.addEventListener('click', () => {
        showReplyModal(threadId);
    });
    attachQuoteLinks();
    attachOpControls();
}

async function handleOpAction(action, threadId, postId = null) {
    switch (action) {
        case 'lock':
            await toggleLockThread(threadId);
            break;
        case 'sticky':
            await toggleStickyThread(threadId);
            break;
        case 'delete':
            if (postId && confirm('Delete this post?')) {
                await deletePost(postId, threadId);
            }
            break;
    }
    if (currentThreadId === threadId) {
        await renderThreadView(threadId);
    } else {
        await renderBoardView();
    }
}

function attachOpControls() {
    document.querySelectorAll('.op-btn').forEach(btn => {
        btn.removeEventListener('click', btn._handler);
        btn._handler = async (e) => {
            e.preventDefault();
            const action = btn.getAttribute('data-action');
            const threadId = btn.getAttribute('data-thread');
            const postId = btn.getAttribute('data-post');
            await handleOpAction(action, threadId, postId);
        };
        btn.addEventListener('click', btn._handler);
    });
}

function attachThreadEvents() {

    document.querySelectorAll('[data-viewthread]').forEach(a => {
        a.onclick = async (e) => {
            e.preventDefault();
            let tid = a.getAttribute('data-threadid');
            await renderThreadView(tid);
        };
    });
    

    document.querySelectorAll('.reply-link').forEach(el => {
        el.onclick = (e) => {
            e.preventDefault();
            const threadId = el.getAttribute('data-thread');
            const postId = el.getAttribute('data-post');
            const postNum = el.getAttribute('data-postnum');
            showReplyModal(threadId, postId, postNum);
        };
    });
    

    document.querySelectorAll('.toggle-reply-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const tid = btn.getAttribute('data-thread');
            showReplyModal(tid);
        };
    });
    
    attachQuoteLinks();
    attachOpControls();
}

function attachQuoteLinks() {
    document.querySelectorAll('.quote-link').forEach(el => {
        el.removeEventListener('click', el._listener);
        el._listener = (e) => {
            e.preventDefault();
            let ref = el.getAttribute('data-ref');
            if (ref) {
                let targetPost = document.getElementById(`post-${ref}`);
                if (targetPost) {
                    targetPost.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetPost.style.backgroundColor = '#1a3a2a';
                    setTimeout(() => {
                        targetPost.style.backgroundColor = '';
                    }, 1000);
                }
            }
        };
        el.addEventListener('click', el._listener);
    });
}

function renderBoardNav() {
    let boards = ['b', 'k', 'pol', 'prog', 'game', 'hist', 'str', 'dev'];
    let navDiv = document.getElementById('boardList');
    navDiv.innerHTML = boards.map(b => `<div class="board-badge ${currentBoard === b ? 'active' : ''}" data-board="${b}">/${b}/</div>`).join('');
    document.querySelectorAll('.board-badge').forEach(el => {
        el.onclick = async () => {
            currentBoard = el.getAttribute('data-board');
            currentThreadId = null;
            renderBoardNav();
            await renderBoardView();
        };
    });
}


function initModal() {
    const modal = document.getElementById('replyModal');
    const closeBtn = document.querySelector('.reply-modal-close');
    const cancelBtn = document.getElementById('replyModalCancel');
    const submitBtn = document.getElementById('replyModalSubmit');
    
    closeBtn.onclick = hideReplyModal;
    cancelBtn.onclick = hideReplyModal;
    submitBtn.onclick = submitReplyFromModal;
    
    modal.onclick = (e) => {
        if (e.target === modal) hideReplyModal();
    };
}

document.getElementById('createThreadBtn').onclick = async () => {
    let name = document.getElementById('postName').value;
    let subject = document.getElementById('postSubject').value;
    let comment = document.getElementById('postComment').value;
    let imageFiles = document.getElementById('postImages').files;
    let sage = document.getElementById('sageMode').checked;
    
    if (!comment.trim()) {
        alert('Comment cannot be empty');
        return;
    }
    
    let newThreadId = genId();
    await createPost(currentBoard, newThreadId, subject, comment, name, imageFiles, sage, true);
    
    document.getElementById('postComment').value = '';
    document.getElementById('postSubject').value = '';
    document.getElementById('postImages').value = '';
    
    if (currentThreadId === null) await renderBoardView();
    else await renderBoardView();
};

loadLocal();
renderBoardNav();
initModal();
renderBoardView();
