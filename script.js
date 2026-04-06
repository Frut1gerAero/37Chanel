const SUPABASE_URL = 'your supabase project ur;';
const SUPABASE_ANON_KEY = 'your supabase anon key';

let currentBoard = 'b';
let currentThreadId = null;

const STORAGE_KEY = '37ch_data';

let localData = {
    boards: ['b','k','pol','prog','game','hist','str','dev'],
    threads: {},
    posts: {}
};

const boardNameMap = { b:'Random', k:'Weapons', pol:'Politics', prog:'Programming', game:'GameDev', hist:'History', str:'Strategy', dev:'Development' };

let supabaseClient = null;

function initSupabase() {
    if (typeof window.supabase !== 'undefined' && SUPABASE_URL && SUPABASE_URL !== 'https://your-project.supabase.co' && SUPABASE_ANON_KEY !== 'your-anon-key') {
        try {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            return true;
        } catch(e) {
            console.warn('Supabase init failed:', e);
            return false;
        }
    }
    return false;
}

const isSupabaseActive = initSupabase();

function loadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) {
        try {
            const d = JSON.parse(raw);
            localData.boards = d.boards || ['b','k','pol','prog','game','hist','str','dev'];
            localData.threads = d.threads || {};
            localData.posts = d.posts || {};
        } catch(e) {}
    }
    ['b','k','pol','prog','game','hist','str','dev'].forEach(b => {
        if(!localData.threads[b]) localData.threads[b] = [];
    });
}

function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        boards: localData.boards,
        threads: localData.threads,
        posts: localData.posts
    }));
}

function genId() { return Date.now() + '-' + Math.random().toString(36).substring(2, 8); }

function tripcodeEncode(name) {
    if(!name || !name.includes('#')) return name || 'Anonymous';
    let parts = name.split('#');
    if(parts.length < 2) return name;
    let tripRaw = parts[parts.length-1];
    let hash = 0;
    for(let i=0;i<tripRaw.length;i++) hash = ((hash<<5)-hash)+tripRaw.charCodeAt(i) | 0;
    let tripStr = Math.abs(hash).toString(16).substring(0,6);
    let displayName = parts.slice(0,-1).join('#') || 'Anonymous';
    return `${displayName} !${tripStr}`;
}

async function createPost(board, threadId, subject, comment, nameRaw, imageFile, sage, isOp) {
    let postId = genId();
    let tripDisplay = tripcodeEncode(nameRaw);
    let imageUrl = null;
    if(imageFile && imageFile.size) {
        const reader = await new Promise((res) => {
            let fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(imageFile);
        });
        imageUrl = reader;
    }
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
        image: imageUrl,
        replies: []
    };
    
    if(isSupabaseActive && supabaseClient) {
        try {
            const { data, error } = await supabaseClient.from('posts').insert([post]).select();
            if(error) throw error;
            if(data && data[0]) return data[0];
            return post;
        } catch(e) { 
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
        if(isOp) {
            if(!localData.threads[board]) localData.threads[board] = [];
            if(!localData.threads[board].includes(p.id)) {
                localData.threads[board].unshift(p.id);
            }
        } else {
            if(localData.posts[threadId]) {
                if(!localData.posts[threadId].replies) localData.posts[threadId].replies = [];
                if(!localData.posts[threadId].replies.includes(p.id)) {
                    localData.posts[threadId].replies.push(p.id);
                }
                if(!sage) {
                    let threadArr = localData.threads[board];
                    let idx = threadArr.indexOf(threadId);
                    if(idx !== -1) {
                        threadArr.splice(idx,1);
                        threadArr.unshift(threadId);
                    }
                }
            }
        }
        saveLocal();
    }
}

async function getThreadsForBoard(board) {
    if(isSupabaseActive && supabaseClient) {
        try {
            let { data, error } = await supabaseClient.from('posts').select('*').eq('board', board).eq('isOp', true).order('timestamp', {ascending: false});
            if(error) throw error;
            let threads = data || [];
            for(let t of threads) {
                let { data: replies } = await supabaseClient.from('posts').select('*').eq('threadId', t.id).order('timestamp', {ascending: true});
                t.repliesList = replies || [];
            }
            return threads;
        } catch(e) { 
            console.warn(e);
            return fallbackGetThreads(board);
        }
    } else {
        return fallbackGetThreads(board);
    }
    
    function fallbackGetThreads(b) {
        let threadIds = localData.threads[b] || [];
        let threads = [];
        for(let tid of threadIds) {
            let op = localData.posts[tid];
            if(op) {
                let replies = [];
                if(op.replies) {
                    for(let rid of op.replies) {
                        if(localData.posts[rid]) replies.push(localData.posts[rid]);
                    }
                }
                threads.push({...op, repliesList: replies});
            }
        }
        return threads;
    }
}

