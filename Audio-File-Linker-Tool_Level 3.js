// ============================================================
// Wiktionary Single Page Audio Auto-Linker
// தற்போதைய விக்சனரிச் சொல் பக்கத்தில் ஒலிப்புக் கோப்பு இல்லையெனில்
// விக்கிப் பொதுவகத்திலிருந்து கண்டறிந்து உடனடியாக இணைக்கும் கருவி
// Author: Dr. Sathiyaraj Thangasamy (Neyakkoo)
// ============================================================

(function () {
    'use strict';

    // 1. முதன்மைப் பெயர்வெளியில் (Main Namespace) உள்ள சொல் பக்கங்களில் மட்டுமே இயங்கும்
    if (mw.config.get('wgNamespaceNumber') !== 0) return;

    const currentWord = mw.config.get('wgTitle'); // தற்போதைய பக்கத்தின் சொல்
    const SCRIPT_RE   = /[\u0B80-\u0BFF]/; // தமிழ் எழுத்துக்கள் சரிபார்ப்பு

    if (!SCRIPT_RE.test(currentWord)) return; // தமிழ் சொல் இல்லை எனில் இயங்காது

    // 2. பக்கத்தின் உள்ளடக்கத்தை ஆய்வு செய்து ஒலிப்புக் கோப்பு உள்ளதா எனப் பார்த்தல்
    async function checkAndLinkAudio() {
        const wtApi = new mw.Api();

        try {
            const pageData = await wtApi.get({
                action: 'query',
                prop: 'revisions',
                rvprop: 'content',
                titles: currentWord,
                formatversion: 2
            });

            if (!pageData.query || !pageData.query.pages || pageData.query.pages[0].missing) return;

            const content = pageData.query.pages[0].revisions[0].content;

            // ஏற்கனவே ஒலிப்புக் கோப்பு அல்லது வார்ப்புரு இருந்தால் கருவி இயங்காது
            if (content.includes('{{audio|') || content.includes('{{ஒலிப்பு}}') || content.includes('.ogg') || content.includes('.wav')) {
                console.log('இந்தச் சொல் பக்கத்தில் ஏற்கனவே ஒலிப்புக் கோப்பு உள்ளது.');
                return;
            }

            // 3. விக்கிப் பொதுவகத்தில் (Commons) ஒலிப்புக் கோப்பைத் தேடுதல்
            const commonsApi = new mw.ForeignApi('https://commons.wikimedia.org/w/api.php');
            const searchQuery = `filetype:audio "${currentWord}"`;

            const res = await commonsApi.get({
                action: 'query',
                list: 'search',
                srsearch: searchQuery,
                srnamespace: 6,
                srlimit: 5,
                format: 'json'
            });

            const hits = (res && res.query && res.query.search) || [];
            let matchedFile = null;

            // சொல் பெயர் சரியாகப் பொருந்தும் கோப்பைக் கண்டறிதல்
            for (const item of hits) {
                const title = item.title.replace(/^File:/i, '');
                if (title.toLowerCase().includes(currentWord.toLowerCase())) {
                    matchedFile = title;
                    break;
                }
            }

            // 4. பொதுவகத்தில் கோப்பு இருந்தால் பக்கத்தில் இணைக்கும் பொத்தானைக் காட்டுதல்
            if (matchedFile) {
                showAudioNoticeButton(matchedFile, content, wtApi);
            }

        } catch (e) {
            console.warn('ஒலிப்புக் கோப்புத் தேடலில் பிழை:', e);
        }
    }

    // 5. ஒலிப்புக் கோப்பு கண்டறியப்பட்டால் தலைப்பிற்கு அருகில் பொத்தான் அமைத்தல்
    function showAudioNoticeButton(fileName, currentContent, wtApi) {
        const btn = $('<button>', {
            id: 'wikt-single-audio-btn',
            type: 'button',
            title: `பொதுவகத்தில் கோப்பு உள்ளது: ${fileName}`
        })
        .html(`🔊 <b>ஒலிப்புக் கோப்பு இணைக்கவா?</b> (${fileName})`)
        .css({
            'margin-left': '12px',
            'padding': '4px 10px',
            'background-color': '#00a38f',
            'color': '#ffffff',
            'border': 'none',
            'border-radius': '5px',
            'cursor': 'pointer',
            'font-size': '12px',
            'box-shadow': '0 2px 4px rgba(0,0,0,0.15)'
        })
        .on('click', async function () {
            const $this = $(this);
            $this.prop('disabled', true).text('இணைக்கப்படுகிறது...');

            const audioWikitext = `\n* {{audio|ta|${fileName}|ஒலிப்பு}}\n`;
            let newContent = currentContent;

            if (newContent.includes('=== ஒலிப்பு ===')) {
                newContent = newContent.replace('=== ஒலிப்பு ===', `=== ஒலிப்பு ===${audioWikitext}`);
            } else if (newContent.includes('=== பொருள் ===')) {
                newContent = newContent.replace('=== பொருள் ===', `=== ஒலிப்பு ===${audioWikitext}\n=== பொருள் ===`);
            } else {
                newContent = audioWikitext + newContent;
            }

            try {
                await wtApi.postWithToken('csrf', {
                    action: 'edit',
                    title: currentWord,
                    text: newContent,
                    summary: `விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்பு இணைக்கப்பட்டது: [[c:File:${fileName}|${fileName}]]`
                });

                $this.css('background-color', '#2e7d32').text('✅ ஒலிப்பு இணைக்கப்பட்டது!');
                setTimeout(() => location.reload(), 1000); // 1 நொடியில் பக்கத்தைப் புதுப்பித்தல்

            } catch (err) {
                $this.css('background-color', '#c62828').text('❌ பிழை ஏற்பட்டது');
                console.error(err);
            }
        });

        $('#firstHeading').append(btn);
    }

    // பக்கம் தயாரானதும் இயங்குதல்
    $(document).ready(checkAndLinkAudio);
})();
