// ============================================================
// Wiktionary Audio File Linker Tool
// தமிழ் விக்சனரி சொற்களுக்கு விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்புகளை இணைக்கும் கருவி
// Author: Dr. Sathiyaraj Thangasamy (Neyakkoo) / MediaWiki Assistant
// ============================================================

(function () {
    'use strict';

    const TARGET_LANG = 'ta';
    const SCRIPT_RE   = /[\u0B80-\u0BFF]/; // தமிழ் எழுத்துக்கள்

    // ---------- கருவியின் லோகோ (SVG) ----------
    const LOGO_SIZE = 24;
    const AUDIO_LOGO_SVG = ''
      + '<svg xmlns="http://www.w3.org/2000/svg" width="' + LOGO_SIZE + '" height="' + LOGO_SIZE + '" '
      +     'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
      +     'style="vertical-align:middle;flex-shrink:0;display:inline-block;">'
      +   '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#00a38f" stroke="#00a38f"/>'
      +   '<path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke="#00a38f"/>'
      +   '<path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="#00a38f"/>'
      + '</svg>';

    function buildButtonLabel(text) {
        return '<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;">'
             + AUDIO_LOGO_SVG + ' ' + mw.html.escape(text)
             + '</span>';
    }

    let extractedWordsList = [];
    let audioMatches = [];
    let csrfToken = '';

    // ---------------- 1. பக்கத்திலிருந்து சொற்களைப் பிரித்தெடுத்தல் ----------------
    function extractWordsFromPage() {
        const contentArea = $('#mw-content-text').clone();
        contentArea.find('.printfooter, .mw-editsection, style, script, .no-audio-search').remove();
        
        const foundWords = new Set();
        contentArea.find('a').each(function () {
            const word = $(this).text().trim();
            if (word && SCRIPT_RE.test(word) && !word.includes(':')) {
                foundWords.add(word.normalize('NFC'));
            }
        });

        return Array.from(foundWords);
    }

    // ---------------- 2. விக்கிப் பொதுவகத்தில் (Commons) ஒலிப்புக் கோப்புகளைத் தேடுதல் ----------------
    async function searchCommonsAudioFiles(words) {
        const commonsApi = new mw.ForeignApi('https://commons.wikimedia.org/w/api.php');
        const matchedResults = [];

        for (const word of words) {
            try {
                // LL-Q1378 (Tamil) கோப்புகளை அல்லது பொதுவான தமிழ் ஒலிப்புக் கோப்புகளைத் தேடுதல்
                const searchQueries = [
                    `File:LL-Q1378 (tam)-* -${word}.wav`,
                    `File:LL-Q1378 (tam)-* -${word}.ogg`,
                    `File:Ta-${word}.ogg`,
                    `File:Ta-${word}.wav`,
                    `File:${word}.ogg`,
                    `File:${word}.wav`
                ];

                const searchQuery = `filenamespace:6 "${word}" AND (filetype:audio/ogg OR filetype:audio/wav OR filetype:audio/flac)`;
                
                const res = await commonsApi.get({
                    action: 'query',
                    list: 'search',
                    srsearch: searchQuery,
                    srnamespace: 6,
                    srlimit: 3,
                    format: 'json'
                });

                if (res && res.query && res.query.search && res.query.search.length > 0) {
                    // சரியான சொல் பொருந்துகிறதா எனக் கூர்ந்து சரிபார்த்தல்
                    const matchedFile = res.query.search.find(item => 
                        item.title.toLowerCase().includes(word.toLowerCase())
                    ) || res.query.search[0];

                    if (matchedFile) {
                        const fileName = matchedFile.title.replace(/^File:/i, '');
                        matchedResults.push({ word: word, fileName: fileName });
                    }
                }
            } catch (e) {
                console.warn(`Audio search failed for: ${word}`, e);
            }
        }
        return matchedResults;
    }

    // ---------------- 3. விக்சனரிப் பக்கத்தில் ஒலிப்புக் கோப்பை இணைத்தல் ----------------
    async function appendAudioToWiktionaryPage(word, fileName) {
        const wtApi = new mw.Api();
        
        try {
            const pageData = await wtApi.get({
                action: 'query',
                prop: 'revisions',
                rvprop: 'content',
                titles: word,
                formatversion: 2
            });

            if (!pageData.query || !pageData.query.pages || pageData.query.pages[0].missing) {
                return { success: false, reason: 'பக்கம் கிடைக்கவில்லை' };
            }

            let content = pageData.query.pages[0].revisions[0].content;

            // ஏற்கனவே ஒலிப்புக்கோப்பு உள்ளதா எனச் சரிபார்த்தல்
            if (content.includes(fileName) || content.includes('{{ஒலிப்பு}}') || content.includes('{{audio|')) {
                return { success: false, reason: 'ஏற்கனவே ஒலிப்புக்கோப்பு உள்ளது' };
            }

            // ஒலிப்பு வார்ப்புருவை உருவாக்கம் செய்தல் (Template:audio)
            const audioWikitext = `\n* {{audio|ta|${fileName}|ஒலிப்பு}}\n`;

            // === ஒலிப்பு === அல்லது === பொருள் === தலைப்புக்குக் கீழ் சேர்த்தல்
            if (content.includes('=== ஒலிப்பு ===')) {
                content = content.replace('=== ஒலிப்பு ===', `=== ஒலிப்பு ===${audioWikitext}`);
            } else if (content.includes('=== பொருள் ===')) {
                content = content.replace('=== பொருள் ===', `=== ஒலிப்பு ===${audioWikitext}\n=== பொருள் ===`);
            } else {
                content = audioWikitext + content;
            }

            // புதுப்பித்தல் (Save edit)
            await wtApi.postWithToken('csrf', {
                action: 'edit',
                title: word,
                text: content,
                summary: `விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்பு இணைக்கப்பட்டது: [[File:${fileName}]] (ஒலிப்புக் கருவி வாயிலாக)`
            });

            return { success: true };

        } catch (err) {
            return { success: false, reason: err.message || err };
        }
    }

    // ---------------- 4. பயனர் இடைமுக முகப்புப் பெட்டி (UI Modal) ----------------
    function showAudioModal(matches) {
        $('#wikt-audio-modal-overlay').remove();

        const overlay = $('<div>', { id: 'wikt-audio-modal-overlay' }).css({
            'position': 'fixed', 'top': '0', 'left': '0', 'width': '100%', 'height': '100%',
            'background': 'rgba(0,0,0,0.5)', 'z-index': '10000', 'display': 'flex',
            'align-items': 'center', 'justify-content': 'center', 'font-family': 'sans-serif'
        });

        const dialog = $('<div>').css({
            'background': '#fff', 'width': '600px', 'max-width': '95%', 'max-height': '85vh',
            'overflow-y': 'auto', 'padding': '20px', 'border-radius': '8px',
            'box-shadow': '0 4px 15px rgba(0,0,0,0.3)'
        });

        const title = $('<h3>').css({ 'margin-top': '0', 'color': '#00a38f', 'border-bottom': '2px solid #00a38f', 'padding-bottom': '8px' })
            .html(buildButtonLabel(`கண்டறியப்பட்ட ஒலிப்புக் கோப்புகள் (${matches.length})`));

        const listContainer = $('<div>').css({ 'margin': '15px 0', 'max-height': '350px', 'overflow-y': 'auto' });

        matches.forEach((item, index) => {
            const row = $('<div>').css({
                'display': 'flex', 'align-items': 'center', 'justify-content': 'space-between',
                'padding': '8px', 'border-bottom': '1px solid #eee', 'font-size': '13px'
            }).append(
                $('<span>').html(`<b>${index + 1}. ${item.word}</b> → <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(item.fileName)}" target="_blank">${item.fileName}</a>`),
                $('<button>', { text: 'இணை' }).css({
                    'padding': '4px 10px', 'background': '#0078d7', 'color': '#fff',
                    'border': 'none', 'border-radius': '4px', 'cursor': 'pointer', 'font-size': '12px'
                }).on('click', async function () {
                    $(this).prop('disabled', true).text('இணைக்கப்படுகிறது...');
                    const res = await appendAudioToWiktionaryPage(item.word, item.fileName);
                    if (res.success) {
                        $(this).css('background', 'green').text('இணைக்கப்பட்டது!');
                    } else {
                        $(this).css('background', 'red').text(res.reason || 'பிழை');
                    }
                })
            );
            listContainer.append(row);
        });

        const closeBtn = $('<button>', { text: 'மூடு' }).css({
            'padding': '8px 16px', 'background': '#72777d', 'color': '#fff',
            'border': 'none', 'border-radius': '4px', 'cursor': 'pointer', 'float': 'right'
        }).on('click', () => overlay.remove());

        dialog.append(title, listContainer, closeBtn);
        overlay.append(dialog);
        $('body').append(overlay);
    }

    // ---------------- 5. கருவியை இயக்குதல் (Init & Trigger) ----------------
    async function processAudioLinking() {
        const words = extractWordsFromPage();
        if (!words.length) {
            alert('இப்பக்கத்தில் சொற்கள் எதுவும் கண்டறியப்படவில்லை.');
            return;
        }

        const $btn = $('#wikt-audio-link-btn');
        $btn.html(buildButtonLabel('தேடப்படுகிறது...')).prop('disabled', true);

        const matches = await searchCommonsAudioFiles(words);

        $btn.html(buildButtonLabel('ஒலிப்புக் கோப்பு இணை')).prop('disabled', false);

        if (!matches.length) {
            alert('இப்பக்கத்திலுள்ள சொற்களுக்கு விக்கிப் பொதுவகத்தில் ஒலிப்புக் கோப்புகள் எதுவும் கிடைக்கவில்லை.');
            return;
        }

        showAudioModal(matches);
    }

    function addAudioLinkButton() {
        if ($('#wikt-audio-link-btn').length > 0) return;

        const btn = $('<button>', {
            id: 'wikt-audio-link-btn',
            type: 'button',
            title: 'இப்பக்கச் சொற்களுக்கு விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்புகளைத் தேடி இணை'
        })
        .html(buildButtonLabel('ஒலிப்புக் கோப்பு இணை'))
        .css({
            'margin': '8px 5px', 'padding': '6px 12px',
            'background-color': '#ffffff', 'color': '#00a38f',
            'border': '1px solid #00a38f', 'border-radius': '6px',
            'cursor': 'pointer', 'font-size': '13px',
            'box-shadow': '0 2px 4px rgba(0,0,0,0.1)'
        })
        .on('click', processAudioLinking);

        const $target = $('#firstHeading').length ? $('#firstHeading') : $('#bodyContent');
        $target.first().append(btn);
    }

    function init() {
        if (!mw || !mw.loader) return;
        mw.loader.using(['mediawiki.api', 'mediawiki.ForeignApi', 'jquery'])
            .then(function () {
                $(document).ready(addAudioLinkButton);
            });
    }

    init();
})();
