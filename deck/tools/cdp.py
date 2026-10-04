# -*- coding: utf-8 -*-
"""Tiny Chrome DevTools Protocol driver for headless Edge/Chrome (no extra installs besides websocket-client).
Used by shoot.py to take screenshots, read console errors and evaluate JS in the deck / remote.
"""
import base64, json, os, shutil, subprocess, tempfile, time, urllib.request

import websocket  # pip install websocket-client

CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
]


class Browser:
    def __init__(self, port=9333, exe=None):
        exe = exe or next((p for p in CANDIDATES if os.path.exists(p)), None)
        if not exe:
            raise SystemExit("Edge/Chrome not found")
        self.port = port
        self.prof = tempfile.mkdtemp(prefix="grino_cdp_")
        self.proc = subprocess.Popen([exe, "--headless=new", f"--remote-debugging-port={port}", "--remote-allow-origins=*",
                                      f"--user-data-dir={self.prof}", "--no-first-run", "--no-default-browser-check",
                                      "--disable-extensions", "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb",
                                      "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tabs = None
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                if any(t.get("type") == "page" for t in tabs):
                    break
            except Exception:
                pass
            time.sleep(0.2)
        page = [t for t in tabs if t.get("type") == "page"][0]
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
        self.mid = 0
        self.events = []
        for m in ("Runtime.enable", "Log.enable", "Page.enable", "Network.enable"):
            self.call(m)

    def call(self, method, params=None):
        self.mid += 1
        mid = self.mid
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)

    def pump(self, seconds):
        """process events for a while (keeps console messages)"""
        end = time.time() + seconds
        self.ws.settimeout(0.2)
        while time.time() < end:
            try:
                self.events.append(json.loads(self.ws.recv()))
            except Exception:
                pass
        self.ws.settimeout(60)

    def viewport(self, w, h, scale=1, mobile=False):
        self.call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": scale, "mobile": mobile})
        if mobile:
            self.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})

    def goto(self, url, wait=2.0):
        self.call("Page.navigate", {"url": url})
        self.pump(wait)

    def js(self, expr, wait_promise=True):
        r = self.call("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": wait_promise})
        if r.get("exceptionDetails"):
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
        return r.get("result", {}).get("value")

    def shot(self, path):
        r = self.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(r["data"]))
        return path

    def errors(self):
        out = []
        for e in self.events:
            m = e.get("method")
            p = e.get("params", {})
            if m == "Runtime.exceptionThrown":
                d = p.get("exceptionDetails", {})
                out.append("EXC " + (d.get("exception", {}).get("description") or d.get("text", ""))[:300])
            elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "warning", "assert"):
                out.append(p["type"].upper() + " " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))[:300])
            elif m == "Log.entryAdded" and p.get("entry", {}).get("level") in ("error", "warning"):
                en = p["entry"]
                out.append("LOG " + en.get("level", "") + " " + en.get("text", "")[:200] + " " + en.get("url", "")[:120])
            elif m == "Network.loadingFailed" and not p.get("canceled"):
                out.append("NET " + p.get("errorText", "") + " " + p.get("requestId", ""))
        return out

    def close(self):
        try:  # graceful: Browser.close on the browser target, so no child processes are left behind
            v = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/version", timeout=2))
            b = websocket.create_connection(v["webSocketDebuggerUrl"], timeout=5, suppress_origin=True)
            b.send(json.dumps({"id": 1, "method": "Browser.close"}))
            time.sleep(0.5)
            b.close()
        except Exception:
            pass
        try:
            self.ws.close()
        except Exception:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(5)
        except Exception:
            pass
        shutil.rmtree(self.prof, ignore_errors=True)
