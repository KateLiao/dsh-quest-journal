#!/usr/bin/env python3
"""Optional native mouse-drag regression test, using installed DSH React assets.
No external downloads, real profile, credentials or journal data are used.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import time
from pathlib import Path

root = Path(__file__).resolve().parent.parent
app = Path(os.environ.get('QJ_DSH_APP', '/Applications/DeepSeek Harness.app'))
chrome = os.environ.get('QJ_CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
node = os.environ.get('DSH_NODE') or shutil.which('node')
if not node:
    node = next(str(p) for p in (Path.home()/'.dsh/dsh-runtimes').glob('*/dependencies/node/bin/node'))

with open(app/'Contents/Resources/app.asar', 'rb') as source:
    _, header_size, _, json_size = struct.unpack('<4I', source.read(16))
    header = json.loads(source.read(json_size))
    files = {}
    def walk(tree, prefix=''):
        for key, value in tree.get('files', {}).items():
            path = prefix + '/' + key
            if 'files' in value:
                walk(value, path)
            else:
                files[path] = value
    walk(header)
    def read(path):
        entry = files[path]
        source.seek(8 + header_size + int(entry['offset']))
        return source.read(entry['size']).decode()
    prefix = '/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/'
    index = next(k for k in files if k.startswith(prefix+'index-') and k.endswith('.js'))
    runtime = read(index)
    symbols = re.search(r'return\{react:([\w$]+),"react/jsx-runtime":[\w$]+,"react-dom":[\w$]+,"react-dom/client":([\w$]+)', runtime)
    vendor = re.search(r'from"\./(vendor-[^"]+\.js)"', runtime)
    boot = re.search(r'const [\w$]+=globalThis\.dshDesktopBoot', runtime)
    if not (symbols and vendor and boot):
        raise RuntimeError('Unsupported installed DSH browser bundle for this optional test')
    runtime = runtime[:boot.start()].replace('./'+vendor[1], './vendor.mjs')
    runtime += f'\nwindow.qjReact={symbols[1]};window.qjReactDom={symbols[2]};\n'
    vendor_source = read(prefix+vendor[1])

with tempfile.TemporaryDirectory(prefix='qj-native-drag-') as directory:
    work = Path(directory)
    (work/'runtime.mjs').write_text(runtime)
    (work/'vendor.mjs').write_text(vendor_source)
    (work/'client.mjs').write_text((root/'packages/dsh-client-ui-quest-journal/lib/client.js').read_text())
    shutil.copyfile(root/os.environ.get('QJ_BROWSER_HARNESS','test/browser-drag-harness.mjs'), work/'harness.mjs')
    (work/'web.mjs').write_text((root/'packages/dsh-quest-journal/lib/web.js').read_text())
    (work/'index.html').write_text('<!doctype html><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;background:#171410}</style><div id="root"></div><script type="module" src="./harness.mjs"></script>')
    profile = work/'profile'
    with open(work/'chrome.log', 'w') as log:
        process = subprocess.Popen([chrome, '--headless', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--remote-debugging-port=0', '--user-data-dir='+str(profile), '--window-size=1440,1100', (work/'index.html').as_uri()], stdout=log, stderr=log)
        try:
            endpoint = profile/'DevToolsActivePort'
            for _ in range(200):
                if endpoint.exists():
                    break
                if process.poll() is not None:
                    raise RuntimeError('Chrome exited; '+(work/'chrome.log').read_text())
                time.sleep(.05)
            port = endpoint.read_text().splitlines()[0]
            subprocess.run([node, str(root/os.environ.get('QJ_BROWSER_TEST','test/browser-drag.test.mjs'))], env={**os.environ, 'QJ_BROWSER_PORT': port,'QJ_WEB_MODULE':(work/'web.mjs').as_uri()}, check=True, timeout=60)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
