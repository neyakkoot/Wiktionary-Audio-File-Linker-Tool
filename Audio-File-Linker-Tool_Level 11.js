/* ============================================================
 * Tamil Wiktionary OGG Audio Recorder & Linker — Enhanced
 * Features:
 * 1. Detect existing Commons audio for the exact word filename
 * 2. Verify Commons file and Wiktionary template after upload
 * 3. Batch recording queue for multiple Tamil words
 * 4. Dashboard and browser-local progress history
 *
 * Install in ta.wiktionary.org/wiki/MediaWiki:Common.js
 * or your personal common.js. Test before wider deployment.
 * ============================================================ */
(function () {
    'use strict';

    if (!window.mw || !window.$) return;
    if (mw.config.get('wgNamespaceNumber') !== 0) return;

    const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
    const CDN = 'https://cdn.jsdelivr.net/npm/opus-media-recorder@0.8.0';
    const AUDIO_TEMPLATE = '{{ஒலிக்கோப்பு-தமிழ்|இந்தியா}}';
    const HISTORY_KEY = 'taWiktAudioRecorderHistoryV1';
    const QUEUE_KEY = 'taWiktAudioRecorderQueueV1';

    let recorder = null;
    let stream = null;
    let chunks = [];
    let oggBlob = null;
    let previewURL = null;
    let libraryPromise = null;
    let queue = [];
    let queueIndex = 0;
    let queueMode = false;
    let currentWord = mw.config.get('wgTitle');
    let currentPageText = '';
    let isBusy = false;

    if (!/^[\u0B80-\u0BFF\u0BE6-\u0BEF\s\-]+$/.test(currentWord)) {
        if (!/[\u0B80-\u0BFF]/.test(currentWord)) return;
    }

    function errorText(error) {
        if (!error) return 'தெரியாத பிழை';
        if (error.info) return error.info;
        if (error.message) return error.message;
        return String(error);
    }

    function setStatus(message, color) {
        $('#ta-audio-status').text(message).css('color', color || '#333');
    }

    function readJSON(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) {}
    }

    function getHistory() {
        return readJSON(HISTORY_KEY, []);
    }

    function recordHistory(word, result, fileName, note) {
        const history = getHistory();
        history.unshift({
            word: word,
            result: result,
            fileName: fileName || `Ta-${word}.ogg`,
            note: note || '',
            time: new Date().toISOString()
        });
        writeJSON(HISTORY_KEY, history.slice(0, 1000));
        renderDashboard();
    }

    function safeFileName(word) {
        return `Ta-${word}.ogg`;
    }

    function hasAudioTemplate(text) {
        return /\{\{\s*(ஒலிக்கோப்பு-தமிழ்|audio|ஒலிப்பு)\b/i.test(text || '');
    }

    function loadExternalScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(
                new Error('நூலகத்தை ஏற்ற முடியவில்லை: ' + url)
            );
            document.head.appendChild(script);
        });
    }

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
                throw new Error('Encoder Worker ஏற்றப்படவில்லை.');
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

    function styleButton($button, background) {
        $button.css({
            padding: '7px 11px',
            margin: '3px',
            border: '0',
            borderRadius: '5px',
            background: background,
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px'
        });
    }

    function addToolbarButtons() {
        if (!$('#ta-audio-toolbar').length) {
            const $toolbar = $('<span>', {
                id: 'ta-audio-toolbar'
            }).css({
                display: 'inline-flex',
                flexWrap: 'wrap',
                gap: '3px',
                marginLeft: '8px'
            });

            $('#firstHeading').append($toolbar);

            const $single = $('<button>', {
                type: 'button'
            }).text('🎙️ ஒலிப்பதிவு');

            styleButton($single, '#b83232');

            $single.on('click', async () => {
                try {
                    const check = await inspectWord(currentWord);

                    if (check.fileExists && check.pageHasTemplate) {
                        showNotice(
                            `இந்தச் சொல்லுக்கான OGG கோப்பும் பக்க இணைப்பும் ஏற்கெனவே உள்ளன: ${check.fileName}`,
                            'green'
                        );
                        return;
                    }

                    if (check.fileExists) {
                        showExistingFileAction(
                            currentWord,
                            check.fileName
                        );
                        return;
                    }

                    queue = [currentWord];
                    queueIndex = 0;
                    queueMode = false;
                    openRecorderModal();
                } catch (error) {
                    showNotice(errorText(error), 'red');
                }
            });

            const $batch = $('<button>', {
                type: 'button'
            }).text('📝 பல சொற்கள்');

            styleButton($batch, '#1769aa');
            $batch.on('click', openBatchDialog);

            const $dash = $('<button>', {
                type: 'button'
            }).text('📊 Dashboard');

            styleButton($dash, '#5e548e');
            $dash.on('click', openDashboard);

            $toolbar.append($single, $batch, $dash);
        }
    }

    function showNotice(message, color) {
        $('#ta-audio-notice').remove();

        const $notice = $('<div>', {
            id: 'ta-audio-notice'
        }).text(message).css({
            margin: '8px 0',
            padding: '8px 10px',
            border: '1px solid #ccc',
            borderRadius: '5px',
            color: color || '#333',
            fontSize: '13px'
        });

        $('#firstHeading').after($notice);

        setTimeout(() => {
            $notice.fadeOut(500, () => $notice.remove());
        }, 9000);
    }

    async function getPageData(word) {
        const api = new mw.Api();

        const response = await api.get({
            action: 'query',
            prop: 'revisions',
            rvprop: 'content',
            titles: word,
            formatversion: 2
        });

        const page = response?.query?.pages?.[0];

        return {
            exists: !!page && !page.missing,
            text: page?.revisions?.[0]?.content || ''
        };
    }

    async function commonsFileExists(fileName) {
        const api = new mw.ForeignApi(COMMONS_API);

        const response = await api.get({
            action: 'query',
            titles: `File:${fileName}`,
            formatversion: 2,
            prop: 'imageinfo',
            iiprop: 'url|mime|size'
        });

        const page = response?.query?.pages?.[0];

        if (!page || page.missing) {
            return { exists: false, page: null };
        }

        const info = page.imageinfo?.[0] || {};

        return {
            exists: true,
            page: page,
            url: info.url ||
                `https://commons.wikimedia.org/wiki/${encodeURIComponent('File:' + fileName)}`,
            mime: info.mime || '',
            size: info.size || 0
        };
    }

    async function inspectWord(word) {
        const fileName = safeFileName(word);

        const [pageData, fileData] = await Promise.all([
            getPageData(word),
            commonsFileExists(fileName)
        ]);

        return {
            word: word,
            fileName: fileName,
            pageExists: pageData.exists,
            pageText: pageData.text,
            pageHasTemplate: hasAudioTemplate(pageData.text),
            fileExists: fileData.exists,
            fileUrl: fileData.url || '',
            mime: fileData.mime || '',
            fileSize: fileData.size || 0
        };
    }

    function showExistingFileAction(word, fileName) {
        $('#ta-audio-existing').remove();

        const $box = $('<div>', {
            id: 'ta-audio-existing'
        }).css({
            padding: '10px',
            margin: '8px 0',
            border: '1px solid #d7b45a',
            borderRadius: '5px',
            background: '#fff9e6'
        });

        $box.append(
            $('<p>').text(
                `Commons-ல் ${fileName} ஏற்கெனவே உள்ளது.`
            )
        );

        const $link = $('<a>', {
            href: 'https://commons.wikimedia.org/wiki/' +
                encodeURIComponent('File:' + fileName),
            target: '_blank',
            rel: 'noopener noreferrer'
        }).text('Commons கோப்பைப் பார்க்கவும்');

        const $linkButton = $('<button>', {
            type: 'button'
        }).text('பக்கத்தில் ஒலிப்பு வார்ப்புருவை இணைக்கவும்');

        styleButton($linkButton, '#1769aa');

        $linkButton.on('click', async () => {
            $linkButton
                .prop('disabled', true)
                .text('சரிபார்க்கிறது...');

            try {
                const check = await inspectWord(word);

                if (check.pageHasTemplate) {
                    $linkButton.text('ஏற்கெனவே இணைக்கப்பட்டுள்ளது');

                    recordHistory(
                        word,
                        'already-linked',
                        fileName,
                        'Existing file and template'
                    );
                } else {
                    await updateWiktionary(word, fileName);

                    const verify = await verifyWiktionaryLink(word);

                    if (!verify.ok) {
                        throw new Error(
                            'பக்க இணைப்பை உறுதிப்படுத்த முடியவில்லை.'
                        );
                    }

                    $linkButton.text('இணைக்கப்பட்டது ✓');

                    recordHistory(
                        word,
                        'linked-existing',
                        fileName,
                        'Existing Commons file linked'
                    );
                }
            } catch (error) {
                $linkButton
                    .prop('disabled', false)
                    .text('மீண்டும் முயற்சி செய்');

                showNotice(errorText(error), 'red');
            }
        });

        $box.append(
            $('<div>').append($link, $('<br>'), $linkButton)
        );

        $('#firstHeading').after($box);
    }

    function openBatchDialog() {
        $('#ta-audio-batch-dialog').remove();

        const $modal = $('<div>', {
            id: 'ta-audio-batch-dialog'
        }).css({
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            background: 'rgba(0,0,0,.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '15px'
        });

        const $panel = $('<div>').css({
            background: '#fff',
            color: '#222',
            padding: '20px',
            borderRadius: '8px',
            width: 'min(520px,96vw)',
            maxHeight: '90vh',
            overflow: 'auto'
        });

        const $textarea = $('<textarea>', {
            id: 'ta-audio-batch-words',
            rows: 8,
            placeholder:
                'ஒவ்வொரு வரியிலும் ஒரு தமிழ் சொல் எழுதவும்\nஎ.கா.\nஅப்புதல்\nஅம்மா\nதமிழ்'
        }).css({
            width: '100%',
            boxSizing: 'border-box',
            margin: '10px 0'
        });

        const $start = $('<button>', {
            type: 'button'
        }).text('வரிசையைத் தொடங்கு');

        const $cancel = $('<button>', {
            type: 'button'
        }).text('ரத்து செய்');

        styleButton($start, '#1769aa');
        styleButton($cancel, '#6c757d');

        $start.on('click', () => {
            const words = [...new Set(
                $textarea.val()
                    .split(/[\n,;]+/)
                    .map(w => w.trim())
                    .filter(Boolean)
            )];

            if (!words.length) {
                $('#ta-batch-error')
                    .text('குறைந்தது ஒரு சொல்லையாவது உள்ளிடவும்.')
                    .css('color', 'red');
                return;
            }

            const invalid = words.filter(
                w => !/[\u0B80-\u0BFF]/.test(w)
            );

            if (invalid.length) {
                $('#ta-batch-error')
                    .text(
                        'தமிழ் எழுத்துகள் உள்ள சொற்களை மட்டும் உள்ளிடவும்: ' +
                        invalid.join(', ')
                    )
                    .css('color', 'red');
                return;
            }

            queue = words;
            queueIndex = 0;
            queueMode = true;

            writeJSON(QUEUE_KEY, {
                words: queue,
                index: 0,
                updated: new Date().toISOString()
            });

            $modal.remove();
            openRecorderModal();
        });

        $cancel.on('click', () => $modal.remove());

        $panel.append(
            $('<h2>').text(
                'பல சொற்களுக்கான தொடர்ச்சியான ஒலிப்பதிவு'
            ),
            $('<p>').text(
                'ஒவ்வொரு வரியிலும் ஒரு சொல் எழுதவும். ஏற்கெனவே கோப்பு உள்ள சொற்கள் தவிர்க்கப்படலாம்.'
            ),
            $textarea,
            $('<div>', { id: 'ta-batch-error' }),
            $start,
            $cancel
        );

        $modal.append($panel);
        $('body').append($modal);
    }

    function openRecorderModal() {
        $('#ta-audio-recorder-modal').remove();

        chunks = [];
        oggBlob = null;

        const word = queue[queueIndex] || currentWord;

        const $modal = $('<div>', {
            id: 'ta-audio-recorder-modal'
        }).css({
            position: 'fixed',
            inset: 0,
            zIndex: 100001,
            background: 'rgba(0,0,0,.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '15px'
        });

        const $panel = $('<div>').css({
            background: '#fff',
            color: '#222',
            padding: '20px',
            borderRadius: '9px',
            width: 'min(480px,96vw)',
            maxHeight: '90vh',
            overflow: 'auto'
        });

        const $word = $('<h2>')
            .css({ textAlign: 'center', marginTop: 0 })
            .text(`🎙️ ஒலிப்பதிவு: ${word}`);

        const $progress = $('<p>')
            .css({ textAlign: 'center', fontSize: '13px' })
            .text(
                queueMode
                    ? `சொல் ${queueIndex + 1} / ${queue.length}`
                    : 'ஒரு சொல்லுக்கான ஒலிப்பதிவு'
            );

        const $start = $('<button>', {
            id: 'ta-audio-start',
            type: 'button'
        }).text('▶️ பதிவு தொடங்கு');

        const $stop = $('<button>', {
            id: 'ta-audio-stop',
            type: 'button',
            hidden: true
        }).text('⏹️ நிறுத்து');

        const $audio = $('<audio>', {
            id: 'ta-audio-preview',
            controls: true
        }).css({
            display: 'none',
            width: '100%',
            margin: '12px 0'
        });

        const $status = $('<div>', {
            id: 'ta-audio-status',
            role: 'status'
        }).css({
            textAlign: 'center',
            fontWeight: 'bold',
            fontSize: '13px',
            overflowWrap: 'anywhere'
        });

        const $upload = $('<button>', {
            id: 'ta-audio-upload',
            type: 'button',
            hidden: true
        }).text('☁️ Commons-ல் பதிவேற்று');

        const $cancel = $('<button>', {
            id: 'ta-audio-cancel',
            type: 'button'
        }).text('ரத்து செய்');

        const $skip = $('<button>', {
            id: 'ta-audio-skip',
            type: 'button'
        }).text('இந்தச் சொல்லைத் தவிர்');

        styleButton($start, '#218838');
        styleButton($stop, '#c82333');
        styleButton($upload, '#1769aa');
        styleButton($cancel, '#6c757d');
        styleButton($skip, '#8a6d3b');

        $start.on('click', startRecording);
        $stop.on('click', stopRecording);
        $upload.on('click', uploadRecording);

        $cancel.on('click', () => {
            stopStream();
            clearPreview();
            $modal.remove();

            if (queueMode) {
                writeJSON(QUEUE_KEY, {
                    words: queue,
                    index: queueIndex,
                    cancelled: true,
                    updated: new Date().toISOString()
                });
            }
        });

        $skip.on('click', async () => {
            recordHistory(
                word,
                'skipped',
                safeFileName(word),
                'Skipped by user'
            );

            await moveToNextWord();
        });

        $panel.append(
            $word,
            $progress,
            $('<p>')
                .css({ textAlign: 'center', fontSize: '13px' })
                .text('பதிவேற்றப்படும் கோப்பு OGG வடிவில் இருக்க வேண்டும்.'),
            $('<div>')
                .css({ textAlign: 'center', margin: '16px 0' })
                .append($start, $stop),
            $audio,
            $status,
            $('<div>')
                .css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    marginTop: '18px'
                })
                .append($cancel, $skip, $upload)
        );

        $modal.append($panel);
        $('body').append($modal);

        inspectWord(word).then(check => {
            if (check.fileExists) {
                setStatus(
                    `Commons-ல் ${check.fileName} ஏற்கெனவே உள்ளது. புதிய கோப்பை உருவாக்கவில்லை.`,
                    '#8a6d3b'
                );

                $start.prop('disabled', true);

                const $linkExisting = $('<button>', {
                    type: 'button'
                }).text('ஏற்கெனவே உள்ள கோப்பை இணைக்கவும்');

                styleButton($linkExisting, '#1769aa');

                $linkExisting.on('click', async () => {
                    $linkExisting
                        .prop('disabled', true)
                        .text('இணைக்கிறது...');

                    try {
                        if (!check.pageHasTemplate) {
                            await updateWiktionary(
                                word,
                                check.fileName
                            );
                        }

                        const verification = await verifyAll(
                            word,
                            check.fileName
                        );

                        if (!verification.ok) {
                            throw new Error(verification.message);
                        }

                        recordHistory(
                            word,
                            'linked-existing',
                            check.fileName,
                            'Existing Commons file linked and verified'
                        );

                        setStatus(
                            'ஏற்கெனவே உள்ள கோப்பு இணைக்கப்பட்டு சரிபார்க்கப்பட்டது.',
                            'green'
                        );

                        setTimeout(moveToNextWord, 900);
                    } catch (error) {
                        setStatus(errorText(error), 'red');

                        $linkExisting
                            .prop('disabled', false)
                            .text('மீண்டும் முயற்சி செய்');
                    }
                });

                $status.after($linkExisting);

                if (check.pageHasTemplate) {
                    setStatus(
                        'கோப்பும் பக்க இணைப்பும் ஏற்கெனவே உள்ளன; இந்தச் சொல் தவிர்க்கப்படும்.',
                        'green'
                    );

                    recordHistory(
                        word,
                        'already-complete',
                        check.fileName,
                        'File and page template already exist'
                    );

                    setTimeout(moveToNextWord, 1300);
                }
            }
        }).catch(error => {
            console.warn('முன் சரிபார்ப்பு:', error);
        });
    }

    async function startRecording() {
        const $start = $('#ta-audio-start')
            .prop('disabled', true);

        try {
            setStatus(
                'OGG பதிவு வசதி ஏற்றப்படுகிறது...',
                '#1769aa'
            );

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
                if (event.data && event.data.size) {
                    chunks.push(event.data);
                }
            };

            recorder.onerror = event => {
                console.error(event);

                setStatus(
                    'பதிவுப் பிழை: ' +
                    errorText(event.error || event),
                    'red'
                );
            };

            recorder.onstop = finishRecording;

            recorder.start();

            $start.hide();

            $('#ta-audio-stop')
                .prop('hidden', false)
                .show();

            $('#ta-audio-upload')
                .prop('hidden', true)
                .hide();

            setStatus(
                'பதிவு நடைபெறுகிறது... சொல்லைத் தெளிவாகப் பேசவும்.',
                '#c62828'
            );
        } catch (error) {
            console.error(error);
            stopStream();

            setStatus(
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

        $('#ta-audio-stop').hide();

        $('#ta-audio-start')
            .prop('disabled', false)
            .text('🔄 மீண்டும் பதிவு செய்')
            .show();

        setStatus('பதிவை நிறுத்துகிறது...', '#1769aa');
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

            $('#ta-audio-preview')
                .attr('src', previewURL)
                .show();

            $('#ta-audio-upload')
                .prop('disabled', false)
                .prop('hidden', false)
                .show();

            setStatus(
                `OGG பதிவு தயார் (${Math.ceil(oggBlob.size / 1024)} KB). கேட்டுப் பார்த்து பதிவேற்றவும்.`,
                'green'
            );
        } catch (error) {
            console.error(error);
            oggBlob = null;

            $('#ta-audio-upload').hide();

            setStatus(
                'OGG பதிவு பிழை: ' + errorText(error),
                'red'
            );
        }
    }

    async function uploadRecording() {
        const word = queue[queueIndex] || currentWord;
        const fileName = safeFileName(word);

        if (!oggBlob || oggBlob.type !== 'audio/ogg' || !oggBlob.size) {
            setStatus('செல்லுபடியான OGG கோப்பு தேவை.', 'red');
            return;
        }

        if (isBusy) return;

        isBusy = true;

        const $button = $('#ta-audio-upload')
            .prop('disabled', true)
            .text('பதிவேற்றப்படுகிறது...');

        try {
            const commons = new mw.ForeignApi(COMMONS_API);

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

            const precheck = await commonsFileExists(fileName);

            if (precheck.exists) {
                throw new Error(
                    `File:${fileName} ஏற்கெனவே உள்ளது. அதை இணைக்கும் வசதியைப் பயன்படுத்தவும்.`
                );
            }

            setStatus(
                'Commons-ல் OGG கோப்பு பதிவேற்றப்படுகிறது...',
                '#1769aa'
            );

            const description = [
                '== {{int:filedesc}} ==',
                '{{Information',
                `|description={{ta|${word} என்ற சொல்லின் ஒலிப்பு}}`,
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

            const upload = await commons.upload(oggBlob, {
                filename: fileName,
                comment: `Tamil pronunciation audio: ${word}`,
                text: description,
                format: 'json'
            });

            if (upload?.upload?.result !== 'Success') {
                throw new Error(
                    upload?.error?.info ||
                    'Commons பதிவேற்றம் வெற்றியடையவில்லை.'
                );
            }

            setStatus(
                'பதிவேற்றம் வெற்றி. கோப்பையும் விக்சனரி இணைப்பையும் சரிபார்க்கிறது...',
                '#1769aa'
            );

            await wait(1200);

            await updateWiktionary(word, fileName);

            await wait(900);

            const verification = await verifyAll(word, fileName);

            if (!verification.ok) {
                recordHistory(
                    word,
                    'uploaded-unverified',
                    fileName,
                    verification.message
                );

                throw new Error(
                    'கோப்பு பதிவேற்றப்பட்டது; ஆனால் இணைப்பு சரிபார்ப்பு தோல்வி: ' +
                    verification.message
                );
            }

            recordHistory(
                word,
                'uploaded-verified',
                fileName,
                'Commons file and Wiktionary link verified'
            );

            setStatus(
                'வெற்றி! OGG கோப்பும் விக்சனரி இணைப்பும் சரிபார்க்கப்பட்டன.',
                'green'
            );

            await wait(1000);
            await moveToNextWord();
        } catch (error) {
            console.error('Upload/link error:', error);

            setStatus('பிழை: ' + errorText(error), 'red');

            $button
                .prop('disabled', false)
                .text('☁️ மீண்டும் முயற்சி செய்');

            recordHistory(
                word,
                'error',
                fileName,
                errorText(error)
            );
        } finally {
            isBusy = false;
        }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function updateWiktionary(word, fileName) {
        const api = new mw.Api();

        const response = await api.get({
            action: 'query',
            prop: 'revisions',
            rvprop: 'content',
            titles: word,
            formatversion: 2
        });

        const page = response.query?.pages?.[0];

        if (!page || page.missing) {
            throw new Error(`விக்சனரிப் பக்கம் இல்லை: ${word}`);
        }

        const revision = page.revisions?.[0];

        if (!revision) {
            throw new Error('பக்க உள்ளடக்கத்தைப் பெற முடியவில்லை.');
        }

        let text = revision.content || '';

        if (hasAudioTemplate(text)) return;

        const template = `${AUDIO_TEMPLATE}\n`;

        const languageHeading =
            /(^==\s*\{\{\s*மொழி\s*\|\s*ta\s*\}\}\s*==\s*)/m;

        if (languageHeading.test(text)) {
            text = text.replace(
                languageHeading,
                `$1\n${template}`
            );
        } else {
            text = `=={{மொழி|ta}}==\n\n${template}\n${text}`;
        }

        await api.postWithToken('csrf', {
            action: 'edit',
            title: word,
            text: text,
            summary: `ஒலிப்புக் கோப்பு இணைப்பு: ${fileName}`,
            format: 'json'
        });
    }

    async function verifyWiktionaryLink(word) {
        const page = await getPageData(word);

        return {
            ok: page.exists && hasAudioTemplate(page.text),
            pageText: page.text
        };
    }

    async function verifyAll(word, fileName) {
        const [file, link] = await Promise.all([
            commonsFileExists(fileName),
            verifyWiktionaryLink(word)
        ]);

        const ok = file.exists && link.ok;

        return {
            ok: ok,
            fileExists: file.exists,
            pageLinked: link.ok,
            message: !file.exists
                ? 'Commons கோப்பு காணப்படவில்லை.'
                : (!link.ok
                    ? 'விக்சனரி பக்கத்தில் ஒலிப்பு வார்ப்புரு இல்லை.'
                    : 'சரிபார்ப்பு வெற்றி')
        };
    }

    async function moveToNextWord() {
        stopStream();
        clearPreview();

        $('#ta-audio-recorder-modal').remove();

        recorder = null;
        oggBlob = null;
        isBusy = false;

        if (!queueMode) {
            renderDashboard();
            return;
        }

        queueIndex += 1;

        writeJSON(QUEUE_KEY, {
            words: queue,
            index: queueIndex,
            updated: new Date().toISOString()
        });

        while (queueIndex < queue.length) {
            const word = queue[queueIndex];

            try {
                const check = await inspectWord(word);

                if (check.fileExists && check.pageHasTemplate) {
                    recordHistory(
                        word,
                        'already-complete',
                        check.fileName,
                        'Skipped: file and template exist'
                    );

                    queueIndex += 1;

                    writeJSON(QUEUE_KEY, {
                        words: queue,
                        index: queueIndex,
                        updated: new Date().toISOString()
                    });

                    continue;
                }

                if (check.fileExists) {
                    openRecorderModal();
                    return;
                }

                openRecorderModal();
                return;
            } catch (error) {
                recordHistory(
                    word,
                    'error',
                    safeFileName(word),
                    errorText(error)
                );

                queueIndex += 1;
            }
        }

        queueMode = false;

        writeJSON(QUEUE_KEY, {
            words: queue,
            index: queueIndex,
            completed: true,
            updated: new Date().toISOString()
        });

        showNotice(
            `தொடர் ஒலிப்பதிவு முடிந்தது. ${queue.length} சொற்கள் செயலாக்கப்பட்டன. Dashboard-ல் விவரங்களைப் பார்க்கவும்.`,
            'green'
        );

        renderDashboard();
    }

    function renderDashboard() {
        const history = getHistory();
        const today = new Date().toISOString().slice(0, 10);

        const uploaded = history.filter(
            x => x.result === 'uploaded-verified'
        ).length;

        const linked = history.filter(
            x => x.result === 'linked-existing'
        ).length;

        const existing = history.filter(
            x => x.result === 'already-complete'
        ).length;

        const skipped = history.filter(
            x => x.result === 'skipped'
        ).length;

        const errors = history.filter(
            x => x.result === 'error' ||
                 x.result === 'uploaded-unverified'
        ).length;

        const todayCount = history.filter(
            x => (x.time || '').startsWith(today) &&
                (
                    x.result === 'uploaded-verified' ||
                    x.result === 'linked-existing'
                )
        ).length;

        return {
            history,
            uploaded,
            linked,
            existing,
            skipped,
            errors,
            todayCount,
            total: history.length
        };
    }

    function openDashboard() {
        $('#ta-audio-dashboard').remove();

        const data = renderDashboard();

        const $modal = $('<div>', {
            id: 'ta-audio-dashboard'
        }).css({
            position: 'fixed',
            inset: 0,
            zIndex: 100002,
            background: 'rgba(0,0,0,.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '15px'
        });

        const $panel = $('<div>').css({
            background: '#fff',
            color: '#222',
            padding: '20px',
            borderRadius: '9px',
            width: 'min(760px,97vw)',
            maxHeight: '90vh',
            overflow: 'auto'
        });

        const $grid = $('<div>').css({
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
            gap: '8px'
        });

        const cards = [
            ['பதிவேற்றம் + சரிபார்ப்பு', data.uploaded, '#e7f5e8'],
            ['ஏற்கெனவே இருந்த கோப்பு இணைப்பு', data.linked, '#e8f1ff'],
            ['முன்பே முழுமை', data.existing, '#f0ebff'],
            ['தவிர்க்கப்பட்டது', data.skipped, '#fff4df'],
            ['பிழைகள்', data.errors, '#ffe8e8'],
            ['இன்று இணைத்தவை', data.todayCount, '#e8f7f7']
        ];

        cards.forEach(([label, value, bg]) => {
            $grid.append(
                $('<div>').css({
                    background: bg,
                    padding: '12px',
                    borderRadius: '7px'
                }).append(
                    $('<div>').css({ fontSize: '12px' }).text(label),
                    $('<strong>').css({
                        display: 'block',
                        fontSize: '25px',
                        marginTop: '5px'
                    }).text(value)
                )
            );
        });

        const $table = $('<table>').css({
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '14px',
            fontSize: '13px'
        });

        const $thead = $('<tr>');

        ['சொல்', 'நிலை', 'நேரம்', 'குறிப்பு'].forEach(t => {
            $thead.append(
                $('<th>').css({
                    textAlign: 'left',
                    padding: '7px',
                    borderBottom: '1px solid #ccc'
                }).text(t)
            );
        });

        $table.append($('<thead>').append($thead));

        const $tbody = $('<tbody>');

        data.history.slice(0, 100).forEach(item => {
            const date = item.time
                ? new Date(item.time).toLocaleString()
                : '';

            const $row = $('<tr>');

            [
                item.word,
                item.result,
                date,
                item.note || ''
            ].forEach(value => {
                $row.append(
                    $('<td>').css({
                        padding: '7px',
                        borderBottom: '1px solid #eee',
                        verticalAlign: 'top'
                    }).text(value)
                );
            });

            $tbody.append($row);
        });

        $table.append($tbody);

        const $export = $('<button>', {
            type: 'button'
        }).text('CSV அறிக்கையைப் பதிவிறக்கு');

        const $clear = $('<button>', {
            type: 'button'
        }).text('உள்ளூர் வரலாற்றை அழி');

        const $close = $('<button>', {
            type: 'button'
        }).text('மூடு');

        styleButton($export, '#1769aa');
        styleButton($clear, '#a33');
        styleButton($close, '#6c757d');

        $export.on('click', () => {
            const rows = [
                ['word', 'result', 'fileName', 'time', 'note'],
                ...data.history.map(x => [
                    x.word,
                    x.result,
                    x.fileName,
                    x.time,
                    x.note
                ])
            ];

            const csv = rows.map(row =>
                row.map(v =>
                    '"' + String(v || '').replace(/"/g, '""') + '"'
                ).join(',')
            ).join('\r\n');

            const blob = new Blob(
                ['\uFEFF' + csv],
                { type: 'text/csv;charset=utf-8;' }
            );

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');

            a.href = url;
            a.download = 'tamil-wiktionary-audio-progress.csv';
            a.click();

            URL.revokeObjectURL(url);
        });

        $clear.on('click', () => {
            if (confirm(
                'இந்த உலாவியில் சேமிக்கப்பட்ட Dashboard வரலாற்றை அழிக்கவா? Commons கோப்புகள் அழிக்கப்படாது.'
            )) {
                writeJSON(HISTORY_KEY, []);
                $modal.remove();
                openDashboard();
            }
        });

        $close.on('click', () => $modal.remove());

        $panel.append(
            $('<h2>').text('📊 தமிழ் விக்சனரி ஒலிப்பதிவு Dashboard'),
            $('<p>').text(
                `இந்த உலாவியில் சேமிக்கப்பட்ட வரலாறு: ${data.total} பதிவுகள். இது உள்ளூர் Dashboard; மற்ற கணினிகள் அல்லது உலாவிகளின் வரலாறு இதில் தானாகச் சேராது.`
            ),
            $grid,
            $('<h3>').text('சமீபத்திய செயல்பாடுகள்'),
            $table,
            $export,
            $clear,
            $close
        );

        $modal.append($panel);
        $('body').append($modal);
    }

    $(function () {
        addToolbarButtons();

        inspectWord(currentWord).then(check => {
            if (check.fileExists && check.pageHasTemplate) {
                showNotice(
                    `இந்தச் சொல்லுக்கான ஒலிப்புக் கோப்பும் இணைப்பும் ஏற்கெனவே உள்ளன (${check.fileName}).`,
                    'green'
                );
            } else if (check.fileExists) {
                showNotice(
                    `Commons-ல் ${check.fileName} உள்ளது; விக்சனரி பக்கத்தில் இணைப்பு இல்லாமல் இருக்கலாம்.`,
                    '#8a6d3b'
                );
            }
        }).catch(error => {
            console.warn('Audio precheck failed:', error);
        });
    });
})();
