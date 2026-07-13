import { chordToolName } from '../src/mcpContract';

export function renderChordApp() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #101418; color: #f7f2e8; }
    .app { min-height: 100vh; display: grid; grid-template-columns: minmax(120px, 180px) 1fr; gap: 22px; align-items: center; padding: 22px; box-sizing: border-box; opacity: 0; transition: opacity .12s ease; }
    .app.ready { opacity: 1; }
    .diagram { width: 100%; max-width: 190px; aspect-ratio: 100 / 190; }
    .string { stroke: #e8ddc7; stroke-width: 1.5; opacity: .86; }
    .fret { stroke: #6a737d; stroke-width: 1; }
    .nut { stroke: #f3d27b; stroke-width: 5; stroke-linecap: round; }
    .dot { fill: #6bd1a4; filter: drop-shadow(0 4px 10px rgba(107, 209, 164, .3)); }
    .finger { fill: #101418; font-size: 10px; font-weight: 800; }
    .open, .label { fill: #d9c9ae; font-size: 10px; font-weight: 700; }
    h1 { margin: 0 0 8px; font-size: clamp(30px, 8vw, 58px); letter-spacing: 0; }
    p { margin: 0; color: #d9c9ae; font-size: 16px; line-height: 1.5; }
    .notes { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
    .note { border: 1px solid #37424d; padding: 6px 9px; border-radius: 999px; font-weight: 700; color: #e8ddc7; }
    .controls { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
    button { min-height: 38px; border: 1px solid #37424d; border-radius: 8px; background: #171d22; color: #f7f2e8; padding: 0 13px; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
    button.primary { background: #6bd1a4; border-color: #6bd1a4; color: #101418; }
    button:disabled { cursor: wait; opacity: .62; }
    .empty { color: #d9c9ae; font-weight: 700; }
    @media (max-width: 560px) { .app { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
  </style>
</head>
<body>
	  <main class="app" id="app">
	    <svg viewBox="0 0 100 190" class="diagram" role="img" aria-label="Ukulele chord diagram" id="diagram"></svg>
	    <section>
      <h1 id="title">Chord card</h1>
      <p id="tip" class="empty">Waiting for tool result data.</p>
      <div class="notes" aria-label="Chord notes" id="notes"></div>
      <div class="controls" aria-label="Practice actions">
        <button type="button" id="back-button">Back</button>
        <button type="button" class="primary" id="next-button">Next</button>
      </div>
    </section>
	  </main>
	  <script>
	    const strings = ['G', 'C', 'E', 'A'];
	    const svgNamespace = 'http://www.w3.org/2000/svg';
	    const protocolVersion = '2026-01-26';
	    let nextRequestId = 1;
	    let initialized = false;
	    let currentChord = null;
	    const pendingRequests = new Map();
	    const backButton = document.getElementById('back-button');
	    const nextButton = document.getElementById('next-button');

	    function svgElement(tagName, attributes = {}) {
	      const element = document.createElementNS(svgNamespace, tagName);
      for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
      }
      return element;
    }

    function appendText(parent, attributes, text) {
      const element = svgElement('text', attributes);
      element.textContent = text;
      parent.appendChild(element);
    }

    function renderChord(chord) {
      if (!chord || !Array.isArray(chord.frets)) return;
      currentChord = chord;

      const diagram = document.getElementById('diagram');
      diagram.setAttribute('aria-label', chord.title + ' ukulele chord diagram');
      diagram.replaceChildren();

      const maxFret = Math.max(4, ...chord.frets);
      for (let index = 0; index <= maxFret; index += 1) {
        const y = 34 + index * 34;
        diagram.appendChild(svgElement('line', {
          x1: 12,
          y1: y,
          x2: 88,
          y2: y,
          class: index === 0 ? 'nut' : 'fret',
        }));
      }

      strings.forEach((stringName, index) => {
        const fret = chord.frets[index];
        const left = 12 + index * 25.4;
        const y = fret === 0 ? 16 : 44 + (fret - 0.5) * 34;
        diagram.appendChild(svgElement('line', {
          x1: left,
          y1: 34,
          x2: left,
          y2: 42 + maxFret * 34,
          class: 'string',
        }));
        appendText(diagram, {
          x: left,
          y: 36 + maxFret * 34,
          'text-anchor': 'middle',
          class: 'label',
        }, stringName);

        if (fret === 0) {
          appendText(diagram, {
            x: left,
            y: 20,
            'text-anchor': 'middle',
            class: 'open',
          }, '○');
          return;
        }

        diagram.appendChild(svgElement('circle', {
          cx: left,
          cy: y,
          r: 10,
          class: 'dot',
        }));
	        appendText(diagram, {
	          x: left,
	          y: y + 4,
	          'text-anchor': 'middle',
	          class: 'finger',
	        }, chord.fingers?.[index] || '');
	      });

      document.getElementById('title').textContent = chord.title;
      document.getElementById('tip').textContent = chord.tip;
      document.getElementById('tip').classList.remove('empty');

      const notes = document.getElementById('notes');
      notes.replaceChildren();
      for (const note of chord.notes || []) {
        const noteElement = document.createElement('span');
        noteElement.className = 'note';
        noteElement.textContent = note;
        notes.appendChild(noteElement);
      }

      document.getElementById('app').classList.add('ready');
	      setControlsDisabled(false);
	      sendSizeChanged();
	    }

	    function sendJsonRpc(message) {
	      window.parent.postMessage(message, '*');
	    }

	    function sendRequest(method, params) {
	      const id = nextRequestId++;
	      sendJsonRpc({ jsonrpc: '2.0', id, method, params });
	      return new Promise((resolve, reject) => {
	        pendingRequests.set(id, { resolve, reject });
	        window.setTimeout(() => {
	          if (!pendingRequests.has(id)) return;
	          pendingRequests.delete(id);
	          reject(new Error(method + ' timed out'));
	        }, 5000);
	      });
	    }

	    function sendNotification(method, params = {}) {
	      sendJsonRpc({ jsonrpc: '2.0', method, params });
	    }

	    function setControlsDisabled(disabled) {
	      backButton.disabled = disabled || !currentChord;
	      nextButton.disabled = disabled || !currentChord;
	    }

	    async function callChordTool(chord) {
	      if (!chord) return;
	      setControlsDisabled(true);
	      try {
	        const result = await sendRequest('tools/call', {
	          name: '${chordToolName}',
	          arguments: { chord },
	        });
	        renderChord(result.structuredContent);
	      } catch (error) {
	        console.error('[ukulele-card] tool call failed', error);
	      } finally {
	        setControlsDisabled(false);
	      }
	    }

	    function sendSizeChanged() {
	      const bounds = document.documentElement.getBoundingClientRect();
	      sendNotification('ui/notifications/size-changed', {
	        width: Math.ceil(bounds.width),
	        height: Math.ceil(bounds.height),
	      });
	    }

	    async function initialize() {
	      if (initialized) return;
	      try {
	        await sendRequest('ui/initialize', {
	          protocolVersion,
	          appInfo: { name: 'ukulele-chord-card', version: '0.1.0' },
	          appCapabilities: {},
	        });
	        initialized = true;
	        sendNotification('ui/notifications/initialized');
	        sendSizeChanged();
	      } catch {
	        if (!initialized) window.setTimeout(initialize, 250);
	      }
	    }

	    window.addEventListener('message', (event) => {
	      const data = event.data;
	      if (!data || typeof data !== 'object') return;

	      if (data.jsonrpc === '2.0' && Object.prototype.hasOwnProperty.call(data, 'id')) {
	        const pending = pendingRequests.get(data.id);
	        if (!pending) return;
	        pendingRequests.delete(data.id);
	        if (data.error) {
	          pending.reject(new Error(data.error.message || 'JSON-RPC request failed'));
	        } else {
	          pending.resolve(data.result);
	        }
	        return;
	      }

	      if (data.method === 'ui/notifications/tool-input') {
	        return;
	      }

	      if (data.method === 'ui/notifications/tool-result') {
	        renderChord(data.params?.structuredContent);
	      }
	    });

	    const resizeObserver = new ResizeObserver(sendSizeChanged);
	    resizeObserver.observe(document.documentElement);
	    resizeObserver.observe(document.body);
	    setControlsDisabled(true);
	    backButton.addEventListener('click', () => callChordTool(currentChord?.previous));
	    nextButton.addEventListener('click', () => callChordTool(currentChord?.next));
	    initialize();
	  </script>
	</body>
	</html>`;
}


