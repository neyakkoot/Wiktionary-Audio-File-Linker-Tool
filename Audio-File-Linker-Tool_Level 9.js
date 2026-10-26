// ============================================================
// Wiktionary Audio Recorder & Linker (WebM to OGG via ffmpeg.wasm)
// Author: Dr. Sathiyaraj Thangasamy (Neyakkoo)
// ============================================================

(function () {
    'use strict';

    if (mw.config.get('wgNamespaceNumber') !== 0) return;

    const currentWord = mw.config.get('wgTitle');
    const SCRIPT_RE   = /[\u0B80-\u0BFF]/;

    if (!SCRIPT_RE.test(currentWord)) return;

    let mediaRecorder, audioChunks = [], recordedBlob = null;
    let ffmpegInstance = null;

    // FFmpeg ஐ தேவைப்படும்போது மட்டும் ஏற்றவும்
    async function loadFFmpeg() {
        if (ffmpegInstance) return ffmpegInstance;
        if (typeof FFmpeg === 'undefined') {
            throw new Error('FFmpeg நூலகம் ஏற்றப்படவில்லை. ஸ்கிரிப்ட் இணைப்பைச் சரிபார்க்கவும்.');
        }
        const { createFFmpeg } = FFmpeg;
        ffmpegInstance = createFFmpeg({ log: false });
        await ffmpegInstance.load();
        return ffmpegInstance;
    }

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

            if (content.includes('{{ஒலிக்கோப்பு-தமிழ்') || content.includes('{{audio|') || content.includes('{{ஒலிப்பு|')) {
                console.log('இந்தச் சொல் பக்கத்தில் ஏற்கனவே ஒலிப்புக் கோப்பு உள்ளது.');
                return;
            }

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

            for (const item of hits) {
                const title = item.title.replace(/^File:/i, '');
                if (title.toLowerCase().includes(currentWord.toLowerCase())) {
                    matchedFile = title;
                    break;
                }
            }

            if (matchedFile) {
                showAudioNoticeButton(matchedFile, content, wtApi);
            } else {
                showRecordAudioButton(content, wtApi);
            }

        } catch (e) {
            console.warn('ஒலிப்புக் கோப்புத் தேடலில் பிழை:', e);
        }
    }

    function showAudioNoticeButton(fileName, currentContent, wtApi) {
        const btn = $('<button>', {
            id: 'wikt-single-audio-btn',
            type: 'button',
            title: `பொதுவகக் கோப்பு: ${fileName}`
        })
        .html(`🔊 <b>ஒலிப்புக் கோப்பு இணைக்கவா?</b> (${fileName})`)
        .css({
            'margin-left': '12px', 'padding': '4px 10px', 'background-color': '#00a38f',
            'color': '#ffffff', 'border': 'none', 'border-radius': '5px', 'cursor': 'pointer', 'font-size': '12px'
        })
        .on('click', async function () {
            $(this).prop('disabled', true).text('இணைக்கப்படுகிறது...');
            await updateWiktionaryPage(currentWord, fileName, currentContent, wtApi, $(this));
        });

        $('#firstHeading').append(btn);
    }

    function showRecordAudioButton(currentContent, wtApi) {
        const btn = $('<button>', {
            id: 'wikt-record-audio-btn',
            type: 'button',
            title: 'சொல்லிற்கான புதிய ஒலிப்பை பதிவு செய்'
        })
        .html(`🎙️ <b>ஒலிப்பதிவு செய்</b>`)
        .css({
            'margin-left': '12px', 'padding': '4px 10px', 'background-color': '#d9534f',
            'color': '#ffffff', 'border': 'none', 'border-radius': '5px', 'cursor': 'pointer', 'font-size': '12px'
        })
        .on('click', function () {
            openRecorderModal(currentContent, wtApi);
        });

        $('#firstHeading').append(btn);
    }

    function openRecorderModal(currentContent, wtApi) {
        $('#wikt-recorder-modal').remove();

        const modalHtml = `
            <div id="wikt-recorder-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; display:flex; align-items:center; justify-content:center;">
                <div style="background:#fff; padding:20px; border-radius:8px; width:380px; text-align:center; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
                    <h3 style="margin-top:0; color:#333;">🎙️ ஒலிப்பதிவு: <b>${currentWord}</b></h3>
                    <p style="font-size:13px; color:#666;">ஒலிவாங்கியைக் கொண்டு சொல்லைத் தெளிவாகப் பேசவும்.</p>
                    <div style="margin:15px 0;">
                        <button id="btn-start-rec" style="padding:8px 15px; background:#28a745; color:#fff; border:none; border-radius:4px; cursor:pointer;">▶️ பதிவு தொடங்கு</button>
                        <button id="btn-stop-rec" style="padding:8px 15px; background:#dc3545; color:#fff; border:none; border-radius:4px; cursor:pointer; display:none;">⏹️ நிறுத்து</button>
                    </div>
                    <audio id="rec-preview" controls style="display:none; width:100%; margin-top:10px;"></audio>
                    <div id="rec-status" style="margin-top:10px; font-size:12px; font-weight:bold;"></div>
                    <div style="margin-top:20px; display:flex; justify-content:space-between;">
                        <button id="btn-cancel-rec" style="padding:6px 12px; background:#6c757d; color:#fff; border:none; border-radius:4px; cursor:pointer;">ரத்து செய்</button>
                        <button id="btn-upload-rec" style="padding:6px 12px; background:#007bff; color:#fff; border:none; border-radius:4px; cursor:pointer; display:none;">☁️ பொதுவகத்தில் பதிவேற்று</button>
                    </div>
                </div>
            </div>`;

        $('body').append(modalHtml);

        $('#btn-start-rec').on('click', async function () {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
                mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
                audioChunks = [];

                mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
                mediaRecorder.onstop = async () => {
                    const rawBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
                    
                    // webm என்றால் OGG ஆக மாற்ற வேண்டும்
                    if (mediaRecorder.mimeType.includes('webm')) {
                        $('#rec-status').text('OGG வடிவத்திற்கு மாற்றப்படுகிறது (சிறிது நேரம் ஆகலாம்)...').css('color', '#007bff');
                        $('#btn-upload-rec').prop('disabled', true).hide();
                        
                        try {
                            const ffmpeg = await loadFFmpeg();
                            const arrayBuffer = await rawBlob.arrayBuffer();
                            const uint8Array = new Uint8Array(arrayBuffer);
                            
                            ffmpeg.FS('writeFile', 'input.webm', uint8Array);
                            // libvorbis குறியாக்கியைப் பயன்படுத்தி OGG ஆக மாற்றவும்
                            await ffmpeg.run('-i', 'input.webm', '-acodec', 'libvorbis', '-q:a', '4', 'output.ogg');
                            const oggData = ffmpeg.FS('readFile', 'output.ogg');
                            
                            recordedBlob = new Blob([oggData.buffer], { type: 'audio/ogg' });
                            
                            const audioUrl = URL.createObjectURL(recordedBlob);
                            $('#rec-preview').attr('src', audioUrl).show();
                            $('#btn-upload-rec').prop('disabled', false).show();
                            $('#rec-status').text('OGG வடிவத்திற்கு மாற்றம் வெற்றி! கேட்டுப் பார்த்துப் பதிவேற்றவும்.').css('color', 'green');
                            
                        } catch (err) {
                            console.error("FFmpeg conversion error:", err);
                            $('#rec-status').text(`OGG ஆக மாற்றுவதில் பிழை: ${err.message || 'மீண்டும் முயற்சிக்கவும்.'}`).css('color', 'red');
                            $('#btn-upload-rec').prop('disabled', false).show();
                        }
                    } else {
                        // ஏற்கனவே ogg என்றால் நேரடியாகப் பயன்படுத்தவும்
                        recordedBlob = rawBlob;
                        const audioUrl = URL.createObjectURL(recordedBlob);
                        $('#rec-preview').attr('src', audioUrl).show();
                        $('#btn-upload-rec').show();
                        $('#rec-status').text('ஒலிப்பதிவு முடிந்தது. கேட்டுப் பார்த்துப் பதிவேற்றவும்.').css('color', 'green');
                    }
                };

                mediaRecorder.start();
                $(this).hide();
                $('#btn-stop-rec').show();
                $('#rec-status').text('பதிவாகிறது... பேசுங்கள்!').css('color', 'red');
            } catch (err) {
                alert('ஒலிவாங்கி (Microphone) அனுமதியை வழங்கவும்.');
            }
        });

        $('#btn-stop-rec').on('click', function () {
            mediaRecorder.stop();
            $(this).hide();
            $('#btn-start-rec').show().text('🔄 மீண்டும் பதிவு செய்');
        });

        $('#btn-cancel-rec').on('click', function () {
            $('#wikt-recorder-modal').remove();
        });

        $('#btn-upload-rec').on('click', async function () {
            if (!recordedBlob) return;
            const $btn = $(this);
            $btn.prop('disabled', true).text('பதிவேற்றப்படுகிறது...');
            $('#rec-status').text('விக்கிப் பொதுவகத்தில் பதிவேற்றப்படுகிறது...').css('color', '#007bff');

            // கோப்பு பெயர் எப்போதும் .ogg ஆக இருக்க வேண்டும்
            const fileName = `Ta-${currentWord}.ogg`;
            const result = await uploadToCommons(fileName, recordedBlob);

            if (result.success) {
                $('#rec-status').text(`பதிவேற்றம் வெற்றி! (${result.fileName}) பக்கத்தில் இணைக்கப்படுகிறது...`).css('color', 'green');
                await updateWiktionaryPage(currentWord, result.fileName, currentContent, wtApi);
                $('#wikt-recorder-modal').remove();
            } else {
                $('#rec-status').text(`பதிவேற்றத்தில் பிழை: ${result.error}`).css('color', 'red');
                $btn.prop('disabled', false).text('☁️ மீண்டும் முயற்சி செய்');
            }
        });
    }

    async function uploadToCommons(fileName, fileBlob) {
        try {
            const commonsApi = new mw.ForeignApi('https://commons.wikimedia.org/w/api.php');

            // 1. உள்நுழைவு நிலையைச் சரிபார்க்கவும்
            const userInfo = await commonsApi.get({
                action: 'query',
                meta: 'userinfo',
                format: 'json'
            });
            
            if (!userInfo.query || !userInfo.query.userinfo || userInfo.query.userinfo.anon !== undefined) {
                return { success: false, error: 'பொதுவகத்தில் உள்நுழையவில்லை. தயவுசெய்து முதலில் உள்நுழையவும்.' };
            }

            // 2. CSRF டோக்கனைப் பெறவும்
            const tokenData = await commonsApi.get({
                action: 'query',
                meta: 'tokens',
                format: 'json'
            });
            const csrfToken = tokenData.query.tokens.csrftoken;

            // 3. கோப்புப் பெயர் ஏற்கனவே உள்ளதா எனச் சரிபார்த்து, இருந்தால் தானாக மறுபெயரிடவும்
            let finalFileName = fileName;
            const checkDup = await commonsApi.get({
                action: 'query',
                titles: `File:${fileName}`,
                format: 'json'
            });
            
            if (checkDup.query && checkDup.query.pages && checkDup.query.pages[-1] === undefined) {
                const timestamp = new Date().getTime();
                finalFileName = fileName.replace('.ogg', `_${timestamp}.ogg`);
                console.log(`கோப்பு ஏற்கனவே உள்ளது, தானாக மறுபெயரிடப்பட்டது: ${finalFileName}`);
            }

            // 4. FormData ஐ உருவாக்கவும்
            const formData = new FormData();
            formData.append('action', 'upload');
            formData.append('filename', finalFileName);
            formData.append('token', csrfToken);
            formData.append('comment', `Tamil audio pronunciation for [[ta:${currentWord}]]`);
            formData.append('text', `== {{int:filedesc}} ==\n{{Information\n|description={{ta|1=தமிழ்: ${currentWord} என்பதன் ஒலிப்பு}}\n|date=${new Date().toISOString().split('T')[0]}\n|source={{own}}\n|author=[[User:Neyakkoo|Dr. Sathiyaraj Thangasamy]]\n}}\n\n== {{int:license-header}} ==\n{{CC-BY-SA-4.0}}\n\n[[Category:Tamil pronunciation]]`);
            formData.append('format', 'json');
            formData.append('file', fileBlob, finalFileName);

            // 5. fetch ஐப் பயன்படுத்தி நேரடியாக அனுப்பவும், origin அளவுருவைச் சேர்க்கவும்
            const url = `https://commons.wikimedia.org/w/api.php?origin=${encodeURIComponent(location.origin)}`;
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            const res = await response.json();

            if (res && res.upload && res.upload.result === 'Success') {
                return { success: true, fileName: finalFileName };
            } else {
                console.error('Commons Upload Raw Response:', res);
                let errorMsg = 'தெரியாத பிழை';
                if (res && res.error) {
                    errorMsg = `${res.error.code}: ${res.error.info}`;
                } else if (res && res.upload && res.upload.warnings) {
                    errorMsg = JSON.stringify(res.upload.warnings);
                }
                return { success: false, error: errorMsg };
            }
        } catch (e) {
            console.error('Commons Upload Exception:', e);
            return { success: false, error: e.message || 'பதிவேற்றத்தில் விதிவிலக்கு ஏற்பட்டது' };
        }
    }

    async function updateWiktionaryPage(word, fileName, currentContent, wtApi, $btnUI) {
        const targetAudioTemplate = `{{ஒலிக்கோப்பு-தமிழ்|இந்தியா}}}`;
        let newContent = currentContent;

        newContent = newContent.replace(/\*\s*Ta-[^\n]+\(கோப்பு\)/gi, '');

        if (newContent.includes('=={{மொழி|ta}}==')) {
            newContent = newContent.replace('=={{மொழி|ta}}==', `=={{மொழி|ta}}==\n\n${targetAudioTemplate}`);
        } else if (newContent.includes('== {{மொழி|ta}} ==')) {
            newContent = newContent.replace('== {{மொழி|ta}} ==', `== {{மொழி|ta}} ==\n\n${targetAudioTemplate}`);
        } else if (newContent.includes('=== ஒலிப்பு ===')) {
            newContent = newContent.replace('=== ஒலிப்பு ===', `=== ஒலிப்பு ===\n* ${targetAudioTemplate}`);
        } else {
            newContent = `=={{மொழி|ta}}==\n\n${targetAudioTemplate}\n\n` + newContent;
        }

        try {
            await wtApi.postWithToken('csrf', {
                action: 'edit',
                title: word,
                text: newContent,
                summary: `விக்கிப் பொதுவகத்திலிருந்து ஒலிப்புக் கோப்பு இணைக்கப்பட்டது: {{ஒலிக்கோப்பு-தமிழ்|இந்தியா}}`
            });

            if ($btnUI) $btnUI.css('background-color', '#2e7d32').text('✅ ஒலிப்பு இணைக்கப்பட்டது!');
            setTimeout(() => location.reload(), 1000);
        } catch (err) {
            if ($btnUI) $btnUI.css('background-color', '#c62828').text('❌ பிழை ஏற்பட்டது');
            console.error(err);
        }
    }

    $(document).ready(checkAndLinkAudio);
})();
