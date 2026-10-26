
/* ============================================================
 * Tamil Wiktionary Audio Recorder & Linker
 * Output format: OGG / Opus
 * Uses opus-media-recorder without direct cross-origin Worker
 * ============================================================ */

(function () {
    'use strict';

    if (!window.mw || !window.$) return;
    if (mw.config.get('wgNamespaceNumber') !== 0) return;

    const WORD = mw.config.get('wgTitle');

    if (!/[\u0B80-\u0BFF]/.test(WORD)) return;

    const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
    const CDN =
        'https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0';

    const AUDIO_TEMPLATE = '{{ஒலிக்கோப்பு-தமிழ்|இந்தியா}}';

    let recorder = null;
    let stream = null;
    let chunks = [];
    let oggBlob = null;
    let previewURL = null;
    let libraryPromise = null;
    let currentPageText = '';

    function status(message, color = '#333') {
        $('#rec-status')
            .text(message)
            .css('color', color);
    }

    function errorText(error) {
        if (!error) return 'தெரியாத பிழை';
        if (error.info) return error.info;
        if (error.message) return error.message;
        return String(error);
    }

    function loadExternalScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = true;

            script.onload = () => resolve();
            script.onerror = () => reject(
                new Error('நூலகத்தை ஏற்ற முடியவில்லை: ' + url)
            );

            document.head.appendChild(script);
        });
    }

    /*
     * IMPORTANT:
     * Load both UMD files as scripts.
     * Do not create a Worker directly from the CDN URL.
     */
    async function loadOggLibrary() {
        if (
            window.OpusMediaRecorder &&
            window.OpusMediaRecorder.encoderWorker
        ) {
            return window.OpusMediaRecorder;
        }

        if (libraryPromise) return libraryPromise;

        libraryPromise = (async () => {
            if (!window.OpusMediaRecorder) {
                await loadExternalScript(
                    CDN + '/OpusMediaRecorder.umd.js'
                );
            }

            if (!window.OpusMediaRecorder) {
                throw new Error(
                    'OpusMediaRecorder நூலகம் கிடைக்கவில்லை.'
                );
            }

            if (!window.OpusMediaRecorder.encoderWorker) {
                await loadExternalScript(
                    CDN + '/encoderWorker.umd.js'
                );
            }

            if (!window.OpusMediaRecorder.encoderWorker) {
                throw new Error(
                    'Encoder Worker ஏற்றப்படவில்லை. ' +
                    'CDN அல்லது விக்சனரியின் பாதுகாப்பு அமைப்பைச் சரிபார்க்கவும்.'
                );
            }

            return window.OpusMediaRecorder;
        })();

        try {
            return await libraryPromise;
        } catch (error) {
            libraryPromise = null;
            throw error;
        }
    }

    function workerOptions() {
        /*
         * encoderWorker.umd.js has already been loaded.
         * The library supplies its own encoderWorker factory.
         */
        return {
            OggOpusEncoderWasmPath:
                CDN + '/OggOpusEncoder.wasm',

            WebMOpusEncoderWasmPath:
                CDN + '/WebMOpusEncoder.wasm'
        };
    }

    function stopStream() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
    }

    function clearPreview() {
        if (previewURL) {
            URL.revokeObjectURL(previewURL);
            previewURL = null;
        }
    }

    function closeModal() {
        try {
            if (recorder && recorder.state !== 'inactive') {
                recorder.stop();
            }
        } catch (error) {
            console.warn(error);
        }

        stopStream();
        clearPreview();

        $('#wikt-audio-modal').remove();

        recorder = null;
        oggBlob = null;
    }

    function styleButton($button, background) {
        $button.css({
            padding: '8px 12px',
            margin: '4px',
            border: '0',
            borderRadius: '5px',
            background: background,
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px'
        });
    }

    async function initialize() {
        try {
            const api = new mw.Api();

            const response = await api.get({
                action: 'query',
                prop: 'revisions',
                rvprop: 'content',
                titles: WORD,
                formatversion: 2
            });

            const page = response?.query?.pages?.[0];

            if (!page || page.missing) return;

            currentPageText = page.revisions?.[0]?.content || '';

            if (hasAudioTemplate(currentPageText)) return;

            addRecordButton();
        } catch (error) {
            console.error('பக்கத்தைச் சரிபார்க்கும் பிழை:', error);
            addRecordButton();
        }
    }

    function hasAudioTemplate(text) {
        return /\{\{\s*(ஒலிக்கோப்பு-தமிழ்|audio|ஒலிப்பு)\b/i
            .test(text || '');
    }

    function addRecordButton() {
        if ($('#wikt-audio-record-button').length) return;

        const $button = $('<button>', {
            id: 'wikt-audio-record-button',
            type: 'button'
        }).text('🎙️ ஒலிப்பதிவு செய்');

        styleButton($button, '#b83232');

        $button.on('click', openModal);

        $('#firstHeading').append($button);
    }

    function openModal() {
        $('#wikt-audio-modal').remove();

        chunks = [];
        oggBlob = null;

        const html = `
        <div id="wikt-audio-modal"
             style="position:fixed;inset:0;z-index:99999;
             background:rgba(0,0,0,.65);display:flex;
             align-items:center;justify-content:center;padding:14px;">
          <div style="background:#fff;color:#222;border-radius:9px;
               padding:22px;width:min(470px,96vw);
               box-shadow:0 4px 20px rgba(0,0,0,.3);">
            <h2 style="text-align:center;margin-top:0;">
              🎙️ ஒலிப்பதிவு: <span id="audio-word"></span>
            </h2>

            <p style="text-align:center;font-size:14px;">
              சொல்லைத் தெளிவாகப் பேசிப் பதிவு செய்யவும்.
              பதிவேற்றப்படும் கோப்பு OGG வடிவில் இருக்க வேண்டும்.
            </p>

            <div style="text-align:center;margin:18px 0;">
              <button id="audio-start" type="button">
                ▶️ பதிவு தொடங்கு
              </button>
              <button id="audio-stop" type="button" hidden>
                ⏹️ நிறுத்து
              </button>
            </div>

            <audio id="audio-preview" controls
                   style="display:none;width:100%;margin:12px 0;">
            </audio>

            <div id="rec-status" role="status"
                 style="font-size:13px;text-align:center;
                 font-weight:bold;overflow-wrap:anywhere;">
            </div>

            <div style="display:flex;justify-content:space-between;
                 flex-wrap:wrap;margin-top:20px;">
              <button id="audio-cancel" type="button">
                ரத்து செய்
              </button>
              <button id="audio-upload" type="button" hidden>
                ☁️ Commons-ல் பதிவேற்று
              </button>
            </div>
          </div>
        </div>`;

        $('body').append(html);
        $('#audio-word').text(WORD);

        styleButton($('#audio-start'), '#218838');
        styleButton($('#audio-stop'), '#c82333');
        styleButton($('#audio-cancel'), '#6c757d');
        styleButton($('#audio-upload'), '#0069d9');

        $('#audio-start').on('click', startRecording);
        $('#audio-stop').on('click', stopRecording);
        $('#audio-cancel').on('click', closeModal);
        $('#audio-upload').on('click', uploadRecording);
    }

    async function startRecording() {
        const $start = $('#audio-start').prop('disabled', true);

        try {
            status('OGG பதிவு வசதி ஏற்றப்படுகிறது...', '#0056b3');

            const OpusRecorder = await loadOggLibrary();

            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error(
                    'ஒலிவாங்கி வசதி கிடைக்கவில்லை. HTTPS இணைப்பைப் பயன்படுத்தவும்.'
                );
            }

            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            chunks = [];
            oggBlob = null;

            recorder = new OpusRecorder(
                stream,
                {
                    mimeType: 'audio/ogg',
                    audioBitsPerSecond: 64000
                },
                workerOptions()
            );

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            recorder.onerror = event => {
                console.error('Recorder error:', event);

                status(
                    'ஒலிப்பதிவுப் பிழை: ' +
                    errorText(event.error || event),
                    'red'
                );
            };

            recorder.onstop = finishRecording;

            recorder.start();

            $start.hide();
            $('#audio-stop').prop('hidden', false).show();
            $('#audio-upload').prop('hidden', true).hide();

            status(
                'பதிவு நடைபெறுகிறது... சொல்லைத் தெளிவாகப் பேசவும்.',
                '#c62828'
            );
        } catch (error) {
            console.error(error);
            stopStream();

            status(
                'பதிவைத் தொடங்க முடியவில்லை: ' + errorText(error),
                'red'
            );

            $start.prop('disabled', false).show();
        }
    }

    function stopRecording() {
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }

        $('#audio-stop').hide();

        $('#audio-start')
            .prop('disabled', false)
            .text('🔄 மீண்டும் பதிவு செய்')
            .show();

        status('பதிவை நிறுத்துகிறது...', '#0056b3');
    }

    async function finishRecording() {
        stopStream();

        try {
            if (!chunks.length) {
                throw new Error('ஒலித் தரவு கிடைக்கவில்லை.');
            }

            const mime = (
                recorder?.mimeType ||
                chunks[0].type ||
                ''
            ).toLowerCase();

            if (!mime.includes('ogg')) {
                throw new Error(
                    'OGG வடிவ ஒலி கிடைக்கவில்லை. பெறப்பட்ட வடிவம்: ' +
                    (mime || 'தெரியவில்லை')
                );
            }

            oggBlob = new Blob(chunks, {
                type: 'audio/ogg'
            });

            if (!oggBlob.size) {
                throw new Error('ஒலிப்பதிவு காலியாக உள்ளது.');
            }

            clearPreview();

            previewURL = URL.createObjectURL(oggBlob);

            $('#audio-preview')
                .attr('src', previewURL)
                .show();

            $('#audio-upload')
                .prop('disabled', false)
                .prop('hidden', false)
                .text('☁️ Commons-ல் பதிவேற்று')
                .show();

            status(
                'OGG பதிவு தயார் (' +
                Math.ceil(oggBlob.size / 1024) +
                ' KB). ஒலியைக் கேட்டு உறுதிப்படுத்தவும்.',
                'green'
            );
        } catch (error) {
            console.error(error);
            oggBlob = null;

            $('#audio-upload').hide();

            status(
                'OGG பதிவு பிழை: ' + errorText(error),
                'red'
            );
        }
    }

    async function uploadRecording() {
        if (
            !oggBlob ||
            oggBlob.type !== 'audio/ogg' ||
            !oggBlob.size
        ) {
            status(
                'பதிவேற்றத்திற்கு செல்லுபடியான OGG கோப்பு தேவை.',
                'red'
            );
            return;
        }

        const $button = $('#audio-upload')
            .prop('disabled', true)
            .text('பதிவேற்றப்படுகிறது...');

        try {
            const commons = new mw.ForeignApi(COMMONS_API);

            status(
                'Commons கணக்கையும் கோப்புப் பெயரையும் சரிபார்க்கிறது...',
                '#0056b3'
            );

            const userResult = await commons.get({
                action: 'query',
                meta: 'userinfo',
                format: 'json'
            });

            if (
                !userResult.query?.userinfo ||
                userResult.query.userinfo.anon !== undefined
            ) {
                throw new Error(
                    'Wikimedia Commons-ல் உள்நுழையவும்.'
                );
            }

            const fileName = `Ta-${WORD}.ogg`;

            const titleResult = await commons.get({
                action: 'query',
                titles: `File:${fileName}`,
                formatversion: 2,
                format: 'json'
            });

            const existing = titleResult.query?.pages?.[0];

            if (existing && !existing.missing) {
                throw new Error(
                    `File:${fileName} ஏற்கெனவே Commons-ல் உள்ளது. ` +
                    'அதைச் சரிபார்த்து விக்சனரிப் பக்கத்தில் இணைக்கவும்.'
                );
            }

            status(
                'OGG கோப்பு Commons-ல் பதிவேற்றப்படுகிறது...',
                '#0056b3'
            );

            const description = [
                '== {{int:filedesc}} ==',
                '{{Information',
                `|description={{ta|${WORD} என்ற சொல்லின் ஒலிப்பு}}`,
                `|date=${new Date().toISOString().slice(0, 10)}`,
                '|source={{own}}',
                '|author=[[User:Neyakkoo|Neyakkoo]]',
                '}}',
                '',
                '== {{int:license-header}} ==',
                '{{CC-BY-SA-4.0}}',
                '',
                '[[Category:Tamil pronunciation]]'
            ].join('\n');

            const uploadResult = await commons.upload(
                oggBlob,
                {
                    filename: fileName,
                    comment: `Tamil pronunciation audio: ${WORD}`,
                    text: description,
                    format: 'json'
                }
            );

            if (uploadResult?.upload?.result !== 'Success') {
                throw new Error(
                    uploadResult?.error?.info ||
                    'Commons பதிவேற்றம் வெற்றியடையவில்லை.'
                );
            }

            status(
                'பதிவேற்றம் வெற்றி. விக்சனரிப் பக்கத்தை இணைக்கிறது...',
                'green'
            );

            await updateWiktionary(fileName);

            status(
                'OGG கோப்பு பதிவேற்றப்பட்டு பக்கத்தில் இணைக்கப்பட்டது.',
                'green'
            );

            setTimeout(closeModal, 1500);
            setTimeout(() => location.reload(), 1800);
        } catch (error) {
            console.error('Upload/link error:', error);

            status(
                'பிழை: ' + errorText(error),
                'red'
            );

            $button
                .prop('disabled', false)
                .text('☁️ மீண்டும் முயற்சி செய்');
        }
    }

    async function updateWiktionary(fileName) {
        const api = new mw.Api();

        const response = await api.get({
            action: 'query',
            prop: 'revisions',
            rvprop: 'content',
            titles: WORD,
            formatversion: 2
        });

        const page = response.query?.pages?.[0];

        if (!page || page.missing) {
            throw new Error('விக்சனரிப் பக்கத்தைக் கண்டறிய முடியவில்லை.');
        }

        const revision = page.revisions?.[0];

        if (!revision) {
            throw new Error('பக்க உள்ளடக்கத்தைப் பெற முடியவில்லை.');
        }

        let text = revision.content || '';

        if (hasAudioTemplate(text)) {
            throw new Error(
                'இந்தப் பக்கத்தில் ஒலிப்பு வார்ப்புரு ஏற்கெனவே உள்ளது. ' +
                'பதிவேற்றிய கோப்பை கைமுறையாக இணைக்கவும்: ' + fileName
            );
        }

        const template = `${AUDIO_TEMPLATE}\n`;

        const tamilHeading =
            /(^==\s*\{\{\s*மொழி\s*\|\s*ta\s*\}\}\s*==\s*)/m;

        if (tamilHeading.test(text)) {
            text = text.replace(
                tamilHeading,
                `$1\n${template}`
            );
        } else {
            text = `=={{மொழி|ta}}==\n\n${template}\n${text}`;
        }

        await api.postWithToken('csrf', {
            action: 'edit',
            title: WORD,
            text: text,
            summary: `ஒலிப்புக் கோப்பு இணைப்பு: ${fileName}`,
            format: 'json'
        });
    }

    $(initialize);
})();
