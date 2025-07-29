(function() {
    'use strict';
    
    let currentUrl = '';
    let currentComments = [];
    let observer = null;
    let sortObserver = null;
    let interceptedComments = null;
    let lastInterceptTime = 0;
    
    // URL 패턴 매칭
    const URL_PATTERNS = {
        project: /^https:\/\/playentry\.org\/project\/([a-f0-9]+)$/,
        qna: /^https:\/\/playentry\.org\/community\/qna\/([a-f0-9]+)$/,
        tips: /^https:\/\/playentry\.org\/community\/tips\/([a-f0-9]+)$/,
        groupCommunity: /^https:\/\/playentry\.org\/group\/community\/([a-f0-9]+)\/([a-f0-9]+)/
    };
    
    // GraphQL 쿼리
    const COMMENTS_QUERY = `
    query SELECT_COMMENTS(
    $pageParam: PageParam
    $target: String
    $searchAfter: JSON
    $likesLength: Int
    $groupId: ID
){
        commentList(
    pageParam: $pageParam
    target: $target
    searchAfter: $searchAfter
    likesLength: $likesLength
    groupId: $groupId
) {
            total
            searchAfter
            likesLength
            list {
                
    id
    user {
        
    id
    nickname
    profileImage {
        
    id
    name
    label {
        
    ko
    en
    ja
    vn

    }
    filename
    imageType
    dimension {
        
    width
    height

    }
    trimmed {
        filename
        width
        height
    }

    }
    status {
        following
        follower
    }
    description
    role
    mark {
        
    id
    name
    label {
        
    ko
    en
    ja
    vn

    }
    filename
    imageType
    dimension {
        
    width
    height

    }
    trimmed {
        filename
        width
        height
    }
 
    }

    }
    content
    created
    removed
    blamed
    blamedBy
    commentsLength
    likesLength
    isLike
    hide
    pinned
    image {
        
    id
    name
    label {
        
    ko
    en
    ja
    vn

    }
    filename
    imageType
    dimension {
        
    width
    height

    }
    trimmed {
        filename
        width
        height
    }

    }
    sticker {
        
    id
    name
    label {
        
    ko
    en
    ja
    vn

    }
    filename
    imageType
    dimension {
        
    width
    height

    }
    trimmed {
        filename
        width
        height
    }

    }

            }
        }
    }
`;
    
    // URL에서 ID 추출
    function extractIdFromUrl(url) {
        for (const [type, pattern] of Object.entries(URL_PATTERNS)) {
            const match = url.match(pattern);
            if (match) {
                if (type === 'groupCommunity') {
                    return { type, id: match[1], groupId: match[2] };
                } else {
                    return { type, id: match[1] };
                }
            }
        }
        return null;
    }
    
    // 페이지에서 필요한 토큰들 추출
    function getTokensFromPage() {
        // CSRF 토큰 추출 (여러 방법 시도)
        let csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
                       document.querySelector('meta[name="_token"]')?.getAttribute('content');
        
        // 스크립트 태그에서 토큰 찾기
        if (!csrfToken) {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent || script.innerHTML;
                const csrfMatch = content.match(/csrf[_-]?token["']?\s*:\s*["']([^"']+)["']/i);
                if (csrfMatch) {
                    csrfToken = csrfMatch[1];
                    break;
                }
            }
        }
        
        // x-token 추출 (여러 방법 시도)
        let xToken = '';
        
        // 1. 로컬스토리지에서 찾기
        try {
            const storageKeys = ['entryToken', 'token', 'authToken', 'access_token'];
            for (const key of storageKeys) {
                const tokenData = localStorage.getItem(key);
                if (tokenData) {
                    try {
                        const parsed = JSON.parse(tokenData);
                        xToken = parsed.token || parsed.access_token || parsed.accessToken || tokenData;
                    } catch {
                        xToken = tokenData;
                    }
                    if (xToken) break;
                }
            }
        } catch (e) {
            // console.warn('로컬스토리지 토큰 추출 실패:', e);
        }
        
        // 2. 세션스토리지에서 찾기
        if (!xToken) {
            try {
                const storageKeys = ['entryToken', 'token', 'authToken', 'access_token'];
                for (const key of storageKeys) {
                    const tokenData = sessionStorage.getItem(key);
                    if (tokenData) {
                        try {
                            const parsed = JSON.parse(tokenData);
                            xToken = parsed.token || parsed.access_token || parsed.accessToken || tokenData;
                        } catch {
                            xToken = tokenData;
                        }
                        if (xToken) break;
                    }
                }
            } catch (e) {
                // console.warn('세션스토리지 토큰 추출 실패:', e);
            }
        }
        
        // 3. 쿠키에서 찾기
        if (!xToken) {
            try {
                const cookies = document.cookie.split(';');
                for (const cookie of cookies) {
                    const [name, value] = cookie.trim().split('=');
                    if (['token', 'x-token', 'authToken', 'access_token'].includes(name)) {
                        xToken = decodeURIComponent(value);
                        break;
                    }
                }
            } catch (e) {
                // console.warn('쿠키 토큰 추출 실패:', e);
            }
        }
        
        // 4. 스크립트에서 토큰 찾기
        if (!xToken) {
            try {
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const content = script.textContent || script.innerHTML;
                    const tokenMatch = content.match(/[x-]?token["']?\s*:\s*["']([^"']+)["']/i);
                    if (tokenMatch) {
                        xToken = tokenMatch[1];
                        break;
                    }
                }
            } catch (e) {
                // console.warn('스크립트 토큰 추출 실패:', e);
            }
        }
        
        return { csrfToken, xToken };
    }
    
    // 정렬 옵션 감지
    function getCurrentSortOption() {
        const sortSpan = document.querySelector('.css-2hcz3y.erhmwsd0 span');
        if (!sortSpan) return { sort: 'created', order: -1 };
        
        const sortText = sortSpan.textContent.trim();
        
        switch (sortText) {
            case '최신순':
                return { sort: 'created', order: -1 };
            case '등록순':
                return { sort: 'created', order: 1 };
            case '좋아요순':
                return { sort: 'likesLength', order: -1 };
            default:
                return { sort: 'created', order: -1 };
        }
    }
    
    // 댓글 데이터 요청
    async function fetchComments(targetId, groupId = null, searchAfter = null, retryCount = 0) {
        const { csrfToken, xToken } = getTokensFromPage();
        const { sort, order } = getCurrentSortOption();
        
        if (!csrfToken || !xToken) {
            // console.warn(`토큰을 찾을 수 없습니다. CSRF: ${!!csrfToken}, X-Token: ${!!xToken}`);
            
            // 가로챈 댓글 데이터가 있다면 사용
            const intercepted = useInterceptedComments();
            if (intercepted) {
                return intercepted;
            }
            
            // 토큰이 없으면 잠시 후 재시도 (최대 3번)
            if (retryCount < 3) {
                console.log(`토큰 재시도 ${retryCount + 1}/3`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return fetchComments(targetId, groupId, searchAfter, retryCount + 1);
            }
            return null;
        }
        
        // 현재 DOM에 있는 댓글 수에 맞춰 display 수 조정
        const currentCommentCount = document.querySelectorAll('.css-1m3ba66.e1fqckzt0 > li.css-zdw2xm.e19b9x4q0').length;
        const displayCount = Math.max(5, currentCommentCount + 5); // 최소 5개, 현재 + 5개
        
        const variables = {
            target: targetId,
            pageParam: {
                display: displayCount,
                sort: sort,
                order: order
            }
        };
        
        if (groupId) {
            variables.groupId = groupId;
        }
        
        if (searchAfter) {
            variables.searchAfter = searchAfter;
        }
        
        console.log('댓글 요청:', { targetId, groupId, variables, hasTokens: { csrfToken: !!csrfToken, xToken: !!xToken } });
        
        try {
            const response = await fetch("https://playentry.org/graphql/SELECT_COMMENTS", {
                headers: {
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.8",
                    "content-type": "application/json",
                    "csrf-token": csrfToken,
                    "priority": "u=1, i",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Brave\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"Linux\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "sec-gpc": "1",
                    "x-client-type": "Client",
                    "x-token": xToken
                },
                referrer: window.location.href,
                body: JSON.stringify({
                    query: COMMENTS_QUERY,
                    variables: variables
                }),
                method: "POST",
                mode: "cors",
                credentials: "include"
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.errors) {
                // console.error('GraphQL 에러:', data.errors);
                return null;
            }
            
            console.log('댓글 데이터 수신:', data.data?.commentList?.list?.length || 0, '개');
            return data.data?.commentList;
        } catch (error) {
            // console.error('댓글 데이터 요청 실패:', error);
            
            // 네트워크 에러인 경우 재시도
            if (retryCount < 2 && (error.name === 'TypeError' || error.message.includes('Failed to fetch'))) {
                console.log(`네트워크 재시도 ${retryCount + 1}/3`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return fetchComments(targetId, groupId, searchAfter, retryCount + 1);
            }
            
            return null;
        }
    }
    
    // DOM 요소와 댓글 데이터 매칭
    function matchCommentsToDOM(comments) {
        const commentLis = document.querySelectorAll('.css-1m3ba66.e1fqckzt0 > li.css-zdw2xm.e19b9x4q0');
        
        console.log(`DOM 매칭: ${commentLis.length}개 li, ${comments.length}개 댓글 데이터`);
        
        let matchedCount = 0;
        
        comments.forEach((comment, index) => {
            const li = commentLis[index];
            if (li && comment.id) {
                const existingId = li.getAttribute('data-post-id');
                
                // 기존 ID와 다른 경우에만 업데이트 (DOM 변경 최소화)
                if (existingId !== comment.id) {
                    li.setAttribute('data-post-id', comment.id);
                    console.log(`매칭 완료 [${index}]: ${comment.id}`);
                }
                matchedCount++;
            } else if (!li) {
                // console.warn(`DOM 요소 부족: 인덱스 ${index}에 대응하는 li 없음`);
            } else if (!comment.id) {
                // console.warn(`댓글 ID 없음: 인덱스 ${index}`);
            }
        });
        
        // 추가된 DOM 요소가 있는지 확인 (댓글 데이터보다 li가 많은 경우)
        if (commentLis.length > comments.length) {
            // console.warn(`매칭되지 않은 DOM 요소 ${commentLis.length - comments.length}개 발견`);
            
            // 매칭되지 않은 요소들의 기존 data-post-id 제거
            for (let i = comments.length; i < commentLis.length; i++) {
                const li = commentLis[i];
                if (li.hasAttribute('data-post-id')) {
                    li.removeAttribute('data-post-id');
                    console.log(`매칭되지 않은 요소의 ID 제거: 인덱스 ${i}`);
                }
            }
        }
        
        console.log(`총 ${matchedCount}개 댓글 매칭 완료`);
    }
    
    // 댓글 리스트 변경 감지 및 처리
    function setupCommentObserver(targetId, groupId = null) {
        if (observer) {
            observer.disconnect();
        }
        
        const commentContainer = document.querySelector('.css-1m3ba66.e1fqckzt0');
        if (!commentContainer) {
            // 댓글 컨테이너가 아직 로드되지 않은 경우 잠시 후 재시도
            setTimeout(() => setupCommentObserver(targetId, groupId), 1000);
            return;
        }
        
        observer = new MutationObserver(async (mutations) => {
            let shouldFetch = false;
            
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    // 새로운 댓글이 추가되었는지 확인
                    if (mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && 
                                node.classList?.contains('css-zdw2xm')) {
                                shouldFetch = true;
                                break;
                            }
                        }
                    }
                }
            });
            
            if (shouldFetch) {
                await handleCommentsUpdate(targetId, groupId);
            }
        });
        
        observer.observe(commentContainer, {
            childList: true,
            subtree: true
        });
    }
    
    // 정렬 옵션 변경 감지
    function setupSortObserver(targetId, groupId = null) {
        if (sortObserver) {
            sortObserver.disconnect();
        }
        
        const sortElement = document.querySelector('.css-2hcz3y.erhmwsd0 span');
        if (!sortElement) return;
        
        sortObserver = new MutationObserver(async () => {
            // 정렬 옵션이 변경되면 댓글을 다시 가져옴
            currentComments = [];
            await handleCommentsUpdate(targetId, groupId);
        });
        
        sortObserver.observe(sortElement, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }
    
    // 댓글 업데이트 처리
    async function handleCommentsUpdate(targetId, groupId = null) {
        const currentCommentCount = document.querySelectorAll('.css-1m3ba66.e1fqckzt0 > li.css-zdw2xm.e19b9x4q0').length;
        
        if (currentCommentCount > currentComments.length) {
            // 추가 댓글 요청 - 페이지네이션을 위한 searchAfter 설정
            let searchAfter = null;
            if (currentComments.length > 0) {
                const lastComment = currentComments[currentComments.length - 1];
                // searchAfter는 보통 마지막 댓글의 생성 시간이나 ID를 사용
                searchAfter = {
                    created: lastComment.created,
                    id: lastComment.id
                };
            }
                
            const commentData = await fetchComments(targetId, groupId, searchAfter);
            if (commentData?.list) {
                if (searchAfter && commentData.list.length > 0) {
                    // 중복 제거하면서 추가 댓글을 기존 배열에 합침
                    const existingIds = new Set(currentComments.map(c => c.id));
                    const newComments = commentData.list.filter(c => !existingIds.has(c.id));
                    currentComments = [...currentComments, ...newComments];
                } else {
                    // 새로운 댓글 데이터 (전체 새로고침)
                    currentComments = commentData.list;
                }
                
                matchCommentsToDOM(currentComments);
            }
        } else if (currentCommentCount < currentComments.length) {
            // 댓글이 삭제된 경우 - 전체 새로고침
            const commentData = await fetchComments(targetId, groupId);
            if (commentData?.list) {
                currentComments = commentData.list;
                matchCommentsToDOM(currentComments);
            }
        } else {
            // 댓글 수가 같으면 전체 다시 매칭 (순서 변경 등)
            matchCommentsToDOM(currentComments);
        }
    }
    
    // 페이지 초기화
    async function initializePage() {
        const urlData = extractIdFromUrl(window.location.href);
        if (!urlData) return;
        
        // 기존 옵저버 정리
        if (observer) observer.disconnect();
        if (sortObserver) sortObserver.disconnect();
        
        // 댓글 데이터 초기화
        currentComments = [];
        
        // 페이지가 완전히 로드될 때까지 대기
        const waitForComments = () => {
            return new Promise((resolve) => {
                const checkComments = () => {
                    const commentContainer = document.querySelector('.css-1m3ba66.e1fqckzt0');
                    if (commentContainer) {
                        resolve();
                    } else {
                        setTimeout(checkComments, 500);
                    }
                };
                checkComments();
            });
        };
        
        await waitForComments();
        
        // 초기 댓글 데이터 가져오기
        const commentData = await fetchComments(urlData.id, urlData.groupId);
        if (commentData?.list) {
            currentComments = commentData.list;
            matchCommentsToDOM(currentComments);
        }
        
        // 옵저버 설정
        setupCommentObserver(urlData.id, urlData.groupId);
        setupSortObserver(urlData.id, urlData.groupId);
    }
    
    // URL 변경 감지
    function detectUrlChange() {
        if (currentUrl !== window.location.href) {
            currentUrl = window.location.href;
            
            // URL이 매칭되는 패턴인지 확인
            if (extractIdFromUrl(currentUrl)) {
                setTimeout(initializePage, 500); // 페이지 전환 후 잠시 대기
            }
        }
    }
    
    // 네트워크 요청 가로채기 (백업 방법)
    function setupNetworkInterception() {
        // XMLHttpRequest 가로채기
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._method = method;
            this._url = url;
            return originalXHROpen.apply(this, [method, url, ...args]);
        };
        
        XMLHttpRequest.prototype.send = function(data) {
            if (this._url?.includes('/graphql/SELECT_COMMENTS') && this._method === 'POST') {
                this.addEventListener('load', function() {
                    try {
                        const responseData = JSON.parse(this.responseText);
                        if (responseData.data?.commentList?.list) {
                            console.log('XHR 요청 가로채기: 댓글 데이터 감지');
                            interceptedComments = responseData.data.commentList.list;
                            lastInterceptTime = Date.now();
                        }
                    } catch (e) {
                        // console.warn('XHR 응답 파싱 실패:', e);
                    }
                });
            }
            return originalXHRSend.apply(this, [data]);
        };
        
        // fetch 가로채기
        const originalFetch = window.fetch;
        window.fetch = async function(url, options) {
            const response = await originalFetch.apply(this, [url, options]);
            
            if (url?.includes('/graphql/SELECT_COMMENTS') && options?.method === 'POST') {
                const clonedResponse = response.clone();
                try {
                    const responseData = await clonedResponse.json();
                    if (responseData.data?.commentList?.list) {
                        console.log('Fetch 요청 가로채기: 댓글 데이터 감지');
                        interceptedComments = responseData.data.commentList.list;
                        lastInterceptTime = Date.now();
                    }
                } catch (e) {
                    // console.warn('Fetch 응답 파싱 실패:', e);
                }
            }
            
            return response;
        };
    }
    
    // 가로챈 댓글 데이터 사용 (토큰이 없을 때)
    function useInterceptedComments() {
        if (interceptedComments && (Date.now() - lastInterceptTime < 10000)) { // 10초 이내
            console.log('가로챈 댓글 데이터 사용:', interceptedComments.length, '개');
            return { list: interceptedComments };
        }
        return null;
    }
    
    // 초기화
    function init() {
        currentUrl = window.location.href;
        
        // 네트워크 요청 가로채기 설정
        setupNetworkInterception();
        
        // 페이지 로드 완료 대기
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializePage);
        } else {
            initializePage();
        }
        
        // URL 변경 감지 (SPA 대응)
        setInterval(detectUrlChange, 1000);
        
        // popstate 이벤트도 감지
        window.addEventListener('popstate', () => {
            setTimeout(detectUrlChange, 100);
        });
        
        // pushState, replaceState 오버라이드
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            originalPushState.apply(this, args);
            setTimeout(detectUrlChange, 100);
        };
        
        history.replaceState = function(...args) {
            originalReplaceState.apply(this, args);
            setTimeout(detectUrlChange, 100);
        };
    }
    
    init();
})(); 