async function getRepliesForThread(threadId) {
    if(isSupabaseActive && supabaseClient) {
        try {
            let { data } = await supabaseClient.from('posts').select('*').eq('threadId', threadId).order('timestamp', {ascending: true});
            return data || [];
        } catch(e) {
            return fallbackGetReplies(threadId);
        }
    } else {
        return fallbackGetReplies(threadId);
    }
    
    function fallbackGetReplies(tid) {
        let op = localData.posts[tid];
        if(!op) return [];
        let replies = [];
        if(op.replies) {
            for(let rid of op.replies) {
                if(localData.posts[rid]) replies.push(localData.posts[rid]);
            }
        }
        return replies;
    }
}

function escapeHtml(str) { 
    if(!str) return ''; 
    return str.replace(/[&<>]/g, function(m){
        if(m==='&') return '&amp;'; 
        if(m==='<') return '&lt;'; 
        if(m==='>') return '&gt;'; 
        return m;
    }); 
}

function parseQuotes(html) {
    let regex = />>(\d+)/g;
    return html.replace(regex, (match, p1) => {
        return `<a href="#" class="quote-link" data-ref="${p1}">&gt;&gt;${p1}</a>`;
    });
}

function renderPost(post, isOp, showReplyLink=true, threadRootId=null) {
    let header = `<div class="post-header">
        <span class="post-number">No.${String(post.id).slice(-6)}</span>
        <span>${escapeHtml(post.name || 'Anonymous')}</span>
        ${post.sage ? '<span class="sage-badge">[Sage]</span>' : ''}
        <span>${new Date(post.timestamp).toLocaleString()}</span>
        ${post.subject ? `<span>📌 ${escapeHtml(post.subject)}</span>` : ''}
    </div>`;
    let content = parseQuotes(escapeHtml(post.comment || ''));
    let imageHtml = '';
    if(post.image) {
        imageHtml = `<div class="attachment"><img src="${post.image}" class="thumb-img" data-fullimg="${post.image}" onclick="window.showFullImage(this)"></div>`;
    }
    let replyHtml = '';
    if(showReplyLink && !isOp && threadRootId) {
        replyHtml = `<div class="reply-link" data-thread="${threadRootId}" data-replyto="${post.id}">🔗 Reply to this post</div>`;
    }
    return `<div class="${isOp ? 'op-post' : 'reply-post'}" id="post-${post.id}">
        ${header}
        <div class="post-content">${content || '<em>...</em>'}</div>
        ${imageHtml}
        ${replyHtml}
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

async function renderBoardView() {
    currentThreadId = null;
    document.getElementById('boardTitle').innerHTML = `/${currentBoard}/ - ${boardNameMap[currentBoard] || currentBoard.toUpperCase()}`;
    let threads = await getThreadsForBoard(currentBoard);
    let container = document.getElementById('threadsContainer');
    if(!threads || !threads.length) {
        container.innerHTML = `<div style="padding: 32px; text-align:center; border:1px solid #2a4a3a;">✨ No threads yet. Create the first one.</div>`;
        return;
    }
    let html = '';
    for(let thread of threads) {
        let opHtml = renderPost(thread, true, false);
        let repliesHtml = '';
        let repliesList = thread.repliesList || [];
        for(let reply of repliesList.slice(0,5)) {
            repliesHtml += renderPost(reply, false, true, thread.id);
        }
        let moreLink = '';
        if(repliesList.length > 5) moreLink = `<div style="padding: 6px 18px;"><a href="#" class="quote-link" data-threadid="${thread.id}" data-viewthread="1">View all ${repliesList.length} replies →</a></div>`;
        html += `<div class="thread" data-thread="${thread.id}">
            ${opHtml}
            <div id="repliesContainer-${thread.id}">${repliesHtml}</div>
            ${moreLink}
            <div style="padding: 8px 18px 12px 18px;"><button class="quick-reply-btn" data-thread="${thread.id}">Reply to thread</button></div>
        </div>`;
    }
    container.innerHTML = html;
    attachThreadEvents();
}

async function renderThreadView(threadId) {
    currentThreadId = threadId;
    let threads = await getThreadsForBoard(currentBoard);
    let opPost = threads.find(t => t.id === threadId);
    if(!opPost) { 
        renderBoardView(); 
        return; 
    }
    let allReplies = await getRepliesForThread(threadId);
    let container = document.getElementById('threadsContainer');
    let opHtml = renderPost(opPost, true, false);
    let repliesHtml = '';
    for(let r of allReplies) {
        if(!r.isOp) repliesHtml += renderPost(r, false, true, threadId);
    }
    let backBtn = `<div style="margin-bottom: 16px;"><button id="backToBoardBtn">← Back to /${currentBoard}/</button></div>`;
    let replyFormInline = `<div class="post-form" style="margin-top: 20px;" id="inlineReplyForm">
        <div class="form-row"><input type="text" id="inlineName" placeholder="Name / tripcode (#key)" style="flex:1"><input type="text" id="inlineSubject" placeholder="Subject"></div>
        <textarea id="inlineComment" placeholder="Comment..."></textarea>
        <div class="form-row"><input type="file" id="inlineImage" accept="image/*"></div>
        <div class="sage-check"><input type="checkbox" id="inlineSage"><label>Sage</label></div>
        <button id="submitInlineReply">Post reply</button>
    </div>`;
    container.innerHTML = backBtn + `<div class="thread" data-thread="${threadId}">${opHtml}${repliesHtml}</div>` + replyFormInline;
    
    document.getElementById('backToBoardBtn').onclick = () => { currentThreadId = null; renderBoardView(); };
    document.getElementById('submitInlineReply').onclick = async () => {
        let name = document.getElementById('inlineName').value;
        let subject = document.getElementById('inlineSubject').value;
        let comment = document.getElementById('inlineComment').value;
        let imageFile = document.getElementById('inlineImage').files[0];
        let sage = document.getElementById('inlineSage').checked;
        if(!comment.trim()) {
            alert('Comment cannot be empty');
            return;
        }
        await createPost(currentBoard, threadId, subject, comment, name, imageFile, sage, false);
        renderThreadView(threadId);
    };
    attachQuoteLinks();
}

function attachThreadEvents() {

    document.querySelectorAll('.quick-reply-btn').forEach(btn => {
        btn.onclick = async (e) => {
            e.stopPropagation();
            let tid = btn.getAttribute('data-thread');
            let name = prompt("Name (optional, #trip)");
            let comment = prompt("Reply content:");
            if(comment && comment.trim()) {
                await createPost(currentBoard, tid, '', comment, name, null, false, false);
                if(currentThreadId === tid) await renderThreadView(tid);
                else await renderBoardView();
            }
        };
    });
    

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
            let threadId = el.getAttribute('data-thread');
            let replyToId = el.getAttribute('data-replyto');
            if(threadId && replyToId) {
                const replyForm = document.getElementById('inlineReplyForm');
                if(replyForm) {
                    const commentField = document.getElementById('inlineComment');
                    if(commentField) {
                        commentField.value = `>>${replyToId}\n${commentField.value}`;
                    }
                    replyForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    renderThreadView(threadId).then(() => {
                        setTimeout(() => {
                            const commentField = document.getElementById('inlineComment');
                            if(commentField) {
                                commentField.value = `>>${replyToId}\n`;
                                commentField.focus();
                            }
                        }, 100);
                    });
                }
            }
        };
    });
    
    attachQuoteLinks();
}

function attachQuoteLinks() {
    document.querySelectorAll('.quote-link').forEach(el => {
        el.removeEventListener('click', el._listener);
        el._listener = (e) => {
            e.preventDefault();
            let ref = el.getAttribute('data-ref');
            if(ref) {
                let targetPost = document.getElementById(`post-${ref}`);
                if(targetPost) {
                    targetPost.scrollIntoView({behavior: 'smooth', block: 'center'});
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
    let boards = ['b','k','pol','prog','game','hist','str','dev'];
    let navDiv = document.getElementById('boardList');
    navDiv.innerHTML = boards.map(b => `<div class="board-badge ${currentBoard===b?'active':''}" data-board="${b}">/${b}/</div>`).join('');
    document.querySelectorAll('.board-badge').forEach(el => {
        el.onclick = async () => {
            currentBoard = el.getAttribute('data-board');
            currentThreadId = null;
            renderBoardNav();
            await renderBoardView();
        };
    });
}
document.getElementById('createThreadBtn').onclick = async () => {
    let name = document.getElementById('postName').value;
    let subject = document.getElementById('postSubject').value;
    let comment = document.getElementById('postComment').value;
    let imageFile = document.getElementById('postImage').files[0];
    let sage = document.getElementById('sageMode').checked;
    
    if(!comment.trim()) {
        alert('Comment cannot be empty');
        return;
    }
    
    let newThreadId = genId();
    await createPost(currentBoard, newThreadId, subject, comment, name, imageFile, sage, true);
    
    document.getElementById('postComment').value = '';
    document.getElementById('postSubject').value = '';
    document.getElementById('postName').value = '';
    document.getElementById('postImage').value = '';
    document.getElementById('sageMode').checked = false;
    
    if(currentThreadId === null) await renderBoardView();
    else await renderBoardView();
};

loadLocal();
renderBoardNav();
renderBoardView();