export const mcpSandboxProxyHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <style>
    html, body {
      background: #101418;
      color-scheme: dark;
      height: 100%;
      margin: 0;
      overflow: hidden;
    }

    iframe {
      background: #101418;
      border: 0;
      display: block;
      height: 100vh;
      opacity: 0;
      width: 100%;
    }

    iframe.ready {
      opacity: 1;
    }
  </style>
</head>
<body>
  <script>
    (() => {
      let appFrame = null;
      let hasResource = false;
      const parentWindow = window.parent;
      const parentOrigin = (() => {
        try {
          return document.referrer ? new URL(document.referrer).origin : null;
        } catch {
          return null;
        }
      })();
      const parentTargetOrigin = parentOrigin || '*';

      function isJsonRpcMessage(data) {
        return data && typeof data === 'object' && data.jsonrpc === '2.0';
      }

      function notifyProxyReady() {
        parentWindow.postMessage({
          jsonrpc: '2.0',
          method: 'ui/notifications/sandbox-proxy-ready',
          params: {}
        }, parentTargetOrigin);
      }

      function mountResource(params) {
        if (!params || typeof params.html !== 'string') return;

        hasResource = true;
        if (appFrame) {
          appFrame.remove();
          appFrame = null;
        }

        appFrame = document.createElement('iframe');
        appFrame.sandbox = typeof params.sandbox === 'string' ? params.sandbox : 'allow-scripts';
        appFrame.addEventListener('load', () => {
          appFrame?.classList.add('ready');
        }, { once: true });
        appFrame.srcdoc = params.html;
        document.body.replaceChildren(appFrame);
      }

      window.addEventListener('message', (event) => {
        if (event.source === parentWindow) {
          if (parentOrigin && event.origin !== parentOrigin) return;

          if (
            isJsonRpcMessage(event.data) &&
            event.data.method === 'ui/notifications/sandbox-resource-ready'
          ) {
            mountResource(event.data.params);
            return;
          }

          if (appFrame?.contentWindow && isJsonRpcMessage(event.data)) {
            appFrame.contentWindow.postMessage(event.data, '*');
          }
          return;
        }

        if (appFrame?.contentWindow && event.source === appFrame.contentWindow && isJsonRpcMessage(event.data)) {
          parentWindow.postMessage(event.data, parentTargetOrigin);
        }
      });

      notifyProxyReady();
      const readyTimer = window.setInterval(() => {
        if (hasResource) {
          window.clearInterval(readyTimer);
          return;
        }
        notifyProxyReady();
      }, 100);
    })();
  </script>
</body>
</html>`;
