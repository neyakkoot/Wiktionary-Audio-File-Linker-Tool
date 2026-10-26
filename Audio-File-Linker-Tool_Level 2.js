// ============================================================
// Wiktionary Audio File Linker Tool (Fast Edition)
// தமிழ் விக்சனரி சொற்களுக்கு விக்கிப் பொதுவகத்திலிருந்து நொடிகளில் ஒலிப்புக் கோப்புகளை இணைக்கும் கருவி
// ============================================================

(function () {
    'use strict';

    const SCRIPT_RE = /[\u0B80-\u0BFF]/; // தமிழ் எழுத்துக்கள்
    const LOGO_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00a38f" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#00a38f"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';

    // 1. பக்கத்தில் உள்ள தமிழ்ச் சொற்களைப் பிரித்தல்
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

    // 2. ஒரே தேடலில் அதிவேகமாக விக்கிப் பொதுவகத்தில் தேடுதல் (Batch Search)
    async function searchCommonsAudioFilesFast(words) {
        if (!words.length) return [];

        const commonsApi = new mw.ForeignApi('https://commons.wikimedia.org/w/api.php');
        
        // சொற்களை OR குறியீட்டுடன் சேர்த்து ஒரே API அழைப்பாக அனுப்புதல்
        const queryTerms = words.map(w => `"${w}"`).join(' OR ');
        const searchQuery = `filetype:audio (${queryTerms})`;

        try {
            const res = await commonsApi.get({
                action: 'query',
                list: 'search',
                srsearch: searchQuery,
                srnamespace: 6,
                srlimit: 50, // அதிகபட்ச கோப்புகளை ஒரே நேரத்தில் எடுத்தல்
                format: 'json'
            });

            const hits = (res && res.query && res.query.search) || [];
            const matchedResults = [];

            // பெறப்பட்ட முடிவுகளைச் சொற்களோடு வேகமாகப் பொருத்துதல்
            words.forEach(word => {
                const matchedFile = hits.find(item => 
                    item.title.toLowerCase().includes(word.toLowerCase())
                );
                if (matchedFile) {
                    matchedResults.push({
                        word: word,
                        fileName: matchedFile.title.replace(/^File:/i, '')
                    });
                }
            });

            return matchedResults;

        } catch (e) {
            console.warn('Fast Audio Search Failed:', e);
            return [];
        }
    }

    // 3. விக்சனரிப் பக்கத்தில் ஒலிப்புக் கோப்பைச் சேர்த்தல்
    async function appendAudioToWiktionaryPage(word, fileName) {
        const wtApi = new mw.Api();
        try {
            const pageData = await wtApi.get({
                action: 'query', prop: 'revisions', rvprop: 'content', titles: word, formatversion: 2
            });

            if (!pageData.query || !pageData.query.pages || pageData.query.pages[0].missing) {
                return { success: false, reason: 'பக்கம் இல்லை' };
            }

            let content = pageData.query.pages[0].revisions[0].content;

            if (content.includes(fileName) || content.includes('{{audio|')) {
                return { success: false, reason: 'ஏற்கனவே உள்ளது' };
            }

            const audioWikitext = `\n* {{audio|ta|${fileName}|ஒலிப்பு}}\n`;

            if (content.includes('=== ஒலிப்பு ===')) {
                content = content.replace('=== ஒலிப்பு ===', `=== ஒலிப்பு ===${audioWikitext}`);
            } else if (content.includes('=== பொருள் ===')) {
                content = content.replace('=== பொருள் ===', `=== ஒலிப்பு ===${audioWikitext}\n=== பொருள் ===`);
            } else {
                content = audioWikitext + content;
            }

            await wtApi.postWithToken('csrf', {
                action: 'edit',
                title: word,
                text: content,
                summary: `விக்கிப் பொதுவக ஒலிப்புக் கோப்பு இணைக்கப்பட்டது: [[File:${fileName}]]`
            });

            return { success: true };
        } catch (err) {
            return { success: false, reason: err.message || err };
        }
    }

    // 4. மேல்தோன்றும் உரையாடல் பெட்டி (Modal UI)
    function showAudioModal(matches) {
        $('#wikt-audio-modal-overlay').remove();

        const overlay = $('<div>', { id: 'wikt-audio-modal-overlay' }).css({
            'position': 'fixed', 'top': '0', 'left': '0', 'width': '100%', 'height': '100%',
            'background': 'rgba(0,0,0,0.5)', 'z-index': '10000', 'display': 'flex',
            'align-items': 'center', 'justify-content': 'center', 'font-family': 'sans-serif'
        });

        const dialog = $('<div>').css({
            'background': '#fff', 'width': '550px', 'max-width': '95%', 'max-height': '80vh',
            'overflow-y': 'auto', 'padding': '20px', 'border-radius': '8px',
            'box-shadow': '0 4px 15px rgba(0,0,0,0.3)'
        });

        const title = $('<h3>').css({ 'margin-top': '0', 'color': '#00a38f', 'border-bottom': '2px solid #00a38f', 'padding-bottom': '8px' })
            .html(`${LOGO_SVG} கண்டறியப்பட்ட கோப்புகள் (${matches.length})`);

        const listContainer = $('<div>').css({ 'margin': '15px 0', 'max-height': '300px', 'overflow-y': 'auto' });

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
                    $(this).prop('disabled', true).text('சேர்க்கிறது...');
                    const res = await appendAudioToWikitionaryPage(item.word, item.fileName);
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
            'padding': '6px 14px', 'background': '#72777d', 'color': '#fff',
            'border': 'none', 'border-radius': '4px', 'cursor': 'pointer', 'float': 'right'
        }).on('click', () => overlay.remove());

        dialog.append(title, listContainer, closeBtn);
        overlay.append(dialog);
        $('body').append(overlay);
    }

    // 5. கருவி இயக்கம்
    async function processAudioLinking() {
        const words = extractWordsFromPage();
        if (!words.length) {
            alert('இப்பக்கத்தில் சொற்கள் எதுவும் கண்டறியப்படவில்லை.');
            return;
        }

        const $btn = $('#wikt-audio-link-btn');
        $btn.html('தேடப்படுகிறது...').prop('disabled', true);

        // அதிவேகத் தேடல்
        const matches = await searchCommonsAudioFilesFast(words);

        $btn.html(`${LOGO_SVG} ஒலிப்புக் கோப்பு இணை`).prop('disabled', false);

        if (!matches.length) {
            alert('இப்பக்கத்துச் சொற்களுக்கு விக்கிப் பொதுவகத்தில் ஒலிப்புக் கோப்புகள் எதுவும் கிடைக்கவில்லை.');
            return;
        }

        showAudioModal(matches);
    }

    function addAudioLinkButton() {
        if ($('#wikt-audio-link-btn').length > 0) return;

        const btn = $('<button>', {
            id: 'wikt-audio-link-btn',
            type: 'button',
            title: 'சொற்களுக்கான ஒலிப்புக் கோப்புகளை அதிவேகமாகத் தேடு'
        })
        .html(`${LOGO_SVG} <span style="vertical-align:middle;margin-left:4px;">ஒலிப்புக் கோப்பு இணை</span>`)
        .css({
            'margin': '8px 5px', 'padding': '5px 10px',
            'background-color': '#fff', 'color': '#00a38f',
            'border': '1px solid #00a38f', 'border-radius': '6px',
            'cursor': 'pointer', 'font-size': '13px', 'display': 'inline-flex', 'align-items': 'center'
        })
        .on('click', processAudioLinking);

        const $target = $('#firstHeading').length ? $('#firstHeading') : $('#bodyContent');
        $target.first().append(btn);
    }

    mw.loader.using(['mediawiki.api', 'mediawiki.ForeignApi', 'jquery'], function () {
        $(document).ready(addAudioLinkButton);
    });
})();
