// ============================================================
// Wiktionary Audio Linker - Official Tamil Wiktionary Format
// தமிழ் விக்சனரி சொற்களுக்குக் குறிப்பிட்ட மரபுச் சட்டகத்தில்
// {{ஒலிக்கோப்பு-தமிழ்|...}} வார்ப்புருவுடன் ஒலிப்பு இணைக்கும் கருவி
// Author: Dr. Sathiyaraj Thangasamy (Neyakkoo)
// ============================================================

(function () {
    'use strict';

    // 1. முதன்மைப் பெயர்வெளியில் (Main Namespace) உள்ள சொல் பக்கங்களில் மட்டுமே இயங்கும்
    if (mw.config.get('wgNamespaceNumber') !== 0) return;

    const currentWord = mw.config.get('wgTitle'); // தற்போதைய பக்கத்தின் சொல்
    const SCRIPT_RE   = /[\u0B80-\u0BFF]/;        // தமிழ் எழுத்துக்கள் சரிபார்ப்பு

    if (!SCRIPT_RE.test(currentWord)) return;

    // 2. பக்கத்தின் உள்ளடக்கத்தைச் சரிபார்த்தல்
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

            // ஏற்கனவே ஒலிப்புக் கோப்பு அல்லது வார்ப்புரு இருந்தால் இயங்காது
            if (content.includes('{{ஒலிக்கோப்பு-தமிழ்') || content.includes('{{audio|') || content.includes('{{ஒலிப்பு|')) {
                console.log('இந்தச் சொல் பக்கத்தில் ஏற்கனவே ஒலிப்புக் கோப்பு வார்ப்புரு உள்ளது.');
                return;
            }

            // 3. விக்கிப் பொதுவகத்தில் (Commons) கோப்பு உள்ளதா எனத் தேடுதல்
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

            // 4. கோப்பு இருந்தால் பொத்தானைக் காட்டுதல்
            if (matchedFile) {
                showAudioNoticeButton(matchedFile, content, wtApi);
            }

        } catch (e) {
            console.warn('ஒலிப்புக் கோப்புத் தேடலில் பிழை:', e);
        }
    }

    // 5. குறிப்பிட்ட மரபுச் சட்டகத்தில் இணைக்கும் பொத்தான்
    function showAudioNoticeButton(fileName, currentContent, wtApi) {
        const btn = $('<button>', {
            id: 'wikt-single-audio-btn',
            type: 'button',
            title: `பொதுவகக் கோப்பு: ${fileName}`
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

            const targetAudioTemplate = `{{ஒலிக்கோப்பு-தமிழ்|இந்தியா}}`;
            let newContent = currentContent;

            // பிழையான உரை வடிவங்கள் இருந்தால் நீக்குதல்
            newContent = newContent.replace(/\*\s*Ta-[^\n]+\(கோப்பு\)/gi, '');

            // =={{மொழி|ta}}== தலைப்பு இருந்தால் அதன் கீழ் உடனே வைத்தல்
            if (newContent.includes('=={{மொழி|ta}}==')) {
                newContent = newContent.replace('=={{மொழி|ta}}==', `=={{மொழி|ta}}==\n\n${targetAudioTemplate}`);
            } 
            // '== {{மொழி|ta}} ==' இடைவெளிகளுடன் இருந்தால்
            else if (newContent.includes('== {{மொழி|ta}} ==')) {
                newContent = newContent.replace('== {{மொழி|ta}} ==', `== {{மொழி|ta}} ==\n\n${targetAudioTemplate}`);
            } 
            // '=== ஒலிப்பு ===' பகுதி இருந்தால்
            else if (newContent.includes('=== ஒலிப்பு ===')) {
                newContent = newContent.replace('=== ஒலிப்பு ===', `=== ஒலிப்பு ===\n* ${targetAudioTemplate}`);
            } 
            // எதுவுமில்லையெனில் பக்கத்தின் தொடக்கத்திலேயே அமைத்தல்
            else {
                newContent = `=={{மொழி|ta}}==\n\n${targetAudioTemplate}\n\n` + newContent;
            }

            try {
                await wtApi.postWithToken('csrf', {
                    action: 'edit',
                    title: currentWord,
                    text: newContent,
                    summary: `விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்பு இணைக்கப்பட்டது: {{ஒலிக்கோப்பு-தமிழ்|${fileName}}}`
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

    $(document).ready(checkAndLinkAudio);
})();
